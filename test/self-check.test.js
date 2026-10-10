import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  AUTH_TRANSPORT,
  ROUTE_CAPABILITIES,
  SELF_CHECK_PATH,
  buildCapabilities,
  buildSelfCheckPayload,
  createSelfCheckHandler,
  routeCapabilityView,
} from '../lib/self-check.js'

const EXPECTED_ROUTES = [
  ['notes', '/api/dsh-you-should-know/notes', ['GET', 'HEAD'], 'buffered'],
  ['history', '/api/dsh-you-should-know/history', ['GET', 'HEAD'], 'buffered'],
  ['dismiss', '/api/dsh-you-should-know/dismiss', ['POST'], 'streaming'],
  ['status', '/api/dsh-you-should-know/status', ['GET', 'HEAD'], 'buffered'],
  ['session', '/api/dsh-you-should-know/session', ['GET', 'HEAD', 'POST'], 'buffered'],
  ['explain', '/api/dsh-you-should-know/explain', ['POST'], 'buffered'],
  ['config', '/api/dsh-you-should-know/config', ['GET', 'HEAD', 'POST'], 'buffered'],
  ['update', '/api/dsh-you-should-know/update', ['GET', 'HEAD', 'POST'], 'buffered'],
  ['self-check', '/api/dsh-you-should-know/self-check', ['GET', 'HEAD'], 'buffered'],
]

const ALL_HANDLERS = Object.fromEntries(ROUTE_CAPABILITIES.map((capability) => [capability.name, () => {}]))

const ALLOWED_TOP_LEVEL = ['ok', 'authTransport', 'healthy', 'configured', 'pluginVersion', 'runtimeVersion', 'installedVersion', 'runtimeStatus', 'reviewerMode', 'routes', 'capabilities', 'update']
const ALLOWED_UPDATE = ['currentVersion', 'latestVersion', 'latestTag', 'updateAvailable', 'dismissed', 'autoCheckUpdates', 'updateBehavior', 'lastAutoCheckDate', 'lastCheckedAt', 'lastResult']
const FORBIDDEN_KEYS = new Set(['note', 'notes', 'action', 'source', 'explanation', 'evidenceText', 'customReviewerPrompt', 'additionalInstructions', 'provider', 'model', 'session', 'messages', 'transcript', 'systemPrompt', 'prompt'])

function keyPaths(value, path = '') {
  if (Array.isArray(value)) return value.flatMap((entry, index) => keyPaths(entry, path + '[' + index + ']'))
  if (value === null || typeof value !== 'object') return []
  return Object.keys(value).flatMap((key) => {
    const next = path === '' ? key : path + '.' + key
    return [next, ...keyPaths(value[key], next)]
  })
}

async function manifestVersion() {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  return manifest.version
}

const baseDiagnostics = { configured: true, reviewerMode: 'balanced', runtimeStatus: 'idle' }
const baseUpdate = { currentVersion: '0.4.1', latestVersion: '0.4.1', latestTag: 'v0.4.1', updateAvailable: false, dismissed: false, autoCheckUpdates: true, updateBehavior: 'ask-before-update', lastAutoCheckDate: '', lastCheckedAt: null, lastResult: null }

function build(overrides = {}) {
  return buildSelfCheckPayload({
    pluginVersion: '0.4.1',
    installedVersion: '0.4.1',
    diagnostics: baseDiagnostics,
    handlers: ALL_HANDLERS,
    update: baseUpdate,
    ...overrides,
  })
}

test('the shared capability table is the single registration source and lists every route', () => {
  assert.equal(SELF_CHECK_PATH, '/api/dsh-you-should-know/self-check')
  assert.deepEqual(
    ROUTE_CAPABILITIES.map((capability) => [capability.name, capability.path, [...capability.methods], capability.requestBody]),
    EXPECTED_ROUTES,
  )
})

