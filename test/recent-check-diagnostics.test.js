import test from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, createConfigHandlers, createEngine, normalizeConfig } from '../lib/core.js'
import * as core from '../lib/core.js'
import { Config, apply } from '../lib/index.js'
import { ROUTE_CAPABILITIES, buildSelfCheckPayload } from '../lib/self-check.js'

const ALL_HANDLERS = Object.fromEntries(ROUTE_CAPABILITIES.map((capability) => [capability.name, () => {}]))
const NOW = 1700000000000

const EXPECTED_OUTCOMES = [
  'noted',
  'silent',
  'duplicate',
  'suppressed',
  'budget',
  'unroutable',
  'error',
  'aborted',
  'quota_exhausted',
  'halted',
  'queue_full',
  'disposed',
  'other',
]

function normalizedConfig(overrides = {}) {
  return normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1, ...overrides }).config
}

function fakeLlm(script = []) {
  const calls = []
  const llm = {
    calls,
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
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
        yield { type: 'text-delta', index: 0, text }
      })()
    },
  }
  return llm
}

function engineWith(script = [], overrides = {}) {
  const llm = fakeLlm(script)
  const errors = []
  const engine = createEngine({
    config: normalizedConfig(overrides),
    getLlm: () => llm,
    now: () => NOW,
    onError: (error) => errors.push(error),
  })
  return { engine, llm, errors }
}

/** An engine with no resolvable DeepSeek route: every eligible turn ends unroutable. */
function unroutableEngine(overrides = {}, clock = () => NOW) {
  return createEngine({
    config: normalizeConfig({ minDeltaChars: 0, cooldownTurns: 1, ...overrides }).config,
    getLlm: () => ({
      listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }],
      listModels: async () => [],
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      stream() {
        throw new Error('must not stream without a DeepSeek route')
      },
    }),
    now: clock,
  })
}

