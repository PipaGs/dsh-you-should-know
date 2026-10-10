import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_KNOWN_FINGERPRINTS,
  createFingerprintSet,
  fingerprintsMatch,
} from '../lib/feedback.js'
import {
  MAX_QUIET_COOLDOWN_MULTIPLIER,
  REVIEWER_HOURLY_WINDOW_MS,
  createAdaptiveState,
  effectiveCooldownTurns,
  noteQuietOutcome,
  recordReviewerCall,
  resetQuiet,
  reviewerBudget,
} from '../lib/adaptive.js'

test('the known-fingerprint set is bounded and evicts the oldest entry', () => {
  const set = createFingerprintSet(3)
  assert.equal(set.add('a'), true)
  assert.equal(set.add('b'), true)
  assert.equal(set.add('c'), true)
  assert.equal(set.size, 3)
  assert.equal(set.has('a'), true)
  assert.equal(set.add('d'), true)
  assert.equal(set.size, 3)
  assert.equal(set.has('a'), false, 'the oldest fingerprint is evicted at the cap')
  assert.deepEqual([set.has('b'), set.has('c'), set.has('d')], [true, true, true])
  // Re-adding an existing key refreshes its recency without growing the set.
  assert.equal(set.add('b'), true)
  assert.equal(set.size, 3)
  assert.equal(set.add(''), false)
  assert.equal(set.add(42), false)
  set.clear()
  assert.equal(set.size, 0)
})

test('the known-fingerprint set matches a near-duplicate but never an unrelated finding', () => {
  const set = createFingerprintSet(4)
  set.add('the cache never clears')
  assert.equal(set.matches('the cache never clears'), true, 'the exact fingerprint matches')
  assert.equal(set.matches('the cache never clears when the session ends'), true, 'a near-duplicate that keeps the distinctive terms matches')
  assert.equal(set.matches('the retry drops the original error'), false, 'an unrelated finding stays eligible')
  assert.equal(set.matches(''), false)
  assert.equal(set.matches(undefined), false)
  const short = createFingerprintSet(2)
  short.add('cache')
  assert.equal(short.matches('cache'), true)
  assert.equal(short.matches('cache invalidation'), false, 'fewer than the minimum shared tokens is never a match')
})

test('a repeated token never inflates the overlap and the match is symmetric', () => {
  assert.equal(fingerprintsMatch('retry retry failed', 'retry timeout failed'), false)
  assert.equal(fingerprintsMatch('retry timeout failed', 'retry retry failed'), false)
  const set = createFingerprintSet(2)
  set.add('retry retry failed')
  assert.equal(set.matches('retry timeout failed'), false)
})

test('a difference past the token cap is never treated as a near-duplicate', () => {
  const prefix = Array.from({ length: 64 }, (_, index) => 'token' + index).join(' ')
  const left = prefix + ' tailone'
  const right = prefix + ' tailtwo'
  assert.equal(fingerprintsMatch(left, right), false)
  assert.equal(fingerprintsMatch(left, left), true, 'an exact over-cap fingerprint still matches')
  const set = createFingerprintSet(2)
  set.add(left)
  assert.equal(set.matches(right), false)
})

test('the default known-fingerprint cap is a small documented constant', () => {
  assert.equal(MAX_KNOWN_FINGERPRINTS, 32)
  const set = createFingerprintSet()
  for (let index = 0; index < MAX_KNOWN_FINGERPRINTS + 5; index += 1) set.add('k' + index)
  assert.equal(set.size, MAX_KNOWN_FINGERPRINTS)
})

test('the hourly budget counts only calls inside the sliding window', () => {
  const state = createAdaptiveState()
  const start = 1_700_000_000_000
  assert.deepEqual(reviewerBudget(state, 3, start), { used: 0, remaining: 3, max: 3 })
  recordReviewerCall(state, start)
  recordReviewerCall(state, start + 1000)
  assert.deepEqual(reviewerBudget(state, 3, start + 2000), { used: 2, remaining: 1, max: 3 })
  recordReviewerCall(state, start + 3000)
  assert.deepEqual(reviewerBudget(state, 3, start + 4000), { used: 3, remaining: 0, max: 3 })
  // Exactly one window later the first call leaves the window.
  assert.deepEqual(reviewerBudget(state, 3, start + REVIEWER_HOURLY_WINDOW_MS + 1), { used: 2, remaining: 1, max: 3 })
})

test('the explainer has its own bounded sliding window, independent of reviews', () => {
  const state = createAdaptiveState()
  const start = 1_700_000_000_000
  assert.deepEqual(state.explainCallTimes, [])
  recordReviewerCall(state, start)
  assert.deepEqual(reviewerBudget(state, 2, start + 1), { used: 1, remaining: 1, max: 2 })
  assert.deepEqual(reviewerBudget(state, 2, start + 1, 'explainCallTimes'), { used: 0, remaining: 2, max: 2 })
  recordReviewerCall(state, start + 1, 'explainCallTimes')
  assert.deepEqual(reviewerBudget(state, 2, start + 2, 'explainCallTimes'), { used: 1, remaining: 1, max: 2 })
  assert.deepEqual(reviewerBudget(state, 2, start + 2), { used: 1, remaining: 1, max: 2 }, 'review accounting is unchanged')
})

test('a quiet outcome grows the streak and a useful outcome resets it', () => {
  const state = createAdaptiveState()
  assert.equal(state.quietStreak, 0)
  noteQuietOutcome(state)
  noteQuietOutcome(state)
  assert.equal(state.quietStreak, 2)
  resetQuiet(state)
  assert.equal(state.quietStreak, 0)
})

test('the effective cooldown grows deterministically with the quiet streak and is capped', () => {
  const state = createAdaptiveState()
  assert.equal(effectiveCooldownTurns(state, 3), 3)
  noteQuietOutcome(state)
  assert.equal(effectiveCooldownTurns(state, 3), 6)
  noteQuietOutcome(state)
  noteQuietOutcome(state)
  noteQuietOutcome(state)
  noteQuietOutcome(state)
  assert.equal(effectiveCooldownTurns(state, 3), 3 * MAX_QUIET_COOLDOWN_MULTIPLIER)
  // A nonpositive base is normalized to at least one turn.
  assert.equal(effectiveCooldownTurns(createAdaptiveState(), 0), 1)
})

test('the hourly window length is exactly one hour', () => {
  assert.equal(REVIEWER_HOURLY_WINDOW_MS, 60 * 60 * 1000)
})
