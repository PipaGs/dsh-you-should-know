// Tests for the update checker: version/tag parsing, release-source parsing,
// local-date and next-midnight scheduler math, the once-per-day scheduler, and
// the network/privacy bounds. The checker only ever CHECKS; nothing here may
// touch an installation.

// The scheduler uses the process-local calendar day. Pin the timezone so the
// DST assertions are deterministic; Node's test runner runs each file in its
// own process, so this does not affect other files.
process.env.TZ = 'America/New_York'

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_UPDATE_BEHAVIOR,
  LATEST_RELEASE_URL,
  UPDATE_BEHAVIORS,
  UPDATE_REPO,
  compareVersions,
  createUpdateChecker,
  installSpec,
  latestReleaseTag,
  localDateKey,
  mergeUpdateState,
  millisUntilNextLocalMidnight,
  nextLocalMidnight,
  normalizeUpdateState,
  parseStableTag,
} from '../lib/update.js'

/** One local wall-clock instant in the pinned test timezone. */
function at(year, monthIndex, day, hour = 0, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).getTime()
}

const HOUR = 3600000

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function releaseBody(tag, extra = {}) {
  return JSON.stringify({ tag_name: tag, draft: false, prerelease: false, ...extra })
}

test('parseStableTag accepts only stable vMAJOR.MINOR.PATCH tags', () => {
  assert.deepEqual(parseStableTag('v0.3.8'), { tag: 'v0.3.8', major: 0, minor: 3, patch: 8 })
  assert.deepEqual(parseStableTag('v12.34.56'), { tag: 'v12.34.56', major: 12, minor: 34, patch: 56 })
  for (const rejected of [
    '0.3.8', 'v0.3', 'v0.3.8.1', 'v0.3.8-rc.1', 'v0.3.8+build', 'v01.3.8', 'v0.03.8',
    'main', 'latest', 'release-v0.3.8', '', ' v0.3.8', 'v0.3.8 ', 'vX.Y.Z', null, undefined, 8, {},
  ]) {
    assert.equal(parseStableTag(rejected), null, String(rejected) + ' must be rejected')
  }
  assert.equal(parseStableTag('v' + '1'.repeat(20) + '.0.0'), null, 'an oversized tag is rejected')
})

test('compareVersions orders equal, older, and newer versions', () => {
  const v = (tag) => parseStableTag(tag)
  assert.equal(compareVersions(v('v0.3.8'), v('v0.3.8')), 0)
  assert.equal(compareVersions(v('v0.3.8'), v('v0.3.9')), -1)
  assert.equal(compareVersions(v('v0.3.8'), v('v0.4.0')), -1)
  assert.equal(compareVersions(v('v0.4.0'), v('v0.3.8')), 1)
  assert.equal(compareVersions(v('v1.0.0'), v('v0.9.9')), 1)
})

test('latestReleaseTag reads a stable release and ignores drafts, prereleases, and branch names', () => {
  assert.equal(latestReleaseTag(JSON.parse(releaseBody('v0.4.0'))).tag, 'v0.4.0')
  assert.equal(latestReleaseTag({ tag_name: 'v0.4.0', draft: true }), null)
  assert.equal(latestReleaseTag({ tag_name: 'v0.4.0', prerelease: true }), null)
  assert.equal(latestReleaseTag({ tag_name: 'main' }), null)
  assert.equal(latestReleaseTag({ tag_name: 'v0.4.0-rc.2' }), null)
  assert.equal(latestReleaseTag({}), null)
  assert.equal(latestReleaseTag(null), null)
  assert.equal(latestReleaseTag(['v0.4.0']), null)
})

test('installSpec builds the exact pinned Git spec', () => {
  assert.equal(installSpec('v0.4.0'), 'github:PipaGs/dsh-you-should-know#v0.4.0')
  assert.equal(installSpec('main'), '')
  assert.equal(installSpec('v0.4.0-rc.1'), '')
  assert.equal(UPDATE_REPO, 'PipaGs/dsh-you-should-know')
})

