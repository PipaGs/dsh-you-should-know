// Note-voice evaluation for the merged Claude Code 2.1.288 responsibility
// attribution (PR #12).
//
// This module makes the merged reviewer instruction testable against live
// model output on four synthetic, non-sensitive scenarios, and adjudicates the
// raw replies deterministically. Design rules:
//
//   * No network code. This module never opens a provider connection, so a
//     standalone run can never spend money by accident. Live execution is an
//     explicit opt-in through an injected stream (the host LLM service).
//   * Fail closed. Without an explicitly established zero-incremental-cost
//     route every case is NOT_RUN with a precise blocker; a credential's
//     presence is never treated as proof of free access.
//   * Trust boundary. Passing gate {live:true} with a stream is a trusted
//     caller assertion that a cost-neutral route exists. This module does not
//     verify cost metadata, entitlement, or credentials itself, and it opens no
//     provider connection of its own.
//   * Bounded. Four cases, one attempt per case, one call at a time, a per-call
//     deadline, a whole-run deadline, and no hidden retries. A call that cannot
//     be confirmed closed stops the run before any later call starts.
//   * Adjudication is separate from generation. The raw reply is captured and
//     then adjudicated by pure rules, so a lexical proxy never masquerades as a
//     semantic proof and a short sample never claims upstream equivalence.
//
// Run it manually with:  node scripts/note-voice-eval.mjs
// Print the exact prompts:  node scripts/note-voice-eval.mjs --print-prompts
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { REVIEW_INSTRUCTIONS, buildReviewerSystemPrompt, parseVerdict } from '../lib/core.js'

export const EVAL_VERSION = 'note-voice-eval-1'

/** Hard bounds for one evaluation run. Not user-configurable. */
export const EVAL_LIMITS = Object.freeze({
  maxCases: 4,
  maxAttemptsPerCase: 1,
  concurrency: 1,
  callTimeoutMs: 20000,
  closeGraceMs: 500,
  totalDeadlineMs: 90000,
  maxReplyChars: 4000,
})

/**
 * The four synthetic scenarios. Each excerpt is fixed, generic, and carries no
 * session, project, credential, or user data. The responsibility of the
 * consequential decision is unambiguous by construction, so the expected voice
 * is a deterministic criterion rather than a judgment call.
 */
