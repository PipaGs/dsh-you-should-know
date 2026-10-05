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

/** Poll until a predicate holds; the runtime drains across macrotasks. */
async function waitFor(predicate, attempts = 500) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('condition was never reached')
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


test('a stream of non-text and malformed chunks stays silent', async () => {
  const calls = []
  const errors = []
  const engine = createEngine({
    config: CONFIGURED,
    getLlm: () => ({
      resolveModelInfo: async () => ({}),
      stream(options) {
        calls.push(options)
        return (async function* stream() {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'reasoning-delta', index: 0, text: 'hidden reasoning' }
          yield { type: 'tool-call', index: 0, id: 't1', name: 'x', arguments: '{}' }
          yield null
          yield { type: 'text-delta', index: 1, text: 'still not json' }
        })()
      },
    }),
    onError: (error) => errors.push(error),
  })
  const outcome = await observeAndSettle(engine, sessionWith('s1', [{ turn: 1, answer: 'work' }]))
  assert.equal(outcome.status, 'silent')
  assert.deepEqual(engine.notes('s1'), [])
  assert.equal(calls.length, 1)
  assert.deepEqual(errors, [])
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


test('a tool-event flood after the answer never hides a completed turn', async () => {
  const { engine, llm } = engineWith(['{"note":"flooded","importance":"high"}'], { minDeltaChars: 0, cooldownTurns: 1 })
  const events = []
  const session = { header: { id: 'flood' }, snapshotEvents: () => events.slice() }
  const feed = (event) => {
    events.push(event)
    return engine.observe(session, event)
  }

  feed(userEvent(1, 'question'))
  feed(assistantEvent(2, 1, 'the visible answer'))
  // Far more non-message events than the raw window holds, all inside turn 1.
  const flood = LIMITS.maxBufferedEvents + 500
  for (let index = 0; index < flood; index += 1) {
    feed({ type: 'tool/result', seq: 3 + index, data: { index } })
  }
  const outcome = feed(turnEnd(3 + flood, 1))
  assert.equal(outcome.status, 'reviewing')
  const result = await outcome.promise
  assert.equal(result.status, 'noted')
  assert.equal(engine.notes('flood').length, 1)
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.ok(prompt.includes('the visible answer'), 'the current answer must survive the flood in the excerpt')
})

test('a tool-event flood already committed at seed time never hides the turn', async () => {
  const { engine, llm } = engineWith(['{"note":"seeded","importance":"critical"}'], { minDeltaChars: 0, cooldownTurns: 1 })
  const flood = LIMITS.maxBufferedEvents + 500
  const events = [userEvent(1, 'question'), assistantEvent(2, 1, 'the seeded answer')]
  for (let index = 0; index < flood; index += 1) {
    events.push({ type: 'tool/result', seq: 3 + index, data: { index } })
  }
  events.push(turnEnd(3 + flood, 1))
  const session = {
    header: { id: 'seedflood' },
    events,
    lastEvent: events[events.length - 1],
    snapshotEvents: () => events.slice(),
  }
  const outcome = engine.observe(session, session.lastEvent)
  assert.equal(outcome.status, 'reviewing')
  const result = await outcome.promise
  assert.equal(result.status, 'noted')
  const prompt = llm.calls[0].messages[0].content[0].text
  assert.ok(prompt.includes('the seeded answer'), 'the seeded answer must be derived from the full snapshot')
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

test('engine status reports route and per-session activity without conversation text', async () => {
  const secretQuestion = 'SUPER-SECRET-QUESTION-ALPHA'
  const secretAnswer = 'SUPER-SECRET-ANSWER-BETA'
  const secretNote = 'SUPER-SECRET-NOTE-GAMMA'
  let providers = [{ id: 'anthropic', name: 'Anthropic' }]
  const models = { 'deepseek-account': ['deepseek-flash'] }
  const llm = {
    listProviders: () => providers,
    listModels: async (provider) => (models[provider] ?? []).map((id) => ({ provider, id, name: id })),
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream() {
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: JSON.stringify({ note: secretNote, importance: 'high' }) }
      })()
    },
  }
  const engine = createEngine({
    config: normalizeConfig({ minDeltaChars: 0, cooldownTurns: 1 }).config,
    getLlm: () => llm,
    now: () => 1700000000000,
  })

  assert.deepEqual(engine.status('unseen'), {
    configured: true,
    route: null,
    routeResolutions: 0,
    effectiveRoute: null,
    effectiveRouteSource: 'automatic',
    session: null,
  })

  const session = sessionWith('s-status', [{ turn: 1, question: secretQuestion, answer: secretAnswer }])
  assert.equal((await observeAndSettle(engine, session)).status, 'unroutable')

  let snapshot = engine.status('s-status')
  assert.equal(snapshot.routeResolutions, 1)
  assert.deepEqual(snapshot.route, null)
  assert.equal(snapshot.session.reviewStarts, 1)
  assert.equal(snapshot.session.lastOutcome, 'unroutable')
  assert.equal(snapshot.session.lastReviewAt, 1700000000000)
  assert.equal(snapshot.session.inFlight, false)
  assert.equal(snapshot.session.noteCount, 0)

  providers = [{ id: 'deepseek-account', name: 'DeepSeek' }]
  session.events.push(userEvent(90, secretQuestion), assistantEvent(91, 2, secretAnswer), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')

  snapshot = engine.status('s-status')
  assert.equal(snapshot.routeResolutions, 2)
  assert.deepEqual(snapshot.route, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.equal(snapshot.session.reviewStarts, 2)
  assert.equal(snapshot.session.lastOutcome, 'noted')
  assert.equal(snapshot.session.noteCount, 1)

  const serialized = JSON.stringify(snapshot)
  for (const secret of [secretQuestion, secretAnswer, secretNote]) {
    assert.equal(serialized.includes(secret), false, 'diagnostics must not expose conversation or note text')
  }
  assert.equal('note' in snapshot.session, false)
})

test('engine status reports an unconfigured reviewer without a session', () => {
  const engine = createEngine({ config: normalizeConfig({ provider: '', model: '' }).config, getLlm: () => undefined })
  assert.deepEqual(engine.status('anything'), {
    configured: false,
    route: null,
    routeResolutions: 0,
    effectiveRoute: null,
    effectiveRouteSource: null,
    session: null,
  })
})

test('engine status records silent and unexpected-error review outcomes', async () => {
  const silentEngine = createEngine({
    config: normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 }).config,
    getLlm: () => ({
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      stream() {
        return (async function* stream() {
          yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
        })()
      },
    }),
  })
  await observeAndSettle(silentEngine, sessionWith('s-silent', [{ turn: 1, answer: 'work' }]))
  assert.equal(silentEngine.status('s-silent').session.lastOutcome, 'silent')

  const errorEngine = createEngine({
    config: normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 }).config,
    getLlm: () => ({
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      stream() {
        return (async function* stream() {
          yield { type: 'text-delta', index: 0, text: '{"note":"N","importance":"high"}' }
        })()
      },
    }),
    now: () => {
      throw new Error('clock unavailable')
    },
  })
  assert.equal((await observeAndSettle(errorEngine, sessionWith('s-error', [{ turn: 1, answer: 'work' }]))).status, 'error')
  assert.equal(errorEngine.status('s-error').session.lastOutcome, 'error')
})