test('localDateKey is a locale-independent local calendar date', () => {
  assert.equal(localDateKey(at(2026, 5, 15, 22, 30)), '2026-06-15')
  assert.equal(localDateKey(at(2026, 0, 1, 0, 0)), '2026-01-01')
  assert.equal(localDateKey(at(2026, 11, 31, 23, 59)), '2026-12-31')
  assert.equal(localDateKey(Number.NaN), '')
})

test('nextLocalMidnight uses the local calendar, not a hardcoded 24 hours', () => {
  assert.equal(millisUntilNextLocalMidnight(at(2026, 5, 15, 22, 0)), 2 * HOUR)
  assert.equal(millisUntilNextLocalMidnight(at(2026, 5, 30, 23, 0)), 1 * HOUR, 'month rollover')
  // Spring forward 2026-03-08 02:00: the day that crosses it is 23 hours long.
  assert.equal(millisUntilNextLocalMidnight(at(2026, 2, 7, 0, 30)), 23.5 * HOUR)
  // Fall back 2026-11-01 02:00: the day that crosses it is 25 hours long.
  assert.equal(millisUntilNextLocalMidnight(at(2026, 10, 1, 0, 30)), 24.5 * HOUR)
  const now = at(2026, 5, 15, 13, 37)
  const midnight = nextLocalMidnight(now)
  assert.ok(midnight > now, 'the next midnight is strictly after now')
  assert.equal(new Date(midnight).getHours(), 0)
  assert.equal(new Date(midnight).getMinutes(), 0)
  assert.equal(localDateKey(midnight), '2026-06-16')
})

test('normalizeUpdateState applies defaults and rejects unknown enum values', () => {
  assert.deepEqual(normalizeUpdateState({}), {
    autoCheckUpdates: true,
    updateBehavior: DEFAULT_UPDATE_BEHAVIOR,
    lastAutoCheckDate: '',
    lastSeenLatestVersion: '',
    dismissedUpdateVersion: '',
  })
  assert.equal(DEFAULT_UPDATE_BEHAVIOR, 'ask-before-update')
  assert.deepEqual(UPDATE_BEHAVIORS, ['notify-only', 'ask-before-update', 'automatic'])
  const normalized = normalizeUpdateState({
    autoCheckUpdates: false,
    updateBehavior: 'notify-only',
    lastAutoCheckDate: '2026-06-15',
    lastSeenLatestVersion: 'v0.4.0',
    dismissedUpdateVersion: 'v0.4.0',
  })
  assert.deepEqual(normalized, {
    autoCheckUpdates: false,
    updateBehavior: 'notify-only',
    lastAutoCheckDate: '2026-06-15',
    lastSeenLatestVersion: 'v0.4.0',
    dismissedUpdateVersion: 'v0.4.0',
  })
  const coerced = normalizeUpdateState({
    autoCheckUpdates: 'yes',
    updateBehavior: 'paranoid',
    lastAutoCheckDate: '15/06/2026',
    lastSeenLatestVersion: 'main',
    dismissedUpdateVersion: 'v0.4.0-rc.1',
  })
  assert.deepEqual(coerced, {
    autoCheckUpdates: true,
    updateBehavior: DEFAULT_UPDATE_BEHAVIOR,
    lastAutoCheckDate: '',
    lastSeenLatestVersion: '',
    dismissedUpdateVersion: '',
  })
})

// --- Scheduler harness --------------------------------------------------------

function stateStore(initial = {}) {
  const state = normalizeUpdateState(initial)
  const patches = []
  const persist = async (patch) => {
    patches.push({ ...patch })
    Object.assign(state, patch)
  }
  return { state, patches, persist }
}

