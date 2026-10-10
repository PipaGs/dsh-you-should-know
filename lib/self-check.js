// Authenticated in-product self-check for dsh-you-should-know.
//
// The host registers every plugin route from ROUTE_CAPABILITIES, and this
// module's diagnostics handler reads that same table, so the route names and
// capabilities the self-check reports cannot drift from what is actually
// registered. The handler answers only from in-process state: it calls the
// engine and the update checker directly and never makes a network request, so
// it cannot recurse into the routes it describes.
//
// The response is a bounded, non-sensitive operational snapshot. It never
// carries note, action, source, explanation, evidence, custom prompt,
// additional instruction, provider secret, or session transcript text.
//
// Authentication is owned by the host connection carrier: this route is
// registered through hostCtx.connection.fetch.register alongside the other
// routes, so the carrier applies its Host/Origin fence and browser-session
// authentication before the handler runs. This module never reads, stores, or
// forwards a cookie, token, or Authorization header.

import { readFile } from 'node:fs/promises'
import { reviewerBudget } from './adaptive.js'
import { jsonResponse, methodNotAllowed } from './core.js'
import { buildEvidenceCapsule, collectEpisodeEvidence } from './evidence.js'
import { REVIEW_MODES } from './review-strictness.js'

/** Exact Fetch route path for the diagnostics handler. */
export const SELF_CHECK_PATH = '/api/dsh-you-should-know/self-check'

/**
 * The literal naming the transport that carries every plugin route: the DSH
 * connection Fetch carrier, which authenticates the browser session before
 * dispatch. The browser half never handles a token itself.
 */
export const AUTH_TRANSPORT = 'host-authenticated-connection'

/**
 * The compile-time route registry. lib/index.js registers exactly these routes
 * through the connection Fetch carrier, and the self-check reports exactly this
 * list, so registration and diagnostics share one source.
 */
export const ROUTE_CAPABILITIES = Object.freeze([
  Object.freeze({ name: 'notes', path: '/api/dsh-you-should-know/notes', methods: Object.freeze(['GET', 'HEAD']), requestBody: 'buffered' }),
  Object.freeze({ name: 'history', path: '/api/dsh-you-should-know/history', methods: Object.freeze(['GET', 'HEAD']), requestBody: 'buffered' }),
  Object.freeze({ name: 'dismiss', path: '/api/dsh-you-should-know/dismiss', methods: Object.freeze(['POST']), requestBody: 'streaming' }),
  Object.freeze({ name: 'status', path: '/api/dsh-you-should-know/status', methods: Object.freeze(['GET', 'HEAD']), requestBody: 'buffered' }),
  Object.freeze({ name: 'session', path: '/api/dsh-you-should-know/session', methods: Object.freeze(['GET', 'HEAD', 'POST']), requestBody: 'buffered' }),
  Object.freeze({ name: 'explain', path: '/api/dsh-you-should-know/explain', methods: Object.freeze(['POST']), requestBody: 'buffered' }),
  Object.freeze({ name: 'config', path: '/api/dsh-you-should-know/config', methods: Object.freeze(['GET', 'HEAD', 'POST']), requestBody: 'buffered' }),
  Object.freeze({ name: 'update', path: '/api/dsh-you-should-know/update', methods: Object.freeze(['GET', 'HEAD', 'POST']), requestBody: 'buffered' }),
  Object.freeze({ name: 'self-check', path: SELF_CHECK_PATH, methods: Object.freeze(['GET', 'HEAD']), requestBody: 'buffered' }),
])

/** Longest accepted version or enum string in the payload. */
const MAX_METADATA_CHARS = 64

/** Largest accepted numeric metadata value (safe timestamps stay far below). */
const MAX_METADATA_NUMBER = 1e15

/** The runtime states the self-check may report; anything else is unknown. */
const RUNTIME_STATES = Object.freeze(['idle', 'reviewing', 'quota_exhausted', 'halted', 'degraded', 'disposed'])

/** The update-checker fields the self-check is allowed to forward. */
const UPDATE_FIELDS = Object.freeze(['currentVersion', 'latestVersion', 'latestTag', 'updateAvailable', 'dismissed', 'autoCheckUpdates', 'updateBehavior', 'lastAutoCheckDate', 'lastCheckedAt', 'lastResult'])

/**
 * Bound one string to a short metadata value, or null when it is unusable.
 * @param value - a candidate version or enum label.
 * @returns the trimmed value when short and non-empty, else null.
 */
function boundedText(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_METADATA_CHARS) return null
  return trimmed
}

/**
 * Bound one version string to the stable or prerelease dotted shape.
 * @param value - a candidate version.
 * @returns the version when it looks like a semver, else null.
 */
export function normalizeVersion(value) {
  const text = boundedText(value)
  if (text === null) return null
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(text) ? text : null
}

/**
 * Bound one string field to a short value, keeping an empty marker intact.
 * @param value - a candidate date or version label.
 * @returns the value when short, else undefined so the caller drops it.
 */
function boundedFieldText(value) {
  const trimmed = value.trim()
  if (trimmed.length > MAX_METADATA_CHARS) return undefined
  return /[\u0000-\u001f\u007f]/.test(trimmed) ? undefined : trimmed
}

/**
 * Describe each registered route by name, methods, and whether a handler is
 * actually present in the supplied map.
 * @param handlers - the concrete handler functions keyed by route name.
 * @returns one bounded entry per capability, in registration order.
 */
export function routeCapabilityView(handlers) {
  const map = handlers !== null && typeof handlers === 'object' ? handlers : {}
  return ROUTE_CAPABILITIES.map((capability) => ({
    name: capability.name,
    methods: [...capability.methods],
    registered: typeof map[capability.name] === 'function',
  }))
}