function turnEnd(seq, turn, extra = {}) {
  return { type: 'turn/end', seq, data: { turn, reason: { kind: 'completed' }, ...extra } }
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

async function observeTurn(engine, session) {
  const outcome = engine.observe(session, session.lastEvent)
  if (outcome.promise) return await outcome.promise
  return outcome
}

function settingsDouble() {
  const updates = []
  const replaces = []
  return {
    updates,
    replaces,
    update(key, patch) {
      updates.push({ key, patch })
      return Promise.resolve()
    },
    replace(key, section) {
      replaces.push({ key, section })
      return Promise.resolve()
    },
  }
}

function configRequest(method, body) {
  return new Request('http://127.0.0.1/api/dsh-you-should-know/config', {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}

function statusRequest(sessionId) {
  return new Request(`http://127.0.0.1/api/dsh-you-should-know/status?sessionId=${sessionId}`, { method: 'GET' })
}

function selfCheckPayload(diagnostics) {
  return buildSelfCheckPayload({
    pluginVersion: '0.4.6',
    installedVersion: '0.4.6',
    diagnostics,
    handlers: ALL_HANDLERS,
    update: null,
  })
}

function makeCtx(services = {}) {
  const listeners = []
  const injected = []
  const disposers = []
  const fetchRoutes = []
  const ctx = {
    on(eventName, listener) {
      listeners.push({ eventName, listener })
    },
    effect(callback) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    inject(dependencies, callback) {
      injected.push({ dependencies, callback })
    },
    get(key) {
      return services[key]
    },
  }
  const connection = {
    fetch: {
      register(route) {
        fetchRoutes.push(route)
        return () => {}
      },
    },
  }
  return {
    ctx,
    listeners,
    fetchRoutes,
    disposeAll() {
      for (const disposer of disposers) disposer()
      disposers.length = 0
    },
    runInjections() {
      for (const { callback } of injected) callback({ effect: ctx.effect, connection, get: ctx.get })
    },
  }
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('the recent-check outcome allowlist and the cap are explicit and frozen', () => {
  assert.deepEqual([...core.RECENT_CHECK_OUTCOMES], EXPECTED_OUTCOMES)
  assert.equal(Object.isFrozen(core.RECENT_CHECK_OUTCOMES), true)
  assert.equal(LIMITS.maxRecentChecks, 12)
  assert.equal(LIMITS.maxRecentChecks, LIMITS.maxNotesPerSession, 'the cap reuses the note ceiling')
})

test('recent-check diagnostics stay off by default in config, status, diagnostics, and self-check', async () => {
  const { engine } = engineWith(['{"note":"A finding.","importance":"high"}'])
  const session = sessionWith('s-off', [{ turn: 1, answer: 'work' }])
  assert.equal((await observeTurn(engine, session)).status, 'noted')

  const snapshot = engine.status('s-off')
  assert.equal('recentChecks' in snapshot.session, false, 'the disabled route carries no history field')
  assert.deepEqual(engine.diagnostics(), {
    configured: true,
    reviewerMode: 'balanced',
    runtimeStatus: 'idle',
    recentCheckDiagnostics: false,
  })
  assert.equal(selfCheckPayload(engine.diagnostics()).capabilities.recentCheckDiagnostics, false)
  assert.equal(normalizedConfig().recentCheckDiagnostics, false)

  const handlers = createConfigHandlers(engine, { settings: settingsDouble(), getLlm: () => undefined })
  const body = await (await handlers.config(configRequest('GET'))).json()
  assert.equal(body.config.recentCheckDiagnostics, false)
  assert.equal(Config({}).recentCheckDiagnostics.get(), false)
  assert.equal(Config({ recentCheckDiagnostics: true }).recentCheckDiagnostics.get(), true)
  assert.throws(() => Config({ recentCheckDiagnostics: 'yes' }))
})

test('enabled diagnostics expose newest-first records with only at, outcome, and turn', async () => {
  const { engine } = engineWith(
    ['{"note":"A finding.","importance":"high"}', '{"note":null,"importance":null}'],
    { recentCheckDiagnostics: true },
  )
  const session = sessionWith('s-on', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeTurn(engine, session)).status, 'noted')
  appendTurn(session, 2, 'two')
  assert.equal((await observeTurn(engine, session)).status, 'silent')

  const records = engine.status('s-on').session.recentChecks
  assert.equal(Array.isArray(records), true)
  assert.deepEqual(records.map((record) => record.outcome), ['silent', 'noted'])
  assert.deepEqual(records.map((record) => record.turn), [2, 1], 'turn ordinals follow turn order, newest first')
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), ['at', 'outcome', 'turn'])
    assert.equal(record.at, NOW)
    assert.equal(EXPECTED_OUTCOMES.includes(record.outcome), true)
  }
})

test('the per-session history keeps only the newest records up to the cap', async () => {
  const engine = unroutableEngine({ recentCheckDiagnostics: true, maxReviewerCallsPerHour: 60 })
  const session = sessionWith('s-cap', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeTurn(engine, session)).status, 'unroutable')
  for (let turn = 2; turn <= 14; turn += 1) {
    appendTurn(session, turn, `answer ${turn}`)
    assert.equal((await observeTurn(engine, session)).status, 'unroutable')
  }

  const records = engine.status('s-cap').session.recentChecks
  assert.equal(records.length, LIMITS.maxRecentChecks)
  assert.equal(records[0].turn, 14, 'the newest record stays first')
  assert.equal(records[records.length - 1].turn, 14 - LIMITS.maxRecentChecks + 1, 'the oldest kept record is the cap boundary')
  assert.equal(records.some((record) => record.turn === 2), false, 'the oldest records were dropped')
  assert.deepEqual(records.map((record) => record.outcome), Array.from({ length: LIMITS.maxRecentChecks }, () => 'unroutable'))
})

