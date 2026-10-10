import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, normalizeConfig } from '../lib/core.js'
import { REVIEWER_HOURLY_WINDOW_MS } from '../lib/adaptive.js'

const SILENT = '{"note":null,"importance":null}'

function note(text) {
  return JSON.stringify({ note: text, importance: 'high' })
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

function harness(script, overrides = {}) {
  const calls = []
  const errors = []
  let now = 1_700_000_000_000
  const replies = [...script]
  const llm = {
    resolveModelInfo: (provider, model) => Promise.resolve({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      const reply = replies.length === 0 ? SILENT : replies.shift()
      const text = reply === null ? SILENT : reply
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text }
      })()
    },
  }
  const engine = createEngine({
    config: normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1, maxReviewerCallsPerHour: 60, ...overrides }).config,
    getLlm: () => llm,
    now: () => now,
    onError: (error) => errors.push(error),
  })
  return {
    engine,
    calls,
    errors,
    setNow: (value) => { now = value },
    advance: (delta) => { now += delta },
  }
}

async function observe(engine, session, event) {
  const outcome = engine.observe(session, event)
  if (outcome.promise) return await outcome.promise
  return outcome
}

test('Knew it resolves the exact note with its own state and suppresses the same fingerprint', async () => {
  const h = harness([note('The cache never clears.'), note('The cache never clears.')])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const active = h.engine.notes('s1')
  assert.equal(active.length, 1)
  assert.equal(h.engine.resolve('s1', active[0].id, 'knew_it'), true)
  const history = h.engine.history('s1')
  assert.equal(history[0].resolved, true)
  assert.equal(history[0].resolution, 'knew_it')
  // The same fingerprint is suppressed for the rest of the session without
  // becoming active again; the provider was still consulted for the new turn.
  const outcome = await observe(h.engine, feed.session, feed.turn('q2', 'a2'))
  assert.equal(outcome.status, 'suppressed')
  assert.equal(h.engine.notes('s1').length, 0)
  assert.equal(h.engine.history('s1').length, 1, 'a suppressed finding is never stored')
})

test('Knew it suppresses a near-duplicate finding that exact delivery dedupe would not', async () => {
  const h = harness([note('The cache never clears.'), note('The cache never clears when the session ends.')])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const first = h.engine.notes('s1')[0]
  assert.equal(h.engine.resolve('s1', first.id, 'knew_it'), true)
  const outcome = await observe(h.engine, feed.session, feed.turn('q2', 'a2'))
  assert.equal(outcome.status, 'suppressed')
  assert.equal(h.engine.notes('s1').length, 0)
  assert.equal(h.engine.history('s1').length, 1)
})

test('a near-duplicate remains eligible when the human did not mark the finding known', async () => {
  const h = harness([note('The cache never clears.'), note('The cache never clears when the session ends.')])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  // No Knew it: the reworded finding is a genuinely new note, so it is stored.
  const outcome = await observe(h.engine, feed.session, feed.turn('q2', 'a2'))
  assert.equal(outcome.status, 'noted')
  assert.equal(h.engine.notes('s1').length, 2)
})

test('an unrelated finding remains eligible after a Knew it', async () => {
  const h = harness([note('The cache never clears.'), note('The retry drops the error.'), note('The cache never clears.')])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const first = h.engine.notes('s1')[0]
  assert.equal(h.engine.resolve('s1', first.id, 'knew_it'), true)
  await observe(h.engine, feed.session, feed.turn('q2', 'a2'))
  const active = h.engine.notes('s1')
  assert.equal(active.length, 1)
  assert.equal(active[0].note, 'The retry drops the error.')
  // The suppressed finding stays suppressed on a later turn, and the known
  // fingerprint is what answers first (not the ordinary delivery dedupe).
  const outcome = await observe(h.engine, feed.session, feed.turn('q3', 'a3'))
  assert.equal(outcome.status, 'suppressed')
  assert.equal(h.engine.notes('s1').length, 1)
})

test('Thanks and a successful Add to chat reset the quiet streak; Dismiss does not', async () => {
  const h = harness([note('Note A.'), note('Note B.'), note('Note C.'), SILENT, SILENT])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  await observe(h.engine, feed.session, feed.turn('q2', 'a2'))
  await observe(h.engine, feed.session, feed.turn('q3', 'a3'))
  const [a, b, c] = h.engine.notes('s1')
  // One silent review grows the streak.
  const silent = await observe(h.engine, feed.session, feed.turn('q4', 'a4'))
  assert.equal(silent.status, 'silent')
  assert.equal(h.engine.status('s1').session.quietStreak, 1)
  assert.equal(h.engine.resolve('s1', a.id, 'dismissed'), true)
  assert.equal(h.engine.status('s1').session.quietStreak, 1, 'Dismiss is not a useful discovery')
  assert.equal(h.engine.resolve('s1', b.id, 'added_to_chat'), true)
  assert.equal(h.engine.status('s1').session.quietStreak, 0, 'Add to chat resets backoff')
  const silent2 = await observe(h.engine, feed.session, feed.turn('q5', 'a5'))
  assert.equal(silent2.status, 'silent')
  assert.equal(h.engine.status('s1').session.quietStreak, 1)
  assert.equal(h.engine.resolve('s1', c.id, 'thanks'), true)
  assert.equal(h.engine.status('s1').session.quietStreak, 0, 'Thanks resets backoff')
})

