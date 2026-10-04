import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const SOURCE_URL = new URL('../lib/client.js', import.meta.url)

// A tiny deterministic React-hook runtime: enough to mount the dock component,
// flush its effect, drive state updates, and re-render with new props without a
// real DOM or the React package (the plugin ships with no dependencies).
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
        if (Object.is(previous, next)) return
        inst.states[index] = next
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
      if (previous !== undefined && nextEffects[index] === undefined && typeof previous.cleanup === 'function') {
        previous.cleanup()
      }
    }
    inst.effects = nextEffects
    inst.output = output
    rendering = false
    if (scheduled) {
      scheduled = false
      render()
    }
  }

  function mount(component, props) {
    instance = { component, props, states: {}, hookCursor: 0, pendingEffects: [], effects: [], output: null }
    render()
    return {
      get output() {
        return instance.output
      },
      render(nextProps) {
        instance.props = nextProps
        render()
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

// Walk a virtual tree, expanding nested function components (the card is one).
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
  return parts.join('')
}

function findButton(node) {
  let found = null
  walk(node, (entry) => {
    if (found === null && typeof entry === 'object' && entry.type === 'button') found = entry
  })
  return found
}

async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function loadDock() {
  const source = await readFile(SOURCE_URL, 'utf8')
  const registrations = []
  const listeners = { visibilitychange: new Set() }
  const intervals = []
  const fetchCalls = []
  const dismissCalls = []
  const responses = new Map()

  const documentMock = {
    visibilityState: 'visible',
    addEventListener(type, listener) {
      if (listeners[type] === undefined) listeners[type] = new Set()
      listeners[type].add(listener)
    },
    removeEventListener(type, listener) {
      if (listeners[type] !== undefined) listeners[type].delete(listener)
    },
  }

  const fetchMock = async (url, init = {}) => {
    if (init && init.method === 'POST') {
      dismissCalls.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ ok: true, dismissed: true }) }
    }
    fetchCalls.push(url)
    const sessionId = new URL(url, 'http://localhost').searchParams.get('sessionId')
    const responder = responses.get(sessionId)
    const notes = typeof responder === 'function' ? await responder() : responder || []
    return { ok: true, json: async () => ({ ok: true, notes }) }
  }

  const sandbox = {
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
    document: documentMock,
    fetch: fetchMock,
    setInterval: (fn) => {
      intervals.push(fn)
      return intervals.length
    },
    clearInterval: (id) => {
      intervals[id - 1] = null
    },
    encodeURIComponent,
    console,
    JSON,
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })

  const runtime = createHookRuntime()
  const mod = registrations[0].factory((specifier) => {
    assert.equal(specifier, 'react')
    return runtime.React
  })
  let dock = null
  mod.apply({
    slots: {
      inject(_slot, callback) {
        callback()
      },
      register(_spec, component) {
        dock = component
      },
    },
  })

  return {
    Dock: dock,
    runtime,
    documentMock,
    intervals,
    fetchCalls,
    dismissCalls,
    responses,
    runIntervals() {
      for (const fn of intervals) if (fn) fn()
    },
    setVisibility(state) {
      documentMock.visibilityState = state
      for (const listener of listeners.visibilitychange) listener()
    },
  }
}

function noteFor(sessionId) {
  return () => [{ id: `${sessionId}:1`, note: `note for ${sessionId}`, importance: 'high' }]
}

test('a session switch never renders the previous session note, not even for one frame', async () => {
  const env = await loadDock()
  env.responses.set('A', noteFor('A'))
  env.responses.set('B', () => [])

  const view = env.runtime.mount(env.Dock, { sessionId: 'A' })
  await flushAsync()
  assert.match(textOf(view.output), /note for A/)

  view.render({ sessionId: 'B' })
  // B has not answered this poll yet; A's note must already be gone.
  assert.doesNotMatch(textOf(view.output), /note for A/)

  await flushAsync()
  assert.equal(view.output, null)
  view.unmount()
})

