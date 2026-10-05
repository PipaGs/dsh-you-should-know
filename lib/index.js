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
  isConfigured,
  normalizeConfig,
  sessionIdOf,
  snapshotConfig,
} from './core.js'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-you-should-know'

/**
 * Declarative row schema for the host settings service. Every field is volatile,
 * so the loader commits a config edit into this fiber's live references in place
 * and reports `loader/volatile-update` instead of remounting the plugin. That
 * is what lets the Plugins settings card, a profile patch, and this plugin's own
 * config route all reach a running reviewer. The route keys stay optional:
 * omitted means automatic discovery, and an explicit empty string still
 * disables the plugin.
 */
export const Config = z.object({
  provider: z.string().volatile(),
  model: z.string().volatile(),
  minDeltaChars: z.number().step(1).min(LIMITS.minDeltaChars.min).max(LIMITS.minDeltaChars.max).default(DEFAULT_CONFIG.minDeltaChars).volatile(),
  cooldownTurns: z.number().step(1).min(LIMITS.cooldownTurns.min).max(LIMITS.cooldownTurns.max).default(DEFAULT_CONFIG.cooldownTurns).volatile(),
  maxContextMessages: z.number().step(1).min(LIMITS.maxContextMessages.min).max(LIMITS.maxContextMessages.max).default(DEFAULT_CONFIG.maxContextMessages).volatile(),
  maxTokens: z.number().step(1).min(LIMITS.maxTokens.min).max(LIMITS.maxTokens.max).default(DEFAULT_CONFIG.maxTokens).volatile(),
})

const NOTES_PATH = '/api/dsh-you-should-know/notes'
const DISMISS_PATH = '/api/dsh-you-should-know/dismiss'
const STATUS_PATH = '/api/dsh-you-should-know/status'
const SESSION_PATH = '/api/dsh-you-should-know/session'
const CONFIG_PATH = '/api/dsh-you-should-know/config'

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

  const engine = createEngine({
    config,
    getLlm: () => (typeof ctx.get === 'function' ? ctx.get('llm') : ctx.llm),
    now: () => Date.now(),
    onError: (error) => warn(`reviewer call failed: ${describe(error)}`),
  })

  // Teardown releases the process-global slot and stops every per-session
  // runtime. The release is idempotent and only frees our own token, so a
  // repeated dispose or a newer owner is never disturbed.
  let released = false
  ctx.effect(() => () => {
    if (released) return
    released = true
    try {
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
      const { warnings: nextWarnings } = engine.updateConfig(snapshotConfig(rawConfig))
      for (const warning of nextWarnings) warn(warning)
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
    })
    const routes = [
      { path: NOTES_PATH, methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch: handlers.notes },
      { path: DISMISS_PATH, methods: ['POST'], requestBody: 'streaming', fetch: handlers.dismiss },
      { path: STATUS_PATH, methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch: handlers.status },
      // GET/HEAD share one path with POST, and the connection declares one
      // requestBody mode per path: the streaming carrier hands node:http's body
      // stream to Request, which rejects a body on GET/HEAD. Buffering keeps
      // reads working and still delivers the small JSON POST bodies intact.
      { path: SESSION_PATH, methods: ['GET', 'HEAD', 'POST'], requestBody: 'buffered', fetch: handlers.session },
      { path: CONFIG_PATH, methods: ['GET', 'HEAD', 'POST'], requestBody: 'buffered', fetch: configHandlers.config },
    ]
    for (const route of routes) {
      hostCtx.effect(
        () => hostCtx.connection.fetch.register(route),
        `dsh-you-should-know: ${route.path} Fetch route`,
      )
    }
  })
}
