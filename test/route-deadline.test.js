import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, normalizeConfig } from '../lib/core.js'
import { createRuntime } from '../lib/runtime.js'

const NOW = 1700000000000
// A watchdog sentinel, never a product value: the tests drive the deadline
// with the injected fake timers, and this only turns a regression that leaves
// the returned promise pending into a fast failure instead of a hung file.
const GUARD = Symbol('guard')

/** A deterministic timer table: nothing fires until the test asks. */
function fakeTimers() {
  let nextId = 0
  const pending = new Map()
  return {
    setTimer(fn, ms) {
      const id = (nextId += 1)
      pending.set(id, { fn, ms })
      return id
    },
    clearTimer(handle) {
      pending.delete(handle)
    },
    pendingDelays() {
      return [...pending.values()].map((timer) => timer.ms)
    },
    fireAll() {
      for (const [id, timer] of [...pending.entries()]) {
        if (!pending.has(id)) continue
        pending.delete(id)
        timer.fn()
      }
    },
  }
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function settleWithin(promise, ms = 500) {
  let handle
  const guard = new Promise((resolve) => {
    handle = setTimeout(() => resolve(GUARD), ms)
  })
  try {
    return await Promise.race([promise, guard])
  } finally {
    clearTimeout(handle)
  }
}

function normalizedConfig(overrides = {}) {
  return normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1, ...overrides }).config
}

