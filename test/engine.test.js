import test from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, createEngine, normalizeConfig } from '../lib/core.js'

const CONFIGURED = normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 }).config

function turnEnd(seq, turn, kind = 'completed') {
  return { type: 'turn/end', seq, data: { turn, reason: { kind } } }
}

function userEvent(seq, text) {
  return {
    type: 'user/message',
    seq,
    data: { id: `u${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
  }
}

function assistantEvent(seq, turn, text) {
  return {
    type: 'assistant/message',
    seq,
    data: {
      turn,
      step: 0,
      message: { id: `a${seq}`, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } },
      stream: [],
    },
  }
}

/** Build a session whose log ends with the given turn/end event. */
function sessionWith(id, turns, header = {}) {
  const events = []
  let seq = 1
  for (const turn of turns) {
    events.push(userEvent(seq += 1, turn.question || `question ${turn.turn}`))
    if (turn.answer !== undefined) events.push(assistantEvent(seq += 1, turn.turn, turn.answer))
    events.push(turnEnd(seq += 1, turn.turn, turn.kind || 'completed'))
  }
  return {
    id,
    header: { id, ...header },
    events,
    lastEvent: events[events.length - 1],
  }
}

function fakeLlm(script = []) {
  const calls = []
  const resolveCalls = []
  const llm = {
    calls,
    resolveCalls,
    efforts: undefined,
    resolveModelInfo(provider, model) {
      resolveCalls.push([provider, model])
      return Promise.resolve({ provider, id: model, name: model, reasoning: llm.efforts })
    },
    stream(options) {
      calls.push(options)
      const reply = script.shift()
      if (reply instanceof Error) {
        return (async function* stream() {
          throw reply
        })()
      }
      const text = reply === undefined ? '{"note":null,"importance":null}' : reply
      return (async function* stream() {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
      })()
    },
  }
  return llm
}

function engineWith(script, overrides = {}) {
  const llm = fakeLlm(script)
  const errors = []
  const engine = createEngine({
    config: { ...CONFIGURED, ...overrides },
    getLlm: () => llm,
    now: () => 1700000000000,
    onError: (error) => errors.push(error),
  })
  return { engine, llm, errors }
}

async function observeAndSettle(engine, session) {
  const outcome = engine.observe(session, session.lastEvent)
  if (outcome.promise) return await outcome.promise
  return outcome
}

test('a real Session is read through snapshotEvents(), not a private events field', async () => {
  const { engine, llm, errors } = engineWith(['{"note":"N","importance":"high"}'])
  const session = sessionWith('s1', [{ turn: 1, answer: 'work' }])
  // A live Session exposes no public events array; the supported read is
  // snapshotEvents(). Rebuild the double in that shape so the reviewer path is
  // exercised the way the host actually calls it.
  const live = {
    header: { id: 's1' },
    snapshotEvents: () => session.events,
    lastEvent: session.lastEvent,
  }
  const outcome = await observeAndSettle(engine, live)
  assert.equal(outcome.status, 'noted')
  assert.equal(engine.notes('s1').length, 1)
  assert.equal(llm.calls.length, 1)
  assert.deepEqual(errors, [])
})

test('a Session whose log accessor is unavailable is never reviewed', async () => {
  const { engine, llm } = engineWith(['{"note":"N","importance":"high"}'])
  const real = sessionWith('s2', [{ turn: 1, answer: 'work' }])
  const hostile = {
    header: { id: 's2' },
    snapshotEvents() {
      throw new Error('log unavailable')
    },
    lastEvent: real.lastEvent,
  }
  const outcome = await observeAndSettle(engine, hostile)
  assert.equal(outcome.status, 'empty')
  assert.equal(llm.calls.length, 0)
})

test('the event feed keeps one window and reads the committed log once', async () => {
  const { engine, llm } = engineWith([
    '{"note":"feed note one","importance":"high"}',
    '{"note":"feed note two","importance":"high"}',
  ], { minDeltaChars: 0, cooldownTurns: 1 })

  const events = []
  let snapshotCalls = 0
  const session = {
    header: { id: 'feed' },
    snapshotEvents() {
      snapshotCalls += 1
      return events.slice()
    },
  }
  const feed = (event) => {
    events.push(event)
    return engine.observe(session, event)
  }

  feed(userEvent(1, 'first question'))
  feed(assistantEvent(2, 1, 'first answer'))
  const first = feed(turnEnd(3, 1))
  assert.equal(first.status, 'reviewing')
  await first.promise
  assert.equal(snapshotCalls, 1)

  feed(userEvent(4, 'second question'))
  feed(assistantEvent(5, 2, 'second answer'))
  const second = feed(turnEnd(6, 2))
  assert.equal(second.status, 'reviewing')
  await second.promise
  assert.equal(snapshotCalls, 1, 'a contiguous feed never re-reads the log')
  assert.equal(engine.notes('feed').length, 2)
  assert.equal(llm.calls.length, 2)
})

test('a feed gap recovers the committed log once and stays correct', async () => {
  const { engine } = engineWith([
    '{"note":"resumed finding","importance":"high"}',
    '{"note":"after the gap","importance":"critical"}',
  ], { minDeltaChars: 0, cooldownTurns: 1 })

  const events = []
  let snapshotCalls = 0
  const session = {
    header: { id: 'gap' },
    snapshotEvents() {
      snapshotCalls += 1
      return events.slice()
    },
  }
  const feed = (event) => {
    events.push(event)
    return engine.observe(session, event)
  }

  // History published before this engine mounted.
  events.push(userEvent(1, 'resumed question'), assistantEvent(2, 1, 'resumed answer'))
  const resumed = feed(turnEnd(3, 1))
  assert.equal(resumed.status, 'reviewing')
  await resumed.promise
  assert.equal(snapshotCalls, 1)

  // A committed event this listener never observed creates a real gap.
  events.push(userEvent(4, 'gap question'))
  const gap = feed(assistantEvent(5, 2, 'gap answer'))
  assert.equal(gap.status, 'ignored')
  const outcome = feed(turnEnd(6, 2))
  assert.equal(outcome.status, 'reviewing')
  await outcome.promise
  assert.equal(snapshotCalls, 2, 'a gap triggers exactly one recovery read')
  assert.equal(engine.notes('gap').length, 2)
})

test('an unconfigured reviewer is completely inert and never calls the model', async () => {
  const llm = fakeLlm(['{"note":"should never run","importance":"critical"}'])
  const engine = createEngine({ config: normalizeConfig({ provider: '', model: '' }).config, getLlm: () => llm })
  const session = sessionWith('s1', [{ turn: 1, answer: 'work' }])
  const outcome = engine.observe(session, session.lastEvent)
  assert.equal(outcome.status, 'inert')
  assert.equal(llm.calls.length, 0)
  assert.deepEqual(engine.notes('s1'), [])
})

test('subagent child sessions and non-completed turns are ignored', async () => {
  const { engine, llm } = engineWith(['{"note":"N","importance":"high"}'])
  const child = sessionWith('child', [{ turn: 1, answer: 'work' }], { origin: 'subagent' })
  assert.equal((await observeAndSettle(engine, child)).status, 'ignored')
  const delegated = sessionWith('deep', [{ turn: 1, answer: 'work' }], { delegationDepth: 1 })
  assert.equal((await observeAndSettle(engine, delegated)).status, 'ignored')
  const aborted = sessionWith('s1', [{ turn: 1, answer: 'work', kind: 'aborted' }])
  assert.equal((await observeAndSettle(engine, aborted)).status, 'ignored')
  assert.equal(llm.calls.length, 0)
})

test('a silent or malformed reviewer reply is dropped quietly', async () => {
  for (const reply of ['{"note":null,"importance":null}', 'not json at all', '{"note":"x","importance":"low"}']) {
    const { engine, errors } = engineWith([reply])
    const session = sessionWith('s1', [{ turn: 1, answer: 'work' }])
    const outcome = await observeAndSettle(engine, session)
    assert.equal(outcome.status, 'silent')
    assert.deepEqual(engine.notes('s1'), [])
    assert.deepEqual(errors, [])
  }
})

test('a valid high or critical reply becomes one session-scoped note', async () => {
  const { engine } = engineWith(['{"note":"Rotate the key.","importance":"critical"}'])
  const session = sessionWith('s1', [{ turn: 1, answer: 'work' }])
  const outcome = await observeAndSettle(engine, session)
  assert.equal(outcome.status, 'noted')
  assert.equal(outcome.note.importance, 'critical')
  assert.deepEqual(engine.notes('s1'), [
    { id: outcome.note.id, note: 'Rotate the key.', importance: 'critical', createdAt: 1700000000000 },
  ])
})

test('the reviewer is called once, without tools, and with bounded options', async () => {
  const { engine, llm } = engineWith(['{"note":"N","importance":"high"}'], { maxTokens: 333, maxContextMessages: 2 })
  const session = sessionWith('s1', [{ turn: 1, answer: 'work' }])
  await observeAndSettle(engine, session)
  assert.equal(llm.calls.length, 1)
  const options = llm.calls[0]
  assert.equal(options.provider, 'p')
  assert.equal(options.model, 'm')
  assert.equal(options.maxTokens, 333)
  assert.equal(options.temperature, 0)
  assert.equal(options.tools, undefined)
  assert.equal(options.messages.length, 1)
  assert.equal(options.messages[0].role, 'user')
  assert.equal(options.reasoningEffort, undefined)
  assert.equal(llm.resolveCalls.length, 1)
})

test("reasoningEffort is 'off' only when the model advertises it", async () => {
  const advertised = engineWith(['{"note":"N","importance":"high"}'])
  advertised.llm.efforts = { efforts: [{ id: 'low', name: 'Low' }, { id: 'off', name: 'Off' }], defaultEffort: 'low' }
  await observeAndSettle(advertised.engine, sessionWith('s1', [{ turn: 1, answer: 'work' }]))
  assert.equal(advertised.llm.calls[0].reasoningEffort, 'off')

  const notAdvertised = engineWith(['{"note":"N","importance":"high"}'])
  notAdvertised.llm.efforts = { efforts: [{ id: 'high', name: 'High' }] }
  await observeAndSettle(notAdvertised.engine, sessionWith('s2', [{ turn: 1, answer: 'work' }]))
  assert.equal(notAdvertised.llm.calls[0].reasoningEffort, undefined)
})

test('the same advice is deduplicated across turns', async () => {
  const { engine } = engineWith([
    '{"note":"Use HTTPS for the callback.","importance":"high"}',
    '{"note":"use https for the callback","importance":"high"}',
  ])
  const session = sessionWith('s1', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')
  session.events.push(userEvent(90, 'more'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'duplicate')
  assert.equal(engine.notes('s1').length, 1)
})

test('cooldownTurns spaces reviews out while later turns still pass the gate', async () => {
  const script = []
  for (let index = 0; index < 4; index += 1) script.push(`{"note":"unique note ${index}","importance":"high"}`)
  const { engine, llm } = engineWith(script, { cooldownTurns: 3 })

  const session = sessionWith('s1', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')

  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'cooldown')

  session.events.push(userEvent(93, 'q3'), assistantEvent(94, 3, 'three'), turnEnd(95, 3))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'cooldown')

  session.events.push(userEvent(96, 'q4'), assistantEvent(97, 4, 'four'), turnEnd(98, 4))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')

  assert.equal(llm.calls.length, 2)
  assert.equal(engine.notes('s1').length, 2)
})

test('the accumulated-delta gate blocks a thin turn until enough text accumulates', async () => {
  const { engine, llm } = engineWith(['{"note":"N","importance":"high"}'], { minDeltaChars: 500 })
  const session = sessionWith('s1', [{ turn: 1, answer: 'short' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'delta')

  session.events.push(userEvent(90, 'x'.repeat(600)), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')
  assert.equal(llm.calls.length, 1)
})

test('a turn that produced no visible output is never reviewed', async () => {
  const { engine, llm } = engineWith(['{"note":"N","importance":"high"}'])
  const session = sessionWith('s1', [{ turn: 1 }])
  assert.equal((await observeAndSettle(engine, session)).status, 'empty')
  assert.equal(llm.calls.length, 0)
})

test('notes are scoped per session and dismissal is session-scoped', async () => {
  const { engine } = engineWith([
    '{"note":"first","importance":"high"}',
    '{"note":"second","importance":"critical"}',
  ])
  await observeAndSettle(engine, sessionWith('s1', [{ turn: 1, answer: 'one' }]))
  await observeAndSettle(engine, sessionWith('s2', [{ turn: 1, answer: 'one' }]))

  assert.equal(engine.notes('s1').length, 1)
  assert.equal(engine.notes('s2').length, 1)
  assert.notEqual(engine.notes('s1')[0].id, engine.notes('s2')[0].id)

  const id = engine.notes('s1')[0].id
  assert.equal(engine.dismiss('s1', id), true)
  assert.equal(engine.dismiss('s1', id), false)
  assert.deepEqual(engine.notes('s1'), [])
  assert.equal(engine.notes('s2').length, 1)
  assert.equal(engine.dismiss('s2', id), false)
  assert.equal(engine.dismiss('unknown', id), false)
})

test('a reviewer failure is contained and never surfaces as a note', async () => {
  const { engine, errors } = engineWith([new Error('provider down')])
  const outcome = await observeAndSettle(engine, sessionWith('s1', [{ turn: 1, answer: 'work' }]))
  assert.equal(outcome.status, 'silent')
  assert.deepEqual(engine.notes('s1'), [])
  assert.equal(errors.length, 1)
  assert.equal(errors[0].message, 'provider down')
})

test('a missing LLM service keeps the plugin quiet and is not cached as "no route"', async () => {
  const engine = createEngine({ config: CONFIGURED, getLlm: () => undefined })
  const outcome = await observeAndSettle(engine, sessionWith('s1', [{ turn: 1, answer: 'work' }]))
  assert.equal(outcome.status, 'unroutable')
  assert.deepEqual(engine.notes('s1'), [])
})

test('the per-session note budget stops further reviews', async () => {
  const script = []
  for (let index = 0; index < LIMITS.maxNotesPerSession + 5; index += 1) {
    script.push(`{"note":"unique ${index}","importance":"high"}`)
  }
  const { engine, llm } = engineWith(script)
  const session = sessionWith('s1', [{ turn: 1, answer: 'one' }])
  let status = ''
  for (let turn = 1; turn <= LIMITS.maxNotesPerSession + 5; turn += 1) {
    if (turn > 1) {
      session.events.push(userEvent(1000 + turn * 3, `q${turn}`), assistantEvent(1001 + turn * 3, turn, 'a'), turnEnd(1002 + turn * 3, turn))
      session.lastEvent = session.events[session.events.length - 1]
    }
    const outcome = await observeAndSettle(engine, session)
    status = outcome.status
  }
  assert.equal(engine.notes('s1').length, LIMITS.maxNotesPerSession)
  assert.equal(llm.calls.length, LIMITS.maxNotesPerSession)
  assert.equal(status, 'budget')
})

test('a note with no ASCII alphanumerics is still stored once, then deduplicated', async () => {
  const { engine } = engineWith([
    '{"note":"!!!","importance":"high"}',
    '{"note":"!!!","importance":"critical"}',
  ])
  const session = sessionWith('s1', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')
  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'duplicate')
  assert.equal(engine.notes('s1').length, 1)
})

test('the tracked-session table is bounded and evicts the oldest session', async () => {
  const { engine } = engineWith(['{"note":"first","importance":"high"}'])
  await observeAndSettle(engine, sessionWith('s1', [{ turn: 1, answer: 'one' }]))
  assert.equal(engine.notes('s1').length, 1)

  for (let index = 0; index < LIMITS.maxTrackedSessions; index += 1) {
    await observeAndSettle(engine, sessionWith(`s${index + 2}`, [{ turn: 1, answer: 'one' }]))
  }
  assert.deepEqual(engine.notes('s1'), [])
})

test('an in-flight review blocks a concurrent review of the same session', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const calls = []
  const engine = createEngine({
    config: CONFIGURED,
    getLlm: () => ({
      resolveModelInfo: async () => ({}),
      stream(options) {
        calls.push(options)
        return (async function* stream() {
          await gate
          yield { type: 'text-delta', index: 0, text: '{"note":"N","importance":"high"}' }
        })()
      },
    }),
  })
  const session = sessionWith('s1', [{ turn: 1, answer: 'work' }])
  const first = engine.observe(session, session.lastEvent)
  assert.equal(first.status, 'reviewing')
  const second = engine.observe(session, session.lastEvent)
  assert.equal(second.status, 'busy')
  release()
  await first.promise
  assert.equal(calls.length, 1)
})

test('an automatic route with no registered DeepSeek provider makes zero generation calls', async () => {
  const calls = []
  const llm = {
    listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }],
    listModels: async (provider) => [{ provider, id: 'claude-sonnet-4', name: 'Claude' }],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      throw new Error('must not stream without a route')
    },
  }
  const engine = createEngine({ config: normalizeConfig({ minDeltaChars: 0, cooldownTurns: 1 }).config, getLlm: () => llm })
  const outcome = await observeAndSettle(engine, sessionWith('s-no-route', [{ turn: 1, answer: 'work' }]))
  assert.equal(outcome.status, 'unroutable')
  assert.deepEqual(engine.notes('s-no-route'), [])
  assert.equal(calls.length, 0)
})

test('an automatic config resolves the discovered route before its single generation call', async () => {
  const calls = []
  const llm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async (provider) => [
      { provider, id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      { provider, id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
    ],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
      })()
    },
  }
  const engine = createEngine({ config: normalizeConfig({ minDeltaChars: 0, cooldownTurns: 1 }).config, getLlm: () => llm })
  const outcome = await observeAndSettle(engine, sessionWith('s-auto', [{ turn: 1, answer: 'work' }]))
  assert.equal(outcome.status, 'silent')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].provider, 'deepseek-official')
  assert.equal(calls[0].model, 'deepseek-flash')
})

test('an automatic route is retried when the LLM service mounts after the first turn', async () => {
  const calls = []
  let llm
  const engine = createEngine({
    config: normalizeConfig({ minDeltaChars: 0, cooldownTurns: 1 }).config,
    getLlm: () => llm,
  })
  const session = sessionWith('s-late', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'unroutable')

  llm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async (provider) => [{ provider, id: 'deepseek-flash', name: 'Flash' }],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
      })()
    },
  }
  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'silent')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].provider, 'deepseek-official')
  assert.equal(calls[0].model, 'deepseek-flash')
})
