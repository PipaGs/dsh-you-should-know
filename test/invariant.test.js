import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const SHIPPED = ['lib/core.js', 'lib/index.js', 'lib/client.js']
const PUBLIC = ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE']

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

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
  assert.ok(index.includes('webServer.register('), 'notes are served over the local web server')
  assert.ok(client.includes('conversation.input.dock'), 'the card lives in the composer-adjacent slot')
  assert.ok(client.includes("ctx.slots.inject("), 'the card registers through the slot system')
  assert.ok(!client.includes('localStorage'), 'dismissal state stays in the page, not shared storage')
})

test('public-facing text stays English-only and free of unrelated project references', async () => {
  const cjk = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/
  const unrelated = [/\bozon\b/i, /chatgpt/i, /new-reg-ozon/i, /\bloto\b/i, /\bairo\b/i, /O-komplex/i, /immutable evidence/i]
  for (const path of [...SHIPPED, ...PUBLIC]) {
    const source = await read(path)
    assert.equal(cjk.test(source), false, `${path} contains non-English (CJK) text`)
    for (const pattern of unrelated) {
      assert.equal(pattern.test(source), false, `${path} references an unrelated project (${pattern})`)
    }
  }
})

test('the manifest declares the bundle, the client half, and no build step', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.name, 'dsh-you-should-know')
  assert.equal(manifest.version, '0.2.0')
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
