import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { apply, name } from '../lib/index.js'
import { createFetchHandlers } from '../lib/core.js'

function makeLlm(script) {
  const calls = []
  return {
    calls,
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      const text = script.shift() ?? '{"note":null,"importance":null}'
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text }
      })()
    },
  }
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
    effect(callback, label) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push({ disposer, label })
    },
    inject(dependencies, callback) {
      injected.push({ dependencies, callback })
    },
    get(key) {
      return services[key]
    },
  }
  // The Desktop delivers app-owned browser routes over the connection Fetch
  // carrier; the raw web server is deliberately not part of the delivery path.
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
    injected,
    fetchRoutes,
    disposeAll() {
      for (const { disposer } of disposers) disposer()
      disposers.length = 0
    },
    runInjections() {
      for (const { callback } of injected) callback({ effect: ctx.effect, connection, get: ctx.get })
    },
  }
}

function sessionWith(id, turn, answer) {
  const events = [
    {
      type: 'user/message',
      seq: 1,
      data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } },
    },
    {
      type: 'assistant/message',
      seq: 2,
      data: {
        turn,
        step: 0,
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: answer }], source: { kind: 'model' } },
        stream: [],
      },
    },
    { type: 'turn/end', seq: 3, data: { turn, reason: { kind: 'completed' } } },
  ]
  return { id, header: { id }, events, lastEvent: events[events.length - 1] }
}

/**
 * Append one more completed turn to an existing session log with strictly
 * increasing sequence numbers, so the engine's contiguous-feed/gap recovery
 * path sees it the way the real session/event feed would.
 */