test('a record keeps the reviewed turn ordinal while a later turn is in flight', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const engine = createEngine({
    config: normalizedConfig({ recentCheckDiagnostics: true }),
    getLlm: () => ({
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      stream() {
        return (async function* stream() {
          await gate
          yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
        })()
      },
    }),
    now: () => NOW,
  })
  const session = sessionWith('s-in-flight', [{ turn: 1, answer: 'one' }])
  const first = engine.observe(session, session.lastEvent)
  assert.equal(first.status, 'reviewing')

  appendTurn(session, 2, 'two')
  const second = engine.observe(session, session.lastEvent)
  assert.equal(second.status, 'busy', 'the in-flight review blocks the second turn')
  assert.equal(engine.status('s-in-flight').session.reviewStarts, 1, 'the second turn starts no review')

  release()
  assert.equal((await first.promise).status, 'silent')
  const records = engine.status('s-in-flight').session.recentChecks
  assert.equal(records.length, 1)
  assert.equal(records[0].turn, 1, 'the record names the reviewed turn, not the later in-flight turn')
})

test('the tracked-session cap drops the oldest history with its session', async () => {
  const engine = unroutableEngine({ recentCheckDiagnostics: true })
  const total = LIMITS.maxTrackedSessions + 1
  for (let index = 0; index < total; index += 1) {
    const session = sessionWith(`s-evict-${index}`, [{ turn: 1, answer: 'one' }])
    assert.equal((await observeTurn(engine, session)).status, 'unroutable')
  }
  assert.equal(engine.status('s-evict-0').session, null, 'the oldest session and its history are evicted')
  assert.equal(engine.status(`s-evict-${total - 1}`).session.recentChecks.length, 1)
})

test('an unusable clock never breaks a record and stores a null timestamp', async () => {
  for (const value of [NaN, -1, 1.5, 2 ** 60, 'x', {}]) {
    const engine = unroutableEngine({ recentCheckDiagnostics: true }, () => value)
    const outcome = await observeTurn(engine, sessionWith('s-clock', [{ turn: 1, answer: 'one' }]))
    assert.equal(outcome.status, 'unroutable', 'clock ' + String(value) + ' must not break the review')
    assert.deepEqual(engine.status('s-clock').session.recentChecks, [{ at: null, turn: 1, outcome: 'unroutable' }])
  }

  const zero = unroutableEngine({ recentCheckDiagnostics: true }, () => 0)
  assert.equal((await observeTurn(zero, sessionWith('s-zero', [{ turn: 1, answer: 'one' }]))).status, 'unroutable')
  assert.equal(zero.status('s-zero').session.recentChecks[0].at, 0)
})

test('forget, dispose, and a disabled toggle drop or hide the per-session history', async () => {
  const engine = unroutableEngine({ recentCheckDiagnostics: true })
  const session = sessionWith('s-reset', [{ turn: 1, answer: 'one' }])
  await observeTurn(engine, session)
  assert.equal(engine.status('s-reset').session.recentChecks.length, 1)

  assert.equal(engine.forget('s-reset'), true)
  assert.equal(engine.status('s-reset').session, null)
  appendTurn(session, 2, 'two')
  await observeTurn(engine, session)
  assert.equal(engine.status('s-reset').session.recentChecks.length, 1, 'the dropped state starts with an empty history')

  engine.dispose()
  assert.equal(engine.status('s-reset').session, null)

  const toggled = unroutableEngine({ recentCheckDiagnostics: true })
  const toggleSession = sessionWith('s-toggle', [{ turn: 1, answer: 'one' }])
  await observeTurn(toggled, toggleSession)
  assert.equal(toggled.status('s-toggle').session.recentChecks.length, 1)
  toggled.updateConfig({ ...toggled.config(), recentCheckDiagnostics: false })
  assert.equal('recentChecks' in toggled.status('s-toggle').session, false, 'a disabled toggle hides the field')
  appendTurn(toggleSession, 2, 'two')
  await observeTurn(toggled, toggleSession)
  assert.equal('recentChecks' in toggled.status('s-toggle').session, false, 'a disabled toggle records nothing')
  toggled.updateConfig({ ...toggled.config(), recentCheckDiagnostics: true })
  assert.equal(toggled.status('s-toggle').session.recentChecks.length, 0, 're-enabling starts empty because disabling cleared the history')
})