function checkerHarness(options = {}) {
  const clock = { ms: options.now ?? at(2026, 5, 15, 22, 0) }
  const timers = new Map()
  let nextTimer = 1
  const setTimer = (fn, ms) => {
    const id = nextTimer++
    timers.set(id, { fn, ms })
    return id
  }
  const clearTimer = (id) => {
    timers.delete(id)
  }
  const calls = []
  const errors = []
  const store = stateStore(options.initial)
  const responses = options.responses ? [...options.responses] : []
  const webFetch = options.webFetch ?? (async (request, signal) => {
    calls.push({ request, signal })
    if (responses.length > 0) {
      const next = responses.shift()
      if (next instanceof Error) throw next
      return next
    }
    return { statusCode: 200, body: { kind: 'text', content: releaseBody(options.latestTag ?? 'v0.4.0') }, truncated: false, url: LATEST_RELEASE_URL }
  })
  const checker = createUpdateChecker({
    currentVersion: options.currentVersion ?? '0.3.8',
    getState: () => store.state,
    persist: store.persist,
    webFetch,
    now: () => clock.ms,
    setTimer,
    clearTimer,
    onError: (error) => errors.push(error),
    requestTimeoutMs: 1000,
    maxBodyChars: options.maxBodyChars,
  })
  const idsWhere = (predicate) => [...timers.entries()].filter(([, timer]) => predicate(timer.ms)).map(([id]) => id)
  const zeroTimers = () => idsWhere((ms) => ms === 0)
  const midnightTimers = () => idsWhere((ms) => ms > 0)
  const fire = (id) => {
    const timer = timers.get(id)
    if (timer === undefined) return
    timers.delete(id)
    timer.fn()
  }
  return { checker, store, calls, errors, timers, clock, zeroTimers, midnightTimers, fire }
}

test('startup before midnight with a successful check today does not check and arms the next midnight', () => {
  const h = checkerHarness({ initial: { lastAutoCheckDate: '2026-06-15' } })
  h.checker.start()
  assert.equal(h.zeroTimers().length, 0, 'no immediate check is due')
  assert.equal(h.calls.length, 0)
  const midnights = h.midnightTimers()
  assert.equal(midnights.length, 1)
  assert.equal(h.timers.get(midnights[0]).ms, 2 * HOUR, 'the timer targets the next local midnight')
})

test('startup after midnight with yesterday as the last success checks once and stamps today', async () => {
  const h = checkerHarness({ initial: { lastAutoCheckDate: '2026-06-14' }, now: at(2026, 5, 15, 0, 30) })
  h.checker.start()
  assert.equal(h.zeroTimers().length, 1, 'the day has not been checked yet')
  h.fire(h.zeroTimers()[0])
  await h.checker.whenIdle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.store.state.lastAutoCheckDate, '2026-06-15')
  assert.equal(h.store.state.lastSeenLatestVersion, 'v0.4.0')
  assert.equal(h.checker.status().lastResult, 'update-available')
})

test('a failed automatic check does not stamp the day and reports failure', async () => {
  const h = checkerHarness({
    initial: { lastAutoCheckDate: '2026-06-14' },
    now: at(2026, 5, 15, 0, 30),
    webFetch: async () => {
      throw new Error('network down')
    },
  })
  h.checker.start()
  h.fire(h.zeroTimers()[0])
  await h.checker.whenIdle()
  assert.equal(h.store.state.lastAutoCheckDate, '2026-06-14', 'a failure must not burn the day')
  assert.equal(h.errors.length, 1)
  assert.equal(h.checker.status().lastResult, 'failed')
})

test('restarting the same day after a successful automatic check does not repeat it', () => {
  const h = checkerHarness({ initial: { lastAutoCheckDate: '2026-06-15' }, now: at(2026, 5, 15, 9, 0) })
  h.checker.start()
  assert.equal(h.zeroTimers().length, 0)
  assert.equal(h.calls.length, 0)
})

test('the manual check ignores the once-per-day guard and never rewrites the automatic date', async () => {
  const h = checkerHarness({ initial: { lastAutoCheckDate: '2026-06-15' } })
  h.checker.start()
  assert.equal(h.zeroTimers().length, 0)
  const outcome = await h.checker.checkNow()
  assert.equal(outcome.ok, true)
  assert.equal(h.calls.length, 1)
  assert.equal(h.store.state.lastSeenLatestVersion, 'v0.4.0')
  assert.equal(h.store.state.lastAutoCheckDate, '2026-06-15', 'the manual check is not an automatic success')
})

