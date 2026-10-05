import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const SOURCE_URL = new URL('../lib/client.js', import.meta.url)

const CARD_SLOT = 'plugins.bundle.config'
const CARD_KEY = 'dsh-you-should-know'
const ACTION_SLOT = 'conversation.session.header.actions'

// --- Deterministic React-hook runtime -----------------------------------------
// Enough to mount the settings card and the header action, flush effects, drive
// state updates, and re-render without a DOM or the React package.

function createHookRuntime() {
  let instance = null
  let rendering = false
  let scheduled = false

  function sameDeps(left, right) {
    if (left === undefined || right === undefined) return false
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => Object.is(value, right[index]))
  }

  const React = {
    createElement(type, props, ...children) {
      const resolved = children.length === 1 ? children[0] : children
      return { type, props: { ...(props || {}), children: resolved }, children }
    },
    useState(initial) {
      const inst = instance
      assert.ok(inst, 'useState must run during a render')
      const index = inst.hookCursor
      inst.hookCursor += 1
      if (!(index in inst.states)) inst.states[index] = typeof initial === 'function' ? initial() : initial
      const setState = (update) => {
        const previous = inst.states[index]
        const next = typeof update === 'function' ? update(previous) : update
        inst.states[index] = next
        if (rendering) {
          // React queues a state update issued during a render and flushes it
          // after that render; it never recurses synchronously.
          // Leave the consumed initial value in place and re-run the component
          // once, which is enough for the render-time route binding.
          scheduled = true
          return
        }
        scheduleRender()
      }
      return [inst.states[index], setState]
    },
    useEffect(fn, deps) {
      const inst = instance
      assert.ok(inst, 'useEffect must run during a render')
      inst.pendingEffects.push({ cursor: inst.hookCursor, fn, deps })
      inst.hookCursor += 1
    },
    useRef(value) {
      const inst = instance
      assert.ok(inst, 'useRef must run during a render')
      const index = inst.hookCursor
      inst.hookCursor += 1
      if (!(index in inst.refs)) inst.refs[index] = { current: value }
      return inst.refs[index]
    },
  }

  function scheduleRender() {
    if (rendering) {
      scheduled = true
      return
    }
    render()
  }

  function render() {
    if (instance === null) return
    const inst = instance
    let passes = 0
    for (;;) {
      passes += 1
      assert.ok(passes <= 25, 'the component must settle instead of re-rendering forever')
      rendering = true
      inst.hookCursor = 0
      inst.pendingEffects = []
      const output = inst.component(inst.props)
      const nextEffects = []
      for (const effect of inst.pendingEffects) {
        const previous = inst.effects[effect.cursor]
        if (previous !== undefined && sameDeps(previous.deps, effect.deps)) {
          nextEffects[effect.cursor] = previous
          continue
        }
        if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup()
        nextEffects[effect.cursor] = { deps: effect.deps, cleanup: effect.fn() }
      }
      for (let index = 0; index < inst.effects.length; index += 1) {
        const previous = inst.effects[index]
        if (previous !== undefined && nextEffects[index] === undefined && typeof previous.cleanup === 'function') previous.cleanup()
      }
      inst.effects = nextEffects
      inst.output = output
      rendering = false
      if (!scheduled) break
      scheduled = false
    }
  }

  function mount(component, props) {
    instance = { component, props, states: {}, refs: {}, hookCursor: 0, pendingEffects: [], effects: [], output: null }
    render()
    return {
      get output() {
        return instance.output
      },
      render(nextProps) {
        instance.props = nextProps
        render()
      },
      setStateAt(index, value) {
        instance.states[index] = value
        scheduleRender()
      },
      unmount() {
        for (const effect of instance.effects) {
          if (effect !== undefined && typeof effect.cleanup === 'function') effect.cleanup()
        }
        instance = null
      },
    }
  }

  return { React, mount }
}

function walk(node, visit) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') {
    visit(node)
    return
  }
  if (typeof node.type === 'function') {
    walk(node.type(node.props), visit)
    return
  }
  visit(node)
  walk(node.children || [], visit)
}

function textOf(node) {
  const parts = []
  walk(node, (entry) => {
    if (typeof entry === 'string') parts.push(entry)
  })
  return parts.join(' ')
}