test('secret event, reason, and note text never reach the diagnostic records', async () => {
  const secretAnswer = 'SECRET-ANSWER-MARKER-71'
  const secretReason = 'SECRET-REASON-MARKER-72'
  const secretData = 'SECRET-EVENT-MARKER-73'
  const secretNote = 'SECRET-NOTE-MARKER-74'
  const secretTurn = 'SECRET-TURN-MARKER-75'
  const { engine } = engineWith(
    [JSON.stringify({ note: `note ${secretNote}`, importance: 'high' })],
    { recentCheckDiagnostics: true },
  )
  const session = sessionWith('s-private', [{ turn: 1, answer: `answer ${secretAnswer}` }])
  session.lastEvent.data.reason.detail = secretReason
  session.lastEvent.data.reviewerNote = secretData
  assert.equal((await observeTurn(engine, session)).status, 'noted')
  assert.equal(engine.notes('s-private').length, 1, 'the note itself is stored')

  assert.doesNotThrow(() => engine.observe(session, null))
  assert.doesNotThrow(() => engine.observe(session, { type: 'turn/end', data: 'malformed' }))
  assert.doesNotThrow(() => engine.observe(session, {
    type: 'turn/end',
    data: { turn: secretTurn, secret: secretData, reason: { kind: 'interrupted', detail: secretReason } },
  }))

  const snapshot = engine.status('s-private')
  assert.equal(snapshot.session.recentChecks.length, 1, 'the ignored non-completed event adds no record')
  const text = JSON.stringify(snapshot)
  for (const secret of [secretAnswer, secretReason, secretData, secretNote, secretTurn]) {
    assert.equal(text.includes(secret), false, 'diagnostics must not leak ' + secret)
  }
  assert.equal(text.includes(secretTurn), false, 'event.data.turn is never copied into diagnostics')
  assert.deepEqual(
    Object.keys(snapshot.session.recentChecks[0]).sort(),
    ['at', 'outcome', 'turn'],
    'the ignored event leaves the stored record shape unchanged',
  )
  for (const record of snapshot.session.recentChecks) {
    assert.deepEqual(Object.keys(record).sort(), ['at', 'outcome', 'turn'])
  }
})

test('a reviewer failure and an unexpected failure stay allowlisted and never throw', async () => {
  const { engine } = engineWith([new Error('provider down')], { recentCheckDiagnostics: true })
  const outcome = await observeTurn(engine, sessionWith('s-fail', [{ turn: 1, answer: 'work' }]))
  assert.equal(outcome.status, 'silent')
  const failed = engine.status('s-fail').session.recentChecks
  assert.deepEqual(failed.map((record) => record.outcome), ['silent'])
  assert.equal(EXPECTED_OUTCOMES.includes(failed[0].outcome), true)

  const errorEngine = createEngine({
    config: normalizedConfig({ recentCheckDiagnostics: true }),
    getLlm: () => fakeLlm([]),
    now: () => {
      throw new Error('clock unavailable')
    },
    onError: () => {},
  })
  const errorOutcome = await observeTurn(errorEngine, sessionWith('s-error', [{ turn: 1, answer: 'work' }]))
  assert.equal(errorOutcome.status, 'error')
  assert.deepEqual(errorEngine.status('s-error').session.recentChecks, [{ at: null, turn: 1, outcome: 'error' }])
})

test('a pinned config save preserves the live recent-check opt-in', async () => {
  const engine = createEngine({ config: normalizedConfig({ recentCheckDiagnostics: true }), getLlm: () => undefined })
  const settings = settingsDouble()
  const llm = { resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }) }
  const handlers = createConfigHandlers(engine, {
    settings,
    getLlm: () => llm,
    preserveFields: () => ({ recentCheckDiagnostics: engine.config().recentCheckDiagnostics }),
  })

  assert.equal((await (await handlers.config(configRequest('GET'))).json()).config.recentCheckDiagnostics, true)
  const response = await handlers.config(configRequest('POST', { mode: 'pinned', provider: 'alpha', model: 'a-model' }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).config.recentCheckDiagnostics, true)
  assert.equal(engine.config().recentCheckDiagnostics, true, 'a pinned save must not clear the live opt-in')
  assert.equal(settings.updates[0].patch.recentCheckDiagnostics, true, 'the pinned patch carries the opt-in')
})