function appendTurn(session, turn, answer) {
  const next = session.events[session.events.length - 1].seq + 1
  session.events.push(
    { type: 'user/message', seq: next, data: { id: `u${turn}`, role: 'user', content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: next + 1, data: { turn, step: 0, message: { id: `a${turn}`, role: 'assistant', content: [{ type: 'text', text: answer }], source: { kind: 'model' } }, stream: [] } },
    { type: 'turn/end', seq: next + 2, data: { turn, reason: { kind: 'completed' } } },
  )
  session.lastEvent = session.events[session.events.length - 1]
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('the plugin exports the package name', () => {
  assert.equal(name, 'dsh-you-should-know')
})

test('an explicitly blank provider or model registers nothing at all', () => {
  const inert = [
    { provider: '', model: '' },
    { provider: '  ', model: '  ' },
    { provider: '', model: 'deepseek-chat' },
    { provider: 'deepseek', model: '' },
  ]
  for (const config of inert) {
    const harness = makeCtx()
    apply(harness.ctx, config)
    assert.equal(harness.listeners.length, 0)
    assert.equal(harness.injected.length, 0)
    harness.disposeAll()
  }
})

/** An LLM double that reports the registry a current DSH 0.2.0-rc.2 mounts. */
function installedDeepSeekLlm(script) {
  const llm = makeLlm(script)
  llm.listProviders = () => [{ id: 'deepseek-official', name: 'DeepSeek' }]
  llm.listModels = async (provider) => [
    { provider, id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
    { provider, id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
  ]
  return llm
}

test('the built-in default discovers the DeepSeek route a current DSH build registers', async () => {
  const llm = installedDeepSeekLlm(['{"note":null,"importance":null}'])
  const harness = makeCtx({ llm })
  // The route keys are left out entirely; the gates are lowered so one short
  // turn actually reaches the reviewer channel.
  apply(harness.ctx, { minDeltaChars: 0, cooldownTurns: 1 })
  assert.equal(harness.listeners.length, 3)
  assert.equal(harness.injected.length, 1)

  const listener = harness.listeners[0].listener
  const session = sessionWith('s-default', 1, 'done')
  listener(session, session.lastEvent)
  await settle()
  assert.equal(llm.calls.length, 1)
  assert.equal(llm.calls[0].provider, 'deepseek-official')
  assert.equal(llm.calls[0].model, 'deepseek-flash')
  harness.disposeAll()
})

test('an automatic row with no DeepSeek provider stays quiet and never calls the model', async () => {
  const llm = makeLlm([])
  llm.listProviders = () => [{ id: 'anthropic', name: 'Anthropic' }]
  llm.listModels = async (provider) => [{ provider, id: 'claude-sonnet-4', name: 'Claude' }]
  const harness = makeCtx({ llm })
  apply(harness.ctx, { minDeltaChars: 0, cooldownTurns: 1 })
  const listener = harness.listeners[0].listener
  const session = sessionWith('s-none', 1, 'done')
  listener(session, session.lastEvent)
  await settle()
  assert.equal(llm.calls.length, 0)
  harness.disposeAll()
})

test('a provider and model override reaches the reviewer channel', async () => {
  const llm = makeLlm(['{"note":null,"importance":null}'])
  const harness = makeCtx({ llm })
  apply(harness.ctx, { provider: 'anthropic', model: 'claude-sonnet', minDeltaChars: 0, cooldownTurns: 1 })
  const listener = harness.listeners[0].listener
  const session = sessionWith('s-override', 1, 'done')
  listener(session, session.lastEvent)
  await settle()
  assert.equal(llm.calls[0].provider, 'anthropic')
  assert.equal(llm.calls[0].model, 'claude-sonnet')
  harness.disposeAll()
})

test('a live config change moves from the automatic route to an explicit override', async () => {
  const firstLlm = installedDeepSeekLlm(['{"note":null,"importance":null}'])
  const first = makeCtx({ llm: firstLlm })
  apply(first.ctx, { minDeltaChars: 0, cooldownTurns: 1 })
  const firstListener = first.listeners[0].listener
  const firstSession = sessionWith('s-live-a', 1, 'done')
  firstListener(firstSession, firstSession.lastEvent)
  await settle()
  assert.equal(firstLlm.calls[0].provider, 'deepseek-official')
  assert.equal(firstLlm.calls[0].model, 'deepseek-flash')
  first.disposeAll()

  const secondLlm = makeLlm(['{"note":null,"importance":null}'])
  const second = makeCtx({ llm: secondLlm })
  apply(second.ctx, { provider: 'anthropic', model: 'claude-sonnet', minDeltaChars: 0, cooldownTurns: 1 })
  const secondListener = second.listeners[0].listener
  const secondSession = sessionWith('s-live-b', 1, 'done')
  secondListener(secondSession, secondSession.lastEvent)
  await settle()
  assert.equal(secondLlm.calls[0].provider, 'anthropic')
  assert.equal(secondLlm.calls[0].model, 'claude-sonnet')
  second.disposeAll()
})

test('a changed volatile provider/model ref updates the live reviewer route', async () => {
  const llm = makeLlm(['{"note":null,"importance":null}', '{"note":null,"importance":null}'])
  const harness = makeCtx({ llm })
  let route = { provider: 'vendor-one', model: 'model-one' }
  // DSH commits volatile row values into their running references in place, so
  // each field arrives as a { get() } ref rather than a plain value.
  apply(harness.ctx, {
    provider: { get: () => route.provider },
    model: { get: () => route.model },
    minDeltaChars: 0,
    cooldownTurns: 1,
  })

  const sessionEvent = harness.listeners.find((entry) => entry.eventName === 'session/event').listener
  const volatileUpdate = harness.listeners.find((entry) => entry.eventName === 'loader/volatile-update')
  assert.notEqual(volatileUpdate, undefined, 'the owning fiber subscribes to loader/volatile-update')

  const first = sessionWith('s-volatile-route', 1, 'first answer')
  sessionEvent(first, first.lastEvent)
  await settle()
  assert.equal(llm.calls.length, 1)
  assert.equal(llm.calls[0].provider, 'vendor-one')
  assert.equal(llm.calls[0].model, 'model-one')

  route = { provider: 'vendor-two', model: 'model-two' }
  volatileUpdate.listener()

  appendTurn(first, 2, 'second answer')
  sessionEvent(first, first.lastEvent)
  await settle()
  assert.equal(llm.calls.length, 2, 'the changed route must reach the next review')
  assert.equal(llm.calls[1].provider, 'vendor-two')
  assert.equal(llm.calls[1].model, 'model-two')
  harness.disposeAll()
})

test('a changed volatile gate ref is applied to the live turn gates', async () => {
  const llm = makeLlm(['{"note":null,"importance":null}'])
  const harness = makeCtx({ llm })
  let minDeltaChars = 10000
  apply(harness.ctx, {
    provider: 'p',
    model: 'm',
    minDeltaChars: { get: () => minDeltaChars },
    cooldownTurns: { get: () => 1 },
  })

  const sessionEvent = harness.listeners.find((entry) => entry.eventName === 'session/event').listener
  const volatileUpdate = harness.listeners.find((entry) => entry.eventName === 'loader/volatile-update')

  const blocked = sessionWith('s-volatile-gate', 1, 'short answer')
  sessionEvent(blocked, blocked.lastEvent)
  await settle()
  assert.equal(llm.calls.length, 0, 'the live delta gate keeps a short turn out')

  minDeltaChars = 0
  volatileUpdate.listener()

  appendTurn(blocked, 2, 'short answer')
  sessionEvent(blocked, blocked.lastEvent)
  await settle()
  assert.equal(llm.calls.length, 1, 'the changed gate admits the next turn')
  harness.disposeAll()
})

test('a throwing volatile ref keeps the prior live config and never escapes the listener', async () => {
  const llm = makeLlm(['{"note":null,"importance":null}'])
  const harness = makeCtx({ llm })
  let route = { provider: 'stable-provider', model: 'stable-model' }
  apply(harness.ctx, {
    provider: { get: () => route.provider },
    model: { get: () => route.model },
    minDeltaChars: 0,
    cooldownTurns: 1,
  })

  const sessionEvent = harness.listeners.find((entry) => entry.eventName === 'session/event').listener
  const volatileUpdate = harness.listeners.find((entry) => entry.eventName === 'loader/volatile-update')

  route = null
  assert.doesNotThrow(() => volatileUpdate.listener(), 'a broken ref must fail quiet')

  const session = sessionWith('s-volatile-quiet', 1, 'answer')
  sessionEvent(session, session.lastEvent)
  await settle()
  assert.equal(llm.calls.length, 1)
  assert.equal(llm.calls[0].provider, 'stable-provider')
  assert.equal(llm.calls[0].model, 'stable-model')
  harness.disposeAll()
})

test('an inert row does not consume the single-reviewer slot', () => {
  const inert = makeCtx()
  apply(inert.ctx, { provider: '', model: '' })
  inert.disposeAll()

  const configured = makeCtx({ llm: makeLlm([]) })
  apply(configured.ctx, { provider: 'p', model: 'm' })
  assert.equal(configured.listeners.length, 3)
  assert.equal(configured.listeners[0].eventName, 'session/event')
  assert.equal(configured.injected.length, 1)
  configured.disposeAll()
})

test('composing the plugin twice keeps exactly one reviewer, until the first is disposed', () => {
  const first = makeCtx({ llm: makeLlm([]) })
  apply(first.ctx, { provider: 'p', model: 'm' })
  const second = makeCtx({ llm: makeLlm([]) })
  apply(second.ctx, { provider: 'p', model: 'm' })
  assert.equal(second.listeners.length, 0)
  assert.equal(second.injected.length, 0)

  first.disposeAll()
  const third = makeCtx({ llm: makeLlm([]) })
  apply(third.ctx, { provider: 'p', model: 'm' })
  assert.equal(third.listeners.length, 3)
  third.disposeAll()
  second.disposeAll()
})

test('the plugin registers its browser routes on the connection Fetch carrier', () => {
  const harness = makeCtx({ llm: makeLlm([]) })
  apply(harness.ctx, { provider: 'p', model: 'm' })
  assert.equal(harness.injected.length, 1)
  assert.deepEqual(harness.injected[0].dependencies, ['connection'])
  harness.runInjections()

  assert.deepEqual(harness.fetchRoutes.map((route) => route.path).sort(), [
    '/api/dsh-you-should-know/config',
    '/api/dsh-you-should-know/dismiss',
    '/api/dsh-you-should-know/history',
    '/api/dsh-you-should-know/notes',
    '/api/dsh-you-should-know/session',
    '/api/dsh-you-should-know/status',
    '/api/dsh-you-should-know/update',
  ])

  const notes = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/notes')
  assert.deepEqual(notes.methods, ['GET', 'HEAD'])
  assert.equal(notes.requestBody, 'buffered')
  assert.equal(typeof notes.fetch, 'function')

  const history = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/history')
  assert.deepEqual(history.methods, ['GET', 'HEAD'])
  assert.equal(history.requestBody, 'buffered')
  assert.equal(typeof history.fetch, 'function')

  const dismiss = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/dismiss')
  assert.deepEqual(dismiss.methods, ['POST'])
  assert.equal(dismiss.requestBody, 'streaming', 'the handler enforces the plugin body bound itself')

  const status = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/status')
  assert.deepEqual(status.methods, ['GET', 'HEAD'])
  assert.equal(status.requestBody, 'buffered')
  harness.disposeAll()
})

test('every declared Fetch route crosses the connection bridge for each of its methods', async () => {
  const harness = makeCtx({ llm: makeLlm([]) })
  apply(harness.ctx, { provider: 'p', model: 'm' })
  harness.runInjections()

  // Mirrors HostConnectionService.createSharedFetchHandler + bridge(): one
  // requestBody mode is declared per path, and the streaming path hands
  // node:http's body stream to Request. Request rejects a body on GET/HEAD, so
  // a combined GET/HEAD/POST route that declares streaming breaks its reads.
  const bridgeRequest = (route, method, body) => {
    const mode = route.methods.includes(method) ? route.requestBody : 'buffered'
    const url = new URL(route.path, 'http://127.0.0.1')
    if (mode !== 'streaming') {
      return new Request(url, { method, ...(body === undefined ? {} : { body }) })
    }
    return new Request(url, {
      method,
      body: Readable.toWeb(Readable.from(body === undefined ? [] : [body])),
      duplex: 'half',
    })
  }

  for (const route of harness.fetchRoutes) {
    for (const method of route.methods) {
      assert.doesNotThrow(
        () => bridgeRequest(route, method, method === 'POST' ? '{}' : undefined),
        method + ' ' + route.path + ' must cross the connection bridge',
      )
    }
  }

  // A buffered POST keeps its body readable by the plugin's stream reader.
  const session = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/session')
  const buffered = bridgeRequest(session, 'POST', JSON.stringify({ action: 'status' }))
  assert.equal(await buffered.text(), JSON.stringify({ action: 'status' }))
  const response = await session.fetch(bridgeRequest(session, 'POST', JSON.stringify({ action: 'resume', sessionId: 's-bridge' })))
  assert.deepEqual(await response.json(), { ok: true, action: 'resume', resumed: false }, 'a buffered POST body still reaches the handler')
  harness.disposeAll()
})

test('a configured plugin observes a turn, serves the note, and dismisses it over Fetch', async () => {
  const llm = makeLlm(['{"note":"The retry path double-charges.","importance":"critical"}'])
  const harness = makeCtx({ llm })
  apply(harness.ctx, { provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 })
  harness.runInjections()

  const listener = harness.listeners[0].listener
  const session = sessionWith('s1', 1, 'done')
  listener(session, session.lastEvent)
  await settle()

  const notesRoute = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/notes')
  const listResponse = await notesRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/notes?sessionId=s1', { method: 'GET' }))
  assert.equal(listResponse.headers.get('cache-control'), 'no-store')
  const listed = await listResponse.json()
  assert.equal(listed.ok, true)
  assert.equal(listed.notes.length, 1)
  assert.equal(listed.notes[0].importance, 'critical')
  assert.equal(listed.historyCount, 1, 'the notes payload also carries the bounded history count')

  const dismissRoute = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/dismiss')
  const dismissResponse = await dismissRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/dismiss', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 's1', noteId: listed.notes[0].id }),
  }))
  assert.deepEqual(await dismissResponse.json(), { ok: true, dismissed: true })

  const afterResponse = await notesRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/notes?sessionId=s1', { method: 'GET' }))
  assert.deepEqual((await afterResponse.json()).notes, [])
  harness.disposeAll()
})

test('the Fetch resolve route records an exact action and history keeps the note', async () => {
  const llm = makeLlm(['{"note":"Added to the draft.","importance":"high","source":{"path":"src/a.js","line":4}}'])
  const harness = makeCtx({ llm })
  apply(harness.ctx, { provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 })
  harness.runInjections()

  const listener = listenerOf(harness, 'session/event')
  const session = sessionWith('s1', 1, 'done')
  listener(session, session.lastEvent)
  await settle()

  const notesRoute = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/notes')
  const historyRoute = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/history')
  const listed = await (await notesRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/notes?sessionId=s1', { method: 'GET' }))).json()
  assert.equal(listed.historyCount, 1)
  const noteId = listed.notes[0].id

  const resolveRoute = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/dismiss')
  const resolved = await resolveRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/dismiss', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 's1', noteId, action: 'added_to_chat' }),
  }))
  assert.deepEqual(await resolved.json(), { ok: true, resolved: true, resolution: 'added_to_chat' })

  const after = await (await notesRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/notes?sessionId=s1', { method: 'GET' }))).json()
  assert.deepEqual(after.notes, [], 'a resolved note leaves the active list')
  assert.equal(after.historyCount, 1)

  const history = await (await historyRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/history?sessionId=s1', { method: 'GET' }))).json()
  assert.equal(history.history.length, 1)
  assert.equal(history.history[0].id, noteId)
  assert.equal(history.history[0].resolved, true)
  assert.equal(history.history[0].resolution, 'added_to_chat')
  assert.deepEqual(history.history[0].source, { path: 'src/a.js', line: 4 })
  assert.equal(typeof history.history[0].resolvedAt, 'number')

  const invalid = await resolveRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/dismiss', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 's1', noteId, action: 'forgotten' }),
  }))
  assert.equal(invalid.status, 400)
  assert.deepEqual(await invalid.json(), { ok: false, error: 'invalid-action' })
  harness.disposeAll()
})