function findAll(node, type) {
  const found = []
  walk(node, (entry) => {
    if (typeof entry === 'object' && entry.type === type) found.push(entry)
  })
  return found
}

function controlByLabel(node, label) {
  return findAll(node, '*').length === -1 ? null : findByAria(node, label)
}

function findByAria(node, label) {
  let found = null
  walk(node, (entry) => {
    if (found !== null || typeof entry !== 'object') return
    const aria = entry.props && entry.props['aria-label']
    if (aria === label) found = entry
  })
  return found
}

function findByField(node, field) {
  let found = null
  walk(node, (entry) => {
    if (found !== null || typeof entry !== 'object') return
    const value = entry.props && entry.props['data-field']
    if (value === field) found = entry
  })
  return found
}

function findByType(node, type) {
  let found = null
  walk(node, (entry) => {
    if (found !== null || typeof entry !== 'object') return
    if (entry.type === type) found = entry
  })
  return found
}

function buttonByText(node, text) {
  let found = null
  walk(node, (entry) => {
    if (found !== null || typeof entry !== 'object') return
    if (entry.type !== 'button') return
    const inner = []
    walk(entry, (child) => {
      if (typeof child === 'string') inner.push(child)
    })
    if (inner.join(' ').includes(text)) found = entry
  })
  return found
}

async function flushAsync(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// --- Environment ---------------------------------------------------------------

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
  }
}

/**
 * Load the browser bundle with an injectable config/session backend.
 *
 * @param options.backend - (url, init) => response payload for non-notes routes.
 */
async function loadBundle(options = {}) {
  const source = await readFile(SOURCE_URL, 'utf8')
  const registrations = []
  const calls = []
  const windowListeners = { focus: new Set() }
  const documentListeners = { visibilitychange: new Set() }
  const resets = []

  const windowMock = {
    __ModuleLoader__: { load: (registration) => registrations.push(registration) },
    addEventListener(type, listener) {
      if (!windowListeners[type]) windowListeners[type] = new Set()
      windowListeners[type].add(listener)
    },
    removeEventListener(type, listener) {
      if (windowListeners[type]) windowListeners[type].delete(listener)
    },
  }
  const documentMock = {
    visibilityState: 'visible',
    addEventListener(type, listener) {
      if (!documentListeners[type]) documentListeners[type] = new Set()
      documentListeners[type].add(listener)
    },
    removeEventListener(type, listener) {
      if (documentListeners[type]) documentListeners[type].delete(listener)
    },
  }

  const fetchMock = async (url, init = {}) => {
    calls.push({ url, init })
    const responder = options.backend
    if (typeof responder === 'function') {
      const result = await responder(url, init)
      if (result && typeof result === 'object' && 'status' in result && 'body' in result) {
        return jsonResponse(result.status, result.body)
      }
      return jsonResponse(200, result)
    }
    return jsonResponse(200, { ok: true })
  }

  const sandbox = {
    window: windowMock,
    document: documentMock,
    fetch: fetchMock,
    setInterval: () => {
      throw new Error('the settings and session surfaces must not poll')
    },
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    URL,
    console,
    JSON,
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })

  const runtime = createHookRuntime()
  const mod = registrations[0].factory((specifier) => {
    assert.equal(specifier, 'react')
    return runtime.React
  })
  const seen = []
  // The live client connection face the card observes through its inject.
  const connection = {
    on(event, listener) {
      resets.push({ event, listener })
    },
  }
  const ctx = {
    slots: {
      inject(slot, callback) {
        seen.push(slot)
        const result = callback()
        // The current host slot API accepts a generator whose yields are owned
        // by the injection scope, so run it to completion like the host does.
        if (result && typeof result[Symbol.iterator] === 'function' && typeof result.next === 'function') {
          for (const _ of result) { /* the registration happened during iteration */ }
        }
      },
      register(spec, component) {
        seen.push({ name: spec.name, key: spec.key, id: spec.id, spec, component })
      },
    },
    connection,
  }
  mod.apply(ctx)

  function cardComponent() {
    const entry = seen.find((item) => typeof item === 'object' && item.spec && item.spec.name === CARD_SLOT)
    assert.ok(entry, 'the settings card must be registered')
    return entry
  }
  function actionComponent() {
    const entry = seen.find((item) => typeof item === 'object' && item.spec && item.spec.name === ACTION_SLOT)
    assert.ok(entry, 'the session header action must be registered')
    return entry
  }

  return {
    runtime,
    calls,
    seen,
    module: mod,
    cardComponent,
    actionComponent,
    connection,
    resets,
    fireFocus() {
      // Snapshot: a refresh may subscribe a new listener while we iterate.
      for (const listener of [...windowListeners.focus]) listener()
    },
    fireConnectionReset() {
      for (const entry of [...resets]) entry.listener()
    },
    fireVisibility(state) {
      documentMock.visibilityState = state
      for (const listener of [...documentListeners.visibilitychange]) listener()
    },
  }
}