test('the capability view reports names, methods, and whether a handler is registered', () => {
  const view = routeCapabilityView({ notes: () => {}, 'self-check': () => {} })
  assert.deepEqual(view.map((entry) => entry.name), EXPECTED_ROUTES.map(([name]) => name))
  const byName = Object.fromEntries(view.map((entry) => [entry.name, entry]))
  assert.equal(byName.notes.registered, true)
  assert.equal(byName['self-check'].registered, true)
  assert.equal(byName.explain.registered, false)
  assert.deepEqual(byName.session.methods, ['GET', 'HEAD', 'POST'])
})

test('capability flags derive from the registered handlers and name every shipped feature', () => {
  const capabilities = buildCapabilities(ALL_HANDLERS)
  assert.deepEqual(Object.keys(capabilities).sort(), ['adaptiveBudget', 'episodeTrigger', 'evidence', 'explain', 'feedback', 'updateChecker'])
  assert.equal(capabilities.feedback, true)
  assert.equal(capabilities.explain, true)
  assert.equal(capabilities.updateChecker, true)
  assert.equal(capabilities.evidence, true)
  assert.equal(capabilities.episodeTrigger, true)
  assert.equal(capabilities.adaptiveBudget, true)
  const partial = buildCapabilities({ notes: () => {} })
  assert.equal(partial.explain, false)
  assert.equal(partial.feedback, false)
  assert.equal(partial.updateChecker, false)
})

test('the self-check payload returns only allowed fields', () => {
  const payload = build()
  assert.deepEqual(Object.keys(payload).sort(), ALLOWED_TOP_LEVEL.slice().sort())
  assert.equal(payload.ok, true)
  assert.equal(payload.authTransport, AUTH_TRANSPORT)
  assert.equal(payload.authTransport, 'host-authenticated-connection')
  assert.equal(payload.healthy, true)
  assert.equal(payload.pluginVersion, '0.4.1')
  assert.equal(payload.runtimeVersion, '0.4.1')
  assert.equal(payload.installedVersion, '0.4.1')
  assert.equal(payload.runtimeStatus, 'idle')
  assert.equal(payload.reviewerMode, 'balanced')
})

test('healthy is false when the reviewer is disabled or a runtime is not working', () => {
  assert.equal(build().healthy, true)
  assert.equal(build().configured, true)
  assert.equal(build({ diagnostics: { ...baseDiagnostics, configured: false } }).healthy, false)
  for (const runtimeStatus of ['halted', 'quota_exhausted', 'disposed', 'degraded', 'unknown']) {
    assert.equal(build({ diagnostics: { ...baseDiagnostics, runtimeStatus } }).healthy, false, runtimeStatus + ' must not read as healthy')
  }
  assert.equal(build({ diagnostics: { ...baseDiagnostics, runtimeStatus: 'reviewing' } }).healthy, true)
  assert.equal(build({ handlers: {} }).healthy, false, 'a missing handler must not read as healthy')
})

test('the self-check payload never carries note, action, source, explanation, evidence, or prompt text', () => {
  const payload = build()
  const forbidden = [...FORBIDDEN_KEYS].map((key) => key).filter((key) => {
    if (key === 'evidence') return false
    return keyPaths(payload).some((path) => path === key || path.endsWith('.' + key))
  })
  assert.deepEqual(forbidden, [])
  const text = JSON.stringify(payload)
  for (const marker of ['"sk-', 'Bearer', 'Authorization', 'cookie', 'transcript']) {
    assert.equal(text.includes(marker), false, 'the self-check payload must not carry ' + marker)
  }
  // The capability flag for the evidence feature is the only place the word appears.
  assert.equal(keyPaths(payload).filter((path) => path.endsWith('evidence')).length, 1)
})

test('the update summary keeps only the bounded enum, version, and date fields', () => {
  const payload = build({ update: { ...baseUpdate, installSpec: 'github:PipiaGs/dsh-you-should-know#v0.4.1', secret: 'sk-live', notes: 'finding text' } })
  assert.deepEqual(Object.keys(payload.update).sort(), ALLOWED_UPDATE.slice().sort())
  assert.equal(JSON.stringify(payload).includes('sk-live'), false)
  assert.equal(JSON.stringify(payload).includes('finding text'), false)
  assert.equal(JSON.stringify(payload).includes('github:'), false)
})

