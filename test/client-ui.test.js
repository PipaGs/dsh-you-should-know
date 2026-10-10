import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const SOURCE_URL = new URL('../lib/client.js', import.meta.url)

const CARD_SLOT = 'plugins.bundle.config'
const CARD_KEY = 'dsh-you-should-know'
const ACTION_SLOT = 'conversation.session.header.actions'
const CARD_SLOT_DOCK = 'conversation.input.dock'

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

  const intervals = []
  const sandbox = {
    window: windowMock,
    document: documentMock,
    fetch: fetchMock,
    setInterval: options.allowIntervals === true ? (fn) => { intervals.push(fn); return intervals.length } : () => {
      throw new Error('the settings and session surfaces must not poll')
    },
    clearInterval: (id) => { if (id) intervals[id - 1] = null },
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
    // The cross-plugin right-Sidebar navigation face the client opens files
    // through. Undefined by default, so the fallback copyable path is exercised.
    get(name) {
      return name === 'sidebarRight' ? options.sidebarRight : undefined
    },
    sidebarRight: options.sidebarRight,
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
  function dockComponent() {
    const entry = seen.find((item) => typeof item === 'object' && item.spec && item.spec.name === CARD_SLOT_DOCK)
    assert.ok(entry, 'the note card dock must be registered')
    return entry
  }

  return {
    runtime,
    calls,
    intervals,
    seen,
    module: mod,
    cardComponent,
    actionComponent,
    dockComponent,
    connection,
    resets,
    runIntervals() {
      for (const fn of intervals) if (fn) fn()
    },
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
    reviewerMode: 'balanced',
    additionalInstructions: '',
    customReviewerPrompt: '',
    minDeltaChars: 42,
    cooldownTurns: 7,
    maxContextMessages: 4,
    maxTokens: 512,
    maxReviewerCallsPerHour: 12,
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
      if (body.action === 'set-mode') {
        state.session = { ...state.session, effectiveMode: body.mode, effectiveModeSource: 'session', sessionModeOverride: body.mode }
        return { status: 200, body: { ok: true, action: 'set-mode', ...state.session } }
      }
      if (body.action === 'reset-mode') {
        state.session = { ...state.session, effectiveMode: 'balanced', effectiveModeSource: 'global', sessionModeOverride: null, globalMode: 'balanced' }
        return { status: 200, body: { ok: true, action: 'reset-mode', removed: true, ...state.session } }
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


// --- Composer-aligned note card geometry ---------------------------------------
// The composer geometry below is quoted from the installed DSH conversation shell
// (@deepseek-ai/dsh-client-ui-conversation, ConversationRoot.module.css and the
// composer module), so this suite fails if the build moves or the plugin stops
// matching it:
//   .ST7X_W_body         { --dsh-composer-side-clearance:16px;
//                          --dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px) }
//   .ST7X_W_embeddedBody { --dsh-composer-side-clearance:8px;
//                          --dsh-composer-card-max-width:min(calc(100% - 16px), 952px) }
//   .yhfFVG_root         { padding:0 var(--dsh-composer-side-clearance) 4px; align-items:center; display:flex }
//   .yhfFVG_card         { box-sizing:border-box; width:100%; max-width:var(--dsh-composer-card-max-width) }

/** The custom properties the conversation body defines for one shell variant. */
function composerVariables(variant) {
  if (variant === 'embedded') {
    return {
      '--dsh-composer-side-clearance': '8px',
      '--dsh-composer-card-max-width': 'min(calc(100% - 16px), 952px)',
    }
  }
  return {
    '--dsh-composer-side-clearance': '16px',
    '--dsh-chat-content-width': '768px',
    '--dsh-composer-card-max-width': 'calc(var(--dsh-chat-content-width) + 32px)',
  }
}

/** Split a comma-separated argument list at the top level of nested parentheses. */
function splitArguments(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/** Split a calc() sum at its top-level plus and minus operators. */
function splitTerms(text) {
  const terms = []
  let depth = 0
  let current = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth === 0 && (char === '+' || char === '-') && index > 0 && /\s/.test(text[index - 1])) {
      terms.push(current)
      current = char
      continue
    }
    current += char
  }
  terms.push(current)
  return terms.filter((term) => term.trim() !== '')
}

/** Resolve the subset of CSS lengths the composer and the dock use. */
function resolveLength(expression, basis, variables = {}) {
  const text = String(expression).trim()
  const call = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(text)
  if (call !== null) {
    const name = call[1].toLowerCase()
    const args = splitArguments(call[2])
    if (name === 'var') {
      const variable = args[0].trim()
      if (Object.hasOwn(variables, variable)) return resolveLength(variables[variable], basis, variables)
      assert.ok(args.length > 1, variable + ' needs a fallback')
      return resolveLength(args.slice(1).join(','), basis, variables)
    }
    if (name === 'min') return Math.min(...args.map((arg) => resolveLength(arg, basis, variables)))
    if (name === 'max') return Math.max(...args.map((arg) => resolveLength(arg, basis, variables)))
    if (name === 'calc') {
      return splitTerms(args[0]).reduce((total, term, index) => {
        const sign = term.trim().startsWith('-') ? -1 : 1
        const value = resolveLength(term.replace(/^[+-]/, ''), basis, variables)
        return index === 0 ? sign * value : total + sign * value
      }, 0)
    }
    throw new Error('unsupported CSS function ' + name)
  }
  if (text.endsWith('%')) return (basis * Number.parseFloat(text)) / 100
  if (text.endsWith('px')) return Number.parseFloat(text)
  throw new Error('unsupported CSS length ' + text)
}

/** The width the composer card resolves to inside a container of containerWidth. */
function composerCardWidth(containerWidth, variant, variables) {
  const clearance = resolveLength(variables['--dsh-composer-side-clearance'], containerWidth, variables)
  const content = containerWidth - 2 * clearance
  const cardMax = resolveLength(variables['--dsh-composer-card-max-width'], content, variables)
  return Math.min(content, cardMax)
}

/** The width the note card resolves to from its own rendered inline styles. */
function dockCardWidth(wrapperStyle, cardStyle, containerWidth, variables) {
  const clearance = resolveLength(wrapperStyle.paddingInline, containerWidth, variables)
  const content = containerWidth - 2 * clearance
  const cardMax = resolveLength(cardStyle.maxWidth, content, variables)
  return Math.min(content, cardMax)
}

function notesBackend(notes) {
  return async (url) => {
    if (url.startsWith('api/dsh-you-should-know/notes')) return { status: 200, body: { ok: true, notes } }
    return { status: 200, body: { ok: true } }
  }
}

/** A backend that serves the active notes plus the bounded per-session history. */
function historyBackend(options = {}) {
  const notes = options.notes || []
  const history = options.history || []
  const historyCount = Number.isInteger(options.historyCount) ? options.historyCount : history.length
  return async (url) => {
    if (url.startsWith('api/dsh-you-should-know/history')) return { status: 200, body: { ok: true, history } }
    if (url.startsWith('api/dsh-you-should-know/notes')) return { status: 200, body: { ok: true, notes, historyCount } }
    return { status: 200, body: { ok: true } }
  }
}

async function mountNoteCard() {
  const env = await loadBundle({
    backend: notesBackend([{ id: 'n-1', note: 'One important thing.', importance: 'high' }]),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()
  return { env, view }
}

test('the note card wrapper mirrors the composer root instead of a fixed column', async () => {
  const { view } = await mountNoteCard()
  const wrapper = view.output
  const card = findByType(wrapper, 'section')
  assert.equal(wrapper.type, 'div', 'the dock renders a wrapper')
  assert.ok(card, 'the note renders inside the wrapper')
  assert.equal(wrapper.props.style.boxSizing, 'border-box')
  assert.equal(wrapper.props.style.width, '100%', 'the wrapper fills the dock')
  assert.equal(wrapper.props.style.paddingInline, 'var(--dsh-composer-side-clearance, 16px)', 'the wrapper uses the composer side clearance')
  assert.equal(wrapper.props.style.alignItems, 'center', 'the column is centered like the composer root')
  assert.equal(card.props.style.boxSizing, 'border-box')
  assert.equal(card.props.style.width, '100%', 'the card fills the padded column')
  assert.equal(card.props.style.maxWidth, 'var(--dsh-composer-card-max-width, 952px)', 'the card caps at the composer card width')
  view.unmount()
})

test('the note card resolves to the exact composer card width at every breakpoint', async () => {
  const { view } = await mountNoteCard()
  const wrapperStyle = view.output.props.style
  const cardStyle = findByType(view.output, 'section').props.style
  for (const variant of ['composer', 'embedded']) {
    const variables = composerVariables(variant)
    for (const containerWidth of [560, 720, 900, 1200, 1600]) {
      assert.equal(
        dockCardWidth(wrapperStyle, cardStyle, containerWidth, variables),
        composerCardWidth(containerWidth, variant, variables),
        variant + ' shell at ' + containerWidth + 'px',
      )
    }
    assert.equal(
      resolveLength(wrapperStyle.paddingInline, 1000, variables),
      resolveLength(variables['--dsh-composer-side-clearance'], 1000, variables),
      variant + ' shell side clearance',
    )
  }
  view.unmount()
})

// --- Note source and human-controlled actions ----------------------------------

test('the note card renders every undismissed note oldest-first and dismisses only the clicked one', async () => {
  const env = await loadBundle({
    backend: notesBackend([
      { id: 'n-new', note: 'Newer finding.', importance: 'high', createdAt: 200 },
      { id: 'n-old', note: 'Older finding.', importance: 'critical', createdAt: 100 },
    ]),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()

  const cards = findAll(view.output, 'section')
  assert.equal(cards.length, 2, 'every undismissed note renders in the stack')
  assert.match(textOf(cards[0]), /Older finding\./, 'the oldest note renders first')
  assert.match(textOf(cards[1]), /Newer finding\./, 'the newest note sits nearest the composer')

  buttonByText(cards[0], 'Dismiss').props.onClick()
  const remaining = findAll(view.output, 'section')
  assert.equal(remaining.length, 1, 'Dismiss removes exactly one note')
  assert.match(textOf(remaining[0]), /Newer finding\./)

  const posts = env.calls.filter((call) => call.url === 'api/dsh-you-should-know/dismiss')
  assert.equal(posts.length, 1)
  assert.deepEqual(JSON.parse(posts[0].init.body), { sessionId: 's-1', noteId: 'n-old', action: 'dismissed' })
  view.unmount()
})

test('the note card renders a source row only when the note carries a valid one', async () => {
  const env = await loadBundle({
    backend: notesBackend([
      { id: 'n-1', note: 'With source.', importance: 'high', createdAt: 1, source: { path: 'src/a.js', line: 12 } },
      { id: 'n-2', note: 'No source.', importance: 'high', createdAt: 2 },
      { id: 'n-3', note: 'Unsafe source.', importance: 'high', createdAt: 3, source: { path: 'javascript:alert(1)' } },
    ]),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()

  const cards = findAll(view.output, 'section')
  assert.equal(cards.length, 3)
  assert.match(textOf(cards[0]), /src\/a\.js:12/)
  assert.equal(textOf(cards[1]).includes('src/'), false, 'a note without a source renders no path')
  assert.equal(findAll(cards[2], 'code').length, 0, 'an unsafe path renders nothing')
  view.unmount()
})

test('a source without a file-navigation service renders copyable text and no fake link', async () => {
  const env = await loadBundle({
    backend: notesBackend([{ id: 'n-1', note: 'Fix it.', importance: 'high', createdAt: 1, source: { path: 'src/a.js', line: 12 } }]),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()

  assert.equal(buttonByText(view.output, 'Open file'), null, 'no navigation service means no link')
  const code = findAll(view.output, 'code')
  assert.equal(code.length, 1)
  assert.equal(textOf(code[0]), 'src/a.js:12')
  view.unmount()
})

test('Open file navigates through the sidebar resource API and never runs a command', async () => {
  const opened = []
  const env = await loadBundle({
    backend: notesBackend([{ id: 'n-1', note: 'Fix it.', importance: 'high', createdAt: 1, source: { path: 'src/a.js', line: 12 } }]),
    allowIntervals: true,
    sidebarRight: { openResource: (address, options) => opened.push({ address, options }) },
  })
  const dock = env.dockComponent()
  const face = dock.spec.inject('s-1')
  assert.equal(typeof face.onOpenFile, 'function', 'an available navigation service exposes the open action')
  const view = env.runtime.mount(dock.component, { ...face, inputActions: null, input: null })
  await flushAsync()

  const open = buttonByText(view.output, 'Open file')
  assert.ok(open, 'the source renders an Open file action')
  open.props.onClick()
  assert.equal(opened.length, 1)
  assert.equal(opened[0].address, 'dsh-resource://file/session/s-1/src/a.js')
  assert.equal(opened[0].options.params.line, 12)
  view.unmount()
})

// --- Add to chat: composer lifecycle -----------------------------------------
// The dock writes into the composer through the public InputActions face. This
// model mirrors the real surface closely enough to reproduce the v0.3.3 Enter
// gesture: setDraft is the canonical whole-draft programmatic write,
// captureInsertion/insertText is the deferred-insertion seam, submit is the
// editor's optimistic send. Focus follows the browser rule verified in
// Chromium: a mousedown that does not preventDefault moves focus to the button,
// and a later Enter activates whatever holds focus before the draft keymap.
const NOTE_WITH_SOURCE = { id: 'n-1', note: 'Guard the write.', importance: 'high', createdAt: 1, source: { path: 'src/store.js', line: 7 } }
const NOTE_DRAFT = 'Fix this reviewer finding: Guard the write.\nFile: src/store.js:7'

function createComposer(sessionId, initialDraft = '') {
  const composer = {
    sessionId,
    draft: initialDraft,
    sent: [],
    focused: null,
    deferredCalls: [],
    inputActions: {
      setDraft(text) {
        composer.draft = text
      },
      captureInsertion() {
        composer.deferredCalls.push('captureInsertion')
        return { start: composer.draft.length, end: composer.draft.length, draftRev: 1 }
      },
      insertText(text, span) {
        composer.deferredCalls.push('insertText')
        composer.draft = composer.draft.slice(0, span.start) + text + composer.draft.slice(span.end)
        return true
      },
      submit() {
        composer.sent.push(composer.draft)
        composer.draft = ''
      },
    },
  }
  return composer
}

/** Apply the browser's pointer/focus rule to one rendered control. */
function pressControl(label, control, composer) {
  let prevented = false
  if (typeof control.props.onMouseDown === 'function') {
    control.props.onMouseDown({ preventDefault() { prevented = true } })
  }
  if (!prevented) composer.focused = label
  control.props.onClick()
}

/** Enter activates the focused control; with focus in the draft it submits. */
function pressEnter(view, composer) {
  if (composer.focused !== null) {
    const focused = buttonByText(view.output, composer.focused)
    if (focused !== null) {
      focused.props.onClick()
      return
    }
  }
  composer.inputActions.submit()
}

async function mountAddToChat(composer) {
  const env = await loadBundle({ backend: notesBackend([NOTE_WITH_SOURCE]), allowIntervals: true })
  const view = env.runtime.mount(env.dockComponent().component, {
    sessionId: composer.sessionId,
    inputActions: composer.inputActions,
    input: { draft: composer.draft },
  })
  await flushAsync()
  return { env, view }
}

const NOTE_ACTION = {
  id: 'n-action',
  note: 'The loading state never clears because GET /session returns 400.',
  importance: 'high',
  createdAt: 1,
  action: 'Fix the /session route registration so GET/HEAD do not use a streaming request body, and add a regression test for the live bridge behavior.',
}
const NOTE_ACTION_DRAFT = 'Fix the /session route registration so GET/HEAD do not use a streaming request body, and add a regression test for the live bridge behavior.'

/** Mount the dock with an explicit note list and composer face. */
async function mountNotes(notes, composer) {
  const env = await loadBundle({ backend: notesBackend(notes), allowIntervals: true })
  const view = env.runtime.mount(env.dockComponent().component, {
    sessionId: composer.sessionId,
    inputActions: composer.inputActions,
    input: { draft: composer.draft },
  })
  await flushAsync()
  return { env, view }
}

test('Add to chat inserts the actionable repair instruction instead of the human note', async () => {
  const composer = createComposer('s-1')
  const { view } = await mountNotes([NOTE_ACTION], composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(composer.draft, NOTE_ACTION_DRAFT, 'the action is the draft, not the finding prose')
  assert.equal(composer.draft.includes(NOTE_ACTION.note), false, 'the notification text is never inserted')
  assert.deepEqual(composer.sent, [], 'Add to chat never sends')
  view.unmount()
})

test('Add to chat appends File only when the action does not already name the exact source path', async () => {
  const first = createComposer('s-1')
  const withSource = { ...NOTE_ACTION, source: { path: 'src/live-bridge.js', line: 12 } }
  const firstMount = await mountNotes([withSource], first)
  pressControl('Add to chat', buttonByText(firstMount.view.output, 'Add to chat'), first)
  assert.equal(first.draft, NOTE_ACTION_DRAFT + '\nFile: src/live-bridge.js:12')
  firstMount.view.unmount()

  const second = createComposer('s-2')
  const mentionsPath = {
    ...NOTE_ACTION,
    action: 'Fix src/live-bridge.js so the bridge does not time out.',
    source: { path: 'src/live-bridge.js', line: 12 },
  }
  const secondMount = await mountNotes([mentionsPath], second)
  pressControl('Add to chat', buttonByText(secondMount.view.output, 'Add to chat'), second)
  assert.equal(second.draft, 'Fix src/live-bridge.js so the bridge does not time out.', 'an action that already names the exact path gets no duplicate File line')
  secondMount.view.unmount()
})

test('Add to chat appends File when the action names only a longer path that contains the source path', async () => {
  const composer = createComposer('s-1')
  const note = {
    ...NOTE_ACTION,
    action: 'Fix src/a.js.map handling so the bridge does not time out.',
    source: { path: 'src/a.js', line: 4 },
  }
  const { view } = await mountNotes([note], composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(composer.draft, 'Fix src/a.js.map handling so the bridge does not time out.\nFile: src/a.js:4', 'a longer token is not the exact source path')
  view.unmount()
})

test('Add to chat does not duplicate File when the action names the exact path with punctuation', async () => {
  const composer = createComposer('s-1')
  const note = { ...NOTE_ACTION, action: 'Fix `src/a.js` handling.', source: { path: 'src/a.js', line: 4 } }
  const { view } = await mountNotes([note], composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(composer.draft, 'Fix `src/a.js` handling.', 'the exact path is already named')
  view.unmount()
})

test('a stale action card cannot write into the next session draft', async () => {
  const first = createComposer('s-1')
  const second = createComposer('s-2')
  const env = await loadBundle({ backend: notesBackend([NOTE_ACTION]), allowIntervals: true })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1', inputActions: first.inputActions, input: { draft: '' } })
  await flushAsync()
  const stale = buttonByText(view.output, 'Add to chat')
  assert.ok(stale, 'the previous session action card rendered')
  view.render({ sessionId: 's-2', inputActions: second.inputActions, input: { draft: '' } })
  assert.equal(buttonByText(view.output, 'Add to chat'), null, 'the stale action card is dropped before the new poll resolves')
  stale.props.onClick()
  assert.equal(second.draft, '', 'the stale action card never writes into the next session draft')
  view.unmount()
})

test('a note without an action falls back to an imperative wrapper', async () => {
  const composer = createComposer('s-1')
  const legacy = { id: 'n-legacy', note: 'Guard the write.', importance: 'high', createdAt: 1, source: { path: 'src/store.js', line: 7 } }
  const { view } = await mountNotes([legacy], composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(composer.draft, 'Fix this reviewer finding: Guard the write.\nFile: src/store.js:7')
  assert.equal(composer.draft.includes('Please address this reviewer finding:'), false, 'the old notification wrapper is gone')
  view.unmount()
})

test('Add to chat keeps an existing draft and separates the action with a blank line', async () => {
  const composer = createComposer('s-1', 'draft in progress')
  const { view } = await mountNotes([NOTE_ACTION], composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(composer.draft, 'draft in progress\n\n' + NOTE_ACTION_DRAFT)
  assert.deepEqual(composer.sent, [])
  view.unmount()
})

test('Add to chat with an action resolves the note and removes the card', async () => {
  const composer = createComposer('s-1')
  const { env, view } = await mountNotes([NOTE_ACTION], composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(buttonByText(view.output, 'Add to chat'), null, 'the resolved card leaves the stack immediately')
  const posts = env.calls.filter((call) => call.url === 'api/dsh-you-should-know/dismiss')
  assert.equal(posts.length, 1)
  assert.deepEqual(JSON.parse(posts[0].init.body), { sessionId: 's-1', noteId: 'n-action', action: 'added_to_chat' })
  view.unmount()
})

test('Add to chat then Enter submits the action draft once and never replays it', async () => {
  const composer = createComposer('s-1')
  const { view } = await mountNotes([NOTE_ACTION], composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  view.render({ sessionId: 's-1', inputActions: composer.inputActions, input: { draft: composer.draft } })
  pressEnter(view, composer)
  assert.notEqual(composer.draft, NOTE_ACTION_DRAFT + '\n\n' + NOTE_ACTION_DRAFT, 'Enter never replays the insertion')
  assert.deepEqual(composer.sent, [NOTE_ACTION_DRAFT], 'Enter submits the action once')
  assert.equal(composer.draft, '', 'the submitted draft is cleared')
  assert.deepEqual(composer.deferredCalls, [])
  view.unmount()
})

test('History keeps showing the human finding rather than the action', async () => {
  const env = await loadBundle({
    backend: historyBackend({
      notes: [],
      history: [{ ...NOTE_ACTION, resolved: true, resolution: 'added_to_chat', resolvedAt: 1 }],
    }),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()
  buttonByText(view.output, 'History').props.onClick()
  await flushAsync()
  const text = textOf(view.output)
  assert.match(text, /The loading state never clears because GET \/session returns 400\./)
  assert.equal(text.includes('Fix the /session route registration'), false, 'the history keeps the finding and not the action')
  view.unmount()
})

test('one Add to chat click writes the finding into the draft exactly once and never sends', async () => {
  const composer = createComposer('s-1')
  const { view } = await mountAddToChat(composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(composer.draft, NOTE_DRAFT, 'one click inserts the finding once')
  assert.deepEqual(composer.sent, [], 'Add to chat never sends the draft')
  assert.deepEqual(composer.deferredCalls, [], 'the deferred-insertion seam is not a programmatic draft write')
  view.unmount()
})

test('Add to chat then Enter submits the existing draft and does not replay the insertion', async () => {
  const composer = createComposer('s-1')
  const { view } = await mountAddToChat(composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  view.render({ sessionId: 's-1', inputActions: composer.inputActions, input: { draft: composer.draft } })
  assert.equal(composer.draft, NOTE_DRAFT)
  pressEnter(view, composer)
  assert.notEqual(composer.draft, `${NOTE_DRAFT}\n\n${NOTE_DRAFT}`, 'Enter must not replay the finding into the draft')
  assert.deepEqual(composer.sent, [NOTE_DRAFT], 'Enter submits the built draft exactly once')
  assert.equal(composer.draft, '', 'the submitted draft is cleared')
  assert.deepEqual(composer.deferredCalls, [])
  view.unmount()
})

test('Add to chat keeps an existing draft and separates the finding with a blank line', async () => {
  const composer = createComposer('s-1', 'draft in progress')
  const { view } = await mountAddToChat(composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(composer.draft, `draft in progress\n\n${NOTE_DRAFT}`)
  assert.deepEqual(composer.sent, [])
  view.unmount()
})

test('a second Add to chat click is impossible because the resolved card is gone', async () => {
  const composer = createComposer('s-1')
  const { view } = await mountAddToChat(composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  view.render({ sessionId: 's-1', inputActions: composer.inputActions, input: { draft: composer.draft } })
  assert.equal(buttonByText(view.output, 'Add to chat'), null, 'the resolved card leaves the stack')
  assert.equal(composer.draft, NOTE_DRAFT, 'the finding is inserted exactly once')
  assert.deepEqual(composer.sent, [], 'no click sends')
  view.unmount()
})

test('a card from a previous session cannot write into the next session draft', async () => {
  const first = createComposer('s-1')
  const second = createComposer('s-2')
  const env = await loadBundle({ backend: notesBackend([NOTE_WITH_SOURCE]), allowIntervals: true })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1', inputActions: first.inputActions, input: { draft: '' } })
  await flushAsync()
  const stale = buttonByText(view.output, 'Add to chat')
  assert.ok(stale, 'the previous session card rendered')
  view.render({ sessionId: 's-2', inputActions: second.inputActions, input: { draft: '' } })
  assert.equal(buttonByText(view.output, 'Add to chat'), null, 'the stale card is dropped before the new poll resolves')
  stale.props.onClick()
  assert.equal(second.draft, '', 'the stale card never writes into the next session draft')
  view.unmount()
})

test('Add to chat fails quietly when the composer action face is unavailable', async () => {
  const env = await loadBundle({
    backend: notesBackend([{ id: 'n-1', note: 'Guard the write.', importance: 'high', createdAt: 1 }]),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()

  const button = buttonByText(view.output, 'Add to chat')
  assert.ok(button, 'the action is offered even when the composer cannot accept it')
  assert.doesNotThrow(() => button.props.onClick())
  view.unmount()
})

// --- Notification history -----------------------------------------------------

/** The history-fetch count for one environment. */
function historyFetchCount(env) {
  return env.calls.filter((call) => call.url.startsWith('api/dsh-you-should-know/history')).length
}

test('Add to chat resolves the note, removes the card immediately, and posts added_to_chat', async () => {
  const composer = createComposer('s-1')
  const { env, view } = await mountAddToChat(composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(composer.draft, NOTE_DRAFT, 'one click inserts the finding once')
  assert.equal(buttonByText(view.output, 'Add to chat'), null, 'the resolved card leaves the stack immediately')
  assert.deepEqual(composer.sent, [], 'Add to chat never sends')

  const posts = env.calls.filter((call) => call.url === 'api/dsh-you-should-know/dismiss')
  assert.equal(posts.length, 1, 'one click posts exactly one resolve transition')
  assert.deepEqual(JSON.parse(posts[0].init.body), { sessionId: 's-1', noteId: 'n-1', action: 'added_to_chat' })
  view.unmount()
})

test('Add to chat then Enter submits the existing draft once and never replays the insertion', async () => {
  const composer = createComposer('s-1')
  const { view } = await mountAddToChat(composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  assert.equal(buttonByText(view.output, 'Add to chat'), null, 'the card is gone after the resolve')
  view.render({ sessionId: 's-1', inputActions: composer.inputActions, input: { draft: composer.draft } })
  pressEnter(view, composer)
  assert.notEqual(composer.draft, NOTE_DRAFT + '\n\n' + NOTE_DRAFT, 'Enter never replays the finding')
  assert.deepEqual(composer.sent, [NOTE_DRAFT], 'Enter submits the built draft exactly once')
  assert.equal(composer.draft, '', 'the submitted draft is cleared')
  assert.deepEqual(composer.deferredCalls, [])
  view.unmount()
})

test('Add to chat that cannot write the draft leaves the card active and never resolves', async () => {
  const env = await loadBundle({
    backend: notesBackend([NOTE_WITH_SOURCE]),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1', inputActions: null, input: null })
  await flushAsync()

  const button = buttonByText(view.output, 'Add to chat')
  assert.ok(button, 'the action is offered even when the composer cannot accept it')
  button.props.onClick()
  assert.ok(buttonByText(view.output, 'Add to chat'), 'a failed draft write keeps the card active')
  assert.equal(env.calls.filter((call) => call.url === 'api/dsh-you-should-know/dismiss').length, 0, 'a failed draft write never resolves the note')
  view.unmount()
})

test('a resolved Add to chat card cannot be re-inserted or re-resolved', async () => {
  const composer = createComposer('s-1')
  const { env, view } = await mountAddToChat(composer)
  pressControl('Add to chat', buttonByText(view.output, 'Add to chat'), composer)
  view.render({ sessionId: 's-1', inputActions: composer.inputActions, input: { draft: composer.draft } })
  assert.equal(buttonByText(view.output, 'Add to chat'), null, 'the resolved card never returns')
  assert.equal(composer.draft, NOTE_DRAFT, 'no second insertion happens')
  assert.equal(env.calls.filter((call) => call.url === 'api/dsh-you-should-know/dismiss').length, 1, 'exactly one resolve transition is posted')
  view.unmount()
})

test('History opens on demand, shows every state, and never polls while closed', async () => {
  const env = await loadBundle({
    backend: historyBackend({
      notes: [{ id: 'n-active', note: 'Active finding.', importance: 'high', createdAt: 1700000000000, source: { path: 'src/a.js', line: 4 } }],
      history: [
        { id: 'n-chat', note: 'Added finding.', importance: 'critical', createdAt: 1700000000000, resolved: true, resolution: 'added_to_chat', resolvedAt: 1700000001000, source: { path: 'src/b.js', line: 9 } },
        { id: 'n-done', note: 'Dismissed finding.', importance: 'high', createdAt: 1600000000000, resolved: true, resolution: 'dismissed', resolvedAt: 1600000001000 },
        { id: 'n-active', note: 'Active finding.', importance: 'high', createdAt: 1700000000000, resolved: false, source: { path: 'src/a.js', line: 4 } },
      ],
    }),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()
  assert.equal(historyFetchCount(env), 0, 'history is never fetched while closed')
  env.runIntervals()
  await flushAsync()
  assert.equal(historyFetchCount(env), 0, 'the note poll never fetches history')

  const open = buttonByText(view.output, 'History')
  assert.ok(open, 'the compact History action renders')
  open.props.onClick()
  await flushAsync()
  assert.equal(historyFetchCount(env), 1, 'opening history refreshes it exactly once')

  const text = textOf(view.output)
  assert.match(text, /State: Added to chat/)
  assert.match(text, /State: Dismissed/)
  assert.match(text, /State: Active/)
  assert.match(text, /Added finding\./)
  assert.match(text, /Dismissed finding\./)
  assert.match(text, /Active finding\./)
  assert.match(text, /2023-11-14 22:13 UTC/, 'the timestamp renders deterministically')
  assert.match(text, /src\/b\.js:9/, 'the source path renders with its line')

  buttonByText(view.output, 'Hide history').props.onClick()
  await flushAsync()
  env.runIntervals()
  await flushAsync()
  assert.equal(historyFetchCount(env), 1, 'a closed history never polls')
  view.unmount()
})

test('a resolved history entry is read-only and cannot be re-resolved', async () => {
  const env = await loadBundle({
    backend: historyBackend({
      notes: [],
      history: [
        { id: 'n-chat', note: 'Added finding.', importance: 'critical', createdAt: 10, resolved: true, resolution: 'added_to_chat', resolvedAt: 11 },
        { id: 'n-done', note: 'Dismissed finding.', importance: 'high', createdAt: 9, resolved: true, resolution: 'dismissed', resolvedAt: 10 },
      ],
    }),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()

  const open = buttonByText(view.output, 'History')
  assert.ok(open, 'history with no active note still offers the action')
  open.props.onClick()
  await flushAsync()

  assert.equal(buttonByText(view.output, 'Dismiss'), null, 'a resolved entry offers no Dismiss')
  assert.equal(buttonByText(view.output, 'Add to chat'), null, 'a resolved entry offers no Add to chat')
  assert.equal(env.calls.filter((call) => call.url === 'api/dsh-you-should-know/dismiss').length, 0, 'nothing can be re-resolved')
  view.unmount()
})

test('an active history entry keeps Add to chat while a resolved one stays read-only', async () => {
  const composer = createComposer('s-1')
  const env = await loadBundle({
    backend: historyBackend({
      notes: [],
      history: [
        { id: 'n-active', note: 'Active finding.', importance: 'high', createdAt: 10, resolved: false },
        { id: 'n-done', note: 'Dismissed finding.', importance: 'high', createdAt: 9, resolved: true, resolution: 'dismissed', resolvedAt: 10 },
      ],
    }),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1', inputActions: composer.inputActions, input: { draft: '' } })
  await flushAsync()
  buttonByText(view.output, 'History').props.onClick()
  await flushAsync()

  const addButtons = findAll(view.output, 'button').filter((button) => textOf(button).includes('Add to chat'))
  const dismissButtons = findAll(view.output, 'button').filter((button) => textOf(button).includes('Dismiss'))
  assert.equal(addButtons.length, 1, 'only the active entry offers Add to chat')
  assert.equal(dismissButtons.length, 1, 'only the active entry offers Dismiss')

  addButtons[0].props.onClick()
  assert.equal(composer.draft, 'Fix this reviewer finding: Active finding.', 'the history entry writes the draft once')
  const posts = env.calls.filter((call) => call.url === 'api/dsh-you-should-know/dismiss')
  assert.equal(posts.length, 1)
  assert.deepEqual(JSON.parse(posts[0].init.body), { sessionId: 's-1', noteId: 'n-active', action: 'added_to_chat' })
  view.unmount()
})

test('history refreshes after a resolve while it stays open', async () => {
  const composer = createComposer('s-1')
  const env = await loadBundle({
    backend: historyBackend({
      notes: [{ id: 'n-active', note: 'Active finding.', importance: 'high', createdAt: 10 }],
      history: [
        { id: 'n-active', note: 'Active finding.', importance: 'high', createdAt: 10, resolved: false },
        { id: 'n-old', note: 'Old finding.', importance: 'high', createdAt: 9, resolved: true, resolution: 'dismissed', resolvedAt: 10 },
      ],
    }),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1', inputActions: composer.inputActions, input: { draft: '' } })
  await flushAsync()
  buttonByText(view.output, 'History').props.onClick()
  await flushAsync()
  assert.equal(historyFetchCount(env), 1)

  buttonByText(view.output, 'Dismiss').props.onClick()
  await flushAsync()
  assert.equal(historyFetchCount(env), 2, 'a resolve refreshes the open history')
  view.unmount()
})

test('a stale history response for session A never populates session B', async () => {
  let releaseA
  const gateA = new Promise((resolve) => { releaseA = resolve })
  const backend = async (url) => {
    if (url.startsWith('api/dsh-you-should-know/history')) {
      if (url.includes('sessionId=A')) {
        await gateA
        return { status: 200, body: { ok: true, history: [{ id: 'A:1', note: 'Alpha finding.', importance: 'high', createdAt: 1, resolved: false }] } }
      }
      return { status: 200, body: { ok: true, history: [{ id: 'B:1', note: 'Beta finding.', importance: 'high', createdAt: 2, resolved: false }] } }
    }
    if (url.startsWith('api/dsh-you-should-know/notes')) {
      const sessionId = new URL(url, 'http://localhost').searchParams.get('sessionId')
      return { status: 200, body: { ok: true, notes: [], historyCount: sessionId === 'A' ? 1 : 1 } }
    }
    return { status: 200, body: { ok: true } }
  }
  const env = await loadBundle({ backend, allowIntervals: true })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 'A' })
  await flushAsync()
  buttonByText(view.output, 'History').props.onClick()
  await flushAsync()

  view.render({ sessionId: 'B' })
  await flushAsync()
  assert.match(textOf(view.output), /Beta finding\./)

  releaseA()
  await flushAsync()
  assert.doesNotMatch(textOf(view.output), /Alpha finding\./, 'a stale history response never crosses sessions')
  view.unmount()
})

// --- Reviewer strictness modes in the UI ---------------------------------------

test('the settings card renders the exact five reviewer modes with a mode helper line', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()

  const select = findByAria(view.output, 'Reviewer mode')
  assert.ok(select, 'the reviewer mode select renders')
  assert.deepEqual(Array.from(select.props.children, (option) => option.props.children), ['Relaxed', 'Balanced', 'Strict', 'Paranoid', 'Custom'])
  assert.deepEqual(Array.from(select.props.children, (option) => option.props.value), ['relaxed', 'balanced', 'strict', 'paranoid', 'custom'])
  assert.equal(select.props.value, 'balanced', 'the default mode is Balanced')
  assert.match(textOf(view.output), /Material overlooked problems/, 'the Balanced helper line renders')
  assert.ok(findByAria(view.output, 'Additional reviewer instructions'), 'the instructions field renders')

  select.props.onChange({ target: { value: 'paranoid' } })
  assert.match(textOf(view.output), /Aggressively searches hidden failure modes/, 'the helper line follows the mode')
  view.unmount()
})

test('Save posts the reviewer mode and the exact additional instructions', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()

  findByAria(view.output, 'Reviewer mode').props.onChange({ target: { value: 'custom' } })
  const text = '  Check tenant isolation.\nKeep exact bytes.  '
  findByAria(view.output, 'Additional reviewer instructions').props.onChange({ target: { value: text } })
  buttonByText(view.output, 'Save').props.onClick()
  await flushAsync()

  const post = env.calls.find((call) => call.init && call.init.method === 'POST')
  assert.ok(post, 'Save POSTs the config')
  const payload = JSON.parse(post.init.body)
  assert.equal(payload.reviewerMode, 'custom')
  assert.equal(payload.additionalInstructions, text)
  assert.equal(payload.mode, 'automatic')
  view.unmount()
})

test('the settings card populates the mode and instructions from the live config', async () => {
  const env = await loadBundle({
    backend: configBackend({ overrides: { config: { mode: 'automatic', reviewerMode: 'strict', additionalInstructions: 'live custom text', minDeltaChars: 1200, cooldownTurns: 3, maxContextMessages: 12, maxTokens: 768 } } }),
  })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  assert.equal(findByAria(view.output, 'Reviewer mode').props.value, 'strict')
  assert.equal(findByAria(view.output, 'Additional reviewer instructions').props.value, 'live custom text')
  view.unmount()
})

test('the session header offers Default plus the five modes and never posts global config', async () => {
  const state = sessionState()
  const env = await loadBundle({ backend: sessionBackend(state) })
  const view = env.runtime.mount(env.actionComponent().component, { sessionId: 's-1' })
  buttonByText(view.output, 'Reviewer').props.onClick()
  await flushAsync()

  const select = findByAria(view.output, 'Session reviewer mode')
  assert.ok(select, 'the session mode select renders')
  assert.deepEqual(Array.from(select.props.children, (option) => option.props.children), ['Default', 'Relaxed', 'Balanced', 'Strict', 'Paranoid', 'Custom'])
  assert.deepEqual(Array.from(select.props.children, (option) => option.props.value), ['', 'relaxed', 'balanced', 'strict', 'paranoid', 'custom'])
  assert.equal(select.props.value, '', 'Default is selected without a session override')

  findByAria(view.output, 'Session reviewer mode').props.onChange({ target: { value: 'paranoid' } })
  await flushAsync()
  assert.deepEqual(state.sessionPosts.at(-1), { action: 'set-mode', sessionId: 's-1', mode: 'paranoid' })
  assert.equal(
    env.calls.some((call) => call.url.startsWith('api/dsh-you-should-know/config') && call.init && call.init.method === 'POST'),
    false,
    'a session mode override never writes the global config route',
  )

  findByAria(view.output, 'Session reviewer mode').props.onChange({ target: { value: '' } })
  await flushAsync()
  assert.deepEqual(state.sessionPosts.at(-1), { action: 'reset-mode', sessionId: 's-1' })
  view.unmount()
})

test('the session header shows the effective mode and its source', async () => {
  const state = sessionState({ effectiveMode: 'paranoid', effectiveModeSource: 'session', sessionModeOverride: 'paranoid', globalMode: 'balanced' })
  const env = await loadBundle({ backend: sessionBackend(state) })
  const view = env.runtime.mount(env.actionComponent().component, { sessionId: 's-1' })
  buttonByText(view.output, 'Reviewer').props.onClick()
  await flushAsync()
  assert.match(textOf(view.output), /Mode: Paranoid/)
  assert.equal(findByAria(view.output, 'Session reviewer mode').props.value, 'paranoid')
  view.unmount()
})

test('the settings card shows the custom prompt only in Custom mode and posts it exactly', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  assert.equal(findByAria(view.output, 'Custom reviewer prompt'), null, 'hidden outside Custom mode')

  findByAria(view.output, 'Reviewer mode').props.onChange({ target: { value: 'custom' } })
  const field = findByAria(view.output, 'Custom reviewer prompt')
  assert.ok(field, 'shown in Custom mode')
  const text = '  Watch every write.\nKeep exact.  '
  field.props.onChange({ target: { value: text } })

  findByAria(view.output, 'Reviewer mode').props.onChange({ target: { value: 'strict' } })
  assert.equal(findByAria(view.output, 'Custom reviewer prompt'), null, 'hidden again')
  findByAria(view.output, 'Reviewer mode').props.onChange({ target: { value: 'custom' } })
  assert.equal(findByAria(view.output, 'Custom reviewer prompt').props.value, text, 'the saved value is restored')

  buttonByText(view.output, 'Save').props.onClick()
  await flushAsync()
  const post = env.calls.find((call) => call.init && call.init.method === 'POST')
  const payload = JSON.parse(post.init.body)
  assert.equal(payload.customReviewerPrompt, text)
  assert.equal(payload.reviewerMode, 'custom')
  view.unmount()
})

test('the settings card populates the saved custom prompt from the live config', async () => {
  const env = await loadBundle({
    backend: configBackend({ overrides: { config: { mode: 'automatic', reviewerMode: 'custom', customReviewerPrompt: 'saved custom text', additionalInstructions: 'overlay', minDeltaChars: 1200, cooldownTurns: 3, maxContextMessages: 12, maxTokens: 768 } } }),
  })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  assert.equal(findByAria(view.output, 'Custom reviewer prompt').props.value, 'saved custom text')
  assert.equal(findByAria(view.output, 'Additional reviewer instructions').props.value, 'overlay')
  view.unmount()
})

test('the session header has no per-session custom prompt field and notes the global reuse', async () => {
  const state = sessionState({ effectiveMode: 'custom', effectiveModeSource: 'session', sessionModeOverride: 'custom', globalMode: 'balanced' })
  const env = await loadBundle({ backend: sessionBackend(state) })
  const view = env.runtime.mount(env.actionComponent().component, { sessionId: 's-1' })
  buttonByText(view.output, 'Reviewer').props.onClick()
  await flushAsync()
  assert.equal(findByAria(view.output, 'Custom reviewer prompt'), null, 'no per-session custom prompt field')
  assert.match(textOf(view.output), /Custom uses the global custom reviewer prompt/)
  view.unmount()
})

// --- Update settings and notification -----------------------------------------

const UPDATE_STATUS = {
  currentVersion: '0.3.8',
  latestVersion: '0.4.0',
  latestTag: 'v0.4.0',
  installSpec: 'github:PipaGs/dsh-you-should-know#v0.4.0',
  updateAvailable: true,
  dismissed: false,
  dismissedVersion: '',
  autoCheckUpdates: true,
  updateBehavior: 'ask-before-update',
  automaticSupported: false,
  lastAutoCheckDate: '2026-06-15',
  lastCheckedAt: null,
  lastResult: null,
}

/**
 * A backend that serves the config GET (carrying the bounded update status) and
 * the update POST route. It records every update-route body so a test can prove
 * exactly which action the browser sent.
 */
function updateBackend(overrides = {}, options = {}) {
  const status = { ...UPDATE_STATUS, ...overrides }
  const posts = []
  async function backend(url, init = {}) {
    if (init.method === 'POST' && url === 'api/dsh-you-should-know/update') {
      const body = JSON.parse(init.body)
      posts.push(body)
      if (body.action === 'check') {
        return { status: 200, body: { ok: true, result: 'update-available', update: { ...status, lastResult: 'update-available' } } }
      }
      if (body.action === 'set-preferences') {
        if (typeof body.autoCheckUpdates === 'boolean') status.autoCheckUpdates = body.autoCheckUpdates
        if (typeof body.updateBehavior === 'string') status.updateBehavior = body.updateBehavior
        return { status: 200, body: { ok: true, action: 'set-preferences', update: { ...status } } }
      }
      if (body.action === 'dismiss') {
        status.dismissed = true
        status.dismissedVersion = body.version
        return { status: 200, body: { ok: true, action: 'dismiss', update: { ...status } } }
      }
    }
    return {
      status: 200,
      body: {
        ok: true,
        writable: options.writable !== false,
        config: { mode: 'automatic', reviewerMode: 'balanced', additionalInstructions: '', customReviewerPrompt: '', minDeltaChars: 1200, cooldownTurns: 3, maxContextMessages: 12, maxTokens: 768 },
        catalog: { providers: [] },
        update: { ...status },
      },
    }
  }
  return { backend, posts, status }
}

function mountSettingsCard(env) {
  return env.runtime.mount(env.cardComponent().component, { connection: env.connection })
}

test('the update settings render the controls and versions from the single config read', async () => {
  const backend = updateBackend()
  const env = await loadBundle({ backend: backend.backend })
  const view = mountSettingsCard(env)
  await flushAsync()
  assert.equal(env.calls.length, 1, 'update status comes with the config read, not a second request')
  assert.equal(findByAria(view.output, 'Check for updates automatically').props.checked, true)
  const behavior = findByAria(view.output, 'Update behavior')
  assert.equal(behavior.props.value, 'ask-before-update')
  // Array.from keeps the comparison in the test realm; the options array was
  // built inside the vm sandbox and carries that realm's prototype.
  assert.deepEqual(Array.from(behavior.props.children).map((option) => option.props.value), ['notify-only', 'ask-before-update', 'automatic'])
  assert.deepEqual(Array.from(behavior.props.children).map((option) => option.props.children), ['Notify only', 'Ask before update', 'Automatic'])
  assert.ok(buttonByText(view.output, 'Check for updates'), 'the manual check button renders')
  assert.match(textOf(view.output), /0\.3\.8/)
  assert.match(textOf(view.output), /v0\.4\.0/)
  view.unmount()
})

test('changing the automatic-check toggle persists the boolean through the update route', async () => {
  const backend = updateBackend()
  const env = await loadBundle({ backend: backend.backend })
  const view = mountSettingsCard(env)
  await flushAsync()
  findByAria(view.output, 'Check for updates automatically').props.onChange({ target: { checked: false } })
  await flushAsync()
  assert.deepEqual(backend.posts, [{ action: 'set-preferences', autoCheckUpdates: false }])
  assert.equal(findByAria(view.output, 'Check for updates automatically').props.checked, false)
  view.unmount()
})

test('the behavior select persists each value and Automatic shows the exact unsupported helper', async () => {
  const backend = updateBackend()
  const env = await loadBundle({ backend: backend.backend })
  const view = mountSettingsCard(env)
  await flushAsync()
  findByAria(view.output, 'Update behavior').props.onChange({ target: { value: 'notify-only' } })
  await flushAsync()
  assert.deepEqual(backend.posts.at(-1), { action: 'set-preferences', updateBehavior: 'notify-only' })
  findByAria(view.output, 'Update behavior').props.onChange({ target: { value: 'automatic' } })
  await flushAsync()
  assert.deepEqual(backend.posts.at(-1), { action: 'set-preferences', updateBehavior: 'automatic' })
  assert.match(textOf(view.output), /Automatic installation is not supported by this DSH version/)
  view.unmount()
})

test('the Check for updates button runs one manual check and shows deterministic feedback', async () => {
  const backend = updateBackend()
  const env = await loadBundle({ backend: backend.backend })
  const view = mountSettingsCard(env)
  await flushAsync()
  buttonByText(view.output, 'Check for updates').props.onClick()
  await flushAsync()
  assert.deepEqual(backend.posts, [{ action: 'check' }])
  assert.match(textOf(view.output), /Update available/)
  view.unmount()
})

test('the update card shows the exact pinned spec and the restart note, and installs nothing', async () => {
  const backend = updateBackend()
  const env = await loadBundle({ backend: backend.backend })
  const view = mountSettingsCard(env)
  await flushAsync()
  assert.match(textOf(view.output), /v0\.4\.0/)
  assert.match(textOf(view.output), /github:PipaGs\/dsh-you-should-know#v0\.4\.0/)
  assert.match(textOf(view.output), /Restart/)
  assert.ok(findByAria(view.output, 'Copy install spec'))
  assert.equal(typeof env.module.installBundle, 'undefined', 'the browser half exposes no install call')
  assert.equal(backend.posts.length, 0, 'rendering the notice mutates nothing')
  view.unmount()
})

test('dismissing a version hides its card while a newer release surfaces again', async () => {
  const backend = updateBackend()
  const env = await loadBundle({ backend: backend.backend })
  const view = mountSettingsCard(env)
  await flushAsync()
  findByAria(view.output, 'Dismiss update').props.onClick()
  await flushAsync()
  assert.deepEqual(backend.posts, [{ action: 'dismiss', version: 'v0.4.0' }])
  assert.equal(findByAria(view.output, 'Copy install spec'), null, 'the dismissed version stays hidden')
  view.unmount()

  const newer = updateBackend({ latestTag: 'v0.5.0', latestVersion: '0.5.0', installSpec: 'github:PipaGs/dsh-you-should-know#v0.5.0', dismissed: false, dismissedVersion: 'v0.4.0' })
  const env2 = await loadBundle({ backend: newer.backend })
  const view2 = mountSettingsCard(env2)
  await flushAsync()
  assert.ok(findByAria(view2.output, 'Copy install spec'), 'a newer release surfaces again')
  assert.match(textOf(view2.output), /v0\.5\.0/)
  view2.unmount()
})

test('without an update status the card still offers the conservative defaults and no notice', async () => {
  const env = await loadBundle({
    backend: async () => ({
      status: 200,
      body: { ok: true, writable: true, config: { mode: 'automatic', minDeltaChars: 1200, cooldownTurns: 3, maxContextMessages: 12, maxTokens: 768 }, catalog: { providers: [] } },
    }),
  })
  const view = mountSettingsCard(env)
  await flushAsync()
  assert.equal(findByAria(view.output, 'Check for updates automatically').props.checked, true)
  assert.equal(findByAria(view.output, 'Update behavior').props.value, 'ask-before-update')
  assert.equal(findByAria(view.output, 'Copy install spec'), null)
  view.unmount()
})

test('a read-only host disables the update controls too', async () => {
  const backend = updateBackend({}, { writable: false })
  const env = await loadBundle({ backend: backend.backend })
  const view = mountSettingsCard(env)
  await flushAsync()
  assert.equal(findByAria(view.output, 'Check for updates automatically').props.disabled, true)
  assert.equal(findByAria(view.output, 'Update behavior').props.disabled, true)
  assert.equal(buttonByText(view.output, 'Check for updates').props.disabled, true)
  view.unmount()
})

// --- v0.4.0 feedback and Explain ----------------------------------------------

test('the note card offers Knew it, Thanks, and Explain alongside the existing actions', async () => {
  const env = await loadBundle({
    backend: notesBackend([{ id: 'n-1', note: 'One important thing.', importance: 'high', createdAt: 1 }]),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()
  const card = findByType(view.output, 'section')
  for (const label of ['Add to chat', 'Dismiss', 'Knew it', 'Thanks', 'Explain']) {
    assert.ok(buttonByText(card, label), label + ' is present')
  }
  view.unmount()
})

test('Knew it and Thanks post their exact resolutions and remove the card', async () => {
  const env = await loadBundle({
    backend: notesBackend([
      { id: 'n-1', note: 'First finding.', importance: 'high', createdAt: 1 },
      { id: 'n-2', note: 'Second finding.', importance: 'high', createdAt: 2 },
    ]),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()
  buttonByText(view.output, 'Knew it').props.onClick()
  await flushAsync()
  assert.equal(findAll(view.output, 'section').length, 1, 'Knew it removes exactly its own card')
  buttonByText(view.output, 'Thanks').props.onClick()
  await flushAsync()
  assert.equal(findAll(view.output, 'section').length, 0, 'Thanks removes the last card')
  const posts = env.calls
    .filter((call) => call.url === 'api/dsh-you-should-know/dismiss')
    .map((call) => JSON.parse(call.init.body))
  assert.deepEqual(posts, [
    { sessionId: 's-1', noteId: 'n-1', action: 'knew_it' },
    { sessionId: 's-1', noteId: 'n-2', action: 'thanks' },
  ])
  view.unmount()
})

test('Explain is collapsed by default, expands inline, and reuses the cached text', async () => {
  const explainPosts = []
  const env = await loadBundle({
    backend: async (url, init = {}) => {
      if (url.startsWith('api/dsh-you-should-know/explain')) {
        explainPosts.push(JSON.parse(init.body))
        return { status: 200, body: { ok: true, cached: false, explanation: 'It matters because the cache is stale.' } }
      }
      if (url.startsWith('api/dsh-you-should-know/notes')) {
        return { status: 200, body: { ok: true, notes: [{ id: 'n-1', note: 'One important thing.', importance: 'high', createdAt: 1 }] } }
      }
      return { status: 200, body: { ok: true } }
    },
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()
  assert.equal(findByAria(view.output, 'Explanation'), null, 'collapsed by default')
  buttonByText(view.output, 'Explain').props.onClick()
  await flushAsync()
  assert.ok(findByAria(view.output, 'Explanation'), 'the explanation expands inline')
  assert.match(textOf(view.output), /cache is stale/)
  assert.deepEqual(explainPosts, [{ sessionId: 's-1', noteId: 'n-1' }])

  buttonByText(view.output, 'Hide explanation').props.onClick()
  await flushAsync()
  assert.equal(findByAria(view.output, 'Explanation'), null, 'it collapses again')
  buttonByText(view.output, 'Explain').props.onClick()
  await flushAsync()
  assert.match(textOf(view.output), /cache is stale/)
  assert.equal(explainPosts.length, 1, 'the cached explanation needs no second request')
  view.unmount()
})

test('a failed Explain shows a retry and never blocks the other card actions', async () => {
  let attempts = 0
  const env = await loadBundle({
    backend: async (url) => {
      if (url.startsWith('api/dsh-you-should-know/explain')) {
        attempts += 1
        if (attempts === 1) return { status: 200, body: { ok: false, error: 'failed' } }
        return { status: 200, body: { ok: true, cached: false, explanation: 'Second attempt worked.' } }
      }
      if (url.startsWith('api/dsh-you-should-know/notes')) {
        return { status: 200, body: { ok: true, notes: [{ id: 'n-1', note: 'One thing.', importance: 'high', createdAt: 1 }] } }
      }
      return { status: 200, body: { ok: true } }
    },
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()
  buttonByText(view.output, 'Explain').props.onClick()
  await flushAsync()
  assert.match(textOf(view.output), /Could not load an explanation/)
  assert.ok(buttonByText(view.output, 'Dismiss'), 'the other actions stay available')
  findByAria(view.output, 'Retry explanation').props.onClick()
  await flushAsync()
  assert.match(textOf(view.output), /Second attempt worked/)
  assert.equal(attempts, 2)
  view.unmount()
})

test('a note that already carries an explanation expands it without a request', async () => {
  const env = await loadBundle({
    backend: notesBackend([{ id: 'n-1', note: 'One thing.', importance: 'high', createdAt: 1, explanation: 'Cached reasoning.' }]),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()
  buttonByText(view.output, 'Explain').props.onClick()
  await flushAsync()
  assert.match(textOf(view.output), /Cached reasoning/)
  assert.equal(env.calls.filter((call) => call.url === 'api/dsh-you-should-know/explain').length, 0)
  view.unmount()
})

test('History renders every resolution state distinctly and shows a bounded explanation', async () => {
  const env = await loadBundle({
    backend: historyBackend({
      notes: [{ id: 'n-active', note: 'Active finding.', importance: 'high', createdAt: 5 }],
      historyCount: 5,
      history: [
        { id: 'n-active', note: 'Active finding.', importance: 'high', createdAt: 5, resolved: false },
        { id: 'n-dismissed', note: 'Dismissed finding.', importance: 'high', createdAt: 4, resolved: true, resolution: 'dismissed' },
        { id: 'n-added', note: 'Added finding.', importance: 'high', createdAt: 3, resolved: true, resolution: 'added_to_chat' },
        { id: 'n-knew', note: 'Known finding.', importance: 'high', createdAt: 2, resolved: true, resolution: 'knew_it', explanation: 'Why it matters.' },
        { id: 'n-thanks', note: 'Thanked finding.', importance: 'high', createdAt: 1, resolved: true, resolution: 'thanks' },
      ],
    }),
    allowIntervals: true,
  })
  const view = env.runtime.mount(env.dockComponent().component, { sessionId: 's-1' })
  await flushAsync()
  buttonByText(view.output, 'History').props.onClick()
  await flushAsync()
  const entries = findAll(view.output, 'section').filter((node) => node.props && node.props.role === 'history-entry')
  assert.equal(entries.length, 5)
  assert.deepEqual(entries.map((entry) => entry.props['data-state']).sort(), ['active', 'added_to_chat', 'dismissed', 'knew_it', 'thanks'])
  const rendered = textOf(view.output)
  for (const label of ['State: Active', 'State: Dismissed', 'State: Added to chat', 'State: Knew it', 'State: Thanks']) {
    assert.ok(rendered.includes(label), label + ' is rendered distinctly')
  }
  assert.match(rendered, /Why it matters\./)
  view.unmount()
})

test('the settings card renders and posts the hourly reviewer-call budget', async () => {
  const env = await loadBundle({ backend: configBackend() })
  const view = env.runtime.mount(env.cardComponent().component, { connection: env.connection })
  await flushAsync()
  const field = findByAria(view.output, 'Max reviewer calls per hour')
  assert.ok(field, 'the budget field renders')
  assert.equal(field.props.value, '12', 'the conservative host default is shown')
  field.props.onChange({ target: { value: '24' } })
  buttonByText(view.output, 'Save').props.onClick()
  await flushAsync()
  const post = env.calls.find((call) => call.init && call.init.method === 'POST')
  assert.equal(JSON.parse(post.init.body).maxReviewerCallsPerHour, 24)
  view.unmount()
})