const CONFIG = {
  ok: true,
  writable: true,
  config: { mode: 'automatic', minDeltaChars: 1200, cooldownTurns: 3, maxContextMessages: 12, maxTokens: 768 },
  catalog: { providers: [{ id: 'alpha', models: ['a-model', 'b-model'] }, { id: 'zeta', models: ['z1'] }] },
}

function configBackend(options = {}) {
  return async (url, init = {}) => {
    if (init.method === 'POST') {
      return options.postResponse || { status: 200, body: { ok: true, config: {}, catalog: { providers: [] } } }
    }
    if (options.configResponse) {
      const result = typeof options.configResponse === 'function' ? options.configResponse() : options.configResponse
      return result
    }
    return { status: CONFIG.ok ? 200 : 500, body: { ...CONFIG, ...(options.overrides || {}) } }
  }
}

// --- Slot contracts ------------------------------------------------------------

test('the client registers the plugins.bundle.config slot with the exact key and inject contract', async () => {
  const env = await loadBundle({ backend: configBackend() })
  assert.equal(env.resets.length, 1, 'apply subscribes the connection reset signal')
  assert.equal(env.resets[0].event, 'connection/reset')
  const entry = env.cardComponent()
  assert.equal(entry.spec.name, CARD_SLOT)
  assert.equal(entry.spec.key, CARD_KEY)
  assert.equal(typeof entry.spec.inject, 'function')
  const face = entry.spec.inject()
  assert.ok(face && typeof face === 'object', 'the card inject face returns an object')
  assert.equal(typeof entry.component, 'function')
})

test('the client registers the conversation.session.header.actions slot with inject(sessionId)', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const entry = env.actionComponent()
  assert.equal(entry.spec.name, ACTION_SLOT)
  assert.equal(entry.spec.id, CARD_KEY)
  assert.equal(typeof entry.spec.inject, 'function')
  assert.equal(entry.spec.inject('s-1').sessionId, 's-1')
  assert.equal(entry.spec.inject(undefined).sessionId, '')
  assert.equal(entry.spec.inject(42).sessionId, '')
  assert.equal(typeof entry.component, 'function')
})

// --- Settings card -------------------------------------------------------------

test('the settings card refreshes once on mount from the document-relative config route', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  assert.equal(env.calls.length, 1)
  assert.equal(env.calls[0].url, 'api/dsh-you-should-know/config')
  assert.equal(env.calls[0].init.method, undefined, 'the mount refresh is a GET')
  assert.match(textOf(view.output), /You Should Know/)
  view.unmount()
})

test('the provider select lists only catalog providers and the model select follows the provider', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()

  // Switch to a pinned route.
  const pinned = findByAria(view.output, 'Pinned model')
  assert.ok(pinned, 'the pinned mode control renders')
  pinned.props.onChange({ target: { checked: true } })

  const provider = findByAria(view.output, 'Provider')
  assert.ok(provider, 'the provider select renders in pinned mode')
  const ids = provider.props.children.map((option) => option.props.value)
  assert.deepEqual(ids, ['alpha', 'zeta'], 'only catalog providers are options')

  provider.props.onChange({ target: { value: 'alpha' } })
  const model = findByAria(view.output, 'Model')
  assert.ok(model, 'the model select renders after a provider is chosen')
  assert.deepEqual(model.props.children.map((option) => option.props.value), ['a-model', 'b-model'])
  view.unmount()
})