test('crossing midnight while running performs exactly one automatic check and reschedules', async () => {
  const h = checkerHarness({ initial: { lastAutoCheckDate: '2026-06-15' }, now: at(2026, 5, 15, 23, 59) })
  h.checker.start()
  assert.equal(h.midnightTimers().length, 1)
  h.clock.ms = at(2026, 5, 16, 0, 0, 3)
  h.fire(h.midnightTimers()[0])
  await h.checker.whenIdle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.store.state.lastAutoCheckDate, '2026-06-16')
  assert.equal(h.midnightTimers().length, 1, 'the next midnight is armed again')
})

test('disabling automatic checks cancels the scheduler and persists the preference', async () => {
  const h = checkerHarness({ initial: { lastAutoCheckDate: '2026-06-14' }, now: at(2026, 5, 15, 0, 30) })
  h.checker.start()
  assert.equal(h.zeroTimers().length, 1)
  const result = await h.checker.setPreferences({ autoCheckUpdates: false })
  assert.equal(result.ok, true)
  assert.equal(h.store.state.autoCheckUpdates, false)
  assert.equal(h.zeroTimers().length, 0)
  assert.equal(h.midnightTimers().length, 0)
  assert.equal(h.calls.length, 0, 'disabling must not run a check')
})

test('re-enabling schedules the next midnight and checks immediately only if today is unproven', async () => {
  const proven = checkerHarness({ initial: { autoCheckUpdates: false, lastAutoCheckDate: '2026-06-15' }, now: at(2026, 5, 15, 8, 0) })
  proven.checker.start()
  assert.equal(proven.timers.size, 0)
  await proven.checker.setPreferences({ autoCheckUpdates: true })
  assert.equal(proven.zeroTimers().length, 0)
  assert.equal(proven.midnightTimers().length, 1)

  const unproven = checkerHarness({ initial: { autoCheckUpdates: false, lastAutoCheckDate: '2026-06-14' }, now: at(2026, 5, 15, 8, 0) })
  unproven.checker.start()
  await unproven.checker.setPreferences({ autoCheckUpdates: true })
  assert.equal(unproven.zeroTimers().length, 1)
  assert.equal(unproven.midnightTimers().length, 1)
})

test('preferences accept only the declared values and reject the rest without persisting', async () => {
  const h = checkerHarness({})
  const invalid = [
    { updateBehavior: 'bogus' },
    { updateBehavior: 3 },
    { autoCheckUpdates: 'yes' },
    { autoCheckUpdates: 1 },
    {},
    null,
    [],
  ]
  for (const patch of invalid) {
    const result = await h.checker.setPreferences(patch)
    assert.equal(result.ok, false, JSON.stringify(patch))
    assert.equal(result.error, 'invalid-preferences')
  }
  assert.deepEqual(h.store.patches, [])
  const valid = await h.checker.setPreferences({ autoCheckUpdates: false, updateBehavior: 'notify-only' })
  assert.equal(valid.ok, true)
  assert.equal(h.store.state.autoCheckUpdates, false)
  assert.equal(h.store.state.updateBehavior, 'notify-only')
})

test('a dismissal persists the exact stable version and a newer release surfaces again', async () => {
  const h = checkerHarness({ initial: { lastSeenLatestVersion: 'v0.4.0', lastAutoCheckDate: '2026-06-15' } })
  const bad = await h.checker.dismiss('main')
  assert.equal(bad.ok, false)
  assert.equal(bad.error, 'invalid-version')
  const good = await h.checker.dismiss('v0.4.0')
  assert.equal(good.ok, true)
  assert.equal(h.store.state.dismissedUpdateVersion, 'v0.4.0')
  assert.equal(good.update.dismissed, true)
  assert.equal(good.update.updateAvailable, true, 'the update is still available, just dismissed')
})

test('status reports the current version, the latest tag, and the pinned install spec', () => {
  const h = checkerHarness({ initial: { lastSeenLatestVersion: 'v0.4.0', lastAutoCheckDate: '2026-06-15' } })
  const status = h.checker.status()
  assert.equal(status.currentVersion, '0.3.8')
  assert.equal(status.latestTag, 'v0.4.0')
  assert.equal(status.latestVersion, '0.4.0')
  assert.equal(status.installSpec, 'github:PipaGs/dsh-you-should-know#v0.4.0')
  assert.equal(status.updateAvailable, true)
  assert.equal(status.dismissed, false)
  assert.equal(status.updateBehavior, 'ask-before-update')
  assert.equal(status.autoCheckUpdates, true)
  assert.equal(status.automaticSupported, false, 'current DSH has no approved update API')
})

