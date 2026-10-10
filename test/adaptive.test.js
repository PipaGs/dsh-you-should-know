import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_KNOWN_FINGERPRINTS,
  createFingerprintSet,
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
