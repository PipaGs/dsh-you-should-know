import test from 'node:test'
import assert from 'node:assert/strict'
import { createConfigHandlers, createEngine, createFetchHandlers, normalizeConfig } from '../lib/core.js'

const ROW_ID = 'you-should-know'

/** An LLM double with a two-provider registry and metadata validation. */
function catalogLlm(overrides = {}) {
  const resolveCalls = []
  const llm = {
    resolveCalls,
    listProviders() {
      return [
        { id: 'zeta', name: 'Zeta' },
        { id: 'alpha', name: 'Alpha' },
        { id: 'deepseek-official', name: 'DeepSeek' },
      ]
    },
    async listModels(provider) {
      if (provider === 'alpha') return [{ id: 'b-model' }, { id: 'a-model' }]
      if (provider === 'zeta') return [{ id: 'z2' }, { id: 'z1' }]
      return [{ id: 'deepseek-flash' }]
    },
    resolveModelInfo(provider, model) {
      resolveCalls.push([provider, model])
      if (provider === 'bad' || model === 'bad-model') return Promise.reject(new Error('NOT_FOUND'))
      return Promise.resolve({ provider, id: model, name: model })
    },
    ...overrides,
  }
  return llm
}

/** A settings service double that records settings.update and settings.replace calls. */
function settingsDouble(options = {}) {
  const updates = []
  const replaces = []
  const settings = {
    updates,
    replaces,
    update(key, patch) {
      if (options.fail === true) return Promise.reject(new Error('settings are read-only'))
      updates.push({ key, patch })
      return Promise.resolve()
    },
    replace(key, section) {
      if (options.fail === true) return Promise.reject(new Error('settings are read-only'))
      replaces.push({ key, section })
      return Promise.resolve()
    },
  }
  return settings
}

function engineWith(rawConfig = { minDeltaChars: 0, cooldownTurns: 1 }) {
  const llm = catalogLlm()
  const engine = createEngine({ config: normalizeConfig(rawConfig).config, getLlm: () => llm })
  return { engine, llm }
}

function handlersFor(engine, options = {}) {
  return createConfigHandlers(engine, {
    getLlm: options.getLlm || (() => catalogLlm()),
    settings: options.settings,
    validationDeadlineMs: options.validationDeadlineMs,
  })
}

function get(handlers, method = 'GET') {
  return handlers.config(new Request('http://127.0.0.1/api/dsh-you-should-know/config', { method }))
}

