import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_EXPLANATION_CHARS,
  buildExplanationPrompt,
  buildExplanationSystemPrompt,
  parseExplanation,
} from '../lib/explain.js'
import { createEngine, normalizeConfig } from '../lib/core.js'

const REVIEW = '{"note":"The cache never clears.","importance":"high","source":{"path":"src/cache.ts","line":12}}'
const EXPLAIN = JSON.stringify({ explanation: 'The cache is populated but never invalidated, so stale data is served after a write.' })

function explanationStream(text) {
  return (async function* stream() {
    yield { type: 'text-delta', index: 0, text }
  })()
}

function harness(script) {
  const calls = []
  const errors = []
  const replies = [...script]
  const llm = {
    resolveModelInfo: (provider, model) => Promise.resolve({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      const reply = replies.length === 0 ? '{"note":null,"importance":null}' : replies.shift()
      if (reply instanceof Error) {
        return (async function* stream() {
          throw reply
        })()
      }
      return explanationStream(reply)
    },
  }
  const engine = createEngine({
    config: normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 }).config,
    getLlm: () => llm,
    now: () => 1700000000000,
    onError: (error) => errors.push(error),
  })
  return { engine, calls, errors }
}

function feedSession(id) {
  const events = []
  let seq = 0
  let turns = 0
  const session = { id, header: { id }, events, lastEvent: null }
  return {
    session,
    turn(question, answer) {
      turns += 1
      const turn = turns
      events.push({ type: 'user/message', seq: ++seq, data: { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: question }], source: { kind: 'user' } } })
      events.push({ type: 'assistant/message', seq: ++seq, data: { turn, step: 0, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: answer }], source: { kind: 'model' } }, stream: [] } })
      const end = { type: 'turn/end', seq: ++seq, data: { turn, reason: { kind: 'completed' } } }
      events.push(end)
      session.lastEvent = end
      return end
    },
  }
}

async function observe(engine, session, event) {
  const outcome = engine.observe(session, event)
  if (outcome.promise) return await outcome.promise
  return outcome
}

test('parseExplanation accepts exactly one bounded explanation object', () => {
  assert.equal(parseExplanation(JSON.stringify({ explanation: 'why it matters' })), 'why it matters')
  assert.equal(parseExplanation('  ' + JSON.stringify({ explanation: ' trimmed ' }) + ' '), 'trimmed')
  const oversized = parseExplanation(JSON.stringify({ explanation: 'x'.repeat(MAX_EXPLANATION_CHARS + 500) }))
  assert.equal(oversized.length, MAX_EXPLANATION_CHARS)
  for (const bad of [
    undefined, null, '', '   ', 'not json', '[]', '"text"', '42',
    JSON.stringify({}), JSON.stringify({ explanation: '' }), JSON.stringify({ explanation: 42 }),
    JSON.stringify({ explanation: null }), JSON.stringify({ note: 'x' }),
  ]) {
    assert.equal(parseExplanation(bad), null, 'must reject ' + JSON.stringify(bad))
  }
})

test('the explanation system prompt keeps the trusted English base and follows the language priority', () => {
  const base = buildExplanationSystemPrompt([{ role: 'user', text: 'hello' }])
  assert.match(base, /explain/i)
  assert.match(base, /never invent|do not invent/i)
  assert.match(base, /Response language:/)
  assert.match(base, /latest genuine human user message/)
  const host = buildExplanationSystemPrompt([{ role: 'user', text: 'hello' }], { hostLanguage: 'ja' })
  assert.match(host, /"ja"/)
  assert.equal(host.includes('latest genuine human user message'), false)
})

test('the explanation prompt embeds the finding, the excerpt, and the bounded evidence', () => {
  const prompt = buildExplanationPrompt({
    note: { note: 'The cache never clears.', importance: 'high', source: { path: 'src/cache.ts', line: 12 }, action: 'Invalidate the cache.' },
    excerpt: '[user]\nplease fix the cache',
    capsule: 'Episode evidence (untrusted metadata):\n- significant tools (1):\n  - edit',
  })
  assert.ok(prompt.includes('The cache never clears.'))
  assert.ok(prompt.includes('src/cache.ts:12'))
  assert.ok(prompt.includes('Invalidate the cache.'))
  assert.ok(prompt.includes('please fix the cache'))
  assert.ok(prompt.includes('BEGIN EPISODE EVIDENCE'))
  assert.ok(prompt.includes('edit'))
})

test('Explain makes one bounded call, caches the result, and never mutates the finding', async () => {
  const h = harness([REVIEW, EXPLAIN])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const note = h.engine.notes('s1')[0]
  assert.ok(note)
  const first = await h.engine.explain('s1', note.id)
  assert.equal(first.ok, true)
  assert.equal(first.cached, false)
  assert.match(first.explanation, /never invalidated/)
  assert.equal(h.calls.length, 2)
  const second = await h.engine.explain('s1', note.id)
  assert.equal(second.ok, true)
  assert.equal(second.cached, true)
  assert.equal(h.calls.length, 2, 'a successful explanation is cached')
  assert.equal(h.engine.notes('s1').length, 1)
  assert.equal(h.engine.history('s1')[0].resolved, false)
})

test('concurrent Explain calls for one note share a single provider call', async () => {
  const h = harness([REVIEW, EXPLAIN])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const note = h.engine.notes('s1')[0]
  const [a, b] = await Promise.all([h.engine.explain('s1', note.id), h.engine.explain('s1', note.id)])
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.equal(h.calls.length, 2, 'the in-flight explanation is shared')
})

test('a failed Explain is fail-quiet, leaves the finding active, and can be retried', async () => {
  const h = harness([REVIEW, new Error('provider down'), EXPLAIN])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const note = h.engine.notes('s1')[0]
  const failed = await h.engine.explain('s1', note.id)
  assert.equal(failed.ok, false)
  assert.equal(typeof failed.error, 'string')
  assert.equal(h.engine.notes('s1').length, 1, 'the finding stays active')
  assert.equal(h.engine.history('s1')[0].explanation, undefined)
  const retried = await h.engine.explain('s1', note.id)
  assert.equal(retried.ok, true)
  assert.equal(h.calls.length, 3, 'a failure does not poison the cache')
})

test('an unparsable Explain reply is a bounded failure and can be retried', async () => {
  const h = harness([REVIEW, 'not json at all', EXPLAIN])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const note = h.engine.notes('s1')[0]
  assert.equal((await h.engine.explain('s1', note.id)).ok, false)
  assert.equal((await h.engine.explain('s1', note.id)).ok, true)
})

test('Explain rejects an unknown session or note without a provider call', async () => {
  const h = harness([REVIEW])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  assert.equal((await h.engine.explain('s1', 'nope')).ok, false)
  assert.equal((await h.engine.explain('missing', 'nope')).ok, false)
  assert.equal(h.calls.length, 1)
})

test('Explain never injects, steers, or sends anything to the primary agent', async () => {
  const h = harness([REVIEW, EXPLAIN])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const note = h.engine.notes('s1')[0]
  await h.engine.explain('s1', note.id)
  for (const call of h.calls) {
    assert.equal(typeof call.provider, 'string')
    assert.equal(typeof call.system, 'string')
  }
})
