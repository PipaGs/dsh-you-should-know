import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const SOURCE_URL = new URL('../lib/client.js', import.meta.url)

function fakeReact() {
  return {
    Fragment: 'fragment',
    createElement(type, props, ...children) {
      return { type, props, children }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, () => {}]
    },
    useEffect() {},
    useRef(value) {
      return { current: value }
    },
  }
}

async function loadBundle() {
  const source = await readFile(SOURCE_URL, 'utf8')
  const registrations = []
  const window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  const sandbox = {
    window,
    document,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    setInterval: () => 0,
    clearInterval: () => {},
    encodeURIComponent,
    console,
    JSON,
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  return registrations
}

test('the browser bundle registers a lazy factory under the package name', async () => {
  const registrations = await loadBundle()
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, 'dsh-you-should-know')
  assert.equal(typeof registrations[0].factory, 'function')
})

test('the client half declares its services and registers the composer-adjacent slot', async () => {
  const registrations = await loadBundle()
  const mod = registrations[0].factory((specifier) => {
    assert.equal(specifier, 'react')
    return fakeReact()
  })
  assert.equal(mod.name, 'dsh-you-should-know')
  assert.deepEqual(Array.from(mod.inject), ['slots'])

  const registrationsSeen = []
  const injections = []
  const ctx = {
    slots: {
      inject(slot, callback) {
        injections.push(slot)
        callback()
      },
      register(spec, component) {
        registrationsSeen.push({ spec, component })
      },
    },
  }
  mod.apply(ctx)
  assert.deepEqual(injections, ['conversation.input.dock'])
  assert.equal(registrationsSeen.length, 1)
  assert.equal(registrationsSeen[0].spec.name, 'conversation.input.dock')
  assert.equal(registrationsSeen[0].spec.id, 'you-should-know')
  assert.equal(typeof registrationsSeen[0].component, 'function')

  // The dock's owner props are { session, input }, so the session id must come
  // from the slot inject face the framework calls with the scope binding key.
  const injectFace = registrationsSeen[0].spec.inject
  assert.equal(typeof injectFace, 'function')
  assert.equal(injectFace('s1').sessionId, 's1')
  assert.equal(injectFace(undefined).sessionId, '')
  assert.equal(injectFace(42).sessionId, '')
})

test('the card renders nothing at all when there is no note', async () => {
  const registrations = await loadBundle()
  const mod = registrations[0].factory(() => fakeReact())
  let dock = null
  mod.apply({
    slots: {
      inject(slot, callback) {
        callback()
      },
      register(spec, component) {
        dock = component
      },
    },
  })
  assert.equal(dock({ sessionId: 's1' }), null)
})