function post(handlers, body) {
  return handlers.config(new Request('http://127.0.0.1/api/dsh-you-should-know/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

test('GET config returns the live config, a sorted deduped catalog, and writability', async () => {
  const { engine } = engineWith({ provider: 'alpha', model: 'a-model', minDeltaChars: 5, cooldownTurns: 2 })
  const handlers = handlersFor(engine, { settings: settingsDouble() })
  const response = await get(handlers)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.writable, true)
  assert.deepEqual(body.config, {
    mode: 'pinned',
    provider: 'alpha',
    model: 'a-model',
    reviewerMode: 'balanced',
    additionalInstructions: '',
    customReviewerPrompt: '',
    minDeltaChars: 5,
    cooldownTurns: 2,
    maxContextMessages: 12,
    maxTokens: 768,
    maxReviewerCallsPerHour: 12,
  })
  assert.deepEqual(body.catalog, {
    providers: [
      { id: 'alpha', models: ['a-model', 'b-model'] },
      { id: 'deepseek-official', models: ['deepseek-flash'] },
      { id: 'zeta', models: ['z1', 'z2'] },
    ],
  })
})

test('GET config never dumps credentials, names, or entry metadata', async () => {
  const secret = 'PRIVATE-CREDENTIAL-77'
  const llm = catalogLlm({
    name: secret,
    apiKey: secret,
    listProviders: () => [{ id: 'alpha', name: secret, apiKey: secret, metadata: { token: secret } }],
    listModels: async () => [{ id: 'a-model', name: secret, apiKey: secret, raw: { secret } }],
  })
  const engine = createEngine({ config: normalizeConfig({ provider: 'alpha', model: 'a-model' }).config, getLlm: () => llm })
  const handlers = handlersFor(engine, { getLlm: () => llm, settings: settingsDouble() })
  const text = await (await get(handlers)).text()
  assert.equal(text.includes(secret), false)
  assert.deepEqual(JSON.parse(text).catalog.providers, [{ id: 'alpha', models: ['a-model'] }])
})

test('GET config reports writable false and an empty catalog without any llm service', async () => {
  const { engine } = engineWith()
  const handlers = handlersFor(engine, { getLlm: () => undefined, settings: undefined })
  const body = await (await get(handlers)).json()
  assert.equal(body.writable, false)
  assert.deepEqual(body.catalog, { providers: [] })
  assert.equal(body.config.mode, 'automatic')
  assert.equal(body.config.provider, undefined, 'automatic mode omits provider/model')
  assert.equal(body.config.model, undefined)
})

test('HEAD config is bodyless and an unsupported method is 405 with allow', async () => {
  const { engine } = engineWith()
  const handlers = handlersFor(engine, { settings: settingsDouble() })
  const head = await get(handlers, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')

  const put = await handlers.config(new Request('http://127.0.0.1/api/dsh-you-should-know/config', { method: 'PUT' }))
  assert.equal(put.status, 405)
  assert.equal(put.headers.get('allow'), 'GET, HEAD, POST')
})

test('POST automatic clears the pinned route, persists the row patch, and updates the live engine', async () => {
  const { engine } = engineWith({ provider: 'alpha', model: 'a-model', minDeltaChars: 0, cooldownTurns: 1 })
  const settings = settingsDouble()
  const handlers = handlersFor(engine, { settings })
  const response = await post(handlers, { mode: 'automatic', minDeltaChars: 3, cooldownTurns: 4, maxContextMessages: 6, maxTokens: 256 })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.config.mode, 'automatic')
  assert.equal(body.config.provider, undefined)
  assert.deepEqual(settings.updates, [], 'automatic mode must not merge a stale pin back in')
  assert.deepEqual(settings.replaces, [{
    key: ROW_ID,
    section: { minDeltaChars: 3, cooldownTurns: 4, maxContextMessages: 6, maxTokens: 256 },
  }])
  assert.deepEqual(engine.config(), {
    provider: '',
    model: '',
    disabled: false,
    reviewerMode: 'balanced',
    additionalInstructions: '',
    customReviewerPrompt: '',
    minDeltaChars: 3,
    cooldownTurns: 4,
    maxContextMessages: 6,
    maxTokens: 256,
    maxReviewerCallsPerHour: 12,
  })
})

test('POST pinned validates through resolveModelInfo before persistence and updates the live engine', async () => {
  const { engine, llm } = engineWith()
  const settings = settingsDouble()
  const handlers = handlersFor(engine, { getLlm: () => llm, settings })
  const response = await post(handlers, { mode: 'pinned', provider: 'alpha', model: 'a-model', maxTokens: 300 })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.config.mode, 'pinned')
  assert.deepEqual([body.config.provider, body.config.model], ['alpha', 'a-model'])
  assert.deepEqual(llm.resolveCalls, [['alpha', 'a-model']])
  assert.deepEqual(settings.updates[0].patch.provider, 'alpha')
  assert.deepEqual(settings.updates[0].patch.model, 'a-model')
  assert.deepEqual(engine.config(), {
    provider: 'alpha',
    model: 'a-model',
    disabled: false,
    reviewerMode: 'balanced',
    additionalInstructions: '',
    customReviewerPrompt: '',
    minDeltaChars: 1200,
    cooldownTurns: 3,
    maxContextMessages: 12,
    maxTokens: 300,
    maxReviewerCallsPerHour: 12,
  })
})

test('POST rejects an out-of-range field, a malformed body, and unknown modes without touching the engine', async () => {
  const { engine, llm } = engineWith({ provider: 'alpha', model: 'a-model' })
  const settings = settingsDouble()
  const handlers = handlersFor(engine, { getLlm: () => llm, settings })

  const huge = await post(handlers, { mode: 'automatic', maxTokens: 999999 })
  assert.equal(huge.status, 400)
  assert.deepEqual(await huge.json(), { ok: false, error: 'invalid-config' })

  const mode = await post(handlers, { mode: 'sometimes' })
  assert.equal(mode.status, 400)
  assert.deepEqual(await mode.json(), { ok: false, error: 'invalid-config' })

  const body = await post(handlers, 'not json')
  assert.equal(body.status, 400)
  assert.deepEqual(await body.json(), { ok: false, error: 'invalid-body' })

  assert.deepEqual(settings.updates, [], 'no invalid request is ever persisted')
  assert.deepEqual(settings.replaces, [], 'no invalid request is ever replaced')
  assert.deepEqual(engine.config(), normalizeConfig({ provider: 'alpha', model: 'a-model' }).config)
})

test('POST pinned requires both route halves nonblank', async () => {
  const { engine, llm } = engineWith()
  const handlers = handlersFor(engine, { getLlm: () => llm, settings: settingsDouble() })
  for (const payload of [
    { mode: 'pinned', provider: 'alpha' },
    { mode: 'pinned', model: 'a-model' },
    { mode: 'pinned', provider: '  ', model: 'a-model' },
    { mode: 'pinned', provider: 'alpha', model: '   ' },
  ]) {
    const response = await post(handlers, payload)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { ok: false, error: 'invalid-route' })
  }
  assert.equal(engine.config().provider, '')
})