test('an equal or older latest release is not an available update', () => {
  const current = checkerHarness({ initial: { lastSeenLatestVersion: 'v0.3.8' } })
  assert.equal(current.checker.status().updateAvailable, false)
  const older = checkerHarness({ initial: { lastSeenLatestVersion: 'v0.3.7' } })
  assert.equal(older.checker.status().updateAvailable, false)
})

test('the release request carries only the release URL and a cancellation signal', async () => {
  const h = checkerHarness({})
  await h.checker.checkNow()
  assert.equal(h.calls.length, 1)
  assert.deepEqual(Object.keys(h.calls[0].request), ['url'])
  assert.equal(h.calls[0].request.url, LATEST_RELEASE_URL)
  assert.equal(LATEST_RELEASE_URL, 'https://api.github.com/repos/PipaGs/dsh-you-should-know/releases/latest')
  assert.ok(h.calls[0].signal instanceof AbortSignal)
})

test('non-200, oversized, unparseable, and non-stable responses fail quietly', async () => {
  const bodies = [
    [{ statusCode: 404, body: { kind: 'text', content: 'not found' }, truncated: false }],
    [{ statusCode: 200, body: { kind: 'text', content: 'x'.repeat(70000) }, truncated: true }],
    [{ statusCode: 200, body: { kind: 'text', content: '{not json' }, truncated: false }],
    [{ statusCode: 200, body: { kind: 'text', content: releaseBody('main') }, truncated: false }],
    [{ statusCode: 200, body: { kind: 'text', content: releaseBody('v0.4.0-rc.1') }, truncated: false }],
  ]
  for (const responses of bodies) {
    const h = checkerHarness({ responses, maxBodyChars: 65536 })
    const outcome = await h.checker.checkNow()
    assert.equal(outcome.ok, false, JSON.stringify(responses))
    assert.equal(outcome.result, 'failed')
    assert.equal(h.store.state.lastSeenLatestVersion, '')
    assert.equal(h.errors.length, 1)
  }
})

test('a missing web fetch service fails quietly instead of throwing', async () => {
  const h = checkerHarness({ webFetch: undefined })
  // Replace the default with an explicitly absent seam.
  const checker = createUpdateChecker({
    currentVersion: '0.3.8',
    getState: () => h.store.state,
    persist: h.store.persist,
    webFetch: undefined,
    now: () => h.clock.ms,
    setTimer: () => 1,
    clearTimer: () => {},
    onError: (error) => h.errors.push(error),
  })
  const outcome = await checker.checkNow()
  assert.equal(outcome.ok, false)
  assert.equal(h.errors.length, 1)
})

test('mergeUpdateState keeps a progress field a stale snapshot omits, while preferences follow it', () => {
  const current = normalizeUpdateState({
    autoCheckUpdates: false,
    updateBehavior: 'automatic',
    lastAutoCheckDate: '2026-06-15',
    lastSeenLatestVersion: 'v0.4.0',
    dismissedUpdateVersion: 'v0.4.0',
  })
  const stale = mergeUpdateState(current, { autoCheckUpdates: true, updateBehavior: 'notify-only' })
  assert.equal(stale.autoCheckUpdates, true, 'preferences follow the snapshot')
  assert.equal(stale.updateBehavior, 'notify-only')
  assert.equal(stale.lastAutoCheckDate, '2026-06-15', 'a progress field is not erased by an empty snapshot value')
  assert.equal(stale.lastSeenLatestVersion, 'v0.4.0')
  assert.equal(stale.dismissedUpdateVersion, 'v0.4.0')
  const fresh = mergeUpdateState(current, {
    autoCheckUpdates: true,
    updateBehavior: 'ask-before-update',
    lastAutoCheckDate: '2026-06-16',
    lastSeenLatestVersion: 'v0.5.0',
  })
  assert.equal(fresh.lastAutoCheckDate, '2026-06-16')
  assert.equal(fresh.lastSeenLatestVersion, 'v0.5.0')
  assert.equal(fresh.dismissedUpdateVersion, 'v0.4.0', 'an empty dismissal keeps the current one')
})