function turnEnd(seq, turn) {
  return { type: 'turn/end', seq, data: { turn, reason: { kind: 'completed' } } }
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

function sessionWith(id, turns) {
  const events = []
  let seq = 1
  for (const turn of turns) {
    events.push(userEvent(seq += 1, `question ${turn.turn}`))
    events.push(assistantEvent(seq += 1, turn.turn, turn.answer))
    events.push(turnEnd(seq += 1, turn.turn))
  }
  return { id, header: { id }, events, lastEvent: events[events.length - 1] }
}

function appendTurn(session, turn, answer) {
  const next = session.events[session.events.length - 1].seq + 1
  session.events.push(userEvent(next, `question ${turn}`), assistantEvent(next + 1, turn, answer), turnEnd(next + 2, turn))
  session.lastEvent = session.events[session.events.length - 1]
}

function silentStream() {
  return (async function* stream() {
    yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
  })()
}

function routeEngine({ config = {}, resolveRoute, timers, routeDeadlineMs, deadlineMs }) {
  const streamCalls = []
  const errors = []
  const llm = {
    listProviders: () => [{ id: 'deepseek' }],
    listModels: async () => ['deepseek-chat'],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream(options) {
      streamCalls.push(options)
      return silentStream()
    },
  }
  const runtimeOptions = { setTimer: timers.setTimer, clearTimer: timers.clearTimer }
  if (deadlineMs !== undefined) runtimeOptions.deadlineMs = deadlineMs
  const engine = createEngine({
    config: normalizedConfig(config),
    getLlm: () => llm,
    resolveRoute,
    runtimeOptions,
    routeDeadlineMs,
    now: () => NOW,
    onError: (error) => errors.push(error),
  })
  return { engine, llm, streamCalls, errors }
}

test('a hung route discovery settles unroutable, clears inFlight, and the next turn retries', async () => {
  const timers = fakeTimers()
  let discoveries = 0
  const { engine, streamCalls } = routeEngine({
    timers,
    routeDeadlineMs: 25,
    config: { recentCheckDiagnostics: true },
    resolveRoute: () => {
      discoveries += 1
      if (discoveries === 1) return new Promise(() => {})
      return Promise.resolve({ provider: 'deepseek', model: 'deepseek-chat' })
    },
  })
  const session = sessionWith('s-hung', [{ turn: 1, answer: 'one' }])
  const first = engine.observe(session, session.lastEvent)
  assert.equal(first.status, 'reviewing')
  assert.deepEqual(timers.pendingDelays(), [25], 'the review races discovery against the injected deadline')
  timers.fireAll()

  const outcome = await settleWithin(first.promise)
  assert.equal(outcome.status, 'unroutable')
  assert.notEqual(outcome, GUARD, 'a hung discovery must settle')
  assert.equal(engine.status('s-hung').session.inFlight, false, 'the timeout clears the busy flag')
  assert.equal(engine.status('s-hung').session.lastOutcome, 'unroutable')
  assert.deepEqual(
    engine.status('s-hung').session.recentChecks,
    [{ at: NOW, turn: 1, outcome: 'unroutable' }],
    'the timeout writes exactly one recent-check record',
  )
  assert.equal(streamCalls.length, 0, 'a timed-out discovery starts no stream')
  assert.equal(discoveries, 1)

  appendTurn(session, 2, 'two')
  const second = engine.observe(session, session.lastEvent)
  assert.equal(second.status, 'reviewing', 'the next turn is not blocked by the timed-out review')
  assert.equal((await settleWithin(second.promise)).status, 'silent')
  assert.equal(discoveries, 2, 'the next turn retries discovery instead of caching a null route')
  assert.equal(streamCalls.length, 1)
  assert.deepEqual(timers.pendingDelays(), [], 'a successful discovery clears its deadline timer')
})

test('a late route discovery cannot fill the cache or produce a note', async () => {
  const timers = fakeTimers()
  let release
  let discoveries = 0
  const { engine, streamCalls } = routeEngine({
    timers,
    routeDeadlineMs: 25,
    config: { recentCheckDiagnostics: true },
    resolveRoute: () => {
      discoveries += 1
      if (discoveries === 1) return new Promise((resolve) => { release = resolve })
      return Promise.resolve({ provider: 'deepseek', model: 'deepseek-chat' })
    },
  })
  const session = sessionWith('s-late', [{ turn: 1, answer: 'one' }])
  const first = engine.observe(session, session.lastEvent)
  assert.deepEqual(timers.pendingDelays(), [25])
  timers.fireAll()
  assert.equal((await settleWithin(first.promise)).status, 'unroutable')

  await settle()
  assert.equal(typeof release, 'function', 'the hung discovery was started')
  release({ provider: 'deepseek', model: 'deepseek-chat' })
  await settle()

  assert.equal(engine.status('s-late').route, null, 'a stale resolution never fills the cache')
  assert.deepEqual(engine.notes('s-late'), [], 'a stale resolution produces no note')
  assert.equal(streamCalls.length, 0, 'a stale resolution starts no stream')
  assert.equal(engine.status('s-late').session.recentChecks.length, 1, 'the timeout wrote exactly one record')
})

test('the default discovery deadline is five seconds and a fast route clears its timer', async () => {
  const timers = fakeTimers()
  const { engine, streamCalls } = routeEngine({
    timers,
    resolveRoute: () => Promise.resolve({ provider: 'deepseek', model: 'deepseek-chat' }),
  })
  const session = sessionWith('s-fast', [{ turn: 1, answer: 'one' }])
  const reviewing = engine.observe(session, session.lastEvent)
  assert.equal(reviewing.status, 'reviewing')
  assert.deepEqual(timers.pendingDelays(), [5000], 'the default bounded-discovery policy is five seconds')
  assert.equal((await settleWithin(reviewing.promise)).status, 'silent')
  assert.equal(streamCalls.length, 1)
  assert.deepEqual(timers.pendingDelays(), [], 'the deadline timer is cleared on the fast path')
})

test('a hung capability lookup is bounded and the stream still runs', async () => {
  const timers = fakeTimers()
  const streamCalls = []
  const errors = []
  let resolutions = 0
  const llm = {
    resolveModelInfo: () => {
      resolutions += 1
      return new Promise(() => {})
    },
    stream(options) {
      streamCalls.push(options)
      return silentStream()
    },
  }
  const engine = createEngine({
    config: normalizedConfig({ recentCheckDiagnostics: true }),
    getLlm: () => llm,
    now: () => NOW,
    runtimeOptions: { setTimer: timers.setTimer, clearTimer: timers.clearTimer, deadlineMs: 25 },
    onError: (error) => errors.push(error),
  })
  const session = sessionWith('s-cap-hang', [{ turn: 1, answer: 'one' }])
  const reviewing = engine.observe(session, session.lastEvent)
  assert.equal(reviewing.status, 'reviewing')
  await settle()
  assert.deepEqual(timers.pendingDelays(), [25], 'the capability lookup is bounded by the whole-call deadline')
  timers.fireAll()

  const outcome = await settleWithin(reviewing.promise)
  assert.equal(outcome.status, 'silent')
  assert.notEqual(outcome, GUARD, 'a hung lookup must not block the review')
  assert.equal(streamCalls.length, 1, 'the review still opens exactly one stream')
  assert.equal(streamCalls[0].reasoningEffort, undefined, 'a timed-out lookup omits the reasoning effort')
  assert.equal(resolutions, 1)
  assert.equal(engine.status('s-cap-hang').session.inFlight, false)
  assert.deepEqual(timers.pendingDelays(), [], 'every deadline timer is cleared')
})

test('a timed-out capability lookup is not cached and the next review retries it', async () => {
  const timers = fakeTimers()
  const streamCalls = []
  let resolutions = 0
  const llm = {
    resolveModelInfo: (provider, model) => {
      resolutions += 1
      if (resolutions === 1) return new Promise(() => {})
      return Promise.resolve({ provider, id: model, reasoning: { efforts: [{ id: 'off' }] } })
    },
    stream(options) {
      streamCalls.push(options)
      return silentStream()
    },
  }
  const engine = createEngine({
    config: normalizedConfig(),
    getLlm: () => llm,
    now: () => NOW,
    runtimeOptions: { setTimer: timers.setTimer, clearTimer: timers.clearTimer, deadlineMs: 25 },
    onError: () => {},
  })
  const session = sessionWith('s-cap-retry', [{ turn: 1, answer: 'one' }])
  const first = engine.observe(session, session.lastEvent)
  await settle()
  timers.fireAll()
  assert.equal((await settleWithin(first.promise)).status, 'silent')
  assert.equal(resolutions, 1)
  assert.equal(streamCalls[0].reasoningEffort, undefined)

  // A quiet outcome grows the adaptive cooldown, so one filler turn passes
  // before the next review qualifies; the capability lookup is idle there.
  appendTurn(session, 2, 'two')
  assert.equal(engine.observe(session, session.lastEvent).status, 'cooldown')
  appendTurn(session, 3, 'three')
  const second = engine.observe(session, session.lastEvent)
  assert.equal(second.status, 'reviewing')
  assert.equal((await settleWithin(second.promise)).status, 'silent')
  assert.equal(resolutions, 2, 'the timed-out value was never cached')
  assert.equal(streamCalls[1].reasoningEffort, 'off')
  assert.equal(streamCalls.length, 2)
})

test('dispose during a hung capability lookup settles the review as aborted', async () => {
  const timers = fakeTimers()
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const errors = []
  let streams = 0
  const runtime = createRuntime({
    getStream: () => () => {
      streams += 1
      return silentStream()
    },
    resolveModelInfo: () => {
      markStarted()
      return new Promise(() => {})
    },
    parseReply: () => null,
    onNote: () => 'noted',
    onError: (error) => errors.push(error),
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    deadlineMs: 25,
  })
  const resultPromise = runtime.enqueue({ provider: 'p', model: 'm', system: 'system', message: 'excerpt', maxTokens: 128 })
  try {
    await started
    assert.deepEqual(timers.pendingDelays(), [25], 'the hung lookup carries the whole-call deadline')
    runtime.dispose()
    const result = await settleWithin(resultPromise)
    assert.notEqual(result, GUARD, 'dispose must settle the lookup')
    assert.equal(result.status, 'aborted')
    assert.equal(runtime.status().runtimeStatus, 'disposed')
    assert.equal(streams, 0, 'dispose must not start the stream')
    assert.deepEqual(timers.pendingDelays(), [], 'dispose clears the lookup timer')
    assert.deepEqual(errors, [])
  } finally {
    runtime.dispose()
  }
})
