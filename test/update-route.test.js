// Host integration for update checking: the update route, the Config schema
// fields, and the guarantee that a reviewer-config save preserves the update
// state instead of resetting it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Config, PLUGIN_VERSION } from '../lib/index.js'
import { createConfigHandlers, createEngine, createUpdateHandlers, normalizeConfig } from '../lib/core.js'
import { createUpdateChecker, normalizeUpdateState } from '../lib/update.js'

const UPDATE_URL = 'http://127.0.0.1/api/dsh-you-should-know/update'

/** One realistic git ls-remote --tags --refs stdout body. */
function tagListing(...tags) {
  return tags.map((tag, index) => String(index + 1).padStart(40, '0') + '\trefs/tags/' + tag).join('\n') + '\n'
}

function updateHarness(options = {}) {
  const state = normalizeUpdateState(options.initial)
  const patches = []
  const persist = async (patch) => {
    patches.push({ ...patch })
    Object.assign(state, patch)
  }
  const calls = []
  const shellExec = async (request, signal) => {
    calls.push({ request, signal })
    if (options.fail === true) throw new Error('git unavailable')
    return { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000, stdout: { text: tagListing(options.latestTag ?? 'v0.4.0'), truncated: false }, stderr: { text: '', truncated: false } }
  }
  const checker = createUpdateChecker({
    currentVersion: options.currentVersion ?? '0.3.8',
    getState: () => state,
    persist,
    shellExec,
    now: () => Date.parse('2026-06-15T10:00:00Z'),
    setTimer: () => 1,
    clearTimer: () => {},
  })
  // The real plugin starts the checker with the row; the route is only
  // reachable while it is active.
  checker.start()
  const handlers = createUpdateHandlers(checker, { writable: () => options.writable !== false })
  return { handlers, checker, state, patches, calls }
}

function updateGet(harness, method = 'GET') {
  return harness.handlers.update(new Request(UPDATE_URL, { method }))
}

function updatePost(harness, body) {
  return harness.handlers.update(new Request(UPDATE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

test('GET update returns the bounded update status and writability', async () => {
  const harness = updateHarness({ initial: { lastSeenLatestVersion: 'v0.4.0', lastAutoCheckDate: '2026-06-15' } })
  const response = await updateGet(harness)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.writable, true)
  assert.deepEqual(body.update, {
    currentVersion: '0.3.8',
    latestVersion: '0.4.0',
    latestTag: 'v0.4.0',
    installSpec: 'github:PipaGs/dsh-you-should-know#v0.4.0',
    source: 'git-tags',
    updateAvailable: true,
    dismissed: false,
    dismissedVersion: '',
    autoCheckUpdates: true,
    updateBehavior: 'ask-before-update',
    automaticSupported: false,
    lastAutoCheckDate: '2026-06-15',
    lastCheckedAt: null,
    lastResult: null,
  })
})

test('GET update reports a read-only host and HEAD stays bodyless', async () => {
  const readOnly = updateHarness({ writable: false })
  assert.equal((await (await updateGet(readOnly)).json()).writable, false)
  const head = await updateGet(readOnly, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  const rejected = await readOnly.handlers.update(new Request(UPDATE_URL, { method: 'PUT' }))
  assert.equal(rejected.status, 405)
  assert.equal(rejected.headers.get('allow'), 'GET, HEAD, POST')
})

test('an update POST with a malformed body or unknown action is rejected', async () => {
  const harness = updateHarness()
  const malformed = await updatePost(harness, '{not json')
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error, 'invalid-body')
  const unknown = await updatePost(harness, { action: 'install' })
  assert.equal(unknown.status, 400)
  assert.equal((await unknown.json()).error, 'unsupported-action')
})

test('a manual check reports up to date, update available, or failed', async () => {
  const available = updateHarness({ latestTag: 'v0.4.0' })
  const response = await updatePost(available, { action: 'check' })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.result, 'update-available')
  assert.equal(body.update.latestTag, 'v0.4.0')

  const current = updateHarness({ latestTag: 'v0.3.8' })
  assert.equal((await (await updatePost(current, { action: 'check' })).json()).result, 'up-to-date')

  const failed = updateHarness({ fail: true })
  const failedBody = await (await updatePost(failed, { action: 'check' })).json()
  assert.equal(failedBody.ok, false)
  assert.equal(failedBody.result, 'failed')
})

test('set-preferences persists valid values and rejects invalid ones', async () => {
  const harness = updateHarness()
  const ok = await updatePost(harness, { action: 'set-preferences', autoCheckUpdates: false, updateBehavior: 'notify-only' })
  assert.equal(ok.status, 200)
  const body = await ok.json()
  assert.equal(body.update.autoCheckUpdates, false)
  assert.equal(body.update.updateBehavior, 'notify-only')
  assert.deepEqual(harness.patches, [{ autoCheckUpdates: false, updateBehavior: 'notify-only' }])

  const invalid = await updatePost(harness, { action: 'set-preferences', updateBehavior: 'paranoid' })
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error, 'invalid-preferences')
})

test('dismiss persists a stable version and refuses anything else', async () => {
  const harness = updateHarness({ initial: { lastSeenLatestVersion: 'v0.4.0' } })
  const ok = await updatePost(harness, { action: 'dismiss', version: 'v0.4.0' })
  assert.equal(ok.status, 200)
  const body = await ok.json()
  assert.equal(body.update.dismissed, true)
  const bad = await updatePost(harness, { action: 'dismiss', version: 'main' })
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).error, 'invalid-version')
})

