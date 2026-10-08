// Update checking for dsh-you-should-know.
//
// This module is deliberately dependency-free: the plugin must load from a
// plain "github:" install with no build step and no runtime imports. It owns the
// read-only half of the update story: it parses and compares stable release
// tags, reads the latest published release from the public GitHub API through
// the injected web seam, and runs a once-per-local-day scheduler that persists
// only harmless version/date metadata.
//
// It never installs, upgrades, or mutates an installation. There is no shell,
// no package manager, no profile file write, and no plugin-manager call here:
// every behavior degrades to an honest notification because current DSH exposes
// no approved plugin update API.

/** The public repository whose releases are the update source. */
export const UPDATE_REPO = 'PipaGs/dsh-you-should-know'

/**
 * The stable public release source. GitHub's "latest release" endpoint names
 * the newest published non-draft, non-prerelease release tag, so a branch head
 * can never become an "update". The pinned Git tag remains the only install
 * address this plugin knows about.
 */
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest'

/** The three stable update-behavior ids, in display order. */
export const UPDATE_BEHAVIORS = Object.freeze(['notify-only', 'ask-before-update', 'automatic'])

/** The conservative default: notify, and never install without the human. */
export const DEFAULT_UPDATE_BEHAVIOR = 'ask-before-update'

/** Internal safety budgets for the remote check. Not user-configurable. */
export const UPDATE_LIMITS = Object.freeze({
  maxBodyChars: 65536,
  requestTimeoutMs: 10000,
  maxTagChars: 64,
})

/** A stable plugin release tag: vMAJOR.MINOR.PATCH with no prefix or suffix. */
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** A locale-independent local calendar date key. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function readLimit(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function isSafeComponent(text) {
  return Number.isSafeInteger(Number(text))
}

/**
 * Parse one stable release tag.
 *
 * Only vMAJOR.MINOR.PATCH is accepted: a bare version, a prerelease/build
 * suffix, a branch name, a leading zero, and an oversized component all return
 * null so a malformed or exploratory tag can never become an update.
 *
 * @param value - a candidate tag.
 * @returns the parsed tag, or null.
 */
export function parseStableTag(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > UPDATE_LIMITS.maxTagChars) return null
  const match = STABLE_TAG.exec(value)
  if (match === null) return null
  if (!isSafeComponent(match[1]) || !isSafeComponent(match[2]) || !isSafeComponent(match[3])) return null
  return { tag: value, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/**
 * Compare two parsed versions.
 *
 * @param left - a parsed version.
 * @param right - a parsed version.
 * @returns -1, 0, or 1; null when either side is not a parsed version.
 */
export function compareVersions(left, right) {
  if (!isVersion(left) || !isVersion(right)) return null
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] < right[key]) return -1
    if (left[key] > right[key]) return 1
  }
  return 0
}

function isVersion(value) {
  return value !== null && typeof value === 'object' &&
    Number.isSafeInteger(value.major) && Number.isSafeInteger(value.minor) && Number.isSafeInteger(value.patch)
}

/** Render the dotted numeric version of a parsed tag. */
function versionOf(parsed) {
  return parsed.major + '.' + parsed.minor + '.' + parsed.patch
}

/**
 * Read the latest stable release tag from a GitHub release payload.
 *
 * A draft, a prerelease, a missing tag, or a tag that is not a stable version
 * yields null.
 *
 * @param payload - the parsed JSON body of the latest-release endpoint.
 * @returns the parsed latest tag, or null.
 */
export function latestReleaseTag(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  if (payload.draft === true || payload.prerelease === true) return null
  return parseStableTag(payload.tag_name)
}

/**
 * Build the exact pinned Git install spec for a release tag.
 * @param tag - a stable release tag.
 * @returns the pinned spec, or an empty string for an unusable tag.
 */