test('POST pinned rejects an unresolvable route without persisting or changing the engine', async () => {
  const { engine, llm } = engineWith({ provider: 'alpha', model: 'a-model' })
  const settings = settingsDouble()
  const handlers = handlersFor(engine, { getLlm: () => llm, settings })
  const response = await post(handlers, { mode: 'pinned', provider: 'alpha', model: 'bad-model' })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { ok: false, error: 'unresolvable' })
  assert.deepEqual(settings.updates, [])
  assert.deepEqual(engine.config(), normalizeConfig({ provider: 'alpha', model: 'a-model' }).config)
})

test('POST pinned bounds a route lookup that exceeds its deadline', async () => {
  const llm = catalogLlm({ resolveModelInfo: () => new Promise(() => {}) })
  const engine = createEngine({ config: normalizeConfig({ provider: 'alpha', model: 'a-model' }).config, getLlm: () => llm })
  const handlers = handlersFor(engine, { getLlm: () => llm, settings: settingsDouble(), validationDeadlineMs: 10 })
  const response = await post(handlers, { mode: 'pinned', provider: 'slow', model: 'model-slow' })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { ok: false, error: 'timeout' })
})

test('GET reports writable false when no settings service is mounted, and POST does not mutate the engine', async () => {
  const { engine, llm } = engineWith({ provider: 'alpha', model: 'a-model' })
  const handlers = handlersFor(engine, { getLlm: () => llm, settings: undefined })
  assert.equal((await (await get(handlers)).json()).writable, false)
  const response = await post(handlers, { mode: 'pinned', provider: 'alpha', model: 'a-model' })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { ok: false, error: 'settings-unavailable' })
  assert.deepEqual(engine.config(), normalizeConfig({ provider: 'alpha', model: 'a-model' }).config)
})