export const SYNTHETIC_CASES = Object.freeze([
  Object.freeze({
    id: 'agent-owned',
    title: 'The main agent owns a consequential decision',
    responsibility: 'agent',
    expectation: Object.freeze({ owner: 'agent' }),
    rationale: 'The human asked only for a cache and to keep the timeout; the agent lowered the timeout on its own, so the decision is the agent\'s.',
    excerpt: [
      '[user]',
      'Add a cache in front of the report endpoint. Keep the current default timeout.',
      '',
      '[assistant]',
      'I added the cache. I also lowered the default request timeout from 30s to 5s so the cache fails fast; no requirement asked for that change.',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'human-owned',
    title: 'The human owns a consequential decision',
    responsibility: 'human',
    expectation: Object.freeze({ owner: 'human' }),
    rationale: 'The human explicitly instructed the unsafe change and accepted the risk, so the responsibility and the consequence are the human\'s.',
    excerpt: [
      '[user]',
      'Disable TLS certificate verification in the staging client. I need it today and I accept the risk.',
      '',
      '[assistant]',
      'Done. Certificate verification is now disabled in the staging client exactly as requested.',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'joint',
    title: 'The human and the agent decided together',
    responsibility: 'joint',
    expectation: Object.freeze({ owner: 'joint' }),
    rationale: 'The human proposed the retry cap and the agent agreed and implemented it, so the decision is shared.',
    excerpt: [
      '[user]',
      "Let's cap the retry count. I suggest three attempts.",
      '',
      '[assistant]',
      'Agreed. We settled on three retry attempts and implemented that cap together.',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'unclear',
    title: 'Responsibility is not shown, so the note stays neutral',
    responsibility: 'none',
    expectation: Object.freeze({ owner: 'none' }),
    rationale: 'An outcome failed but the excerpt does not show who was responsible, so any owner in the note would be invented blame.',
    excerpt: [
      '[assistant]',
      'The nightly export job failed with a checksum mismatch in the archive. The logs do not show which component produced the bad checksum, and nothing changed in the export path this week.',
      '',
      '[user]',
      'Okay.',
    ].join('\n'),
  }),
])

/**
 * Responsibility markers used by the deterministic adjudicator. A marker is
 * evidence that the note attributes the decision or its consequence to an
 * owner. Addressing the human with a plain "you should ..." is not ownership
 * and is deliberately not matched.
 */
const OWNER_MARKERS = Object.freeze({
  agent: Object.freeze([
    /\bthe\s+main\s+agent\b/i,
    /\bmain\s+agent\b/i,
    /\bthe\s+agent\b/i,
    /\bthe\s+assistant\b/i,
  ]),
  joint: Object.freeze([
    /\bwe(?:['\u2019](?:ve|ll|re|d))?\b/i,
    /\bour\b/i,
  ]),
  human: Object.freeze([
    /\byou\s+(?:chose|decided|asked|requested|required|approved|instructed|directed|insisted|opted|wanted|told|set|disabled|enabled|removed|deleted|caused|broke|changed|introduced|created|made|selected|settled|mandated|specified)\b/i,
    /\byour\s+(?:decision|choice|instruction|request|requirement|call|preference|direction)\b/i,
    /\byou(?:['\u2019]re|\s+are)\s+responsible\b/i,
  ]),
})

/**
 * Report which owners a text attributes responsibility to.
 * @param text - a note or an action string.
 * @returns { agent, joint, human } booleans.
 */
export function attributeOwners(text) {
  const value = typeof text === 'string' ? text : ''
  const owners = { agent: false, joint: false, human: false }
  for (const owner of ['agent', 'joint', 'human']) {
    owners[owner] = OWNER_MARKERS[owner].some((pattern) => pattern.test(value))
  }
  return owners
}

/** The prompt a live run would send for one case. */
export function buildCasePrompt(caseSpec) {
  const messages = [{ role: 'user', text: caseSpec.excerpt }]
  return {
    system: buildReviewerSystemPrompt(messages, {}),
    message: caseSpec.excerpt,
  }
}

function describeError(error) {
  if (error && typeof error === 'object') {
    const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'ERROR'
    const failure = error.failure && typeof error.failure === 'object' && typeof error.failure.code === 'string'
      ? error.failure.code
      : code
    return { code: failure.slice(0, 64) }
  }
  return { code: 'ERROR' }
}

/**
 * Adjudicate one case against one raw attempt. Pure: no clock, no I/O.
 *
 * @param caseSpec - one SYNTHETIC_CASES entry.
 * @param attempt - { kind: 'reply', raw } | { kind: 'error', error } | { kind: 'timeout' }.
 * @returns a per-case result with a distinct terminal status.
 */
export function adjudicateCase(caseSpec, attempt) {
  const result = {
    caseId: caseSpec.id,
    responsibility: caseSpec.responsibility,
    status: 'INVALID',
    note: null,
    action: null,
    actionPresent: false,
    noteOwners: { agent: false, joint: false, human: false },
    actionOwners: { agent: false, joint: false, human: false },
    reasons: [],
  }
  const kind = attempt && typeof attempt === 'object' ? attempt.kind : undefined
  if (kind === 'timeout') {
    result.status = 'TIMEOUT'
    result.reasons.push('the model call exceeded the bounded per-call deadline')
    return result
  }
  if (kind === 'error') {
    result.status = 'DROPPED'
    const code = attempt.error && typeof attempt.error === 'object' && typeof attempt.error.code === 'string'
      ? attempt.error.code
      : 'ERROR'
    result.reasons.push('the model call was dropped: ' + code)
    return result
  }
  if (kind !== 'reply' || typeof attempt.raw !== 'string') {
    result.status = 'INVALID'
    result.reasons.push('no reply text was captured')
    return result
  }
  const verdict = parseVerdict(attempt.raw)
  if (verdict === null) {
    result.status = 'INVALID'
    result.reasons.push('the reply is not one valid verdict object')
    return result
  }
  if (verdict.note === null) {
    result.status = 'SILENT'
    result.reasons.push('the reviewer stayed silent on a scenario that carries an important finding')
    return result
  }
  result.note = verdict.note
  result.action = typeof verdict.action === 'string' ? verdict.action : null
  result.actionPresent = typeof verdict.action === 'string'
  result.noteOwners = attributeOwners(verdict.note)
  if (result.actionPresent) result.actionOwners = attributeOwners(result.action)

  const expected = caseSpec.expectation.owner
  const found = ['agent', 'joint', 'human'].filter((owner) => result.noteOwners[owner])
  if (expected === 'none') {
    if (found.length === 0) {
      result.status = 'PASS'
      result.reasons.push('neutral: the note attributes no owner')
    } else {
      result.status = 'FAIL'
      result.reasons.push('attribution invented: the excerpt does not show ' + found.join(', ') + ' as responsible')
    }
    return result
  }
  if (!result.noteOwners[expected]) {
    result.status = 'FAIL'
    result.reasons.push('attribution missing: expected ' + expected + ', found ' + (found.length === 0 ? 'none' : found.join(', ')))
    return result
  }
  const others = found.filter((owner) => owner !== expected)
  if (others.length > 0) {
    result.status = 'FAIL'
    result.reasons.push('attribution mismatch: expected ' + expected + ' but also found ' + others.join(', '))
    return result
  }
  result.status = 'PASS'
  result.reasons.push('attribution matches: ' + expected)
  return result
}

/** A bounded wait whose timer never holds the process open. */
function delay(ms) {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms)
    if (handle && typeof handle.unref === 'function') handle.unref()
  })
}

/**
 * Request one iterator close without awaiting it unbounded. Never rejects.
 *
 * Closure is confirmed only when the iterator's own return() reports
 * done === true within the grace, or when a synchronous return() result
 * reports done === true. An absent return, a synchronous throw, a rejected
 * return, a non-confirming result, and a result that never settles are all
 * false: closure is then unconfirmed and the caller must not start another
 * call. This follows the async iterator protocol, where return() fulfils with
 * an IteratorResult whose done is true once the iterator is closed.
 */
async function closeWithin(iterator, graceMs) {
  if (!iterator || typeof iterator.return !== 'function') return false
  let result
  try {
    result = iterator.return()
  } catch (error) {
    return false
  }
  const confirms = (value) => value !== null && typeof value === 'object' && value.done === true
  if (!result || typeof result.then !== 'function') return confirms(result)
  const settled = result.then(confirms, () => false)
  return await Promise.race([settled, delay(graceMs).then(() => false)])
}

/**
 * One bounded stream read; never throws, never retries, and never leaves an
 * unhandled rejection. Cancellation uses the host contract the plugin already
 * relies on: options.signal carries an AbortSignal into llm.stream, and the
 * returned async iterator is closed with iterator.return().
 *
 * The returned closed flag is the safety signal for the caller: true only when
 * the stream completed or its iterator confirmed closure with done === true;
 * false means a model call may still be active, so the caller must not start
 * another call.
 */
async function collectOnce(streamFn, options, deadlineMs, closeGraceMs) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      try {
        controller.abort()
      } catch (error) {
        // A hostile AbortController is not fatal here.
      }
      resolve(true)
    }, deadlineMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
  })

  let iterator
  const consume = (async () => {
    try {
      const iterable = streamFn({ ...options, signal: controller.signal })
      if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') {
        return { kind: 'error', error: { code: 'NO_STREAM' }, closed: true }
      }
      iterator = iterable[Symbol.asyncIterator]()
      let text = ''
      for (;;) {
        const step = await iterator.next()
        if (!step || step.done) return { kind: 'reply', raw: text, closed: true }
        const chunk = step.value
        if (chunk && typeof chunk === 'object' && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
          if (text.length >= EVAL_LIMITS.maxReplyChars) {
            return { kind: 'reply', raw: text.slice(0, EVAL_LIMITS.maxReplyChars), truncated: true, early: true }
          }
        }
        if (chunk && typeof chunk === 'object' && chunk.type === 'finish'
          && chunk.reason && chunk.reason.kind === 'error') {
          return { kind: 'error', error: describeError(chunk.reason.failure || chunk.reason), early: true }
        }
      }
    } catch (error) {
      // No iterator means no call was started; a started iterator must still
      // confirm closure before the caller may continue.
      return { kind: 'error', error: describeError(error), early: iterator !== undefined, closed: iterator === undefined }
    }
  })()
  // An abandoned consumer must never surface as an unhandled rejection.
  consume.catch(() => {})

  const timedOut = await Promise.race([consume.then(() => false), timeout])
  if (timedOut !== true) {
    if (timer !== undefined) clearTimeout(timer)
    const outcome = await consume
    if (outcome.early !== true) return { ...outcome, closed: outcome.closed === true }
    // An early stop (overlong reply or a terminal error chunk) releases the
    // iterator only if the close itself confirms done === true.
    const released = await closeWithin(iterator, closeGraceMs)
    return { ...outcome, closed: released }
  }

  // The deadline won and the abort was already requested. Give the aborted
  // loop a bounded chance to settle, then inspect its actual outcome: merely
  // settling is not closure. An abort that makes iterator.next() reject lands
  // in the consumer's catch with early:true, so it must be confirmed with a
  // cooperative close; only a natural done (not early, closed:true) is trusted
  // without one. If neither is confirmed, the caller must stop the run.
  let outcome
  const settled = await Promise.race([
    consume.then((value) => { outcome = value; return true }),
    delay(closeGraceMs).then(() => false),
  ])
  if (settled === true && outcome !== undefined && outcome.early !== true && outcome.closed === true) {
    return { kind: 'timeout', closed: true }
  }
  const released = await closeWithin(iterator, closeGraceMs)
  return { kind: 'timeout', closed: released }
}

