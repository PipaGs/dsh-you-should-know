// Core of dsh-you-should-know.
//
// This module is deliberately dependency-free: the plugin must load from a
// plain "github:" install with no build step and no runtime imports. Every
// function here is either pure or takes its collaborators (the LLM service,
// the clock) by injection, so the whole reviewer path is testable with
// "node --test" and nothing else.

/** Conservative defaults; an empty provider or model keeps the plugin inert. */
export const DEFAULT_CONFIG = Object.freeze({
  provider: '',
  model: '',
  minDeltaChars: 1200,
  cooldownTurns: 3,
  maxContextMessages: 12,
  maxTokens: 700,
})

/** Accepted bounds and internal safety budgets (not user-configurable). */
export const LIMITS = Object.freeze({
  minDeltaChars: Object.freeze({ min: 0, max: 200000 }),
  cooldownTurns: Object.freeze({ min: 1, max: 100 }),
  maxContextMessages: Object.freeze({ min: 1, max: 100 }),
  maxTokens: Object.freeze({ min: 32, max: 8000 }),
  maxNoteChars: 600,
  maxContextChars: 12000,
  maxMessageChars: 1500,
  maxReplyChars: 4000,
  maxBodyChars: 8192,
  /** Hard per-session ceiling so a long session cannot spawn unbounded reviews. */
  maxNotesPerSession: 12,
  /** Ceiling on tracked sessions, so a long-lived host does not grow without bound. */
  maxTrackedSessions: 200,
})

const IMPORTANCE = Object.freeze(['high', 'critical'])

// Only a human-authored `user/message` enters the reviewer excerpt. Tool
// results, project/agent instructions, checkpoints, schedule rows, and other
// machine-authored user-role events stay inside the host: the reviewer is an
// external model and must not receive tool output or injected instructions.
const HUMAN_USER_SOURCE = 'user'

/**
 * Normalize and validate a raw plugin config.
 *
 * Invalid values never throw: each one falls back to its conservative default
 * and contributes a warning, so a malformed row can never break plugin load or
 * primary work.
 *
 * @param raw - the row's `config` value, possibly undefined or malformed.
 * @returns the validated config plus human-readable warnings.
 */
export function normalizeConfig(raw) {
  const warnings = []
  const input = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    warnings.push('config must be a mapping; every field fell back to its default')
  }
  return {
    config: {
      provider: readText(input.provider, 'provider', warnings),
      model: readText(input.model, 'model', warnings),
      minDeltaChars: readBoundedInt(input.minDeltaChars, 'minDeltaChars', warnings),
      cooldownTurns: readBoundedInt(input.cooldownTurns, 'cooldownTurns', warnings),
      maxContextMessages: readBoundedInt(input.maxContextMessages, 'maxContextMessages', warnings),
      maxTokens: readBoundedInt(input.maxTokens, 'maxTokens', warnings),
    },
    warnings,
  }
}

function readText(value, field, warnings) {
  if (value === undefined) return DEFAULT_CONFIG[field]
  if (typeof value !== 'string') {
    warnings.push(`${field} must be a string; using the default`)
    return DEFAULT_CONFIG[field]
  }
  return value.trim()
}

function readBoundedInt(value, field, warnings) {
  if (value === undefined) return DEFAULT_CONFIG[field]
  const bounds = LIMITS[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    warnings.push(`${field} must be an integer in [${bounds.min}, ${bounds.max}]; using the default ${DEFAULT_CONFIG[field]}`)
    return DEFAULT_CONFIG[field]
  }
  return value
}

/**
 * The activation gate: both halves of the reviewer route must be present.
 * @param config - a normalized config.
 * @returns whether the plugin may call the reviewer model at all.
 */
export function isConfigured(config) {
  return Boolean(config && config.provider !== '' && config.model !== '')
}

/** @returns the session id of a Session-like object, or undefined. */
export function sessionIdOf(session) {
  if (!session) return undefined
  const header = session.header
  if (header && typeof header.id === 'string' && header.id !== '') return header.id
  if (typeof session.id === 'string' && session.id !== '') return session.id
  return undefined
}

/**
 * Whether a Session is a subagent child. Child sessions are never reviewed:
 * the plan observes completed root-agent turns only.
 * @param session - a Session-like object.
 * @returns true for subagent children.
 */
export function isChildSession(session) {
  const header = session && session.header
  if (!header) return false
  if (header.origin === 'subagent') return true
  return typeof header.delegationDepth === 'number' && header.delegationDepth > 0
}

/**
 * Read a Session's committed event log through the current public accessor.
 *
 * The Session class exposes no public `events` field: the supported read is
 * `snapshotEvents()`, with an array-valued `events` property accepted as a
 * fallback for test doubles and older shapes. A session whose log cannot be
 * read yields an empty list, which all gates treat as "nothing to review".
 *
 * @param session - a Session-like object.
 * @returns the committed events, or an empty array.
 */
