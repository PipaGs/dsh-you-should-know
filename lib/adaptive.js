// Bounded adaptive reviewer cadence for one session.
//
// This module is deliberately dependency-free and pure. It owns the two
// deterministic controls that keep the reviewer quiet under backpressure:
//
//   - a sliding hourly budget on reviewer calls per session; a skipped review
//     never reaches the provider, and
//   - a quiet streak that grows on a null or suppressed verdict and multiplies
//     the effective cooldown up to a fixed cap. A useful emitted finding, a
//     Thanks, and a successful Add to chat reset the streak.
//
// All state is caller-owned so it can be disposed with the session runtime.

/** Exactly one hour: the sliding budget window. */
export const REVIEWER_HOURLY_WINDOW_MS = 60 * 60 * 1000

/** Deterministic ceiling on the cooldown multiplier. */
export const MAX_QUIET_COOLDOWN_MULTIPLIER = 4

/** Internal ceiling on the quiet streak, so it cannot grow forever. */
export const MAX_QUIET_STREAK = 64

/** Internal ceiling on retained call timestamps. */
export const MAX_RECORDED_CALLS = 256

/** Terminal reviewer outcomes that count as nothing useful emitted. */
export const QUIET_OUTCOMES = Object.freeze(['silent', 'duplicate', 'suppressed'])

/** Fresh per-session adaptive accounting state. */
export function createAdaptiveState() {
  return { callTimes: [], explainCallTimes: [], quietStreak: 0 }
}

/** Whether one terminal outcome grows the quiet streak. */
export function isQuietOutcome(outcome) {
  return typeof outcome === 'string' && QUIET_OUTCOMES.includes(outcome)
}

/**
 * Prune timestamps outside the sliding window and report the current budget.
 *
 * @param state - adaptive state.
 * @param max - the per-hour call cap.
 * @param now - the current time.
 * @returns the used, remaining, and max counts.
 */
export function reviewerBudget(state, max, now, field = 'callTimes') {
  const cap = Number.isInteger(max) && max > 0 ? max : 1
  if (!Array.isArray(state[field])) state[field] = []
  const windowStart = now - REVIEWER_HOURLY_WINDOW_MS
  while (state[field].length > 0 && state[field][0] <= windowStart) state[field].shift()
  const used = state[field].length
  return { used, remaining: Math.max(0, cap - used), max: cap }
}

/**
 * Record one call at the given time. The caller names the window: the review
 * budget and the separate explainer budget never share a counter.
 */
export function recordReviewerCall(state, now, field = 'callTimes') {
  if (!Array.isArray(state[field])) state[field] = []
  state[field].push(now)
  if (state[field].length > MAX_RECORDED_CALLS) {
    state[field].splice(0, state[field].length - MAX_RECORDED_CALLS)
  }
}

/** Grow the quiet streak by exactly one, up to the internal ceiling. */
export function noteQuietOutcome(state) {
  const current = Number.isInteger(state.quietStreak) && state.quietStreak > 0 ? state.quietStreak : 0
  state.quietStreak = Math.min(current + 1, MAX_QUIET_STREAK)
}

/** Reset the quiet streak to normal cadence. */
export function resetQuiet(state) {
  state.quietStreak = 0
}

/**
 * The effective cooldown in turns: the configured base multiplied by the
 * bounded quiet streak. A base below one is normalized to one.
 */
export function effectiveCooldownTurns(state, baseCooldown) {
  const base = Number.isFinite(baseCooldown) && baseCooldown >= 1 ? Math.floor(baseCooldown) : 1
  const streak = Number.isInteger(state.quietStreak) && state.quietStreak > 0 ? state.quietStreak : 0
  return base * Math.min(streak + 1, MAX_QUIET_COOLDOWN_MULTIPLIER)
}
