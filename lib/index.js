// Host half of dsh-you-should-know.
//
// The plugin watches completed root-agent turns, asks a separately configured
// reviewer model for a second opinion, and stores any resulting note in
// plugin-owned per-session memory. The reviewer route is adaptive by default:
// it asks the live LLM registry which DeepSeek route this build mounts, and an
// explicit provider/model pair overrides that exactly. It deliberately never
// touches the primary agent: no steer, no inject, no followup, no log append.
// The only consumer is the human, through the browser route below.
//
// Its only non-relative import is the host-provided @deepseek-ai/schemastery
// Config schema, so an installed copy still works from a plain "github:" install
// with no build step and no bundled dependency.

import {
  DEFAULT_CONFIG,
  LIMITS,
  createConfigHandlers,
  createEngine,
  createFetchHandlers,
  createUpdateHandlers,
  isConfigured,
  normalizeConfig,
  sessionIdOf,
  snapshotConfig,
} from './core.js'
import z from '@deepseek-ai/schemastery'
import { MAX_ADDITIONAL_INSTRUCTIONS_CHARS, MAX_CUSTOM_PROMPT_CHARS, REVIEW_MODES } from './review-strictness.js'
import { ROUTE_CAPABILITIES, createSelfCheckHandler } from './self-check.js'
import { DEFAULT_UPDATE_BEHAVIOR, UPDATE_BEHAVIORS, createUpdateChecker, mergeUpdateState, normalizeUpdateState } from './update.js'

export const name = 'dsh-you-should-know'

// The running plugin version. It mirrors package.json, and the update checker
// compares it against the newest stable Git tag of the public repository.
export const PLUGIN_VERSION = '0.4.2'

/**
 * Declarative row schema for the host settings service. Every field is volatile,
 * so the loader commits a config edit into this fiber's live references in place
 * and reports `loader/volatile-update` instead of remounting the plugin. That
 * is what lets the Plugins settings card, a profile patch, and this plugin's own
 * config route all reach a running reviewer. The route keys stay optional:
 * omitted means automatic discovery, and an explicit empty string still
 * disables the plugin. The strictness mode and the human's additional reviewer
 * instructions are volatile too, so a mode change or an instruction edit also
 * lands live without a remount. The update-checking preferences and the tiny
 * non-sensitive update state (a local date, a release tag, a dismissal, and the
 * update behavior enum) are volatile as well, so the scheduler can persist them
 * into this same row without a remount.
 */
export const Config = z.object({
  provider: z.string().volatile(),
  model: z.string().volatile(),
  reviewerMode: z.union(REVIEW_MODES.map((id) => z.const(id))).default(DEFAULT_CONFIG.reviewerMode).volatile(),
  additionalInstructions: z.string().max(MAX_ADDITIONAL_INSTRUCTIONS_CHARS).default(DEFAULT_CONFIG.additionalInstructions).volatile(),
  customReviewerPrompt: z.string().max(MAX_CUSTOM_PROMPT_CHARS).default(DEFAULT_CONFIG.customReviewerPrompt).volatile(),
  minDeltaChars: z.number().step(1).min(LIMITS.minDeltaChars.min).max(LIMITS.minDeltaChars.max).default(DEFAULT_CONFIG.minDeltaChars).volatile(),
  cooldownTurns: z.number().step(1).min(LIMITS.cooldownTurns.min).max(LIMITS.cooldownTurns.max).default(DEFAULT_CONFIG.cooldownTurns).volatile(),
  maxContextMessages: z.number().step(1).min(LIMITS.maxContextMessages.min).max(LIMITS.maxContextMessages.max).default(DEFAULT_CONFIG.maxContextMessages).volatile(),
  maxTokens: z.number().step(1).min(LIMITS.maxTokens.min).max(LIMITS.maxTokens.max).default(DEFAULT_CONFIG.maxTokens).volatile(),
  maxReviewerCallsPerHour: z.number().step(1).min(LIMITS.maxReviewerCallsPerHour.min).max(LIMITS.maxReviewerCallsPerHour.max).default(DEFAULT_CONFIG.maxReviewerCallsPerHour).volatile(),
  autoCheckUpdates: z.boolean().default(true).volatile(),
  updateBehavior: z.union(UPDATE_BEHAVIORS.map((id) => z.const(id))).default(DEFAULT_UPDATE_BEHAVIOR).volatile(),
  lastAutoCheckDate: z.string().max(10).default('').volatile(),
  lastSeenLatestVersion: z.string().max(64).default('').volatile(),
  dismissedUpdateVersion: z.string().max(64).default('').volatile(),
})