test('an automatic route is retried when a DeepSeek provider appears after a no-route turn', async () => {
  const calls = []
  let providers = [{ id: 'anthropic', name: 'Anthropic' }]
  const models = { 'deepseek-account': ['deepseek-flash'] }
  const llm = {
    listProviders: () => providers,
    listModels: async (provider) => (models[provider] ?? []).map((id) => ({ provider, id, name: id })),
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: '{"note":"late route works","importance":"high"}' }
      })()
    },
  }
  const engine = createEngine({ config: normalizeConfig({ minDeltaChars: 0, cooldownTurns: 1 }).config, getLlm: () => llm })
  const session = sessionWith('s-race', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'unroutable')

  // The same registry now exposes a usable DeepSeek route.
  providers = [{ id: 'deepseek-account', name: 'DeepSeek' }]
  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  const outcome = await observeAndSettle(engine, session)
  assert.equal(outcome.status, 'noted')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].provider, 'deepseek-account')
  assert.equal(calls[0].model, 'deepseek-flash')
  assert.equal(engine.notes('s-race').length, 1)
})

test('a resolved automatic route is cached across later turns', async () => {
  let providerReads = 0
  const calls = []
  const llm = {
    listProviders() {
      providerReads += 1
      return [{ id: 'deepseek-account', name: 'DeepSeek' }]
    },
    listModels: async (provider) => [{ provider, id: 'deepseek-flash', name: 'Flash' }],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
      })()
    },
  }
  const engine = createEngine({ config: normalizeConfig({ minDeltaChars: 0, cooldownTurns: 1 }).config, getLlm: () => llm })
  const session = sessionWith('s-cache', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'silent')

  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'silent')
  assert.equal(calls.length, 2)
  assert.equal(providerReads, 1, 'a resolved route is discovered once and cached')
})

