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
// The module imports nothing at runtime so an installed copy works from a
// plain "github:" install with no build step.

import {
  createEngine,
  createFetchHandlers,
  isConfigured,
  normalizeConfig,
} from './core.js'

export const name = 'dsh-you-should-know'

const NOTES_PATH = '/api/dsh-you-should-know/notes'
const DISMISS_PATH = '/api/dsh-you-should-know/dismiss'
const STATUS_PATH = '/api/dsh-you-should-know/status'

// Module-level instance guard. Composing the same package twice (two Loader
// rows resolving to one module instance) must still produce one reviewer.
let activeReviewers = 0

function warn(message) {
  console.warn(`[dsh-you-should-know] ${message}`)
}

function describe(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Cordis plugin body.
 * @param ctx - host context.
 * @param rawConfig - the row's config, validated here rather than by a schema.
 */
export function apply(ctx, rawConfig) {
  const { config, warnings } = normalizeConfig(rawConfig)
  for (const warning of warnings) warn(warning)

  // Gate first: an explicit blank provider or model disables the plugin
  // entirely, so it registers nothing and makes zero model calls. The automatic
  // default passes this gate; its concrete DeepSeek route is discovered lazily
  // and, when this build mounts none, the engine stays quiet with zero calls.
  if (!isConfigured(config)) return

  if (activeReviewers > 0) {
    warn('already composed in this process; this duplicate row stays inert')
    return
  }
  activeReviewers += 1
  let released = false
  ctx.effect(() => () => {
    if (released) return
    released = true
    activeReviewers -= 1
  }, 'dsh-you-should-know: instance guard')

  const engine = createEngine({
    config,
    getLlm: () => (typeof ctx.get === 'function' ? ctx.get('llm') : ctx.llm),
    now: () => Date.now(),
    onError: (error) => warn(`reviewer call failed: ${describe(error)}`),
  })

  ctx.on('session/event', (session, event) => {
    try {
      engine.observe(session, event)
    } catch (error) {
      // Fail quiet: a reviewer bug must never disturb the primary agent.
      warn(`observation failed: ${describe(error)}`)
    }
  })

  // The browser half reaches these routes through the connection Fetch carrier:
  // exact routes under the absolute /api prefix. The connection owns the
  // Host/Origin fence and browser authentication, and the Desktop app origin
  // proxies /api to the host, so an origin-root absolute path never resolves.
  // Registering on the raw web server would deliver the routes only to the web
  // server's own origin, which is not where the Desktop loads the app page.
  ctx.inject(['connection'], (hostCtx) => {
    const handlers = createFetchHandlers(engine)
    const routes = [
      { path: NOTES_PATH, methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch: handlers.notes },
      { path: DISMISS_PATH, methods: ['POST'], requestBody: 'streaming', fetch: handlers.dismiss },
      { path: STATUS_PATH, methods: ['GET', 'HEAD'], requestBody: 'buffered', fetch: handlers.status },
    ]
    for (const route of routes) {
      hostCtx.effect(
        () => hostCtx.connection.fetch.register(route),
        `dsh-you-should-know: ${route.path} Fetch route`,
      )
    }
  })
}