test('Save posts the exact bounded config for the selected route', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()

  findByAria(view.output, 'Pinned model').props.onChange({ target: { checked: true } })
  findByAria(view.output, 'Provider').props.onChange({ target: { value: 'zeta' } })
  findByAria(view.output, 'Model').props.onChange({ target: { value: 'z1' } })
  findByAria(view.output, 'Minimum turn delta').props.onChange({ target: { value: '42' } })
  findByAria(view.output, 'Cooldown turns').props.onChange({ target: { value: '7' } })
  findByAria(view.output, 'Context messages').props.onChange({ target: { value: '4' } })
  findByAria(view.output, 'Max reviewer tokens').props.onChange({ target: { value: '512' } })

  buttonByText(view.output, 'Save').props.onClick()
  await flushAsync()

  const post = env.calls.find((call) => call.init && call.init.method === 'POST')
  assert.ok(post, 'Save POSTs the config')
  assert.equal(post.url, 'api/dsh-you-should-know/config')
  assert.deepEqual(JSON.parse(post.init.body), {
    mode: 'pinned',
    provider: 'zeta',
    model: 'z1',
    minDeltaChars: 42,
    cooldownTurns: 7,
    maxContextMessages: 4,
    maxTokens: 512,
  })
  view.unmount()
})

test('Save posts automatic mode without a provider or model', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  buttonByText(view.output, 'Save').props.onClick()
  await flushAsync()
  const post = env.calls.find((call) => call.init && call.init.method === 'POST')
  const payload = JSON.parse(post.init.body)
  assert.equal(payload.mode, 'automatic')
  assert.equal('provider' in payload, false)
  assert.equal('model' in payload, false)
  assert.equal(payload.minDeltaChars, 1200)
  view.unmount()
})

test('an invalid pinned selection blocks Save and shows a bounded message', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  findByAria(view.output, 'Pinned model').props.onChange({ target: { checked: true } })
  // No provider or model selected yet.
  const save = buttonByText(view.output, 'Save')
  save.props.onClick()
  await flushAsync()
  assert.equal(env.calls.filter((call) => call.init && call.init.method === 'POST').length, 0)
  assert.match(textOf(view.output), /provider|model|route/i)
  view.unmount()
})

test('a read-only host disables every control and explains why', async () => {
  const env = await loadBundle({
    backend: configBackend({ overrides: { writable: false } }),
  })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  assert.equal(findByAria(view.output, 'Pinned model').props.disabled, true)
  assert.equal(findByAria(view.output, 'Minimum turn delta').props.disabled, true)
  assert.equal(buttonByText(view.output, 'Save').props.disabled, true)
  assert.match(textOf(view.output), /read-only/i)
  view.unmount()
})

test('the settings card refreshes on window focus and on connection reset without any interval', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  assert.equal(env.calls.length, 1)
  env.fireFocus()
  await flushAsync()
  assert.equal(env.calls.length, 2, 'focus refreshes once')
  env.fireConnectionReset()
  await flushAsync()
  assert.equal(env.calls.length, 3, 'a connection reset refreshes once')
  view.unmount()
})

test('a stale config response for an old generation never overwrites a newer one', async () => {
  let release = null
  let gets = 0
  const env = await loadBundle({
    backend: async (url, init = {}) => {
      if (init.method === 'POST') return { status: 200, body: { ok: true, config: {}, catalog: { providers: [] } } }
      gets += 1
      if (gets === 1) {
        // The first GET hangs until the test releases it.
        return new Promise((resolve) => {
          release = () => resolve({ status: 200, body: { ok: true, writable: true, config: { mode: 'automatic', minDeltaChars: 11, cooldownTurns: 3, maxContextMessages: 12, maxTokens: 768 }, catalog: { providers: [] } } })
        })
      }
      return { status: 200, body: { ok: true, writable: true, config: { mode: 'automatic', minDeltaChars: 99, cooldownTurns: 3, maxContextMessages: 12, maxTokens: 768 }, catalog: { providers: [] } } }
    },
  })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  // A reset starts a newer request; the hanging first response arrives last.
  env.fireConnectionReset()
  await flushAsync()
  assert.ok(release, 'the first request is still in flight')
  release()
  await flushAsync()
  const delta = findByAria(view.output, 'Minimum turn delta')
  assert.equal(delta.props.value, '99', 'the newest response wins')
  view.unmount()
})

test('the note card code is preserved alongside the new settings surfaces', async () => {
  const env = await loadBundle({ backend: configBackend() })
  assert.deepEqual(env.seen.filter((item) => typeof item === 'string'), ['conversation.input.dock', CARD_SLOT, ACTION_SLOT])
})