test('the status route reports activity without exposing conversation or note text', async () => {
  const secret = 'PRIVATE-MARKER-42'
  const llm = installedDeepSeekLlm([JSON.stringify({ note: `note ${secret}`, importance: 'high' })])
  const harness = makeCtx({ llm })
  apply(harness.ctx, { minDeltaChars: 0, cooldownTurns: 1 })
  harness.runInjections()

  const listener = harness.listeners[0].listener
  const session = sessionWith('s-status', 1, `answer ${secret}`)
  listener(session, session.lastEvent)
  await settle()

  const statusRoute = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/status')
  assert.equal(typeof statusRoute?.fetch, 'function')

  const response = await statusRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/status?sessionId=s-status', { method: 'GET' }))
  const text = await response.text()
  const snapshot = JSON.parse(text)
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.configured, true)
  assert.deepEqual(snapshot.route, { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.equal(snapshot.routeResolutions, 1)
  assert.equal(snapshot.session.reviewStarts, 1)
  assert.equal(snapshot.session.lastOutcome, 'noted')
  assert.equal(snapshot.session.noteCount, 1)
  assert.equal(text.includes(secret), false, 'diagnostics must not leak conversation or note text')

  const head = await statusRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/status?sessionId=s-status', { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')

  const wrongMethod = await statusRoute.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/status', { method: 'POST' }))
  assert.equal(wrongMethod.status, 405)
  harness.disposeAll()
})

