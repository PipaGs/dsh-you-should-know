// Human feedback semantics for the reviewer card.
//
// This module is deliberately dependency-free and pure. It owns the one exact
// resolution vocabulary a human may apply to a stored finding, and the bounded
// per-session set of known finding fingerprints. A known fingerprint means the
// human already knew this class of finding, so the same or a similar finding is
// suppressed for the rest of that session instead of being shown again.

/**
 * The exact resolution actions a human may apply. 'dismissed' and
 * 'added_to_chat' are the v0.3.x values; 'knew_it' and 'thanks' are the
 * v0.4.0 feedback values and are stored distinctly.
 */
export const FEEDBACK_RESOLUTIONS = Object.freeze(['dismissed', 'added_to_chat', 'knew_it', 'thanks'])

/** Resolutions that mean the finding was a useful new discovery. */
export const USEFUL_RESOLUTIONS = Object.freeze(['added_to_chat', 'thanks'])

/** The resolution that strengthens fingerprint suppression. */
export const SUPPRESSING_RESOLUTION = 'knew_it'

/** Small, documented cap on one session's known-fingerprint set. */
export const MAX_KNOWN_FINGERPRINTS = 32

/** Largest token set derived from one fingerprint before it is truncated. */
export const MAX_FINGERPRINT_TOKENS = 64

/** Minimum shared distinctive tokens before two fingerprints can be similar. */
export const MIN_SHARED_FINGERPRINT_TOKENS = 3

/** Share of the smaller token set that must overlap for a near-duplicate match. */
export const FINGERPRINT_CONTAINMENT = 0.8

/** The bounded token set of one already-normalized fingerprint. */
export function fingerprintTokens(key) {
  if (typeof key !== 'string' || key === '') return []
  return key.split(' ').filter((token) => token !== '').slice(0, MAX_FINGERPRINT_TOKENS)
}

/**
 * Whether two fingerprints describe the same finding. An exact match always
 * counts. A near-duplicate counts when it keeps the distinctive terms of the
 * other one: at least the minimum number of shared tokens and a high enough
 * share of the smaller token set. A pure paraphrase with different terms is
 * deliberately not a match, so an unrelated finding is never suppressed.
 */
export function fingerprintsMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  if (left === '') return false
  if (left === right) return true
  const a = fingerprintTokens(left)
  const b = fingerprintTokens(right)
  const smaller = Math.min(a.length, b.length)
  if (smaller < MIN_SHARED_FINGERPRINT_TOKENS) return false
  const other = new Set(b)
  let shared = 0
  for (const token of a) if (other.has(token)) shared += 1
  return shared / smaller >= FINGERPRINT_CONTAINMENT
}

/** Whether one value is exactly one of the four resolution actions. */
export function isFeedbackResolution(value) {
  return typeof value === 'string' && FEEDBACK_RESOLUTIONS.includes(value)
}

/**
 * Create a bounded, insertion-order fingerprint set. Re-adding an existing key
 * refreshes its recency; adding past the cap evicts the oldest key, so the set
 * can never grow without bound for a long session.
 *
 * @param limit - the cap; a missing or invalid value falls back to the default.
 * @returns an object with add, has, clear, and size.
 */
export function createFingerprintSet(limit = MAX_KNOWN_FINGERPRINTS) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : MAX_KNOWN_FINGERPRINTS
  const keys = new Set()
  return {
    add(key) {
      if (typeof key !== 'string' || key === '') return false
      if (keys.has(key)) keys.delete(key)
      keys.add(key)
      while (keys.size > cap) keys.delete(keys.keys().next().value)
      return true
    },
    has(key) {
      return typeof key === 'string' && key !== '' && keys.has(key)
    },
    matches(key) {
      if (typeof key !== 'string' || key === '') return false
      for (const known of keys) {
        if (fingerprintsMatch(known, key)) return true
      }
      return false
    },
    clear() {
      keys.clear()
    },
    get size() {
      return keys.size
    },
  }
}