export function eventsOf(session) {
  if (!session) return []
  if (typeof session.snapshotEvents === 'function') {
    try {
      const snapshot = session.snapshotEvents()
      if (Array.isArray(snapshot)) return snapshot
    } catch (error) {
      // Fall through to the array-shaped fallback; a hostile accessor is not fatal here.
    }
  }
  return Array.isArray(session.events) ? session.events : []
}

/** Extract visible text from a content-block array. */
export function textOfBlocks(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * @returns `{ role, text }` for one log event, or null when it carries no
 * visible conversation text. Human user messages only: every other
 * user-role source is machine traffic that must not reach the reviewer.
 */
export function messageText(event) {
  if (!event || typeof event !== 'object') return null
  if (event.type === 'user/message') {
    const source = event.data && event.data.source
    const kind = source && typeof source.kind === 'string' ? source.kind : ''
    if (kind !== HUMAN_USER_SOURCE) return null
    const text = textOfBlocks(event.data && event.data.content).trim()
    return text === '' ? null : { role: 'user', text }
  }
  if (event.type === 'assistant/message') {
    const text = textOfBlocks(event.data && event.data.message && event.data.message.content).trim()
    return text === '' ? null : { role: 'assistant', text }
  }
  return null
}

/** @returns the highest event sequence number, or -1 for an empty log. */
export function lastSeq(events) {
  let seq = -1
  if (!Array.isArray(events)) return seq
  for (const event of events) {
    if (event && typeof event.seq === 'number' && event.seq > seq) seq = event.seq
  }
  return seq
}

/** Visible assistant text produced inside one turn. */
export function turnOutputText(events, turn) {
  if (!Array.isArray(events)) return ''
  const parts = []
  for (const event of events) {
    if (!event || event.type !== 'assistant/message') continue
    if (!event.data || event.data.turn !== turn) continue
    const text = textOfBlocks(event.data.message && event.data.message.content)
    if (text !== '') parts.push(text)
  }
  return parts.join('\n').trim()
}

/** Characters of visible conversation text appended after `sinceSeq`. */
export function accumulatedDelta(events, sinceSeq) {
  if (!Array.isArray(events)) return 0
  let total = 0
  for (const event of events) {
    if (!event || typeof event.seq !== 'number' || event.seq <= sinceSeq) continue
    const message = messageText(event)
    if (message) total += message.text.length
  }
  return total
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * Build a bounded recent-context excerpt for the reviewer.
 *
 * The budget applies newest-first so the review always sees the most recent
 * exchange, then the excerpt is returned in chronological order.
 *
 * @param events - the session log.
 * @param maxMessages - the maximum number of text messages to include.
 * @returns the excerpt, possibly empty.
 */
export function collectContext(events, maxMessages) {
  if (!Array.isArray(events)) return ''
  const limit = Number.isInteger(maxMessages) && maxMessages > 0 ? maxMessages : DEFAULT_CONFIG.maxContextMessages
  const newestFirst = []
  for (let index = events.length - 1; index >= 0 && newestFirst.length < limit; index -= 1) {
    const message = messageText(events[index])
    if (message) newestFirst.push(message)
  }
  const lines = []
  let total = 0
  for (const message of newestFirst) {
    const line = `[${message.role}]\n${truncate(message.text, LIMITS.maxMessageChars)}`
    if (lines.length > 0 && total + line.length > LIMITS.maxContextChars) break
    total += line.length
    lines.push(line)
  }
  lines.reverse()
  return lines.join('\n\n')
}

/** The reviewer instruction. One self-contained user message, no tools. */
export const REVIEW_INSTRUCTIONS = [
  'You are an independent reviewer looking over a coding agent\'s completed turn.',
  'The human is the user; the agent is the assistant. You see a bounded excerpt of the recent conversation.',
  '',
  'Report only information that is genuinely important, novel, and actionable for the human, and that the agent most likely missed. Qualifying information is limited to:',
  '- a contradiction with an explicit requirement the user stated;',
  '- a material constraint the agent overlooked;',
  '- a serious correctness, security, safety, data-loss, or reliability problem;',
  '- an important implication that changes what the user should do next.',
  '',
  'Stay silent otherwise. Do not summarize, restate, praise, or give style advice. Do not ask questions. Never invent facts that are not present in the excerpt.',
  '',
  'Reply with one JSON object and nothing else:',
  '{"note": "<one or two sentences addressed to the human>", "importance": "high" | "critical"}',
  'When there is nothing important to report, reply exactly:',
  '{"note": null, "importance": null}',
].join('\n')

/**
 * Build the reviewer prompt for one review.
 * @param context - the bounded conversation excerpt.
 * @returns the full prompt text.
 */
export function buildReviewPrompt(context) {
  const excerpt = typeof context === 'string' ? context : ''
  return `${REVIEW_INSTRUCTIONS}\n\n--- BEGIN RECENT CONVERSATION ---\n${excerpt}\n--- END RECENT CONVERSATION ---`
}

/**
 * Extract the first balanced JSON object from arbitrary model text.
 * @returns the substring, or null when no object opener exists.
 */
export function firstJsonObject(text) {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

/**
 * Parse and validate a reviewer reply.
 *
 * Malformed replies, unknown importance values, and non-object payloads all
 * return null, which the caller drops quietly.
 *
 * @param raw - the accumulated assistant text.
 * @returns `{ note, importance }` where note may be null, or null when malformed.
 */
export function parseVerdict(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const text = raw.trim()
  const candidates = [text]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced && typeof fenced[1] === 'string') candidates.push(fenced[1].trim())
  const balanced = firstJsonObject(text)
  if (balanced !== null) candidates.push(balanced)
  let payload = null
  for (const candidate of candidates) {
    if (candidate === '') continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed
        break
      }
    } catch (error) {
      // Try the next candidate shape.
    }
  }
  if (payload === null) return null
  const note = payload.note
  if (note === null || note === undefined) return { note: null, importance: null }
  if (typeof note !== 'string') return null
  const trimmed = note.trim()
  if (trimmed === '') return { note: null, importance: null }
  const importance = payload.importance
  if (typeof importance !== 'string' || !IMPORTANCE.includes(importance)) return null
  return { note: truncate(trimmed, LIMITS.maxNoteChars), importance }
}