test('a no-route engine retries discovery only at a later qualifying turn', async () => {
  let providerReads = 0
  const llm = {
    listProviders() {
      providerReads += 1
      return [{ id: 'anthropic', name: 'Anthropic' }]
    },
    listModels: async () => [],
    resolveModelInfo: async () => {
      throw new Error('NO_ADAPTER')
    },
    stream() {
      throw new Error('must not stream without a route')
    },
  }
  const engine = createEngine({ config: normalizeConfig({ minDeltaChars: 0, cooldownTurns: 1 }).config, getLlm: () => llm })
  const session = sessionWith('s-quiet', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'unroutable')
  assert.equal(providerReads, 1)

  for (let index = 0; index < 10; index += 1) {
    assert.equal(engine.observe(session, userEvent(300 + index, 'x'.repeat(500))).status, 'ignored')
  }
  assert.equal(providerReads, 1, 'non-qualifying events never re-run discovery')

  session.events.push(userEvent(400, 'q2'), assistantEvent(401, 2, 'two'), turnEnd(402, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'unroutable')
  assert.equal(providerReads, 2, 'the next qualifying turn retries discovery once')
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

test('the engine routes reviews through the per-session runtime and retries a transient failure once', async () => {
  const calls = []
  let attempt = 0
  const engine = createEngine({
    config: CONFIGURED,
    getLlm: () => ({
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      stream(options) {
        calls.push(options)
        attempt += 1
        if (attempt === 1) {
          return (async function* stream() {
            yield { type: 'finish', reason: { kind: 'error', failure: { message: 'timeout', code: 'TIMEOUT' } } }
          })()
        }
        return (async function* stream() {
          yield { type: 'text-delta', index: 0, text: '{"note":"Retried through the runtime.","importance":"high"}' }
        })()
      },
    }),
    now: () => 1700000000000,
    runtimeOptions: { retryDelayMs: 1, deadlineMs: 50 },
  })
  const outcome = await observeAndSettle(engine, sessionWith('s-runtime', [{ turn: 1, answer: 'work' }]))
  assert.equal(outcome.status, 'noted')
  assert.equal(calls.length, 2)
  assert.equal(engine.notes('s-runtime').length, 1)
  const snapshot = engine.status('s-runtime')
  assert.equal(snapshot.session.runtimeStatus, 'idle')
  assert.equal(snapshot.session.runtime.reviewStarts, 2)
  assert.equal(snapshot.session.runtime.completedReviews, 1)
  assert.equal(snapshot.session.runtime.lastOutcome, 'noted')
})

test('a quota-paused engine keeps the job queued and resume() replays it in place', async () => {
  const calls = []
  let attempt = 0
  const engine = createEngine({
    config: CONFIGURED,
    getLlm: () => ({
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      stream(options) {
        calls.push(options)
        attempt += 1
        if (attempt === 1) {
          return (async function* stream() {
            yield { type: 'finish', reason: { kind: 'error', failure: { message: 'rate limited', code: 'RATE_LIMIT' } } }
          })()
        }
        return (async function* stream() {
          yield { type: 'text-delta', index: 0, text: '{"note":"After resume.","importance":"critical"}' }
        })()
      },
    }),
    now: () => 1700000000000,
    runtimeOptions: { retryDelayMs: 1, deadlineMs: 50 },
  })
  const session = sessionWith('s-quota', [{ turn: 1, answer: 'work' }])
  const outcome = engine.observe(session, session.lastEvent)
  assert.equal(outcome.status, 'reviewing')
  await waitFor(() => engine.status('s-quota').session.runtimeStatus === 'quota_exhausted')
  assert.equal(calls.length, 1)
  assert.equal(engine.status('s-quota').session.runtime.pendingReviews, 1)
  assert.equal(engine.resume('s-quota'), true)
  assert.equal(engine.resume('s-quota'), false, 'a second resume finds nothing paused')
  const settled = await outcome.promise
  assert.equal(settled.status, 'noted')
  assert.equal(engine.notes('s-quota').length, 1)
  assert.equal(calls.length, 2)
  assert.equal(engine.status('s-quota').session.runtimeStatus, 'idle')
})

test('forget disposes the session runtime and aborts anything in flight', async () => {
  let calls = 0
  const engine = createEngine({
    config: CONFIGURED,
    getLlm: () => ({
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      stream() {
        calls += 1
        return (async function* stream() {
          await new Promise(() => {})
          yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
        })()
      },
    }),
    runtimeOptions: { retryDelayMs: 1, deadlineMs: 5000 },
  })
  const session = sessionWith('s-forget', [{ turn: 1, answer: 'work' }])
  const outcome = engine.observe(session, session.lastEvent)
  assert.equal(outcome.status, 'reviewing')
  await waitFor(() => calls === 1)
  assert.equal(engine.forget('s-forget'), true)
  const settled = await outcome.promise
  assert.equal(settled.status, 'aborted')
  assert.equal(engine.status('s-forget').session, null)
})

// --- Phase 2: bounded per-session model overrides and live config ---

test('per-session model overrides isolate A from B and stay exact', async () => {
  const { engine, llm } = engineWith([
    '{"note":null,"importance":null}',
    '{"note":null,"importance":null}',
  ])
  assert.deepEqual(await engine.setSessionModel('session-a', 'provider-a', 'model-a'), { ok: true })
  assert.deepEqual(await engine.setSessionModel('session-b', 'provider-b', 'model-b'), { ok: true })

  assert.equal((await observeAndSettle(engine, sessionWith('session-a', [{ turn: 1, answer: 'one' }]))).status, 'silent')
  assert.equal((await observeAndSettle(engine, sessionWith('session-b', [{ turn: 1, answer: 'two' }]))).status, 'silent')

  assert.deepEqual(llm.calls.map((call) => [call.provider, call.model]), [
    ['provider-a', 'model-a'],
    ['provider-b', 'model-b'],
  ])
  const a = engine.sessionConfig('session-a')
  const b = engine.sessionConfig('session-b')
  assert.equal(a.effectiveRouteSource, 'session')
  assert.deepEqual(a.sessionOverride, { provider: 'provider-a', model: 'model-a' })
  assert.equal(b.effectiveRouteSource, 'session')
  assert.deepEqual(b.sessionOverride, { provider: 'provider-b', model: 'model-b' })
})

test('setSessionModel validates the exact route through resolveModelInfo and never opens a stream', async () => {
  const { engine, llm } = engineWith([])
  assert.deepEqual(await engine.setSessionModel('s-validate', 'vendor', 'model-x'), { ok: true })
  assert.deepEqual(llm.resolveCalls, [['vendor', 'model-x']])
  assert.equal(llm.calls.length, 0)
})

test('a rejected setSessionModel leaves the previous override and its runtime untouched', async () => {
  const calls = []
  const resolveCalls = []
  let reject = false
  const llm = {
    calls,
    resolveCalls,
    resolveModelInfo(provider, model) {
      resolveCalls.push([provider, model])
      if (reject) return Promise.reject(Object.assign(new Error('unknown model'), { code: 'UNKNOWN_MODEL' }))
      return Promise.resolve({ provider, id: model, name: model })
    },
    stream(options) {
      calls.push(options)
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
      })()
    },
  }
  const engine = createEngine({ config: CONFIGURED, getLlm: () => llm })

  assert.deepEqual(await engine.setSessionModel('s1', 'good', 'model-good'), { ok: true })
  reject = true
  assert.deepEqual(await engine.setSessionModel('s1', 'bad', 'model-bad'), { ok: false, error: 'unresolvable' })
  assert.deepEqual(engine.sessionConfig('s1').sessionOverride, { provider: 'good', model: 'model-good' })

  assert.equal((await observeAndSettle(engine, sessionWith('s1', [{ turn: 1, answer: 'work' }]))).status, 'silent')
  assert.equal(calls[0].provider, 'good')
  assert.equal(calls[0].model, 'model-good')
})

test('a setSessionModel that exceeds its deadline preserves the previous override', async () => {
  const llm = {
    resolveModelInfo: () => new Promise(() => {}),
    stream() {
      throw new Error('validation must not stream')
    },
  }
  const engine = createEngine({ config: CONFIGURED, getLlm: () => llm, validationDeadlineMs: 10 })
  assert.deepEqual(await engine.setSessionModel('s-timeout', 'slow', 'model-slow'), { ok: false, error: 'timeout' })
  assert.deepEqual(engine.sessionConfig('s-timeout').sessionOverride, null)
})

test('setSessionModel rejects an unusable session id or a blank route half', async () => {
  const { engine } = engineWith([])
  assert.deepEqual(await engine.setSessionModel('', 'p', 'm'), { ok: false, error: 'invalid-session' })
  assert.deepEqual(await engine.setSessionModel('s1', '', 'm'), { ok: false, error: 'invalid-route' })
  assert.deepEqual(await engine.setSessionModel('s1', 'p', '   '), { ok: false, error: 'invalid-route' })
})

test('resetSessionModel deletes the override and rebuilds the runtime toward the global route', async () => {
  const { engine, llm } = engineWith([
    '{"note":null,"importance":null}',
    '{"note":null,"importance":null}',
  ])
  assert.deepEqual(await engine.setSessionModel('s1', 'vendor', 'model-x'), { ok: true })
  const session = sessionWith('s1', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'silent')

  assert.deepEqual(engine.resetSessionModel('s1'), { ok: true, removed: true })
  assert.equal(engine.sessionConfig('s1').effectiveRouteSource, 'global')
  assert.deepEqual(engine.sessionConfig('s1').sessionOverride, null)
  assert.deepEqual(engine.resetSessionModel('s1'), { ok: true, removed: false })

  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'silent')
  assert.deepEqual(llm.calls.map((call) => [call.provider, call.model]), [
    ['vendor', 'model-x'],
    ['p', 'm'],
  ])
})