test('the update response carries only bounded update fields, never prompt or note text', async () => {
  const secret = 'PRIVATE-CUSTOM-REVIEWER-PROMPT'
  const harness = updateHarness({ initial: { lastSeenLatestVersion: 'v0.4.0' } })
  const text = await (await updateGet(harness)).text()
  assert.equal(text.includes(secret), false)
  const payload = JSON.parse(text)
  assert.deepEqual(Object.keys(payload).sort(), ['ok', 'update', 'writable'])
  assert.deepEqual(Object.keys(payload.update).sort(), [
    'autoCheckUpdates',
    'automaticSupported',
    'currentVersion',
    'dismissed',
    'dismissedVersion',
    'installSpec',
    'lastAutoCheckDate',
    'lastCheckedAt',
    'lastResult',
    'latestTag',
    'latestVersion',
    'source',
    'updateAvailable',
    'updateBehavior',
  ])
})

// --- Config schema and preservation ------------------------------------------

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

function engineWith(rawConfig = {}) {
  return createEngine({ config: normalizeConfig(rawConfig).config, getLlm: () => undefined })
}

function configPost(handlers, body) {
  return handlers.config(new Request('http://127.0.0.1/api/dsh-you-should-know/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

const PRESERVED = Object.freeze({
  autoCheckUpdates: false,
  updateBehavior: 'notify-only',
  lastAutoCheckDate: '2026-06-15',
  lastSeenLatestVersion: 'v0.4.0',
  dismissedUpdateVersion: 'v0.4.0',
})

test('an automatic reviewer save preserves the live update state across the replace', async () => {
  const settings = settingsDouble()
  const handlers = createConfigHandlers(engineWith(), { settings, preserveFields: () => ({ ...PRESERVED }) })
  const response = await configPost(handlers, { mode: 'automatic', minDeltaChars: 3, cooldownTurns: 4, maxContextMessages: 6, maxTokens: 256 })
  assert.equal(response.status, 200)
  assert.deepEqual(settings.replaces, [{
    key: 'you-should-know',
    section: { minDeltaChars: 3, cooldownTurns: 4, maxContextMessages: 6, maxTokens: 256, ...PRESERVED },
  }])
})

test('a pinned reviewer save merges, so the settings service preserves the update state itself', async () => {
  const llm = {
    resolveModelInfo: async (provider, model) => ({ provider, id: model }),
  }
  const engine = createEngine({ config: normalizeConfig({}).config, getLlm: () => llm })
  const settings = settingsDouble()
  const handlers = createConfigHandlers(engine, { getLlm: () => llm, settings, preserveFields: () => ({ ...PRESERVED }) })
  const response = await configPost(handlers, { mode: 'pinned', provider: 'alpha', model: 'a-model' })
  assert.equal(response.status, 200)
  assert.deepEqual(settings.updates[0].patch, { provider: 'alpha', model: 'a-model' })
})

test('the config GET carries the bounded update status only when the host wires one', async () => {
  const status = { currentVersion: '0.3.8', latestTag: 'v0.4.0', updateAvailable: true }
  const wired = createConfigHandlers(engineWith(), { settings: settingsDouble(), updateStatus: () => ({ ...status }) })
  const body = await (await wired.config(new Request('http://127.0.0.1/api/dsh-you-should-know/config', { method: 'GET' }))).json()
  assert.deepEqual(body.update, status)
  const plain = createConfigHandlers(engineWith(), { settings: settingsDouble() })
  const plainBody = await (await plain.config(new Request('http://127.0.0.1/api/dsh-you-should-know/config', { method: 'GET' }))).json()
  assert.equal('update' in plainBody, false)
})

test('without a preserve hook the reviewer patch is unchanged', async () => {
  const settings = settingsDouble()
  const handlers = createConfigHandlers(engineWith(), { settings })
  await configPost(handlers, { mode: 'automatic', minDeltaChars: 3, cooldownTurns: 4, maxContextMessages: 6, maxTokens: 256 })
  assert.deepEqual(settings.replaces[0].section, { minDeltaChars: 3, cooldownTurns: 4, maxContextMessages: 6, maxTokens: 256 })
})

test('the exported plugin version mirrors package.json', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(PLUGIN_VERSION, manifest.version)
  assert.equal(manifest.version, '0.4.2')
})

test('the Config schema declares the update fields with conservative defaults', () => {
  const defaults = Config({})
  assert.equal(defaults.autoCheckUpdates.get(), true)
  assert.equal(defaults.updateBehavior.get(), 'ask-before-update')
  assert.equal(defaults.lastAutoCheckDate.get(), '')
  assert.equal(defaults.lastSeenLatestVersion.get(), '')
  assert.equal(defaults.dismissedUpdateVersion.get(), '')
  assert.equal(Config({ autoCheckUpdates: false }).autoCheckUpdates.get(), false)
  assert.equal(Config({ updateBehavior: 'notify-only' }).updateBehavior.get(), 'notify-only')
  assert.equal(Config({ lastSeenLatestVersion: 'v0.4.0' }).lastSeenLatestVersion.get(), 'v0.4.0')
  assert.throws(() => Config({ updateBehavior: 'paranoid' }))
  assert.throws(() => Config({ autoCheckUpdates: 'yes' }))
})