/**
 * Normalized comparison key for a note, used to suppress repeats of the same
 * advice across turns.
 */
export function dedupeKey(note) {
  if (typeof note !== 'string') return ''
  const trimmed = note.trim()
  if (trimmed === '') return ''
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  // A note with no ASCII alphanumerics still needs a stable comparison key.
  return normalized === '' ? trimmed.toLowerCase().slice(0, 200) : normalized
}

async function resolveReasoningEffort(llm, provider, model) {
  if (!llm || typeof llm.resolveModelInfo !== 'function') return undefined
  try {
    const info = await llm.resolveModelInfo(provider, model)
    const efforts = info && info.reasoning && Array.isArray(info.reasoning.efforts) ? info.reasoning.efforts : []
    return efforts.some((effort) => effort && effort.id === 'off') ? 'off' : undefined
  } catch (error) {
    return undefined
  }
}

async function callReviewer({ llm, config, prompt, onError }) {
  if (!llm || typeof llm.stream !== 'function') return null
  const reasoningEffort = await resolveReasoningEffort(llm, config.provider, config.model)
  const options = {
    provider: config.provider,
    model: config.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    temperature: 0,
    maxTokens: config.maxTokens,
  }
  if (reasoningEffort !== undefined) options.reasoningEffort = reasoningEffort
  let text = ''
  try {
    for await (const chunk of llm.stream(options)) {
      if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
        if (text.length >= LIMITS.maxReplyChars) break
      }
    }
  } catch (error) {
    onError(error)
    return null
  }
  return parseVerdict(text)
}

/**
 * Create the per-process reviewer engine.
 *
 * `observe(session, event)` is called for every session event; it applies the
 * gates synchronously and, when they pass, starts one reviewer call. The
 * returned `promise` resolves to the review outcome and exists for tests and
 * diagnostics; production callers ignore it.
 *
 * @param options.config - a normalized config.
 * @param options.getLlm - resolves the LLM service lazily (may return undefined).
 * @param options.now - clock, injectable for tests.
 * @param options.onError - contained error sink.
 */