/**
 * The feature flags the self-check reports. The route-backed flags follow the
 * concrete handler map, so an unregistered route reports false. evidence,
 * episodeTrigger, and adaptiveBudget are compile-time true because this module
 * imports those features at load: a build without them fails to link rather
 * than shipping a capability that reports false.
 * @param handlers - the concrete handler functions keyed by route name.
 * @returns the bounded capability map.
 */
export function buildCapabilities(handlers) {
  const map = handlers !== null && typeof handlers === 'object' ? handlers : {}
  return {
    feedback: typeof map.dismiss === 'function',
    explain: typeof map.explain === 'function',
    evidence: typeof buildEvidenceCapsule === 'function',
    episodeTrigger: typeof collectEpisodeEvidence === 'function',
    adaptiveBudget: typeof reviewerBudget === 'function',
    updateChecker: typeof map.update === 'function',
  }
}

/**
 * Forward only the bounded, harmless update fields: version tags, dates, and
 * enum/boolean state. Derived install specs and unknown fields are dropped.
 * @param status - the update checker's status, or null when none is wired.
 * @returns the allowlisted update summary.
 */
export function updateSummary(status) {
  const source = status !== null && typeof status === 'object' ? status : {}
  const summary = {}
  for (const field of UPDATE_FIELDS) {
    if (!Object.hasOwn(source, field)) continue
    const value = source[field]
    if (typeof value === 'boolean') summary[field] = value
    else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_METADATA_NUMBER) summary[field] = value
    else if (value === null) summary[field] = null
    else if (typeof value === 'string') {
      const text = boundedFieldText(value)
      if (text !== undefined) summary[field] = text
    }
  }
  return summary
}

/**
 * Bound the effective reviewer mode to one of the shipped mode ids.
 * @param value - a candidate mode id from the engine.
 * @returns the known mode id, else null.
 */
function reviewerModeOf(value) {
  const text = boundedText(value)
  return text !== null && REVIEW_MODES.includes(text) ? text : null
}

/**
 * Build the bounded self-check payload from in-process state only.
 * @param input.pluginVersion - the running module version constant.
 * @param input.installedVersion - the installed manifest version, or null.
 * @param input.diagnostics - the engine's bounded diagnostic snapshot.
 * @param input.handlers - the concrete registered route handlers.
 * @param input.update - the update checker status, or null.
 * @returns the self-check response body.
 */
export function buildSelfCheckPayload(input) {
  const diagnostics = input.diagnostics !== null && typeof input.diagnostics === 'object' ? input.diagnostics : {}
  const routes = routeCapabilityView(input.handlers)
  const runtimeStatus = RUNTIME_STATES.includes(diagnostics.runtimeStatus) ? diagnostics.runtimeStatus : 'unknown'
  const configured = diagnostics.configured === true
  const runtimeHealthy = runtimeStatus === 'idle' || runtimeStatus === 'reviewing'
  return {
    ok: true,
    authTransport: AUTH_TRANSPORT,
    healthy: configured && runtimeHealthy && routes.every((route) => route.registered === true),
    configured,
    // pluginVersion and runtimeVersion are the same loaded module constant: the
    // task names both, so both are reported from one expression and cannot
    // drift apart.
    pluginVersion: normalizeVersion(input.pluginVersion),
    runtimeVersion: normalizeVersion(input.pluginVersion),
    installedVersion: normalizeVersion(input.installedVersion),
    runtimeStatus,
    reviewerMode: reviewerModeOf(diagnostics.reviewerMode),
    routes,
    capabilities: buildCapabilities(input.handlers),
    update: updateSummary(input.update),
  }
}

/**
 * Read this package's own installed manifest version in a source or installed
 * layout, the same way the DSH runtime reads its own version. A missing or
 * malformed manifest degrades to null instead of guessing.
 * @returns the installed version, or null.
 */
export async function readInstalledVersion(onError) {
  try {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    return normalizeVersion(manifest !== null && typeof manifest === 'object' ? manifest.version : undefined)
  } catch (error) {
    // An unreadable manifest is not fatal; the caller reports no installed
    // version and the UI says the comparison is unavailable.
    if (typeof onError === 'function') onError(error)
    return null
  }
}

/**
 * Build the authenticated self-check Fetch handler.
 *
 * @param options.engine - the reviewer engine; its diagnostics() stays in-process.
 * @param options.updateChecker - the update checker, or undefined.
 * @param options.pluginVersion - the running module version constant.
 * @param options.handlers - the concrete registered route handlers.
 * @param options.readInstalledVersion - override for the manifest reader.
 * @returns the self-check handler accepting a Request and resolving to a Response.
 */
export function createSelfCheckHandler(options) {
  const engine = options.engine
  const checker = options.updateChecker
  const handlers = options.handlers
  const onError = typeof options.onError === 'function' ? options.onError : () => {}
  const readInstalled = typeof options.readInstalledVersion === 'function' ? options.readInstalledVersion : readInstalledVersion

  async function selfCheck(request) {
    try {
      const method = request !== null && request !== undefined && typeof request.method === 'string' ? request.method : ''
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed('GET, HEAD')
      const installedVersion = await readInstalled(onError)
      const payload = buildSelfCheckPayload({
        pluginVersion: options.pluginVersion,
        installedVersion,
        diagnostics: engine.diagnostics(),
        handlers,
        update: checker === undefined || checker === null ? null : checker.status(),
      })
      return jsonResponse(200, payload, method === 'HEAD')
    } catch (error) {
      onError(error)
      return jsonResponse(500, { ok: false, error: 'internal' })
    }
  }

  return { selfCheck }
}