test('an automatic trigger coalesced with an in-flight manual check still stamps the day', async () => {
  const calls = []
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const h = checkerHarness({
    initial: { lastAutoCheckDate: '2026-06-14' },
    now: at(2026, 5, 15, 0, 30),
    webFetch: async (request, signal) => {
      calls.push({ request, signal })
      await gate
      return { statusCode: 200, body: { kind: 'text', content: releaseBody('v0.4.0') }, truncated: false }
    },
  })
  const manual = h.checker.checkNow()
  await tick()
  // The day-first automatic trigger fires while the manual request is in flight.
  h.checker.start()
  h.fire(h.zeroTimers()[0])
  await tick()
  release()
  await manual
  await h.checker.whenIdle()
  assert.equal(calls.length, 1, 'both triggers share one network request')
  assert.equal(h.store.state.lastSeenLatestVersion, 'v0.4.0')
  assert.equal(h.store.state.lastAutoCheckDate, '2026-06-15', 'the automatic trigger still stamps the day')
})

test('an immediate timer armed during an in-flight automatic check does not run a second check', async () => {
  const calls = []
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const h = checkerHarness({
    initial: { lastAutoCheckDate: '2026-06-14' },
    now: at(2026, 5, 15, 0, 30),
    webFetch: async (request) => {
      calls.push(request)
      await gate
      return { statusCode: 200, body: { kind: 'text', content: releaseBody('v0.4.0') }, truncated: false }
    },
  })
  h.checker.start()
  h.fire(h.zeroTimers()[0])
  await tick()
  h.checker.refresh()
  release()
  await h.checker.whenIdle()
  for (const id of h.zeroTimers()) h.fire(id)
  await h.checker.whenIdle()
  assert.equal(calls.length, 1, 'the local day is checked exactly once')
  assert.equal(h.store.state.lastAutoCheckDate, '2026-06-15')
})

test('a rejected persist fails the check instead of reporting an unrecorded version', async () => {
  const errors = []
  const state = normalizeUpdateState({})
  const checker = createUpdateChecker({
    currentVersion: '0.3.8',
    getState: () => state,
    persist: async () => {
      throw new Error('settings are read-only')
    },
    webFetch: async () => ({ statusCode: 200, body: { kind: 'text', content: releaseBody('v0.4.0') }, truncated: false }),
    now: () => at(2026, 5, 15, 10, 0),
    setTimer: () => 1,
    clearTimer: () => {},
    onError: (error) => errors.push(error),
  })
  checker.start()
  const outcome = await checker.checkNow()
  assert.equal(outcome.ok, false)
  assert.equal(outcome.result, 'failed')
  assert.equal(checker.status().latestTag, '', 'no version is reported when it could not be recorded')
  assert.equal(checker.status().lastResult, 'failed')
  assert.ok(errors.length >= 1)
  checker.stop()
})

test('a request that never settles is aborted by the timeout and fails', async () => {
  const h = checkerHarness({ webFetch: () => new Promise(() => {}) })
  const pending = h.checker.checkNow()
  const ids = [...h.timers.keys()]
  assert.equal(ids.length, 1, 'the request timeout is the only armed timer')
  h.fire(ids[0])
  const outcome = await pending
  assert.equal(outcome.ok, false)
  assert.equal(outcome.result, 'failed')
})

test('stop cancels the armed timers and marks the last result failed', () => {
  const h = checkerHarness({ initial: { lastAutoCheckDate: '2026-06-14' }, now: at(2026, 5, 15, 0, 30) })
  h.checker.start()
  assert.equal(h.zeroTimers().length, 1)
  assert.equal(h.midnightTimers().length, 1)
  h.checker.stop()
  assert.equal(h.timers.size, 0)
  assert.equal(h.checker.status().lastResult, 'failed')
})