test('the config route persists the opt-in, rejects non-booleans, and preserves it on an automatic save', async () => {
  const engine = createEngine({ config: normalizedConfig(), getLlm: () => undefined })
  const settings = settingsDouble()
  const handlers = createConfigHandlers(engine, {
    settings,
    getLlm: () => undefined,
    preserveFields: () => ({ recentCheckDiagnostics: engine.config().recentCheckDiagnostics }),
  })

  assert.equal((await (await handlers.config(configRequest('GET'))).json()).config.recentCheckDiagnostics, false)

  const enabled = await handlers.config(configRequest('POST', {
    mode: 'automatic',
    minDeltaChars: 0,
    cooldownTurns: 1,
    recentCheckDiagnostics: true,
  }))
  assert.equal(enabled.status, 200)
  assert.equal((await enabled.json()).config.recentCheckDiagnostics, true)
  assert.equal(settings.replaces[0].section.recentCheckDiagnostics, true)
  assert.equal(engine.config().recentCheckDiagnostics, true)

  const invalid = await handlers.config(configRequest('POST', { mode: 'automatic', recentCheckDiagnostics: 'yes' }))
  assert.equal(invalid.status, 400)
  assert.deepEqual(await invalid.json(), { ok: false, error: 'invalid-config' })
  assert.equal(settings.replaces.length, 1, 'an invalid value is never persisted')

  const automatic = await handlers.config(configRequest('POST', { mode: 'automatic' }))
  assert.equal(automatic.status, 200)
  assert.deepEqual(settings.replaces[1].section, { recentCheckDiagnostics: true }, 'an omitted field is preserved')
  assert.equal(engine.config().recentCheckDiagnostics, true)

  const explicit = await handlers.config(configRequest('POST', { mode: 'automatic', recentCheckDiagnostics: false }))
  assert.equal(explicit.status, 200)
  assert.deepEqual(settings.replaces[2].section, { recentCheckDiagnostics: false }, 'an explicit field wins')
  assert.equal(engine.config().recentCheckDiagnostics, false)
})

test('the plugin serves the opt-in history and capability over its routes', async () => {
  const secret = 'PRIVATE-RECENT-MARKER-31'
  const llm = fakeLlm([JSON.stringify({ note: `note ${secret}`, importance: 'high' })])

  const enabled = makeCtx({ llm })
  apply(enabled.ctx, { provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1, recentCheckDiagnostics: true })
  enabled.runInjections()
  const listener = enabled.listeners[0].listener
  const session = sessionWith('s-plugin', [{ turn: 1, answer: `answer ${secret}` }])
  listener(session, session.lastEvent)
  await settle()

  const statusRoute = enabled.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/status')
  const statusBody = await (await statusRoute.fetch(statusRequest('s-plugin'))).json()
  assert.deepEqual(statusBody.session.recentChecks.map((record) => record.outcome), ['noted'])
  assert.equal(JSON.stringify(statusBody).includes(secret), false)

  const selfCheckRoute = enabled.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/self-check')
  const selfCheck = await (await selfCheckRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/self-check', { method: 'GET' }))).json()
  assert.equal(selfCheck.capabilities.recentCheckDiagnostics, true)
  assert.equal(JSON.stringify(selfCheck).includes(secret), false)
  enabled.disposeAll()

  const off = makeCtx({ llm: fakeLlm([JSON.stringify({ note: `note ${secret}`, importance: 'high' })]) })
  apply(off.ctx, { provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 })
  off.runInjections()
  const offSession = sessionWith('s-plugin-off', [{ turn: 1, answer: `answer ${secret}` }])
  off.listeners[0].listener(offSession, offSession.lastEvent)
  await settle()

  const offStatusRoute = off.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/status')
  const offBody = await (await offStatusRoute.fetch(statusRequest('s-plugin-off'))).json()
  assert.equal('recentChecks' in offBody.session, false)
  assert.equal(JSON.stringify(offBody).includes(secret), false)
  const offSelfCheckRoute = off.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/self-check')
  const offSelfCheck = await (await offSelfCheckRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/self-check', { method: 'GET' }))).json()
  assert.equal(offSelfCheck.capabilities.recentCheckDiagnostics, false)
  off.disposeAll()
})