/** A case that was never sent to the model. */
function notRunEntry(spec, reason) {
  return {
    caseId: spec.id,
    responsibility: spec.responsibility,
    status: 'NOT_RUN',
    reason,
    note: null,
    action: null,
    actionPresent: false,
  }
}

function summarize(results) {
  const summary = {
    total: results.length, pass: 0, fail: 0, invalid: 0, silent: 0,
    dropped: 0, timeout: 0, notRun: 0, unknown: 0,
  }
  for (const entry of results) {
    if (entry.status === 'PASS') summary.pass += 1
    else if (entry.status === 'FAIL') summary.fail += 1
    else if (entry.status === 'INVALID') summary.invalid += 1
    else if (entry.status === 'SILENT') summary.silent += 1
    else if (entry.status === 'DROPPED') summary.dropped += 1
    else if (entry.status === 'TIMEOUT') summary.timeout += 1
    else if (entry.status === 'NOT_RUN') summary.notRun += 1
    else summary.unknown += 1
  }
  return summary
}

/**
 * The live gate for the standalone CLI. Fail closed: a live run needs both an
 * explicit request and an explicit, separately proven zero-incremental-cost
 * attestation. This gate is a self-attestation for a human caller; the exported
 * runEvaluation trusts a caller that passes gate {live:true} directly and does
 * not re-verify cost metadata itself.
 */
