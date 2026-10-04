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

test('a blank provider or model registers nothing at all', () => {
  for (const config of [undefined, {}, { provider: 'p' }, { model: 'm' }, { provider: '  ', model: '  ' }]) {
    const harness = makeCtx()
    apply(harness.ctx, config)
    assert.equal(harness.listeners.length, 0)
    assert.equal(harness.injected.length, 0)
    harness.disposeAll()
  }
})

test('an inert row does not consume the single-reviewer slot', () => {
  const inert = makeCtx()
  apply(inert.ctx, {})
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

test('a listener failure is contained instead of escaping into the host', async () => {
  const harness = makeCtx({ llm: makeLlm([]) })
  apply(harness.ctx, { provider: 'p', model: 'm' })
  const listener = harness.listeners[0].listener
  assert.doesNotThrow(() => listener({ get header() { throw new Error('hostile session') } }, { type: 'turn/end', data: {} }))
  await settle()
  harness.disposeAll()
})