test('a listener failure is contained instead of escaping into the host', async () => {
  const harness = makeCtx({ llm: makeLlm([]) })
  apply(harness.ctx, { provider: 'p', model: 'm' })
  const listener = harness.listeners[0].listener
  assert.doesNotThrow(() => listener({ get header() { throw new Error('hostile session') } }, { type: 'turn/end', data: {} }))
  await settle()
  harness.disposeAll()
})

// --- Phase 2: the session route, session/disposed, and process-global ownership ---

function sessionRouteOf(harness) {
  return harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/session')
}

function listenerOf(harness, eventName) {
  const found = harness.listeners.find((entry) => entry.eventName === eventName)
  return found === undefined ? undefined : found.listener
}

function sessionUrl(id) {
  return `http://127.0.0.1/api/dsh-you-should-know/session?sessionId=${id}`
}

function postSession(action, body = {}) {
  return new Request('http://127.0.0.1/api/dsh-you-should-know/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
}

test('the session route is registered with GET, HEAD, and POST on the Fetch carrier', () => {
  const harness = makeCtx({ llm: makeLlm([]) })
  apply(harness.ctx, { provider: 'p', model: 'm' })
  harness.runInjections()

  const route = sessionRouteOf(harness)
  assert.notEqual(route, undefined)
  assert.deepEqual(route.methods, ['GET', 'HEAD', 'POST'])
  assert.equal(route.requestBody, 'buffered', 'GET/HEAD share the path, so the carrier must buffer')
  assert.equal(typeof route.fetch, 'function')
  harness.disposeAll()
})

test('the session route serves the effective route and its source without leaking text', async () => {
  const secret = 'SESSION-ROUTE-SECRET-91'
  const llm = makeLlm([JSON.stringify({ note: `note ${secret}`, importance: 'high' })])
  const harness = makeCtx({ llm })
  apply(harness.ctx, { provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 })
  harness.runInjections()

  const listener = listenerOf(harness, 'session/event')
  const session = sessionWith('s1', 1, `answer ${secret}`)
  listener(session, session.lastEvent)
  await settle()

  const route = sessionRouteOf(harness)
  const response = await route.fetch(new Request(sessionUrl('s1'), { method: 'GET' }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const text = await response.text()
  assert.equal(text.includes(secret), false, 'the session view must not leak conversation or note text')
  const view = JSON.parse(text)
  assert.equal(view.ok, true)
  assert.equal(view.sessionId, 's1')
  assert.equal(view.configured, true)
  assert.equal(view.effectiveRouteSource, 'global')
  assert.deepEqual(view.effectiveRoute, { provider: 'p', model: 'm' })
  assert.equal(view.sessionOverride, null)

  const head = await route.fetch(new Request(sessionUrl('s1'), { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')

  const wrongMethod = await route.fetch(new Request(sessionUrl('s1'), { method: 'PUT' }))
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'GET, HEAD, POST')
  harness.disposeAll()
})

test('the session route POST set-model and reset-model change the reviewer route', async () => {
  const llm = makeLlm(['{"note":null,"importance":null}', '{"note":null,"importance":null}'])
  const harness = makeCtx({ llm })
  apply(harness.ctx, { provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 })
  harness.runInjections()
  const route = sessionRouteOf(harness)

  const set = await route.fetch(postSession('set-model', { sessionId: 's1', provider: 'vendor', model: 'model-x' }))
  assert.equal(set.status, 200)
  const setBody = await set.json()
  assert.equal(setBody.ok, true)
  assert.equal(setBody.action, 'set-model')
  assert.equal(setBody.effectiveRouteSource, 'session')
  assert.deepEqual(setBody.sessionOverride, { provider: 'vendor', model: 'model-x' })
  assert.deepEqual(setBody.effectiveRoute, { provider: 'vendor', model: 'model-x' })

  const listener = listenerOf(harness, 'session/event')
  const session = sessionWith('s1', 1, 'done')
  listener(session, session.lastEvent)
  await settle()
  assert.equal(llm.calls[0].provider, 'vendor')
  assert.equal(llm.calls[0].model, 'model-x')
  assert.equal(llm.calls[0].maxTokens, 768)

  const reset = await route.fetch(postSession('reset-model', { sessionId: 's1' }))
  assert.equal(reset.status, 200)
  const resetBody = await reset.json()
  assert.equal(resetBody.ok, true)
  assert.equal(resetBody.action, 'reset-model')
  assert.equal(resetBody.removed, true)
  assert.equal(resetBody.effectiveRouteSource, 'global')
  assert.deepEqual(resetBody.sessionOverride, null)

  session.events.push(
    { type: 'user/message', seq: 90, data: { id: 'u2', role: 'user', content: [{ type: 'text', text: 'q2' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 91, data: { turn: 2, step: 0, message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'two' }], source: { kind: 'model' } }, stream: [] } },
    { type: 'turn/end', seq: 92, data: { turn: 2, reason: { kind: 'completed' } } },
  )
  session.lastEvent = session.events[session.events.length - 1]
  listener(session, session.lastEvent)
  await settle()
  assert.equal(llm.calls[1].provider, 'p')
  assert.equal(llm.calls[1].model, 'm')
  harness.disposeAll()
})

test('the session route POST resume reports whether a paused runtime resumed', async () => {
  const harness = makeCtx({ llm: makeLlm([]) })
  apply(harness.ctx, { provider: 'p', model: 'm' })
  harness.runInjections()
  const response = await sessionRouteOf(harness).fetch(postSession('resume', { sessionId: 's1' }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, action: 'resume', resumed: false })
  harness.disposeAll()
})

test('the session route bounds and rejects invalid POSTs without throwing', async () => {
  const harness = makeCtx({ llm: makeLlm([]) })
  apply(harness.ctx, { provider: 'p', model: 'm' })
  harness.runInjections()
  const route = sessionRouteOf(harness)

  const unsupported = await route.fetch(postSession('delete-everything', { sessionId: 's1' }))
  assert.equal(unsupported.status, 400)
  assert.deepEqual(await unsupported.json(), { ok: false, error: 'unsupported-action' })

  const missingSession = await route.fetch(postSession('set-model', { provider: 'p', model: 'm' }))
  assert.equal(missingSession.status, 400)
  assert.deepEqual(await missingSession.json(), { ok: false, error: 'invalid-session' })

  const blankRoute = await route.fetch(postSession('set-model', { sessionId: 's1', provider: '  ', model: 'm' }))
  assert.equal(blankRoute.status, 400)
  assert.deepEqual(await blankRoute.json(), { ok: false, error: 'invalid-route' })

  const oversized = await route.fetch(postSession('set-model', { sessionId: 's1', provider: 'p', model: 'x'.repeat(9000) }))
  assert.equal(oversized.status, 400)
  assert.deepEqual(await oversized.json(), { ok: false, error: 'invalid-body' })

  const noBody = await route.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/session', { method: 'POST' }))
  assert.equal(noBody.status, 400)
  assert.deepEqual(await noBody.json(), { ok: false, error: 'invalid-body' })
  harness.disposeAll()
})

test('session/disposed forgets the session notes and its override', async () => {
  const llm = makeLlm(['{"note":"dispose me","importance":"high"}'])
  const harness = makeCtx({ llm })
  apply(harness.ctx, { provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 })
  harness.runInjections()

  const listener = listenerOf(harness, 'session/event')
  const session = sessionWith('s1', 1, 'done')
  listener(session, session.lastEvent)
  await settle()

  const notesUrl = 'http://127.0.0.1/api/dsh-you-should-know/notes?sessionId=s1'
  const notesRoute = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/notes')
  assert.equal((await (await notesRoute.fetch(new Request(notesUrl, { method: 'GET' }))).json()).notes.length, 1)

  const historyUrl = 'http://127.0.0.1/api/dsh-you-should-know/history?sessionId=s1'
  const historyRoute = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/history')
  assert.equal((await (await historyRoute.fetch(new Request(historyUrl, { method: 'GET' }))).json()).history.length, 1)

  const disposedListener = listenerOf(harness, 'session/disposed')
  assert.equal(typeof disposedListener, 'function')
  disposedListener({ header: { id: 's1' } })

  const after = await (await notesRoute.fetch(new Request(notesUrl, { method: 'GET' }))).json()
  assert.deepEqual(after.notes, [])
  assert.deepEqual((await (await historyRoute.fetch(new Request(historyUrl, { method: 'GET' }))).json()).history, [], 'disposal clears history too')

  assert.doesNotThrow(() => disposedListener({ get header() { throw new Error('hostile session') } }))
  assert.doesNotThrow(() => disposedListener('s1'))
  harness.disposeAll()
})

test('the session route turns an unexpected engine failure into a bounded 500', async () => {
  const engine = {
    sessionConfig() {
      throw new Error('boom')
    },
    setSessionModel() {
      throw new Error('boom')
    },
    resetSessionModel() {
      throw new Error('boom')
    },
    resume() {
      throw new Error('boom')
    },
  }
  const handlers = createFetchHandlers(engine)

  const getResponse = await handlers.session(new Request('http://127.0.0.1/api/dsh-you-should-know/session?sessionId=s1', { method: 'GET' }))
  assert.equal(getResponse.status, 500)
  assert.deepEqual(await getResponse.json(), { ok: false, error: 'internal' })

  const postResponse = await handlers.session(new Request('http://127.0.0.1/api/dsh-you-should-know/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'resume', sessionId: 's1' }),
  }))
  assert.equal(postResponse.status, 500)
  assert.deepEqual(await postResponse.json(), { ok: false, error: 'internal' })
})

test('ownership is a process-global token across fresh module imports and releases on disposal', async () => {
  const base = new URL('../lib/index.js', import.meta.url).href
  const firstModule = await import(`${base}?phase2=a`)
  const secondModule = await import(`${base}?phase2=b`)

  const first = makeCtx({ llm: makeLlm([]) })
  firstModule.apply(first.ctx, { provider: 'p', model: 'm' })
  assert.equal(first.listeners.length, 3, 'the first fresh module owns the process-global slot')

  const second = makeCtx({ llm: makeLlm([]) })
  secondModule.apply(second.ctx, { provider: 'p', model: 'm' })
  assert.equal(second.listeners.length, 0, 'a second fresh module instance stays inert')
  assert.equal(second.injected.length, 0)

  first.disposeAll()
  first.disposeAll()
  const third = makeCtx({ llm: makeLlm([]) })
  secondModule.apply(third.ctx, { provider: 'p', model: 'm' })
  assert.equal(third.listeners.length, 3, 'the released token can be claimed again')

  third.disposeAll()
  second.disposeAll()
})

// --- Phase 3: the live config route and the settings integration ---

test('the plugin registers the config route on the connection Fetch carrier', () => {
  const harness = makeCtx({ llm: makeLlm([]) })
  apply(harness.ctx, { provider: 'p', model: 'm' })
  harness.runInjections()

  const config = harness.fetchRoutes.find((route) => route.path === '/api/dsh-you-should-know/config')
  assert.notEqual(config, undefined)
  assert.deepEqual(config.methods, ['GET', 'HEAD', 'POST'])
  assert.equal(config.requestBody, 'buffered', 'GET/HEAD share the path, so the carrier must buffer')
  assert.equal(typeof config.fetch, 'function')
  harness.disposeAll()
})

test('the config route is writable and persists the row through the settings service', async () => {
  const updates = []
  const llm = installedDeepSeekLlm([])
  const settings = {
    update(key, patch) {
      updates.push({ key, patch })
      return Promise.resolve()
    },
    replace(key, section) {
      updates.push({ key, section, replaced: true })
      return Promise.resolve()
    },
  }
  const harness = makeCtx({ llm, settings })
  apply(harness.ctx, { minDeltaChars: 0, cooldownTurns: 1 })
  harness.runInjections()

  const route = harness.fetchRoutes.find((candidate) => candidate.path === '/api/dsh-you-should-know/config')
  const read = await route.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/config', { method: 'GET' }))
  const body = await read.json()
  assert.equal(body.writable, true)
  assert.equal(body.config.mode, 'automatic')
  assert.deepEqual(body.catalog.providers.map((entry) => entry.id), ['deepseek-official'])

  const saved = await route.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'pinned', provider: 'deepseek-official', model: 'deepseek-flash' }),
  }))
  assert.equal(saved.status, 200)
  const savedBody = await saved.json()
  assert.equal(savedBody.config.mode, 'pinned')
  assert.equal(savedBody.config.provider, 'deepseek-official')
  assert.deepEqual(updates, [{ key: 'you-should-know', patch: { provider: 'deepseek-official', model: 'deepseek-flash' } }])
  harness.disposeAll()
})