// Every route path, method set, and body mode lives in ROUTE_CAPABILITIES in
// lib/self-check.js. Registration and the self-check both read that one table,
// so the capabilities the diagnostics report cannot drift from what ships.

// The plugin row id: the settings persistence key for the single row this
// package mounts. It is also the Plugins settings card key.
const ROW_ID = 'you-should-know'

// Process-global ownership token. Composing the same package twice — two Loader
// rows resolving to one module instance, or two cache-busted imports of this
// file — must still produce exactly one reviewer. A module-local counter is not
// enough: two fresh imports have separate module scopes but share globalThis,
// so the claim lives there, keyed by a registered symbol every import resolves
// to the same value.
const OWNER_KEY = Symbol.for('dsh-you-should-know.reviewer-owner')

function claimOwnership() {
  const existing = globalThis[OWNER_KEY]
  if (existing !== undefined && existing.active === true) return null
  const token = { active: true }
  globalThis[OWNER_KEY] = token
  return token
}

/** Release only our own token, so a stale disposer cannot free a newer owner. */
function releaseOwnership(token) {
  if (globalThis[OWNER_KEY] === token) delete globalThis[OWNER_KEY]
}

function warn(message) {
  console.warn(`[dsh-you-should-know] ${message}`)
}

function describe(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

// The locale plugin persists the human's explicit language choice as the
// "preference" field of its "locale" settings namespace. DSH exposes no
// host-side locale service, so the only public host read is the settings
// service's own form projection.
const LOCALE_SETTINGS_NAMESPACE = 'locale'
const LOCALE_PREFERENCE_FIELD = 'preference'

/**
 * Read the explicit host user-language preference from the public settings form
 * projection. A missing settings service, a missing locale entry, or an
 * unusable value is simply "no host value"; the caller falls back to the
 * excerpt language and then English.
 *
 * @param settings - the host settings service, when mounted.
 * @returns the stored language tag, or undefined.
 */
function readHostLanguage(settings) {
  if (settings === undefined || settings === null || typeof settings.describe !== 'function') return undefined
  let forms
  try {
    forms = settings.describe()
  } catch (error) {
    return undefined
  }
  if (!Array.isArray(forms)) return undefined
  for (const form of forms) {
    if (form === null || typeof form !== 'object' || form.ns !== LOCALE_SETTINGS_NAMESPACE) continue
    const value = form.value !== null && typeof form.value === 'object' ? form.value[LOCALE_PREFERENCE_FIELD] : undefined
    if (typeof value === 'string' && value !== '') return value
    const user = form.user !== null && typeof form.user === 'object' ? form.user[LOCALE_PREFERENCE_FIELD] : undefined
    if (typeof user === 'string' && user !== '') return user
    return undefined
  }
  return undefined
}

/** The disposed session id, accepting a Session-like object or a bare id. */
function disposedSessionId(session) {
  if (typeof session === 'string' && session !== '') return session
  return sessionIdOf(session)
}

/**
 * Cordis plugin body.
 * @param ctx - host context.
 * @param rawConfig - the row's config: volatile references as the loader hands
 *   them over, or a plain object. Normalized here; the exported Config schema is
 *   what the host validates and persists.
 */
export function apply(ctx, rawConfig) {
  // The loader hands each volatile schema field to apply as a stable { get() }
  // reference and later commits config edits into it in place, so the config is
  // snapshotted here and re-read when loader/volatile-update fires. A throwing
  // reference must not break plugin load, so it falls back to an automatic row.
  let initial
  try {
    initial = snapshotConfig(rawConfig)
  } catch (error) {
    warn(`config snapshot failed; the reviewer route stays automatic: ${describe(error)}`)
    initial = {}
  }
  const { config, warnings } = normalizeConfig(initial)
  for (const warning of warnings) warn(warning)

  // Gate first: an explicit blank provider or model disables the plugin
  // entirely, so it registers nothing and makes zero model calls. The automatic
  // default passes this gate; its concrete DeepSeek route is discovered lazily
  // and, when this build mounts none, the engine stays quiet with zero calls.
  if (!isConfigured(config)) return

  const token = claimOwnership()
  if (token === null) {
    warn('already composed in this process; this duplicate row stays inert')
    return
  }

  const settingsService = () => (typeof ctx.get === 'function' ? ctx.get('settings') : ctx.settings)
  const engine = createEngine({
    config,
    getLlm: () => (typeof ctx.get === 'function' ? ctx.get('llm') : ctx.llm),
    // The host language seam is read lazily on every review and Explain call,
    // so a live locale change needs no remount.
    getHostLanguage: () => readHostLanguage(settingsService()),
    now: () => Date.now(),
    onError: (error) => warn(`reviewer call failed: ${describe(error)}`),
  })

  // Update discovery is host-side and read-only. It runs one fixed-shape
  // `git ls-remote --tags --refs` command for the trusted repository through
  // the documented public ctx.shell seam and persists only harmless
  // version/date metadata in the same plugin row. A direct seam caller receives
  // the deployment sandbox policy, so the command stays confined; the shell
  // service may mount after this row, so the seam is resolved lazily on every
  // check and a missing one is a quiet failure. It never installs, upgrades, or
  // writes a profile file.
  const update = { state: normalizeUpdateState(initial) }
  const shellExec = (request, signal) => {
    const shell = typeof ctx.get === 'function' ? ctx.get('shell') : ctx.shell
    if (shell === undefined || shell === null || typeof shell.resolve !== 'function' || typeof shell.execute !== 'function') {
      throw new Error('no public shell service is mounted')
    }
    const spec = shell.resolve({
      command: request.command,
      timeoutMs: request.timeoutMs,
      stdoutMaxBytes: request.stdoutMaxBytes,
      onExpiry: 'kill',
      env: request.env,
      ...(signal === undefined ? {} : { signal }),
    })
    return shell.execute(spec).then((execution) => execution.result())
  }
  const updateChecker = createUpdateChecker({
    currentVersion: PLUGIN_VERSION,
    getState: () => update.state,
    persist: async (patch) => {
      const settings = typeof ctx.get === 'function' ? ctx.get('settings') : ctx.settings
      if (settings === undefined || settings === null || typeof settings.update !== 'function') {
        throw new Error('host settings are read-only')
      }
      // Reflect the accepted write immediately, then roll back if the host
      // rejects it, so a concurrent refresh guard sees the real new state.
      const previous = update.state
      update.state = { ...update.state, ...patch }
      try {
        await settings.update(ROW_ID, patch)
      } catch (error) {
        update.state = previous
        throw error
      }
    },
    shellExec,
    now: () => Date.now(),
    onError: (error) => warn(`update check failed: ${describe(error)}`),
  })
  updateChecker.start()

  // Teardown releases the process-global slot, stops the update scheduler, and
  // stops every per-session runtime. The release is idempotent and only frees
  // our own token, so a repeated dispose or a newer owner is never disturbed.
  let released = false
  ctx.effect(() => () => {
    if (released) return
    released = true
    try {
      updateChecker.stop()
      engine.dispose()
    } catch (error) {
      warn(`teardown failed: ${describe(error)}`)
    } finally {
      releaseOwnership(token)
    }
  }, 'dsh-you-should-know: teardown')

  ctx.on('session/event', (session, event) => {
    try {
      engine.observe(session, event)
    } catch (error) {
      // Fail quiet: a reviewer bug must never disturb the primary agent.
      warn(`observation failed: ${describe(error)}`)
    }
  })

  // A disposed session takes its notes, dedupe set, override, and runtime with
  // it, so a long-lived host does not retain state for sessions that are gone.
  ctx.on('session/disposed', (session) => {
    try {
      const sessionId = disposedSessionId(session)
      if (sessionId !== undefined) engine.forget(sessionId)
    } catch (error) {
      warn(`session cleanup failed: ${describe(error)}`)
    }
  })

  // A config edit the host commits into this fiber's volatile references. The
  // row schema declares every field volatile, so a profile patch or the Plugins
  // settings page lands here without a remount; re-reading the same references
  // and applying them live is the whole live-update path. A throwing reference
  // keeps the previous live config and never escapes the listener.
  ctx.on('loader/volatile-update', () => {
    try {
      const snapshot = snapshotConfig(rawConfig)
      const { warnings: nextWarnings } = engine.updateConfig(snapshot)
      for (const warning of nextWarnings) warn(warning)
      // Merge rather than replace: a snapshot that has not yet observed a
      // just-persisted progress field must not erase it.
      update.state = mergeUpdateState(update.state, snapshot)
      updateChecker.refresh()
    } catch (error) {
      warn(`live config update failed; keeping the previous config: ${describe(error)}`)
    }
  })

  // The browser half reaches these routes through the connection Fetch carrier:
  // exact routes under the absolute /api prefix. The connection owns the
  // Host/Origin fence and browser authentication, and the Desktop app origin
  // proxies /api to the host, so an origin-root absolute path never resolves.
  // Registering on the raw web server would deliver the routes only to the web
  // server's own origin, which is not where the Desktop loads the app page.
  ctx.inject(['connection'], (hostCtx) => {
    const settings = typeof ctx.get === 'function' ? ctx.get('settings') : ctx.settings
    const handlers = createFetchHandlers(engine)
    // The persisted plugin row is the single config source, so the config
    // route writes through the host settings service when it is mounted and
    // reports itself read-only when it is not. No personal settings namespace
    // is registered: the row id is the settings key, with replace resetting the
    // live fields for automatic mode and update merging a pinned route.
    const configHandlers = createConfigHandlers(engine, {
      getLlm: () => (typeof ctx.get === 'function' ? ctx.get('llm') : ctx.llm),
      settings,
      rowId: ROW_ID,
      // The update state is volatile and lives in this same row, so automatic
      // mode (settings.replace) must carry it explicitly or reset it.
      preserveFields: () => ({ ...update.state }),
      // The settings card reads the bounded update status with the config, so
      // opening it never makes a second request and never triggers a check.
      updateStatus: () => updateChecker.status(),
    })
    const updateHandlers = createUpdateHandlers(updateChecker, {
      writable: () => settings !== undefined && settings !== null && typeof settings.update === 'function',
    })
    // One concrete handler per named capability. The self-check reports whether
    // each entry is present, and the registration loop below walks the shared
    // table, so a capability cannot be described without being registered.
    const routeHandlers = {
      notes: handlers.notes,
      history: handlers.history,
      dismiss: handlers.dismiss,
      status: handlers.status,
      // GET/HEAD share one path with POST, and the connection declares one
      // requestBody mode per path: the streaming carrier hands node:http's body
      // stream to Request, which rejects a body on GET/HEAD. Buffering keeps
      // reads working and still delivers the small JSON POST bodies intact.
      session: handlers.session,
      explain: handlers.explain,
      config: configHandlers.config,
      update: updateHandlers.update,
    }
    routeHandlers['self-check'] = createSelfCheckHandler({
      engine,
      updateChecker,
      pluginVersion: PLUGIN_VERSION,
      handlers: routeHandlers,
      onError: (error) => warn(`self-check failed: ${describe(error)}`),
    }).selfCheck
    for (const capability of ROUTE_CAPABILITIES) {
      const fetchHandler = routeHandlers[capability.name]
      if (typeof fetchHandler !== 'function') {
        warn(`route capability ${capability.name} has no handler; it stays unregistered`)
        continue
      }
      const route = { path: capability.path, methods: [...capability.methods], requestBody: capability.requestBody, fetch: fetchHandler }
      hostCtx.effect(
        () => hostCtx.connection.fetch.register(route),
        `dsh-you-should-know: ${route.path} Fetch route`,
      )
    }
  })
}
