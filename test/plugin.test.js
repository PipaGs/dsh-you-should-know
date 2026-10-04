import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, name } from '../lib/index.js'

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
  const routes = []
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
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  return {
    ctx,
    listeners,
    injected,
    routes,
    disposeAll() {
      for (const { disposer } of disposers) disposer()
      disposers.length = 0
    },
    runInjections() {
      for (const { callback } of injected) callback({ effect: ctx.effect, webServer })
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

function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

function fakeRequest(overrides = {}) {
  const listeners = new Map()
  return {
    method: 'GET',
    url: '/',
    ...overrides,
    on(event, listener) {
      listeners.set(event, listener)
      return this
    },
    async send(body) {
      if (listeners.has('data')) listeners.get('data')(body)
      if (listeners.has('end')) listeners.get('end')()
    },
  }
}

function fakeResponse() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      if (typeof body === 'string') this.body = body
    },
  }
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
  assert.equal(harness.listeners.length, 1)
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

test('an inert row does not consume the single-reviewer slot', () => {
  const inert = makeCtx()
  apply(inert.ctx, { provider: '', model: '' })
  inert.disposeAll()

  const configured = makeCtx({ llm: makeLlm([]) })
  apply(configured.ctx, { provider: 'p', model: 'm' })
  assert.equal(configured.listeners.length, 1)
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
  assert.equal(third.listeners.length, 1)
  third.disposeAll()
  second.disposeAll()
})

test('a configured plugin observes a turn, serves the note, and dismisses it', async () => {
  const llm = makeLlm(['{"note":"The retry path double-charges.","importance":"critical"}'])
  const harness = makeCtx({ llm })
  apply(harness.ctx, { provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 })
  harness.runInjections()
  assert.deepEqual(harness.routes.map((route) => route.path).sort(), [
    '/dsh-you-should-know/dismiss',
    '/dsh-you-should-know/notes',
    '/dsh-you-should-know/status',
  ])

  const listener = harness.listeners[0].listener
  const session = sessionWith('s1', 1, 'done')
  listener(session, session.lastEvent)
  await settle()

  const notesRoute = harness.routes.find((route) => route.path === '/dsh-you-should-know/notes')
  const listResponse = fakeResponse()
  await notesRoute.handler(fakeRequest({ url: '/dsh-you-should-know/notes?sessionId=s1' }), listResponse)
  const listed = JSON.parse(listResponse.body)
  assert.equal(listed.ok, true)
  assert.equal(listed.notes.length, 1)
  assert.equal(listed.notes[0].importance, 'critical')

  const dismissRoute = harness.routes.find((route) => route.path === '/dsh-you-should-know/dismiss')
  const dismissRequest = fakeRequest({ method: 'POST' })
  const dismissResponse = fakeResponse()
  const pending = dismissRoute.handler(dismissRequest, dismissResponse)
  await dismissRequest.send(JSON.stringify({ sessionId: 's1', noteId: listed.notes[0].id }))
  await pending
  assert.deepEqual(JSON.parse(dismissResponse.body), { ok: true, dismissed: true })

  const afterResponse = fakeResponse()
  await notesRoute.handler(fakeRequest({ url: '/dsh-you-should-know/notes?sessionId=s1' }), afterResponse)
  assert.deepEqual(JSON.parse(afterResponse.body).notes, [])
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

  const statusRoute = harness.routes.find((route) => route.path === '/dsh-you-should-know/status')
  assert.equal(typeof statusRoute?.handler, 'function')

  const response = fakeResponse()
  await statusRoute.handler(fakeRequest({ url: '/dsh-you-should-know/status?sessionId=s-status' }), response)
  const snapshot = JSON.parse(response.body)
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.configured, true)
  assert.deepEqual(snapshot.route, { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.equal(snapshot.routeResolutions, 1)
  assert.equal(snapshot.session.reviewStarts, 1)
  assert.equal(snapshot.session.lastOutcome, 'noted')
  assert.equal(snapshot.session.noteCount, 1)
  assert.equal(response.body.includes(secret), false, 'diagnostics must not leak conversation or note text')

  const head = fakeResponse()
  await statusRoute.handler(fakeRequest({ method: 'HEAD', url: '/dsh-you-should-know/status?sessionId=s-status' }), head)
  assert.equal(head.status, 200)
  assert.equal(head.body, '')

  const wrongMethod = fakeResponse()
  await statusRoute.handler(fakeRequest({ method: 'POST', url: '/dsh-you-should-know/status' }), wrongMethod)
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