test('the config route reports read-only and refuses to persist without a settings service', async () => {
  const harness = makeCtx({ llm: installedDeepSeekLlm([]) })
  apply(harness.ctx, { minDeltaChars: 0, cooldownTurns: 1 })
  harness.runInjections()
  const route = harness.fetchRoutes.find((candidate) => candidate.path === '/api/dsh-you-should-know/config')

  const read = await route.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/config', { method: 'GET' }))
  assert.equal((await read.json()).writable, false)

  const saved = await route.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'automatic' }),
  }))
  assert.equal(saved.status, 503)
  assert.deepEqual(await saved.json(), { ok: false, error: 'settings-unavailable' })
  harness.disposeAll()
})

test('the session route POST set-mode and reset-mode isolate the strictness mode', async () => {
  const llm = makeLlm(['{"note":"hi","importance":"high"}', '{"note":"hi","importance":"high"}'])
  const harness = makeCtx({ llm })
  apply(harness.ctx, { provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1, reviewerMode: 'relaxed' })
  harness.runInjections()
  const route = sessionRouteOf(harness)

  const set = await route.fetch(postSession('set-mode', { sessionId: 's1', mode: 'strict' }))
  assert.equal(set.status, 200)
  const setBody = await set.json()
  assert.equal(setBody.ok, true)
  assert.equal(setBody.action, 'set-mode')
  assert.equal(setBody.effectiveMode, 'strict')
  assert.equal(setBody.effectiveModeSource, 'session')
  assert.equal(setBody.sessionModeOverride, 'strict')
  assert.equal(setBody.globalMode, 'relaxed', 'a session override never mutates the global mode')

  const other = await (await route.fetch(new Request(sessionUrl('s2'), { method: 'GET' }))).json()
  assert.equal(other.effectiveMode, 'relaxed')
  assert.equal(other.sessionModeOverride, null)

  const reset = await route.fetch(postSession('reset-mode', { sessionId: 's1' }))
  assert.equal(reset.status, 200)
  const resetBody = await reset.json()
  assert.equal(resetBody.effectiveMode, 'relaxed')
  assert.equal(resetBody.sessionModeOverride, null)
  assert.equal(resetBody.removed, true)

  const invalid = await route.fetch(postSession('set-mode', { sessionId: 's1', mode: 'loose' }))
  assert.equal(invalid.status, 400)
  assert.deepEqual(await invalid.json(), { ok: false, error: 'invalid-mode' })

  const oversized = await route.fetch(postSession('set-mode', { sessionId: 's1', mode: 'x'.repeat(9000) }))
  assert.equal(oversized.status, 400)
  assert.deepEqual(await oversized.json(), { ok: false, error: 'invalid-body' })
  harness.disposeAll()
})

