import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const SHIPPED = ['lib/core.js', 'lib/review-profile.js', 'lib/review-strictness.js', 'lib/index.js', 'lib/client.js']
const PUBLIC = ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE']

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

// Non-Latin script ranges: CJK/Kana, Hangul, Cyrillic, and Greek. English-only
// means these must never appear in shipped or public text, not just CJK.
const NON_LATIN = /[\u0370-\u03ff\u0400-\u04ff\u1100-\u11ff\u1f00-\u1fff\u3000-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/

/** Remove comments so prose about a forbidden shape never trips the scan. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// Delivery shapes that would wake, steer, or rewrite the primary agent, or
// write into the conversation transcript. The plugin must contain none of them.
const FORBIDDEN = [
  { label: 'agent.steer call', pattern: /\.steer\s*\(/ },
  { label: 'agent.followup call', pattern: /\.followup\s*\(/ },
  { label: 'agent.inject call', pattern: /\bagents?\s*\.\s*inject\s*\(/ },
  { label: 'agent registry access', pattern: /ctx\.agents\b/ },
  { label: 'agent.ctx access', pattern: /\.agent\.ctx\b/ },
  { label: 'inbox access', pattern: /\binbox\b/i },
  { label: 'session append', pattern: /(session|sessions)\.(append|push)\s*\(/ },
  { label: 'transcript access', pattern: /transcript/i },
  { label: 'system prompt tooling', pattern: /systemPrompt/ },
  { label: 'tool registration', pattern: /tools\.register\s*\(/ },
  { label: 'conversation node registration', pattern: /conversation\.chat\.node/ },
  { label: 'idle waiting', pattern: /\.whenIdle\s*\(/ },
]

test('shipped sources contain no path that could deliver advice to the primary agent', async () => {
  for (const path of SHIPPED) {
    const source = stripComments(await read(path))
    for (const { label, pattern } of FORBIDDEN) {
      assert.equal(pattern.test(source), false, `${path} contains ${label} (${pattern})`)
    }
  }
})

test('the plugin uses only the sanctioned seams', async () => {
  const index = await read('lib/index.js')
  const core = await read('lib/core.js')
  const client = await read('lib/client.js')

  assert.ok(index.includes("ctx.on('session/event'"), 'host observes committed session events')
  assert.ok(core.includes('llm.stream('), 'reviewer call goes through the LLM service stream')
  assert.ok(index.includes('connection.fetch.register('), 'notes are served over the connection Fetch carrier')
  assert.ok(client.includes("'api/dsh-you-should-know/notes'"), 'the notes poll is document-relative for the Desktop app origin')
  assert.ok(client.includes("'api/dsh-you-should-know/dismiss'"), 'the dismiss post is document-relative for the Desktop app origin')
  assert.ok(client.includes("'api/dsh-you-should-know/history'"), 'the history read is document-relative for the Desktop app origin')
  assert.equal(client.includes("'/dsh-you-should-know/"), false, 'no origin-root absolute route remains in the browser half')
  assert.ok(client.includes('conversation.input.dock'), 'the card lives in the composer-adjacent slot')
  assert.ok(client.includes("ctx.slots.inject("), 'the card registers through the slot system')
  assert.ok(!client.includes('localStorage'), 'resolution state stays in the page, not shared storage')
})

test('the browser half reaches files and the composer only through their public seams', async () => {
  const client = await read('lib/client.js')
  assert.ok(client.includes('openResource('), 'file navigation goes through the sidebar resource service')
  assert.ok(client.includes('dsh-resource://file/session/'), 'the file address follows the documented resource grammar')
  // Comments name the deferred-insertion seam to explain why it is not used;
  // the scan checks executable code only.
  const clientCode = stripComments(client)
  assert.ok(clientCode.includes('setDraft('), 'a draft edit goes through the public programmatic draft write')
  assert.equal(clientCode.includes('captureInsertion('), false, 'the deferred-insertion seam is not a programmatic draft write')
  assert.equal(clientCode.includes('insertText('), false, 'the deferred-insertion seam is not a programmatic draft write')
  for (const pattern of [/child_process/, /shell\.openPath/, /openExternal/, /window\.open/, /\bexec\s*\(/, /\bspawn\s*\(/, /\.submit\s*\(/]) {
    assert.equal(pattern.test(client), false, 'lib/client.js contains an escape hatch (' + pattern + ')')
  }
})

test('Add to chat can only compose the draft and never hands the action to the agent', async () => {
  const client = stripComments(await read('lib/client.js'))
  assert.ok(client.includes('Fix this reviewer finding:'), 'the actionless fallback is an imperative repair wrapper')
  assert.ok(client.includes('noteActionOf('), 'the action is the preferred draft source')
  for (const { label, pattern } of FORBIDDEN) {
    assert.equal(pattern.test(client), false, 'Add to chat must not reach the agent: ' + label)
  }
  assert.equal(/\.submit\s*\(/.test(client), false, 'Add to chat must not auto-send the draft')
})

test('the English-only scan rejects Cyrillic, Greek, and CJK text', () => {
  for (const sample of ['Привет', 'Ελληνικά', '日本語', '한국어']) {
    assert.equal(NON_LATIN.test(sample), true, `${sample} must be flagged as non-English`)
  }
  assert.equal(NON_LATIN.test('plain english text'), false)
})

test('public-facing text stays English-only and free of unrelated project references', async () => {
  const unrelated = [/\bozon\b/i, /chatgpt/i, /new-reg-ozon/i, /\bloto\b/i, /\bairo\b/i, /O-komplex/i, /immutable evidence/i]
  for (const path of [...SHIPPED, ...PUBLIC]) {
    const source = await read(path)
    assert.equal(NON_LATIN.test(source), false, `${path} contains non-English text`)
    for (const pattern of unrelated) {
      assert.equal(pattern.test(source), false, `${path} references an unrelated project (${pattern})`)
    }
  }
})

test('the bundled row leaves the reviewer route to adaptive discovery', async () => {
  const patch = await read('cordis.patch.yml')
  assert.equal(/^\s*provider\s*:/m.test(patch), false, 'the bundled row must not pin a provider')
  assert.equal(/^\s*model\s*:/m.test(patch), false, 'the bundled row must not pin a model')
})

test('the manifest declares the bundle, the client half, and no build step', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.name, 'dsh-you-should-know')
  assert.equal(manifest.version, '0.3.7')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.dsh.manifestVersion, 1)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.scripts.prepare, undefined, 'a git install must not need a build')
  assert.equal(manifest.dependencies, undefined, 'the plugin must stay dependency-free')
  for (const file of ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
    assert.ok(manifest.files.includes(file), `files must include ${file}`)
  }
})
