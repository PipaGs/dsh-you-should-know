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
const RUNTIME_STATES: readonly string[] = Object.freeze(['idle', 'reviewing', 'quota_exhausted', 'halted', 'degraded', 'disposed'])

/** One runtime state the self-check may report. */
export type RuntimeState = 'idle' | 'reviewing' | 'quota_exhausted' | 'halted' | 'degraded' | 'disposed'

/** The update-checker fields the self-check is allowed to forward. */
const UPDATE_FIELDS = Object.freeze(['currentVersion', 'latestVersion', 'latestTag', 'installSpec', 'source', 'updateAvailable', 'dismissed', 'autoCheckUpdates', 'updateBehavior', 'automaticSupported', 'lastAutoCheckDate', 'lastCheckedAt', 'lastResult'])

/**
 * The exact pinned Git target the self-check may forward. A spec that does not
 * match this shape (a URL, a branch name, a prerelease, control characters) is
 * dropped rather than echoed.
 */
const INSTALL_SPEC = /^github:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** Longest accepted install spec; a parsed stable tag is at most 64 chars. */
const MAX_SPEC_CHARS = 128

/** One engine diagnostic snapshot, as the self-check consumes it. */
export interface SelfCheckEngine {
  diagnostics: () => unknown
}

/** One update-checker status source, as the self-check consumes it. */
export interface SelfCheckUpdateChecker {
  status: () => unknown
}

/** One bounded self-check input set. */
export interface SelfCheckInput {
  pluginVersion?: unknown
  installedVersion?: unknown
  diagnostics?: unknown
  handlers?: unknown
  update?: unknown
}

/** One self-check handler option set. */
export interface SelfCheckHandlerOptions {
  engine: SelfCheckEngine
  updateChecker?: SelfCheckUpdateChecker | null
  pluginVersion: string
  handlers?: unknown
  onError?: (error: unknown) => void
  readInstalledVersion?: (onError: (error: unknown) => void) => Promise<string | null>
}

/** One reported route capability. */
export interface RouteCapabilityView {
  name: string
  methods: string[]
  registered: boolean
}

/** Whether one untrusted value is a plain object the readers may probe. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** Whether one untrusted value is a runtime state the payload may report. */
function isRuntimeState(value: unknown): value is RuntimeState {
  return typeof value === 'string' && RUNTIME_STATES.includes(value)
}

/**
 * Bound one string to a short metadata value, or null when it is unusable.
 * @param value - a candidate version or enum label.
 * @returns the trimmed value when short and non-empty, else null.
 */
function boundedText(value: unknown): string | null {
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
export function normalizeVersion(value: unknown): string | null {
  const text = boundedText(value)
  if (text === null) return null
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(text) ? text : null
}

/**
 * Bound one string field to a short value, keeping an empty marker intact.
 * @param value - a candidate date or version label.
 * @returns the value when short, else undefined so the caller drops it.
 */
function boundedFieldText(value: string): string | undefined {
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
export function routeCapabilityView(handlers: unknown): RouteCapabilityView[] {
  const map = isRecord(handlers) ? handlers : {}
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
 * than shipping a capability that reports false. recentCheckDiagnostics
 * reflects the live opt-in and is therefore read from diagnostics, not from a
 * handler or a compile-time constant.
 * @param handlers - the concrete handler functions keyed by route name.
 * @param diagnostics - the engine's bounded diagnostic snapshot, when present.
 * @returns the bounded capability map.
 */
export function buildCapabilities(handlers: unknown, diagnostics?: unknown) {
  const map = isRecord(handlers) ? handlers : {}
  return {
    feedback: typeof map.dismiss === 'function',
    explain: typeof map.explain === 'function',
    evidence: typeof buildEvidenceCapsule === 'function',
    episodeTrigger: typeof collectEpisodeEvidence === 'function',
    adaptiveBudget: typeof reviewerBudget === 'function',
    updateChecker: typeof map.update === 'function',
    recentCheckDiagnostics: isRecord(diagnostics) && diagnostics.recentCheckDiagnostics === true,
  }
}

/**
 * Forward only the bounded, harmless update fields: version tags, dates, and
 * enum/boolean state. Derived install specs and unknown fields are dropped.
 * @param status - the update checker's status, or null when none is wired.
 * @returns the allowlisted update summary.
 */
export function updateSummary(status: unknown): Record<string, unknown> {
  const source = isRecord(status) ? status : {}
  const summary: Record<string, unknown> = {}
  for (const field of UPDATE_FIELDS) {
    if (!Object.hasOwn(source, field)) continue
    const value = source[field]
    if (typeof value === 'boolean') summary[field] = value
    else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_METADATA_NUMBER) summary[field] = value
    else if (value === null) summary[field] = null
    else if (typeof value === 'string') {
      if (field === 'installSpec') {
        // An empty target is honest ("no stable tag seen yet"); a non-empty one
        // is only forwarded when it is the exact pinned Git shape.
        if (value === '') summary[field] = ''
        else if (value.length <= MAX_SPEC_CHARS && INSTALL_SPEC.test(value)) summary[field] = value
      } else {
        const text = boundedFieldText(value)
        if (text !== undefined) summary[field] = text
      }
    }
  }
  return summary
}

/**
 * Bound the effective reviewer mode to one of the shipped mode ids.
 * @param value - a candidate mode id from the engine.
 * @returns the known mode id, else null.
 */
function reviewerModeOf(value: unknown): string | null {
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
export function buildSelfCheckPayload(input: SelfCheckInput) {
  const diagnostics = isRecord(input.diagnostics) ? input.diagnostics : {}
  const routes = routeCapabilityView(input.handlers)
  const runtimeStatus: RuntimeState | 'unknown' = isRuntimeState(diagnostics.runtimeStatus) ? diagnostics.runtimeStatus : 'unknown'
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
    capabilities: buildCapabilities(input.handlers, diagnostics),
    update: updateSummary(input.update),
  }
}

/**
 * Read this package's own installed manifest version in a source or installed
 * layout, the same way the DSH runtime reads its own version. A missing or
 * malformed manifest degrades to null instead of guessing.
 * @returns the installed version, or null.
 */
export async function readInstalledVersion(onError?: (error: unknown) => void): Promise<string | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    return normalizeVersion(isRecord(manifest) ? manifest.version : undefined)
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
export function createSelfCheckHandler(options: SelfCheckHandlerOptions) {
  const engine = options.engine
  const checker = options.updateChecker
  const handlers = options.handlers
  const onError: (error: unknown) => void = typeof options.onError === 'function' ? options.onError : () => {}
  const readInstalled: (onError: (error: unknown) => void) => Promise<string | null> = typeof options.readInstalledVersion === 'function' ? options.readInstalledVersion : readInstalledVersion

  async function selfCheck(request: Request | null | undefined): Promise<Response> {
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