test('a settings read-only failure becomes a bounded error and leaves the live config unchanged', async () => {
  const { engine, llm } = engineWith({ provider: 'alpha', model: 'a-model' })
  const settings = settingsDouble({ fail: true })
  const handlers = handlersFor(engine, { getLlm: () => llm, settings })
  const response = await post(handlers, { mode: 'automatic' })
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { ok: false, error: 'read-only' })
  assert.deepEqual(settings.updates, [])
  assert.deepEqual(settings.replaces, [])
  assert.deepEqual(engine.config(), normalizeConfig({ provider: 'alpha', model: 'a-model' }).config)
})

test('a live config change reaches running sessions without a restart', async () => {
  const { engine, llm } = engineWith()
  const handlers = handlersFor(engine, { getLlm: () => llm, settings: settingsDouble() })
  assert.equal(engine.sessionConfig('s1').effectiveRouteSource, 'automatic')
  const response = await post(handlers, { mode: 'pinned', provider: 'alpha', model: 'a-model' })
  assert.equal(response.status, 200)
  const view = engine.sessionConfig('s1')
  assert.equal(view.effectiveRouteSource, 'global')
  assert.deepEqual(view.effectiveRoute, { provider: 'alpha', model: 'a-model' })
})

test('the plugin mounts the conditional settings integration only when ctx.settings exists', () => {
  const { engine } = engineWith()
  const withSettings = createConfigHandlers(engine, {
    getLlm: () => undefined,
    settings: settingsDouble(),
  })
  assert.equal(withSettings.writable(), true)
  const withoutSettings = createConfigHandlers(engine, { getLlm: () => undefined })
  assert.equal(withoutSettings.writable(), false)
  const withoutUpdate = createConfigHandlers(engine, { getLlm: () => undefined, settings: {} })
  assert.equal(withoutUpdate.writable(), false)
})

test('the config route turns an unexpected engine failure into a bounded 500', async () => {
  const engine = {
    config() {
      throw new Error('boom')
    },
  }
  const handlers = createConfigHandlers(engine, { getLlm: () => undefined, settings: settingsDouble() })
  const response = await get(handlers)
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { ok: false, error: 'internal' })
})

// --- Reviewer strictness mode config ------------------------------------------

test('POST persists the reviewer mode and additional instructions, and GET returns them', async () => {
  const { engine } = engineWith()
  const settings = settingsDouble()
  const handlers = handlersFor(engine, { settings })
  const text = '  Watch for partial writes.\nKeep exact.  '
  const response = await post(handlers, { mode: 'automatic', reviewerMode: 'paranoid', additionalInstructions: text })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.config.reviewerMode, 'paranoid')
  assert.equal(body.config.additionalInstructions, text)
  assert.equal(engine.config().reviewerMode, 'paranoid')
  assert.equal(engine.config().additionalInstructions, text)
  assert.deepEqual(settings.replaces[0].section, { reviewerMode: 'paranoid', additionalInstructions: text })
})

test('POST rejects an unknown reviewer mode without persisting or changing the engine', async () => {
  const { engine } = engineWith({ provider: 'alpha', model: 'a-model' })
  const settings = settingsDouble()
  const handlers = handlersFor(engine, { getLlm: () => catalogLlm(), settings })
  const response = await post(handlers, { mode: 'automatic', reviewerMode: 'loose' })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { ok: false, error: 'invalid-config' })
  assert.deepEqual(settings.replaces, [])
  assert.equal(engine.config().reviewerMode, 'balanced')
})

test('POST rejects an oversized additional-instructions string without persisting', async () => {
  const { engine } = engineWith()
  const settings = settingsDouble()
  const handlers = handlersFor(engine, { settings })
  const response = await post(handlers, { mode: 'automatic', additionalInstructions: 'x'.repeat(2001) })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { ok: false, error: 'invalid-config' })
  assert.deepEqual(settings.replaces, [])
})