// --- Session header action -----------------------------------------------------

function sessionBackend(state) {
  return async (url, init = {}) => {
    if (url.startsWith('api/dsh-you-should-know/session') && init.method === 'POST') {
      const body = JSON.parse(init.body)
      state.sessionPosts.push(body)
      if (body.action === 'set-model') {
        state.session = { ...state.session, effectiveRoute: { provider: body.provider, model: body.model }, effectiveRouteSource: 'session', sessionOverride: { provider: body.provider, model: body.model } }
        return { status: 200, body: { ok: true, action: 'set-model', ...state.session } }
      }
      if (body.action === 'reset-model') {
        state.session = { ...state.session, effectiveRoute: { provider: 'alpha', model: 'a-model' }, effectiveRouteSource: 'global', sessionOverride: null }
        return { status: 200, body: { ok: true, action: 'reset-model', removed: true, ...state.session } }
      }
      if (body.action === 'resume') {
        state.session = { ...state.session, session: { ...state.session.session, runtimeStatus: 'idle', runtime: { runtimeStatus: 'idle' } } }
        return { status: 200, body: { ok: true, action: 'resume', resumed: true } }
      }
    }
    if (url.startsWith('api/dsh-you-should-know/session')) {
      return { status: 200, body: { ok: true, ...state.session } }
    }
    if (url.startsWith('api/dsh-you-should-know/config')) {
      return { status: 200, body: { ok: true, writable: true, config: { mode: 'automatic', minDeltaChars: 1200, cooldownTurns: 3, maxContextMessages: 12, maxTokens: 768 }, catalog: { providers: [{ id: 'alpha', models: ['a-model', 'b-model'] }] } } }
    }
    return { status: 200, body: { ok: true } }
  }
}

function sessionState(overrides = {}) {
  return {
    session: {
      ok: true,
      configured: true,
      sessionId: 's-1',
      effectiveRoute: { provider: 'alpha', model: 'a-model' },
      effectiveRouteSource: 'global',
      sessionOverride: null,
      session: { reviewStarts: 2, lastOutcome: 'quota_exhausted', runtimeStatus: 'quota_exhausted', runtime: { runtimeStatus: 'quota_exhausted' }, noteCount: 1, inFlight: false },
      ...overrides,
    },
    sessionPosts: [],
  }
}

test('the session action shows the effective route, source, status, and pending count', async () => {
  const state = sessionState()
  const env = await loadBundle({ backend: sessionBackend(state) })
  const component = env.actionComponent().component
  const view = env.runtime.mount(component, { sessionId: 's-1' })
  buttonByText(view.output, 'Reviewer').props.onClick()
  await flushAsync()
  const rendered = textOf(view.output)
  assert.match(rendered, /alpha/)
  assert.match(rendered, /a-model/)
  assert.match(rendered, /Global/i)
  assert.match(rendered, /quota_exhausted/)
  assert.match(rendered, /Pending notes: 1/, 'pending note count is shown')
  assert.equal(env.calls[0].url, 'api/dsh-you-should-know/session?sessionId=s-1')
  view.unmount()
})

test('pinning a session route posts set-model, reset posts reset-model, and quota enables resume', async () => {
  const state = sessionState()
  const env = await loadBundle({ backend: sessionBackend(state) })
  const component = env.actionComponent().component
  const view = env.runtime.mount(component, { sessionId: 's-1' })
  await flushAsync()

  buttonByText(view.output, 'Reviewer').props.onClick()
  await flushAsync()

  const provider = findByAria(view.output, 'Session provider')
  provider.props.onChange({ target: { value: 'alpha' } })
  const model = findByAria(view.output, 'Session model')
  model.props.onChange({ target: { value: 'b-model' } })
  buttonByText(view.output, 'Pin for this session').props.onClick()
  await flushAsync()
  assert.deepEqual(state.sessionPosts.at(-1), { action: 'set-model', sessionId: 's-1', provider: 'alpha', model: 'b-model' })

  buttonByText(view.output, 'Use global default').props.onClick()
  await flushAsync()
  assert.deepEqual(state.sessionPosts.at(-1), { action: 'reset-model', sessionId: 's-1' })

  const resume = buttonByText(view.output, 'Resume reviewer')
  assert.ok(resume, 'resume is offered only for a quota-exhausted runtime')
  resume.props.onClick()
  await flushAsync()
  assert.deepEqual(state.sessionPosts.at(-1), { action: 'resume', sessionId: 's-1' })
  view.unmount()
})