test('the self-check payload bounds every version and enum value', () => {
  const payload = build({
    pluginVersion: 'x'.repeat(200),
    installedVersion: '0.4.0\n<div>',
    diagnostics: { configured: true, reviewerMode: 'not-a-real-mode', runtimeStatus: 'not-a-real-status' },
  })
  assert.equal(payload.pluginVersion, null)
  assert.equal(payload.installedVersion, null)
  assert.equal(payload.reviewerMode, null)
  assert.equal(payload.runtimeStatus, 'unknown')
  assert.ok(JSON.stringify(payload).length < 2000, 'the payload stays small')
})

test('the self-check route is GET/HEAD, bodyless on HEAD, and rejects writes', async () => {
  const handler = createSelfCheckHandler({ engine: { diagnostics: () => baseDiagnostics }, updateChecker: { status: () => baseUpdate }, pluginVersion: '0.4.1', handlers: ALL_HANDLERS, readInstalledVersion: async () => '0.4.1' })
  const get = await handler.selfCheck(new Request('http://127.0.0.1' + SELF_CHECK_PATH, { method: 'GET' }))
  assert.equal(get.status, 200)
  assert.equal(get.headers.get('cache-control'), 'no-store')
  const body = await get.json()
  assert.equal(body.ok, true)
  assert.equal(body.routes.length, EXPECTED_ROUTES.length)
  const head = await handler.selfCheck(new Request('http://127.0.0.1' + SELF_CHECK_PATH, { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  const post = await handler.selfCheck(new Request('http://127.0.0.1' + SELF_CHECK_PATH, { method: 'POST', body: '{}' }))
  assert.equal(post.status, 405)
  assert.equal(post.headers.get('allow'), 'GET, HEAD')
})

test('the self-check handler fails closed to a bounded 500 instead of throwing into the carrier', async () => {
  const handler = createSelfCheckHandler({ engine: { diagnostics: () => { throw new Error('boom') } }, updateChecker: { status: () => baseUpdate }, pluginVersion: '0.4.1', handlers: ALL_HANDLERS, readInstalledVersion: async () => '0.4.1' })
  const response = await handler.selfCheck(new Request('http://127.0.0.1' + SELF_CHECK_PATH, { method: 'GET' }))
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { ok: false, error: 'internal' })
})

test('an installed package version that differs from the running constant is reported honestly', async () => {
  const handler = createSelfCheckHandler({ engine: { diagnostics: () => baseDiagnostics }, updateChecker: { status: () => baseUpdate }, pluginVersion: '0.4.1', handlers: ALL_HANDLERS, readInstalledVersion: async () => '0.4.2' })
  const body = await (await handler.selfCheck(new Request('http://127.0.0.1' + SELF_CHECK_PATH, { method: 'GET' }))).json()
  assert.equal(body.runtimeVersion, '0.4.1')
  assert.equal(body.installedVersion, '0.4.2')
})

test('the default installed-version reader returns this package manifest version', async () => {
  const handler = createSelfCheckHandler({ engine: { diagnostics: () => baseDiagnostics }, updateChecker: { status: () => baseUpdate }, pluginVersion: await manifestVersion(), handlers: ALL_HANDLERS })
  const body = await (await handler.selfCheck(new Request('http://127.0.0.1' + SELF_CHECK_PATH, { method: 'GET' }))).json()
  assert.equal(body.installedVersion, await manifestVersion())
})

test('an unreadable installed manifest degrades to null instead of guessing', async () => {
  const handler = createSelfCheckHandler({ engine: { diagnostics: () => baseDiagnostics }, updateChecker: undefined, pluginVersion: '0.4.1', handlers: ALL_HANDLERS, readInstalledVersion: async () => null })
  const body = await (await handler.selfCheck(new Request('http://127.0.0.1' + SELF_CHECK_PATH, { method: 'GET' }))).json()
  assert.equal(body.installedVersion, null)
  assert.deepEqual(body.update, {})
})