test('the plugin runs the day-first automatic update check through the web and settings seams', async () => {
  const webCalls = []
  const updates = []
  const web = {
    async fetch(request) {
      webCalls.push(request)
      return { statusCode: 200, body: { kind: 'text', content: JSON.stringify({ tag_name: 'v0.4.0', draft: false, prerelease: false }) }, truncated: false, url: request.url }
    },
  }
  const settings = {
    async update(key, patch) {
      updates.push({ key, patch })
    },
    async replace() {},
  }
  const harness = makeCtx({ llm: makeLlm([]), web, settings })
  apply(harness.ctx, { provider: 'p', model: 'm' })

  const deadline = Date.now() + 2000
  while (updates.length === 0 && Date.now() < deadline) await settle()

  assert.equal(webCalls.length, 1, 'one automatic check runs on the first activation of the day')
  assert.deepEqual(Object.keys(webCalls[0]), ['url'], 'the request carries only the release URL')
  assert.equal(typeof webCalls[0].url, 'string')
  assert.equal(updates.length, 1)
  assert.equal(updates[0].key, 'you-should-know')
  assert.equal(updates[0].patch.lastSeenLatestVersion, 'v0.4.0')
  const now = new Date()
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
  assert.equal(updates[0].patch.lastAutoCheckDate, today, 'only a successful automatic check stamps the local date')
  harness.disposeAll()

  // A restart in the same local day, with the stamped date persisted, must not
  // make a second automatic request.
  const again = makeCtx({ llm: makeLlm([]), web, settings })
  apply(again.ctx, { provider: 'p', model: 'm', lastAutoCheckDate: today, lastSeenLatestVersion: 'v0.4.0' })
  await settle()
  await settle()
  assert.equal(webCalls.length, 1, 'a same-day restart does not repeat the check')
  again.disposeAll()
})