test('Knew it does not reset the quiet streak as a useful discovery', async () => {
  const h = harness([note('Note A.'), note('Note B.'), SILENT])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  await observe(h.engine, feed.session, feed.turn('q2', 'a2'))
  await observe(h.engine, feed.session, feed.turn('q3', 'a3'))
  assert.equal(h.engine.status('s1').session.quietStreak, 1)
  const [a] = h.engine.notes('s1')
  assert.equal(h.engine.resolve('s1', a.id, 'knew_it'), true)
  assert.equal(h.engine.status('s1').session.quietStreak, 1)
})

test('the hourly budget stops provider calls once a session reaches its cap', async () => {
  const h = harness([note('Note A.'), note('Note B.'), note('Note C.')], { maxReviewerCallsPerHour: 2 })
  const feed = feedSession('s1')
  assert.equal((await observe(h.engine, feed.session, feed.turn('q1', 'a1'))).status, 'noted')
  assert.equal((await observe(h.engine, feed.session, feed.turn('q2', 'a2'))).status, 'noted')
  const limited = await observe(h.engine, feed.session, feed.turn('q3', 'a3'))
  assert.equal(limited.status, 'rate_limited')
  assert.equal(h.calls.length, 2, 'a skipped review never reaches the provider')
  const status = h.engine.status('s1').session
  assert.equal(status.reviewerCallsLastHour, 2)
  assert.equal(status.reviewerBudgetRemaining, 0)
  // One full window later the budget frees up again.
  h.advance(REVIEWER_HOURLY_WINDOW_MS + 1)
  assert.equal((await observe(h.engine, feed.session, feed.turn('q4', 'a4'))).status, 'noted')
  assert.equal(h.calls.length, 3)
})

test('consecutive quiet verdicts grow the effective cooldown deterministically', async () => {
  const h = harness([SILENT, SILENT, SILENT, SILENT], { cooldownTurns: 1 })
  const feed = feedSession('s1')
  assert.equal((await observe(h.engine, feed.session, feed.turn('q1', 'a1'))).status, 'silent')
  assert.equal(h.engine.status('s1').session.quietStreak, 1)
  // Effective cooldown is now 2 turns, so the immediate next turn is skipped.
  assert.equal((await observe(h.engine, feed.session, feed.turn('q2', 'a2'))).status, 'cooldown')
  assert.equal(h.calls.length, 1)
  assert.equal((await observe(h.engine, feed.session, feed.turn('q3', 'a3'))).status, 'silent')
  assert.equal(h.engine.status('s1').session.quietStreak, 2)
  // Effective cooldown is now 3 turns.
  assert.equal((await observe(h.engine, feed.session, feed.turn('q4', 'a4'))).status, 'cooldown')
  assert.equal((await observe(h.engine, feed.session, feed.turn('q5', 'a5'))).status, 'cooldown')
  assert.equal((await observe(h.engine, feed.session, feed.turn('q6', 'a6'))).status, 'silent')
  assert.equal(h.calls.length, 3)
})

test('per-session feedback and budget state are isolated between sessions', async () => {
  const h = harness([note('Shared finding.'), note('Shared finding.'), note('Shared finding.')], { maxReviewerCallsPerHour: 1 })
  const first = feedSession('s1')
  const second = feedSession('s2')
  await observe(h.engine, first.session, first.turn('q1', 'a1'))
  const known = h.engine.notes('s1')[0]
  assert.equal(h.engine.resolve('s1', known.id, 'knew_it'), true)
  // s2 has its own empty known set and its own fresh hourly budget.
  const outcome = await observe(h.engine, second.session, second.turn('q1', 'a1'))
  assert.equal(outcome.status, 'noted')
  assert.equal(h.engine.notes('s2').length, 1)
  assert.equal(h.engine.status('s1').session.reviewerBudgetRemaining, 0)
  assert.equal(h.engine.status('s2').session.reviewerCallsLastHour, 1)
})

test('disposing a session clears its known fingerprints and budget state', async () => {
  const h = harness([note('Shared finding.'), note('Shared finding.')])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const known = h.engine.notes('s1')[0]
  assert.equal(h.engine.resolve('s1', known.id, 'knew_it'), true)
  assert.equal(h.engine.status('s1').session.knownFingerprintCount, 1)
  assert.equal(h.engine.forget('s1'), true)
  assert.equal(h.engine.status('s1').session, null)
  // A re-created session starts clean, so the same finding is delivered again.
  const replacement = feedSession('s1')
  const outcome = await observe(h.engine, replacement.session, replacement.turn('q1', 'a1'))
  assert.equal(outcome.status, 'noted')
  assert.equal(h.engine.status('s1').session.knownFingerprintCount, 0)
})

test('the status snapshot exposes only harmless adaptive counters', async () => {
  const h = harness([note('Note A.')])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const session = h.engine.status('s1').session
  assert.equal(typeof session.quietStreak, 'number')
  assert.equal(typeof session.reviewerCallsLastHour, 'number')
  assert.equal(typeof session.reviewerBudgetRemaining, 'number')
  assert.equal(typeof session.knownFingerprintCount, 'number')
  const text = JSON.stringify(h.engine.status('s1'))
  assert.equal(text.includes('Note A.'), false, 'no finding text may appear in diagnostics')
})

test('an unsupported resolution action is rejected without changing the note', async () => {
  const h = harness([note('Note A.')])
  const feed = feedSession('s1')
  await observe(h.engine, feed.session, feed.turn('q1', 'a1'))
  const active = h.engine.notes('s1')[0]
  assert.equal(h.engine.resolve('s1', active.id, 'not_a_resolution'), false)
  assert.equal(h.engine.resolve('s1', active.id, ''), false)
  assert.equal(h.engine.notes('s1').length, 1)
  assert.equal(h.engine.status('s1').session.knownFingerprintCount, 0)
})