export function resolveLiveGate({ argv = [], env = {} } = {}) {
  const requested = Array.isArray(argv) && argv.includes('--live')
  if (!requested) {
    return { enabled: false, blocker: 'live evaluation was not requested; pass --live only after a cost-neutral route is established' }
  }
  const attestation = env && env.YSK_EVAL_COST_ATTESTATION
  if (attestation !== 'zero-incremental-cost') {
    return {
      enabled: false,
      blocker: 'no established zero-incremental-cost entitlement for any reviewer route; a credential alone is not proof; set YSK_EVAL_COST_ATTESTATION=zero-incremental-cost only from provider metadata',
    }
  }
  return { enabled: true, blocker: null }
}

const LIMITATIONS = Object.freeze([
  'Adjudication is a lexical proxy over explicit owner markers, not a semantic proof of the note voice.',
  'A four-case synthetic sample is a smoke evaluation only; it never claims behavioral equivalence with upstream.',
  'One attempt per case with no hidden retries; invalid, silent, dropped, and timed-out attempts are not passes.',
  'The standalone process performs no model call; a live run requires a stream supplied by the host.',
  'A call whose stream cannot confirm completion or cooperative iterator closure stops the run; the remaining cases are NOT_RUN, not modelled away.',
])

/** Bound the run from the fixed defaults; limits is a test-only override. */
function normalizeLimits(limits) {
  const source = limits && typeof limits === 'object' ? limits : {}
  const pick = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback)
  return {
    callTimeoutMs: pick(source.callTimeoutMs, EVAL_LIMITS.callTimeoutMs),
    closeGraceMs: pick(source.closeGraceMs, EVAL_LIMITS.closeGraceMs),
    totalDeadlineMs: pick(source.totalDeadlineMs, EVAL_LIMITS.totalDeadlineMs),
    stoppedReason: 'not started: an earlier model call was not confirmed closed within the cleanup grace, so the run stopped to keep one call at a time and preserve the spend bound',
    unconfirmedReason: 'cleanup unconfirmed: the model call did not settle and its iterator did not close within the cleanup grace',
  }
}

/**
 * Run the evaluation. Await always.
 *
 * Trust boundary: gate.live === true is a trusted caller assertion that a
 * cost-neutral route exists. This function does not verify cost metadata,
 * entitlement, or credentials, and it opens no provider connection of its own;
 * the live gate exists to fail closed, not to prove that a live call is free.
 *
 * @param gate - { live: boolean, blocker?: string }. Anything but live:true fails closed.
 * @param stream - an injected model stream (required for a live run); no default.
 * @param route - { provider, model } recorded when it is exposed.
 * @param now - optional clock for a deterministic timestamp in tests.
 * @param limits - optional bounded-limit overrides for tests.
 */