export function installSpec(tag) {
  const parsed = parseStableTag(tag)
  if (parsed === null) return ''
  return 'github:' + UPDATE_REPO + '#' + parsed.tag
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

/**
 * The local calendar date key (YYYY-MM-DD) for one instant.
 * @param ms - epoch milliseconds.
 * @returns the local date key, or an empty string for an invalid instant.
 */
export function localDateKey(ms) {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
}

/**
 * The epoch instant of the next local midnight after one instant.
 *
 * The next day is built from the local calendar fields, so a DST transition
 * yields a 23- or 25-hour day instead of a hardcoded 24 hours.
 *
 * @param ms - epoch milliseconds.
 * @returns the next local midnight in epoch milliseconds.
 */
export function nextLocalMidnight(ms) {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime()
}

/**
 * Milliseconds from one instant to the next local midnight.
 * @param ms - epoch milliseconds.
 * @returns the delay in milliseconds.
 */
export function millisUntilNextLocalMidnight(ms) {
  return nextLocalMidnight(ms) - ms
}

/**
 * Normalize the persisted update state.
 *
 * Every field falls back conservatively: an unknown behavior, a malformed date
 * key, and a non-stable stored version are all discarded rather than trusted.
 *
 * @param raw - the update fields read from the plugin row.
 * @returns the normalized update state.
 */
export function normalizeUpdateState(raw) {
  const input = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const latest = parseStableTag(input.lastSeenLatestVersion)
  const dismissed = parseStableTag(input.dismissedUpdateVersion)
  return {
    autoCheckUpdates: input.autoCheckUpdates === false ? false : true,
    updateBehavior: UPDATE_BEHAVIORS.includes(input.updateBehavior) ? input.updateBehavior : DEFAULT_UPDATE_BEHAVIOR,
    lastAutoCheckDate: typeof input.lastAutoCheckDate === 'string' && DATE_KEY.test(input.lastAutoCheckDate) ? input.lastAutoCheckDate : '',
    lastSeenLatestVersion: latest === null ? '' : latest.tag,
    dismissedUpdateVersion: dismissed === null ? '' : dismissed.tag,
  }
}

/**
 * Merge a fresh config snapshot onto the current update state.
 *
 * A loader snapshot can arrive before a just-persisted progress field is
 * visible in it. Replacing the whole state would then erase a date or tag the
 * host has already accepted, so an empty incoming progress field keeps the
 * current one; preference fields always follow the snapshot.
 *
 * @param current - the current normalized update state.
 * @param raw - the raw update fields from the config snapshot.
 * @returns the merged update state.
 */
export function mergeUpdateState(current, raw) {
  const next = normalizeUpdateState(raw)
  const merged = { ...next }
  const previous = current !== null && typeof current === 'object' ? current : normalizeUpdateState({})
  if (merged.lastAutoCheckDate === '' && previous.lastAutoCheckDate !== '') merged.lastAutoCheckDate = previous.lastAutoCheckDate
  if (merged.lastSeenLatestVersion === '' && previous.lastSeenLatestVersion !== '') merged.lastSeenLatestVersion = previous.lastSeenLatestVersion
  if (merged.dismissedUpdateVersion === '' && previous.dismissedUpdateVersion !== '') merged.dismissedUpdateVersion = previous.dismissedUpdateVersion
  return merged
}

/**
 * Create the once-per-local-day update checker.
 *
 * The scheduler performs at most one automatic check per local calendar day: an
 * immediate check at startup when today is unproven, and otherwise one timer
 * for the next local midnight. A failed automatic check does not stamp the day,
 * so the next startup retries; a manual check bypasses the guard. Disabling the
 * preference cancels every timer. The checker only reads the remote release and
 * persists harmless metadata through the injected host seams.
 *
 * @param options.currentVersion - the running plugin version (dotted).
 * @param options.getState - reads the normalized persisted update state.
 * @param options.persist - writes an update-state patch through the host.
 * @param options.webFetch - the public web seam, called as (request, signal).
 * @param options.now - clock, injectable for deterministic scheduling tests.
 * @param options.setTimer, options.clearTimer - timer seam.
 * @param options.onError - contained diagnostic sink.
 * @param options.latestUrl - the release endpoint, overridable for tests.
 */
export function createUpdateChecker(options = {}) {
  const currentVersion = typeof options.currentVersion === 'string' ? options.currentVersion : '0.0.0'
  const getState = typeof options.getState === 'function' ? options.getState : () => normalizeUpdateState({})
  const persist = typeof options.persist === 'function' ? options.persist : async () => {}
  const webFetch = options.webFetch
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : (fn, ms) => setTimeout(fn, ms)
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : (handle) => clearTimeout(handle)
  const onError = typeof options.onError === 'function' ? options.onError : () => {}
  const latestUrl = typeof options.latestUrl === 'string' && options.latestUrl !== '' ? options.latestUrl : LATEST_RELEASE_URL
  const requestTimeoutMs = readLimit(options.requestTimeoutMs, UPDATE_LIMITS.requestTimeoutMs)
  const maxBodyChars = readLimit(options.maxBodyChars, UPDATE_LIMITS.maxBodyChars)
  const current = parseStableTag(currentVersion.startsWith('v') ? currentVersion : 'v' + currentVersion)

  let stopped = true
  let midnightHandle = null
  let immediateHandle = null
  let pending = null
  let pendingAutomatic = null
  let activeController = null
  let lastResult = null
  let lastCheckedAt = null

  function reportError(error) {
    try {
      onError(error)
    } catch (ignored) {
      // A diagnostic sink must never break the check itself.
    }
  }

  function clearTimers() {
    if (midnightHandle !== null) {
      clearTimer(midnightHandle)
      midnightHandle = null
    }
    if (immediateHandle !== null) {
      clearTimer(immediateHandle)
      immediateHandle = null
    }
  }

  /**
   * Arm one timer without letting it keep an otherwise idle Node process
   * alive: the DSH host owns the event loop, and a plugin timer must never
   * pin a short-lived embedder (or a test runner).
   */
  function armTimer(fn, ms) {
    const handle = setTimer(fn, ms)
    if (handle !== null && handle !== undefined && typeof handle.unref === 'function') handle.unref()
    return handle
  }

  /** Arm exactly one timer for the next local midnight. */
  function scheduleMidnight() {
    if (stopped || midnightHandle !== null) return
    if (getState().autoCheckUpdates !== true) return
    const reference = now()
    const delay = nextLocalMidnight(reference) - reference
    midnightHandle = armTimer(() => {
      midnightHandle = null
      void runAutomatic()
    }, Number.isFinite(delay) && delay > 0 ? delay : 0)
  }

  /** Arm the day's first check when today has no successful automatic check. */
  function scheduleImmediate() {
    if (stopped || immediateHandle !== null) return
    if (getState().autoCheckUpdates !== true) return
    if (getState().lastAutoCheckDate === localDateKey(now())) return
    immediateHandle = armTimer(() => {
      immediateHandle = null
      // Re-check at fire time: a refresh armed this timer while a check was in
      // flight, and that check may already have stamped today.
      if (stopped || getState().autoCheckUpdates !== true) return
      if (getState().lastAutoCheckDate === localDateKey(now())) return
      void runAutomatic()
    }, 0)
  }

  /** Re-evaluate the schedule from the current persisted preferences. */
  function refresh() {
    clearTimers()
    if (stopped || getState().autoCheckUpdates !== true) return
    scheduleMidnight()
    scheduleImmediate()
  }

  function requestWithTimeout() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    activeController = controller
    let handle = null
    const call = Promise.resolve().then(() => webFetch({ url: latestUrl }, controller === null ? undefined : controller.signal))
    const timeout = new Promise((resolve, reject) => {
      // The timeout is unref'd like every other plugin timer: it must not keep
      // an otherwise idle process alive while a hung request is pending.
      handle = armTimer(() => {
        if (controller !== null) {
          try {
            controller.abort()
          } catch (ignored) {
            // A hostile AbortController must not mask the timeout.
          }
        }
        reject(new Error('the update check timed out'))
      }, requestTimeoutMs)
    })
    return Promise.race([call, timeout]).finally(() => {
      if (handle !== null) clearTimer(handle)
      if (activeController === controller) activeController = null
    })
  }

  /**
   * Perform the network read only. It never persists: the automatic and manual
   * callers own their own persistence, so a coalesced pair still applies the
   * automatic stamp after the shared request.
   */
  async function fetchLatest() {
    lastCheckedAt = now()
    try {
      if (typeof webFetch !== 'function') throw new Error('no public web fetch service is mounted')
      const response = await requestWithTimeout()
      if (response === null || response === undefined || response.statusCode !== 200) {
        throw new Error('the release endpoint answered ' + (response && response.statusCode !== undefined ? response.statusCode : 'nothing'))
      }
      const content = response.body && typeof response.body.content === 'string' ? response.body.content : ''
      if (content.length > maxBodyChars) throw new Error('the release response exceeds the size bound')
      const parsed = latestReleaseTag(JSON.parse(content))
      if (parsed === null) throw new Error('the release response does not name a stable release tag')
      return { ok: true, tag: parsed.tag }
    } catch (error) {
      reportError(error)
      lastResult = 'failed'
      return { ok: false }
    }
  }

  /**
   * Persist one outcome. A persist failure is a failed check, never a silent
   * success: a caller must not report a version it could not record.
   */
  async function applyOutcome(outcome, automatic) {
    if (stopped || outcome === null || typeof outcome !== 'object' || outcome.ok !== true) {
      lastResult = 'failed'
      return { ok: false, result: 'failed' }
    }
    const patch = { lastSeenLatestVersion: outcome.tag }
    if (automatic === true && getState().autoCheckUpdates === true) patch.lastAutoCheckDate = localDateKey(now())
    try {
      await persist(patch)
    } catch (error) {
      reportError(error)
      lastResult = 'failed'
      return { ok: false, result: 'failed' }
    }
    const parsed = parseStableTag(outcome.tag)
    lastResult = current !== null && parsed !== null && compareVersions(parsed, current) > 0 ? 'update-available' : 'up-to-date'
    return { ok: true, result: lastResult, latest: outcome.tag }
  }

  /** Coalesce overlapping triggers into one shared network request. */
  function runCheck() {
    if (pending !== null) return pending
    pending = fetchLatest().finally(() => {
      pending = null
    })
    return pending
  }

  function runAutomatic() {
    if (stopped || getState().autoCheckUpdates !== true) return Promise.resolve({ ok: false, result: 'failed' })
    scheduleMidnight()
    if (pendingAutomatic !== null) return pendingAutomatic
    // Every automatic trigger applies its own stamp after the shared request,
    // so a manual check in flight can never swallow the day's automatic success.
    pendingAutomatic = runCheck()
      .then((outcome) => applyOutcome(outcome, true))
      .finally(() => {
        pendingAutomatic = null
      })
    return pendingAutomatic
  }

  function whenIdle() {
    const waits = []
    if (pending !== null) waits.push(pending)
    if (pendingAutomatic !== null) waits.push(pendingAutomatic)
    if (waits.length === 0) return Promise.resolve()
    return Promise.all(waits.map((entry) => entry.then(() => undefined, () => undefined)))
  }

  function status() {
    const state = getState()
    const latest = parseStableTag(state.lastSeenLatestVersion)
    const updateAvailable = current !== null && latest !== null && compareVersions(latest, current) > 0
    return {
      currentVersion,
      latestVersion: latest === null ? '' : versionOf(latest),
      latestTag: latest === null ? '' : latest.tag,
      installSpec: latest === null ? '' : installSpec(latest.tag),
      updateAvailable,
      dismissed: latest !== null && state.dismissedUpdateVersion === latest.tag,
      dismissedVersion: state.dismissedUpdateVersion,
      autoCheckUpdates: state.autoCheckUpdates,
      updateBehavior: state.updateBehavior,
      // Current DSH exposes no approved plugin update API, so an unattended
      // install is never offered. This is reported, not faked.
      automaticSupported: false,
      lastAutoCheckDate: state.lastAutoCheckDate,
      lastCheckedAt,
      lastResult,
    }
  }

  async function setPreferences(patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'invalid-preferences' }
    const next = {}
    if (patch.autoCheckUpdates !== undefined) {
      if (typeof patch.autoCheckUpdates !== 'boolean') return { ok: false, error: 'invalid-preferences' }
      next.autoCheckUpdates = patch.autoCheckUpdates
    }
    if (patch.updateBehavior !== undefined) {
      if (!UPDATE_BEHAVIORS.includes(patch.updateBehavior)) return { ok: false, error: 'invalid-preferences' }
      next.updateBehavior = patch.updateBehavior
    }
    if (Object.keys(next).length === 0) return { ok: false, error: 'invalid-preferences' }
    try {
      await persist(next)
    } catch (error) {
      reportError(error)
      return { ok: false, error: 'read-only' }
    }
    refresh()
    return { ok: true, update: status() }
  }

  async function dismiss(version) {
    const parsed = parseStableTag(version)
    if (parsed === null) return { ok: false, error: 'invalid-version' }
    try {
      await persist({ dismissedUpdateVersion: parsed.tag })
    } catch (error) {
      reportError(error)
      return { ok: false, error: 'read-only' }
    }
    return { ok: true, update: status() }
  }

  async function checkNow() {
    const outcome = await applyOutcome(await runCheck(), false)
    return { ...outcome, update: status() }
  }

  function start() {
    if (!stopped) return
    stopped = false
    refresh()
  }

  function stop() {
    stopped = true
    lastResult = 'failed'
    clearTimers()
    if (activeController !== null) {
      try {
        activeController.abort()
      } catch (ignored) {
        // A hostile AbortController must not break teardown.
      }
    }
  }

  return { start, stop, refresh, status, checkNow, setPreferences, dismiss, whenIdle }
}