test('notes and dedupe survive a per-session model change', async () => {
  const { engine, llm } = engineWith([
    '{"note":"Advice that must survive.","importance":"high"}',
    '{"note":"advice that must survive","importance":"critical"}',
  ])
  const session = sessionWith('s1', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')
  assert.equal(engine.notes('s1').length, 1)

  assert.deepEqual(await engine.setSessionModel('s1', 'vendor', 'model-x'), { ok: true })
  assert.equal(engine.notes('s1').length, 1, 'the stored note survives the runtime rebuild')

  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'duplicate')
  assert.equal(engine.notes('s1').length, 1)
  assert.equal(llm.calls[1].provider, 'vendor')
  assert.equal(llm.calls[1].model, 'model-x')
})

test('the per-session override table is bounded by its limit and evicts the oldest', async () => {
  const { engine } = engineWith([])
  for (let index = 0; index < LIMITS.maxSessionOverrides; index += 1) {
    assert.deepEqual(await engine.setSessionModel(`s${index}`, 'p', `m${index}`), { ok: true })
  }
  assert.notEqual(engine.sessionConfig('s0').sessionOverride, null)
  assert.deepEqual(await engine.setSessionModel('s-extra', 'p', 'm-extra'), { ok: true })
  assert.deepEqual(engine.sessionConfig('s0').sessionOverride, null, 'the oldest override is evicted')
  assert.deepEqual(engine.sessionConfig('s-extra').sessionOverride, { provider: 'p', model: 'm-extra' })
})

