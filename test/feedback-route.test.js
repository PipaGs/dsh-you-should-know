import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, createFetchHandlers, normalizeConfig } from '../lib/core.js'

const REVIEW = '{"note":"The cache never clears.","importance":"high"}'
const EXPLAIN = JSON.stringify({ explanation: 'Stale data is served because the cache is never invalidated.' })

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
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: reply }
      })()
    },
  }
  const engine = createEngine({
    config: normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 }).config,
    getLlm: () => llm,
    now: () => 1700000000000,
    onError: (error) => errors.push(error),
  })
  return { engine, handlers: createFetchHandlers(engine), calls, errors }
}

function sessionEvent(id, turn = 1) {
  return {
    type: 'turn/end',
    seq: turn * 3,
    data: { turn, reason: { kind: 'completed' } },
  }
}

function sessionWith(id, answer = 'work') {
  const events = [
    { type: 'user/message', seq: 1, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'do work' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: answer }], source: { kind: 'model' } }, stream: [] } },
    sessionEvent(id, 1),
  ]
  return { id, header: { id }, events, lastEvent: events[2] }
}

function post(handler, body) {
  return handler(new Request('http://127.0.0.1/api/dsh-you-should-know/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

async function noted(h, id = 's1') {
  const session = sessionWith(id)
  const outcome = h.engine.observe(session, session.lastEvent)
  if (outcome.promise) await outcome.promise
  return h.engine.notes(id)[0]
}

test('the dismiss route accepts the two feedback resolutions and keeps them distinct in history', async () => {
  const h = harness([REVIEW, REVIEW, REVIEW, REVIEW])
  const first = await noted(h, 's1')
  const knew = await post(h.handlers.dismiss, { sessionId: 's1', noteId: first.id, action: 'knew_it' })
  assert.equal(knew.status, 200)
  assert.deepEqual(await knew.json(), { ok: true, resolved: true, resolution: 'knew_it' })

  // A second, different finding is needed for Thanks.
  const feed2 = sessionWith('s2')
  const outcome = h.engine.observe(feed2, feed2.lastEvent)
  if (outcome.promise) await outcome.promise
  const second = h.engine.notes('s2')[0]
  const thanks = await post(h.handlers.dismiss, { sessionId: 's2', noteId: second.id, action: 'thanks' })
  assert.deepEqual(await thanks.json(), { ok: true, resolved: true, resolution: 'thanks' })

  assert.equal(h.engine.history('s1')[0].resolution, 'knew_it')
  assert.equal(h.engine.history('s2')[0].resolution, 'thanks')
})

test('the dismiss route keeps the legacy dismissal and rejects an unknown action', async () => {
  const h = harness([REVIEW])
  const note = await noted(h)
  const legacy = await post(h.handlers.dismiss, { sessionId: 's1', noteId: note.id })
  assert.deepEqual(await legacy.json(), { ok: true, dismissed: true })
  const unknown = await post(h.handlers.dismiss, { sessionId: 's1', noteId: note.id, action: 'nope' })
  assert.equal(unknown.status, 400)
  assert.deepEqual(await unknown.json(), { ok: false, error: 'invalid-action' })
})

test('the explain route returns one bounded explanation and then a cached one', async () => {
  const h = harness([REVIEW, EXPLAIN])
  const note = await noted(h)
  const first = await post(h.handlers.explain, { sessionId: 's1', noteId: note.id })
  assert.equal(first.status, 200)
  const firstBody = await first.json()
  assert.equal(firstBody.ok, true)
  assert.equal(firstBody.cached, false)
  assert.match(firstBody.explanation, /never invalidated/)

  const second = await post(h.handlers.explain, { sessionId: 's1', noteId: note.id })
  assert.deepEqual((await second.json()).cached, true)
  assert.equal(h.calls.length, 2)

  const history = h.engine.history('s1')[0]
  assert.match(history.explanation, /never invalidated/)
  assert.equal(history.resolved, false, 'Explain never resolves the finding')
})

test('the explain route is fail-quiet and retryable, and rejects bad targets', async () => {
  const h = harness([REVIEW, new Error('provider down'), EXPLAIN])
  const note = await noted(h)
  const failed = await post(h.handlers.explain, { sessionId: 's1', noteId: note.id })
  assert.equal(failed.status, 200)
  assert.equal((await failed.json()).ok, false)
  assert.equal(h.engine.notes('s1').length, 1)
  const retried = await post(h.handlers.explain, { sessionId: 's1', noteId: note.id })
  assert.equal((await retried.json()).ok, true)

  const unknown = await post(h.handlers.explain, { sessionId: 's1', noteId: 'missing' })
  assert.equal(unknown.status, 404)
  const invalid = await post(h.handlers.explain, { sessionId: '', noteId: '' })
  assert.equal(invalid.status, 400)
  const wrongMethod = await h.handlers.explain(new Request('http://127.0.0.1/x', { method: 'GET' }))
  assert.equal(wrongMethod.status, 405)
})

test('the status route exposes only harmless adaptive counters and no finding text', async () => {
  const h = harness([REVIEW])
  const note = await noted(h)
  await post(h.handlers.dismiss, { sessionId: 's1', noteId: note.id, action: 'knew_it' })
  const response = await h.handlers.status(new Request('http://127.0.0.1/api/dsh-you-should-know/status?sessionId=s1', { method: 'GET' }))
  const text = await response.text()
  assert.equal(text.includes('The cache never clears.'), false, 'no finding text in diagnostics')
  const body = JSON.parse(text)
  assert.equal(body.session.knownFingerprintCount, 1)
  assert.equal(typeof body.session.quietStreak, 'number')
  assert.equal(typeof body.session.reviewerBudgetRemaining, 'number')
})