export function createEngine(options) {
  const { config, getLlm, now = Date.now, onError = () => {} } = options
  const sessions = new Map()
  let noteSequence = 0

  function stateOf(sessionId) {
    let state = sessions.get(sessionId)
    if (state === undefined) {
      if (sessions.size >= LIMITS.maxTrackedSessions) {
        sessions.delete(sessions.keys().next().value)
      }
      state = {
        reviewedSeq: -1,
        turnIndex: 0,
        lastReviewTurn: Number.NEGATIVE_INFINITY,
        seen: new Set(),
        notes: [],
        inFlight: false,
      }
      sessions.set(sessionId, state)
    }
    return state
  }

  function observe(session, event) {
    if (!isConfigured(config)) return { status: 'inert' }
    if (!event || event.type !== 'turn/end') return { status: 'ignored' }
    const reason = event.data && event.data.reason
    if (!reason || reason.kind !== 'completed') return { status: 'ignored' }
    if (isChildSession(session)) return { status: 'ignored' }
    const sessionId = sessionIdOf(session)
    if (sessionId === undefined) return { status: 'ignored' }

    const events = eventsOf(session)
    const turn = event.data.turn
    const state = stateOf(sessionId)
    state.turnIndex += 1

    if (state.inFlight) return { status: 'busy' }
    if (state.notes.length >= LIMITS.maxNotesPerSession) return { status: 'budget' }
    if (state.turnIndex - state.lastReviewTurn < config.cooldownTurns) return { status: 'cooldown' }
    if (turnOutputText(events, turn) === '') return { status: 'empty' }
    if (accumulatedDelta(events, state.reviewedSeq) < config.minDeltaChars) return { status: 'delta' }

    const prompt = buildReviewPrompt(collectContext(events, config.maxContextMessages))
    state.inFlight = true
    state.lastReviewTurn = state.turnIndex
    state.reviewedSeq = lastSeq(events)

    const promise = callReviewer({ llm: getLlm(), config, prompt, onError })
      .then((verdict) => {
        if (verdict === null || verdict.note === null) return { status: 'silent' }
        const key = dedupeKey(verdict.note)
        if (key === '' || state.seen.has(key)) return { status: 'duplicate' }
        if (state.notes.length >= LIMITS.maxNotesPerSession) return { status: 'budget' }
        state.seen.add(key)
        const note = {
          id: `${sessionId}:${noteSequence += 1}`,
          note: verdict.note,
          importance: verdict.importance,
          createdAt: now(),
        }
        state.notes.push(note)
        return { status: 'noted', note }
      })
      .catch((error) => {
        onError(error)
        return { status: 'error' }
      })
      .finally(() => {
        state.inFlight = false
      })

    return { status: 'reviewing', promise }
  }

  function notes(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return []
    const state = sessions.get(sessionId)
    if (state === undefined) return []
    return state.notes
      .filter((note) => note.dismissed !== true)
      .map((note) => ({ id: note.id, note: note.note, importance: note.importance, createdAt: note.createdAt }))
  }

  function dismiss(sessionId, noteId) {
    if (typeof sessionId !== 'string' || typeof noteId !== 'string') return false
    const state = sessions.get(sessionId)
    if (state === undefined) return false
    const note = state.notes.find((candidate) => candidate.id === noteId)
    if (note === undefined || note.dismissed === true) return false
    note.dismissed = true
    return true
  }

  function forget(sessionId) {
    return sessions.delete(sessionId)
  }

  return { observe, notes, dismiss, forget }
}

/** Read a bounded JSON request body; resolves to undefined on any failure. */
export function readJsonBody(request, limit = LIMITS.maxBodyChars) {
  return new Promise((resolve) => {
    if (!request || typeof request.on !== 'function') {
      resolve(undefined)
      return
    }
    let size = 0
    const chunks = []
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    request.on('data', (chunk) => {
      if (settled) return
      const text = typeof chunk === 'string' ? chunk : String(chunk)
      size += text.length
      if (size > limit) {
        finish(undefined)
        return
      }
      chunks.push(text)
    })
    request.on('error', () => finish(undefined))
    request.on('end', () => {
      const body = chunks.join('')
      if (body.trim() === '') {
        finish(undefined)
        return
      }
      try {
        const parsed = JSON.parse(body)
        finish(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined)
      } catch (error) {
        finish(undefined)
      }
    })
  })
}

function sendJson(response, status, payload) {
  try {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(payload))
  } catch (error) {
    // The peer may have closed the socket; nothing useful remains to send.
  }
}

/**
 * Build the two localhost HTTP handlers the browser half polls.
 * @param engine - the reviewer engine.
 * @returns `{ notes, dismiss }` handlers accepting `(request, response)`.
 */
export function createRequestHandlers(engine) {
  async function notes(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end()
      return
    }
    let sessionId = ''
    try {
      const url = new URL(request.url || '/', 'http://localhost')
      sessionId = url.searchParams.get('sessionId') || ''
    } catch (error) {
      sessionId = ''
    }
    sendJson(response, 200, { ok: true, notes: engine.notes(sessionId) })
  }

  async function dismiss(request, response) {
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' })
      response.end()
      return
    }
    const body = await readJsonBody(request)
    if (body === undefined) {
      sendJson(response, 400, { ok: false, error: 'invalid-body' })
      return
    }
    const removed = engine.dismiss(
      typeof body.sessionId === 'string' ? body.sessionId : '',
      typeof body.noteId === 'string' ? body.noteId : '',
    )
    sendJson(response, 200, { ok: true, dismissed: removed })
  }

  return { notes, dismiss }
}