test('a volatile config edit reaches the update state without a remount', async () => {
  const today = new Date()
  const dateKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
  const settingsUpdates = []
  const web = { fetch: async () => ({ statusCode: 200, body: { kind: 'text', content: JSON.stringify({ tag_name: 'v0.4.0' }) }, truncated: false }) }
  const settings = {
    async update(key, patch) {
      settingsUpdates.push({ key, patch })
    },
    async replace() {},
  }
  const harness = makeCtx({ llm: makeLlm([]), web, settings })
  const rawConfig = { provider: 'p', model: 'm', autoCheckUpdates: true, updateBehavior: 'ask-before-update', lastAutoCheckDate: dateKey, lastSeenLatestVersion: 'v0.4.0' }
  apply(harness.ctx, rawConfig)
  harness.runInjections()
  assert.equal(settingsUpdates.length, 0, 'a day already checked makes no automatic request')

  const listener = harness.listeners.find((entry) => entry.eventName === 'loader/volatile-update').listener
  rawConfig.autoCheckUpdates = false
  rawConfig.updateBehavior = 'notify-only'
  listener()
  await settle()

  const route = harness.fetchRoutes.find((candidate) => candidate.path === '/api/dsh-you-should-know/update')
  const body = await (await route.fetch(new Request('http://127.0.0.1/api/dsh-you-should-know/update', { method: 'GET' }))).json()
  assert.equal(body.update.autoCheckUpdates, false)
  assert.equal(body.update.updateBehavior, 'notify-only')
  assert.equal(body.update.lastAutoCheckDate, dateKey, 'the persisted date survives the volatile edit')
  assert.equal(body.update.latestTag, 'v0.4.0')
  harness.disposeAll()
})