test('the settings read carries the instructions while the status diagnostics never do', async () => {
  const secret = 'PRIVATE-INSTRUCTION-77'
  const { engine } = engineWith({ reviewerMode: 'custom', additionalInstructions: secret })
  const handlers = handlersFor(engine, { settings: settingsDouble() })
  const configText = await (await get(handlers)).text()
  assert.ok(configText.includes(secret), 'the settings form can render the editable text')
  const statusHandlers = createFetchHandlers(engine)
  const statusResponse = await statusHandlers.status(new Request('http://127.0.0.1/api/dsh-you-should-know/status?sessionId=s1', { method: 'GET' }))
  const statusText = await statusResponse.text()
  assert.equal(statusText.includes(secret), false, 'status stays diagnostic only')
  assert.equal(JSON.parse(statusText).reviewerMode, 'custom')
})

// --- Custom reviewer prompt config --------------------------------------------

test('POST persists the custom reviewer prompt and GET returns it for the settings form', async () => {
  const { engine } = engineWith()
  const settings = settingsDouble()
  const handlers = handlersFor(engine, { settings })
  const text = '  Custom strictness profile text.  '
  const response = await post(handlers, {
    mode: 'automatic',
    minDeltaChars: 0,
    cooldownTurns: 1,
    reviewerMode: 'custom',
    customReviewerPrompt: text,
    additionalInstructions: 'overlay',
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.config.customReviewerPrompt, text)
  assert.equal(body.config.additionalInstructions, 'overlay')
  assert.equal(engine.config().customReviewerPrompt, text)
  assert.equal(settings.replaces[0].section.customReviewerPrompt, text)
})

test('POST rejects an invalid or oversized custom reviewer prompt without persisting', async () => {
  const { engine } = engineWith()
  const settings = settingsDouble()
  const handlers = handlersFor(engine, { settings })
  const wrongType = await post(handlers, { mode: 'automatic', customReviewerPrompt: 42 })
  assert.equal(wrongType.status, 400)
  assert.deepEqual(await wrongType.json(), { ok: false, error: 'invalid-config' })
  const oversized = await post(handlers, { mode: 'automatic', customReviewerPrompt: 'x'.repeat(4001) })
  assert.equal(oversized.status, 400)
  assert.deepEqual(await oversized.json(), { ok: false, error: 'invalid-config' })
  assert.deepEqual(settings.replaces, [])
  assert.deepEqual(settings.updates, [])
})

test('a persisted custom reviewer prompt survives a reload through the host row', async () => {
  const settings = settingsDouble()
  const text = 'RELOAD-MARKER custom strictness profile'
  const first = engineWith()
  const handlers = handlersFor(first.engine, { getLlm: () => catalogLlm(), settings })
  await post(handlers, { mode: 'automatic', minDeltaChars: 0, cooldownTurns: 1, reviewerMode: 'custom', customReviewerPrompt: text })
  const persisted = settings.replaces[0].section
  // A fresh engine built from the persisted row is the restart equivalent.
  const reloaded = createEngine({ config: normalizeConfig(persisted).config, getLlm: () => catalogLlm() })
  assert.equal(reloaded.config().customReviewerPrompt, text)
  assert.equal(reloaded.sessionConfig('s1').effectiveMode, 'custom')
  assert.equal('customReviewerPrompt' in reloaded.status('s1'), false, 'status stays diagnostic only')
})

test('the status and session routes never leak the custom reviewer prompt', async () => {
  const secret = 'PRIVATE-CUSTOM-ROUTE-77'
  const { engine } = engineWith({ reviewerMode: 'custom', customReviewerPrompt: secret })
  const handlers = createFetchHandlers(engine)
  const statusText = await (await handlers.status(new Request('http://127.0.0.1/api/dsh-you-should-know/status?sessionId=s1', { method: 'GET' }))).text()
  const sessionText = await (await handlers.session(new Request('http://127.0.0.1/api/dsh-you-should-know/session?sessionId=s1', { method: 'GET' }))).text()
  assert.equal(statusText.includes(secret), false)
  assert.equal(sessionText.includes(secret), false)
  assert.equal('customReviewerPrompt' in JSON.parse(statusText), false)
})