test('forget removes the session state and its override together', async () => {
  const { engine } = engineWith([])
  assert.deepEqual(await engine.setSessionModel('s1', 'vendor', 'model-x'), { ok: true })
  assert.equal(engine.forget('s1'), true)
  assert.deepEqual(engine.sessionConfig('s1').sessionOverride, null)
  assert.equal(engine.sessionConfig('s1').effectiveRouteSource, 'global')
  assert.equal(engine.forget('s1'), false)
})

test('updateConfig applies a new route live and rebuilds the per-session runtime', async () => {
  const { engine, llm } = engineWith([
    '{"note":null,"importance":null}',
    '{"note":null,"importance":null}',
  ])
  const session = sessionWith('s1', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'silent')
  assert.equal(engine.status('s1').session.runtime.reviewStarts, 1)

  const updated = engine.updateConfig({ provider: 'other', model: 'model-z', minDeltaChars: 0, cooldownTurns: 1 })
  assert.equal(updated.config.provider, 'other')
  assert.deepEqual(updated.warnings, [])
  assert.deepEqual(engine.sessionConfig('s1').effectiveRoute, { provider: 'other', model: 'model-z' })
  assert.equal(engine.status('s1').session.runtime.reviewStarts, 0, 'the new route starts a fresh runtime')

  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'silent')
  assert.deepEqual(llm.calls.map((call) => [call.provider, call.model]), [
    ['p', 'm'],
    ['other', 'model-z'],
  ])
})