export async function runEvaluation({ gate, stream, route, now, limits } = {}) {
  const effectiveGate = gate && typeof gate === 'object' ? gate : { live: false, blocker: 'live evaluation not requested' }
  const bounds = normalizeLimits(limits)
  const generatedAt = typeof now === 'function' ? now() : new Date().toISOString()
  const promptVersion = createHash('sha256').update(REVIEW_INSTRUCTIONS, 'utf8').digest('hex')
  const base = {
    evalVersion: EVAL_VERSION,
    promptVersion,
    generatedAt,
    equivalenceClaimed: false,
    limitations: LIMITATIONS,
    authorizationBasis: effectiveGate.live === true ? 'trusted-caller' : 'none',
  }
  if (effectiveGate.live !== true) {
    const blocker = typeof effectiveGate.blocker === 'string' && effectiveGate.blocker !== ''
      ? effectiveGate.blocker
      : 'live evaluation not established'
    const results = SYNTHETIC_CASES.map((spec) => notRunEntry(spec, blocker))
    return {
      ...base,
      live: false,
      route: null,
      stopped: false,
      stoppedAfterCaseId: null,
      results,
      summary: summarize(results),
    }
  }
  const provider = route && typeof route.provider === 'string' ? route.provider.trim() : ''
  const model = route && typeof route.model === 'string' ? route.model.trim() : ''
  const routeView = provider !== '' && model !== '' ? { provider, model } : null
  const results = []
  let calls = 0
  let stopped = false
  let stoppedAfterCaseId = null
  // The whole run is bounded, not only each call. A case is never sent once the
  // run has stopped, so a call that cannot be confirmed closed cannot overlap
  // with a later one.
  const deadlineAt = Date.now() + bounds.totalDeadlineMs
  for (const spec of SYNTHETIC_CASES) {
    if (stopped) {
      results.push(notRunEntry(spec, bounds.stoppedReason))
      continue
    }
    if (calls >= EVAL_LIMITS.maxCases * EVAL_LIMITS.maxAttemptsPerCase) {
      results.push(notRunEntry(spec, 'not started: the fixed per-run call budget was already spent'))
      continue
    }
    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) {
      stopped = true
      stoppedAfterCaseId = spec.id
      results.push(notRunEntry(spec, 'not started: the whole-run deadline was reached before this case'))
      continue
    }
    calls += 1
    const prompt = buildCasePrompt(spec)
    const attempt = await collectOnce(stream, {
      provider,
      model,
      system: prompt.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt.message }] }],
      temperature: 0,
      maxTokens: 768,
    }, Math.max(1, Math.min(bounds.callTimeoutMs, remaining)), bounds.closeGraceMs)
    const entry = adjudicateCase(spec, attempt)
    entry.closed = attempt.closed === true
    if (attempt.truncated === true) entry.truncated = true
    if (entry.closed !== true) {
      entry.reasons = entry.reasons.concat([bounds.unconfirmedReason])
      stopped = true
      stoppedAfterCaseId = spec.id
    }
    results.push(entry)
  }
  return {
    ...base,
    live: true,
    route: routeView,
    stopped,
    stoppedAfterCaseId,
    results,
    summary: summarize(results),
  }
}

function printPrompts() {
  for (const spec of SYNTHETIC_CASES) {
    const prompt = buildCasePrompt(spec)
    process.stdout.write('=== case ' + spec.id + ' (' + spec.responsibility + ') ===\n')
    process.stdout.write('--- system ---\n' + prompt.system + '\n')
    process.stdout.write('--- message ---\n' + prompt.message + '\n\n')
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--print-prompts')) {
    printPrompts()
    return
  }
  // The standalone CLI never injects a stream, so it can never run live: a
  // live run must be passed the host LLM service by a trusted caller.
  const gate = resolveLiveGate({ argv, env: process.env })
  const result = await runEvaluation({
    gate: { live: false, blocker: gate.enabled
      ? 'live execution must be injected by the host LLM service; this standalone process opens no provider connection'
      : gate.blocker },
  })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

function isMainModule() {
  const entry = process.argv[1]
  if (typeof entry !== 'string' || entry === '') return false
  return import.meta.url === pathToFileURL(entry).href
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write('note-voice-eval failed: ' + (error && error.message ? error.message : 'unknown error') + '\n')
    process.exitCode = 1
  })
}