test('a non-quota runtime never offers resume', async () => {
  const state = sessionState({ session: { reviewStarts: 1, lastOutcome: 'noted', runtimeStatus: 'idle', runtime: { runtimeStatus: 'idle' }, noteCount: 0 } })
  const env = await loadBundle({ backend: sessionBackend(state) })
  const view = env.runtime.mount(env.actionComponent().component, { sessionId: 's-1' })
  await flushAsync()
  buttonByText(view.output, 'Reviewer').props.onClick()
  await flushAsync()
  assert.equal(buttonByText(view.output, 'Resume reviewer'), null)
  view.unmount()
})

test('a stale session response for session A never populates session B', async () => {
  let releaseA = null
  const env = await loadBundle({
    backend: async (url) => {
      const id = new URL(url, 'http://localhost').searchParams.get('sessionId')
      if (id === 'A') {
        return new Promise((resolve) => {
          releaseA = () => resolve({ status: 200, body: { ok: true, sessionId: 'A', configured: true, effectiveRoute: { provider: 'alpha', model: 'a-model' }, effectiveRouteSource: 'global', sessionOverride: null, session: { runtimeStatus: 'idle', noteCount: 0 } } })
        })
      }
      return { status: 200, body: { ok: true, sessionId: 'B', configured: true, effectiveRoute: { provider: 'zeta', model: 'z-model' }, effectiveRouteSource: 'session', sessionOverride: { provider: 'zeta', model: 'z-model' }, session: { runtimeStatus: 'idle', noteCount: 0 } } }
    },
  })
  const view = env.runtime.mount(env.actionComponent().component, { sessionId: 'A' })
  buttonByText(view.output, 'Reviewer').props.onClick()
  await flushAsync()
  // Switch to B while A is still in flight.
  view.render({ sessionId: 'B' })
  await flushAsync()
  if (releaseA !== null) releaseA()
  await flushAsync()
  const rendered = textOf(view.output)
  assert.match(rendered, /zeta/)
  assert.doesNotMatch(rendered, /alpha/, 'A must never populate B')
  view.unmount()
})

test('the session action refreshes on focus and connection reset and on session change', async () => {
  const state = sessionState()
  const env = await loadBundle({ backend: sessionBackend(state) })
  const view = env.runtime.mount(env.actionComponent().component, { sessionId: 's-1' })
  buttonByText(view.output, 'Reviewer').props.onClick()
  await flushAsync()
  const before = env.calls.length
  env.fireFocus()
  await flushAsync()
  assert.ok(env.calls.length > before, 'focus refreshes the open panel')
  assert.equal(env.calls.at(-2).url, 'api/dsh-you-should-know/session?sessionId=s-1')
  assert.equal(env.calls.at(-1).url, 'api/dsh-you-should-know/config')

  const afterFocus = env.calls.length
  env.fireConnectionReset()
  await flushAsync()
  assert.ok(env.calls.length > afterFocus, 'a connection reset refreshes the open panel')
  assert.equal(env.calls.at(-2).url, 'api/dsh-you-should-know/session?sessionId=s-1')

  const beforeChange = env.calls.length
  view.render({ sessionId: 's-2' })
  await flushAsync()
  const changed = env.calls.slice(beforeChange).map((call) => call.url)
  assert.ok(changed.includes('api/dsh-you-should-know/session?sessionId=s-2'), 'a session change refreshes the new session')
  view.unmount()
})

test('the session action never renders a transcript or posts to the primary agent', async () => {
  const secret = 'TRANSCRIPT-SECRET-3'
  const state = sessionState()
  const env = await loadBundle({ backend: sessionBackend(state) })
  const view = env.runtime.mount(env.actionComponent().component, { sessionId: 's-1' })
  await flushAsync()
  assert.equal(textOf(view.output).includes(secret), false)
  for (const call of env.calls) {
    assert.equal(call.url.startsWith('api/dsh-you-should-know/'), true, 'only plugin-owned document-relative routes are used')
  }
  view.unmount()
})