test('updateConfig rebuilds the runtime when the token budget changes', async () => {
  const { engine } = engineWith([
    '{"note":null,"importance":null}',
    '{"note":null,"importance":null}',
  ])
  const session = sessionWith('s1', [{ turn: 1, answer: 'one' }])
  await observeAndSettle(engine, session)
  assert.equal(engine.status('s1').session.runtime.reviewStarts, 1)

  const updated = engine.updateConfig({ provider: 'p', model: 'm', maxTokens: 256, minDeltaChars: 0, cooldownTurns: 1 })
  assert.equal(updated.config.maxTokens, 256)
  assert.equal(engine.status('s1').session.runtime.reviewStarts, 0)

  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'silent')
})

test('updateConfig disabling disposes runtimes but preserves notes, and re-enabling works', async () => {
  const { engine, llm } = engineWith([
    '{"note":"kept note","importance":"high"}',
    '{"note":"after re-enable","importance":"high"}',
  ])
  const session = sessionWith('s1', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')
  assert.equal(engine.notes('s1').length, 1)

  const disabled = engine.updateConfig({ provider: '', model: '' })
  assert.equal(disabled.config.disabled, true)
  assert.equal(engine.status('s1').configured, false)
  assert.equal(engine.sessionConfig('s1').effectiveRouteSource, null)
  assert.equal(engine.status('s1').session.runtimeStatus, 'disposed')
  assert.equal(engine.notes('s1').length, 1, 'notes survive a disable')

  session.events.push(userEvent(90, 'q2'), assistantEvent(91, 2, 'two'), turnEnd(92, 2))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'inert')
  assert.equal(llm.calls.length, 1, 'no model call while disabled')

  const enabled = engine.updateConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 })
  assert.equal(enabled.config.disabled, false)
  session.events.push(userEvent(93, 'q3'), assistantEvent(94, 3, 'three'), turnEnd(95, 3))
  session.lastEvent = session.events[session.events.length - 1]
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')
  assert.equal(llm.calls.length, 2)
  assert.equal(engine.notes('s1').length, 2)
})