test('a stale previous-session note can never be dismissed against the new session', async () => {
  const env = await loadDock()
  env.responses.set('A', noteFor('A'))
  env.responses.set('B', () => [])

  const view = env.runtime.mount(env.Dock, { sessionId: 'A' })
  await flushAsync()
  view.render({ sessionId: 'B' })

  assert.equal(findButton(view.output), null, 'no dismiss control for a note that belongs to session A')
  assert.deepEqual(env.dismissCalls, [])
  view.unmount()
})

test('dismiss hides the note immediately and posts the original session id and note id', async () => {
  const env = await loadDock()
  env.responses.set('A', noteFor('A'))

  const view = env.runtime.mount(env.Dock, { sessionId: 'A' })
  await flushAsync()
  const button = findButton(view.output)
  assert.ok(button, 'the note renders with a dismiss control')

  button.props.onClick()
  assert.equal(textOf(view.output), '', 'the note is hidden synchronously')
  await flushAsync()
  assert.deepEqual(env.dismissCalls, [{ sessionId: 'A', noteId: 'A:1' }])
  view.unmount()
})

test('a critical note renders as critical and dismisses with its own session and note ids', async () => {
  const env = await loadDock()
  env.responses.set('C', () => [{ id: 'C:7', note: 'critical finding', importance: 'critical' }])

  const view = env.runtime.mount(env.Dock, { sessionId: 'C' })
  await flushAsync()
  const rendered = textOf(view.output)
  assert.match(rendered, /critical finding/)
  assert.match(rendered, /critical/)

  const button = findButton(view.output)
  assert.ok(button, 'the critical note renders with a dismiss control')
  button.props.onClick()
  await flushAsync()
  assert.deepEqual(env.dismissCalls, [{ sessionId: 'C', noteId: 'C:7' }])
  view.unmount()
})

test('polling never fetches while the page is hidden and resumes when it becomes visible', async () => {
  const env = await loadDock()
  env.responses.set('A', () => [])
  env.documentMock.visibilityState = 'hidden'

  const view = env.runtime.mount(env.Dock, { sessionId: 'A' })
  await flushAsync()
  assert.equal(env.fetchCalls.length, 0, 'no fetch on mount while hidden')

  env.runIntervals()
  await flushAsync()
  assert.equal(env.fetchCalls.length, 0, 'no fetch from the poll timer while hidden')

  env.setVisibility('visible')
  await flushAsync()
  assert.equal(env.fetchCalls.length, 1, 'visibility resumes an immediate poll')

  view.unmount()
  env.setVisibility('visible')
  await flushAsync()
  assert.equal(env.fetchCalls.length, 1, 'the listener is removed on unmount')
})

test('dismissal memory stays bounded and forgets the oldest sessions', async () => {
  const env = await loadDock()
  const budget = 200

  for (let index = 0; index <= budget; index += 1) {
    const sessionId = `s${index}`
    env.responses.set(sessionId, noteFor(sessionId))
    const view = env.runtime.mount(env.Dock, { sessionId })
    await flushAsync()
    const button = findButton(view.output)
    assert.ok(button, `note for ${sessionId} must render`)
    button.props.onClick()
    view.unmount()
  }

  // The oldest session's dismissal memory is evicted, so its note can return.
  const oldest = env.runtime.mount(env.Dock, { sessionId: 's0' })
  await flushAsync()
  assert.match(textOf(oldest.output), /note for s0/, 'the oldest dismissal must be forgotten')
  oldest.unmount()

  // The most recently visited session keeps its dismissal memory.
  const newest = env.runtime.mount(env.Dock, { sessionId: `s${budget}` })
  await flushAsync()
  assert.equal(newest.output, null, 'a recent dismissal must survive')
  newest.unmount()
})

test('a note is shown again on the next poll if the host has not accepted the dismissal', async () => {
  const env = await loadDock()
  env.responses.set('A', noteFor('A'))
  const view = env.runtime.mount(env.Dock, { sessionId: 'A' })
  await flushAsync()
  const button = findButton(view.output)
  button.props.onClick()
  await flushAsync()
  // Local memory keeps it hidden even though the host keeps serving it.
  assert.equal(view.output, null)
  env.runIntervals()
  await flushAsync()
  assert.equal(view.output, null)
  view.unmount()
})