test('status and sessionConfig expose the effective route and source without text', async () => {
  const secret = 'PHASE2-SECRET-MARKER'
  const { engine } = engineWith([JSON.stringify({ note: `note ${secret}`, importance: 'high' })])
  const session = sessionWith('s1', [{ turn: 1, question: secret, answer: `answer ${secret}` }])
  assert.equal((await observeAndSettle(engine, session)).status, 'noted')

  const globalView = engine.sessionConfig('s1')
  assert.equal(globalView.effectiveRouteSource, 'global')
  assert.deepEqual(globalView.effectiveRoute, { provider: 'p', model: 'm' })
  assert.equal(globalView.sessionOverride, null)

  assert.deepEqual(await engine.setSessionModel('s1', 'vendor', 'model-x'), { ok: true })
  const sessionView = engine.sessionConfig('s1')
  assert.equal(sessionView.effectiveRouteSource, 'session')
  assert.deepEqual(sessionView.sessionOverride, { provider: 'vendor', model: 'model-x' })

  const snapshot = engine.status('s1')
  assert.equal(snapshot.effectiveRouteSource, 'session')
  assert.deepEqual(snapshot.effectiveRoute, { provider: 'vendor', model: 'model-x' })
  assert.equal(snapshot.session.noteCount, 1)
  assert.equal('note' in snapshot.session, false)
  const serialized = JSON.stringify(snapshot) + JSON.stringify(sessionView)
  assert.equal(serialized.includes(secret), false)
})

test('an automatic route reports source automatic and the resolved route once discovered', async () => {
  const llm = {
    listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek' }],
    listModels: async (provider) => [{ provider, id: 'deepseek-flash', name: 'Flash' }],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream() {
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
      })()
    },
  }
  const engine = createEngine({ config: normalizeConfig({ minDeltaChars: 0, cooldownTurns: 1 }).config, getLlm: () => llm })
  assert.deepEqual(engine.sessionConfig('s-auto'), {
    configured: true,
    sessionId: 's-auto',
    effectiveRoute: null,
    effectiveRouteSource: 'automatic',
    sessionOverride: null,
  })
  assert.equal((await observeAndSettle(engine, sessionWith('s-auto', [{ turn: 1, answer: 'one' }]))).status, 'silent')
  assert.deepEqual(engine.sessionConfig('s-auto').effectiveRoute, { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.equal(engine.sessionConfig('s-auto').effectiveRouteSource, 'automatic')
})

test('dispose disposes every runtime and clears all session and override state', async () => {
  const { engine } = engineWith(['{"note":null,"importance":null}'])
  assert.deepEqual(await engine.setSessionModel('s1', 'vendor', 'model-x'), { ok: true })
  await observeAndSettle(engine, sessionWith('s1', [{ turn: 1, answer: 'one' }]))
  assert.equal(engine.status('s1').session.runtimeStatus, 'idle')

  engine.dispose()
  assert.equal(engine.status('s1').session, null)
  assert.deepEqual(engine.notes('s1'), [])
  assert.deepEqual(engine.sessionConfig('s1').sessionOverride, null)
  assert.equal(engine.resume('s1'), false)
  assert.equal(engine.observe(sessionWith('s1', [{ turn: 1, answer: 'two' }]), turnEnd(3, 1)).status, 'disposed')
  engine.dispose()
})
