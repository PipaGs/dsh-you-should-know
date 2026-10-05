// Host/runtime foundation for dsh-you-should-know.
//
// This module is deliberately dependency-free: the plugin must load from a
// plain "github:" install with no build step and no runtime imports. It owns
// the per-session reviewer scheduler: a bounded FIFO queue drained one job at a
// time, a whole-call deadline that also bounds an iterator which ignores its
// AbortSignal, one transient retry, transport-failure backlog flushing, and the
// quota/permanent failure states that pause or halt further calls.
//
// Everything external is injected (the model stream, capability lookup, the
// strict verdict parser, the human delivery callback, the clock and timers), so
// the module never reaches into agent APIs and is testable with "node --test"
// and nothing else.

/** Internal safety budgets. Not user-configurable. */
export const RUNTIME_LIMITS = Object.freeze({
  /** Hard per-session ceiling on queued reviews; the newest overflow is dropped. */
  maxQueued: 32,
  /** Whole-call deadline for one model stream, including an iterator that ignores AbortSignal. */
  deadlineMs: 60000,
  /** Delay before the single transient retry. */
  retryDelayMs: 1000,
  /** Consecutive transport-failure drops that flush the queued backlog. */
  transportDropFlushThreshold: 3,
  /** Bound on the accumulated reply text; reading stops once it is reached. */
  maxReplyChars: 4000,
})

/** Terminal/observable runtime states reported by status(). */
export const RUNTIME_STATUS = Object.freeze({
  idle: 'idle',
  reviewing: 'reviewing',
  quotaExhausted: 'quota_exhausted',
  halted: 'halted',
  degraded: 'degraded',
  disposed: 'disposed',
})

/** Failure codes the current DSH LLM stream shapes classify as transient. */
const TRANSIENT_CODES = Object.freeze(['TIMEOUT', 'SERVER', 'TRANSPORT', 'EMPTY_RESPONSE'])

/** Failure codes that mean an exhausted account quota or a request-rate limit. */
const QUOTA_CODES = Object.freeze(['RATE_LIMIT', 'QUOTA', 'ACCOUNT_QUOTA', 'INSUFFICIENT_QUOTA'])

/**
 * Codes that fail identically on every attempt: a malformed credential, no
 * adapter, an unknown model, or an unsupported request control.
 */
const PERMANENT_PATTERN = /INVALID_CREDENTIAL|MISSING_CREDENTIAL|NO_ADAPTER|NOT_FOUND|UNSUPPORTED|UNKNOWN_MODEL|INVALID_MODEL|UNAUTHORIZED|FORBIDDEN|INVALID_(?:ARGS|PREPARED_CALL|CATALOG|DISCOVERY)|INVARIANT/

/**
 * Classify one LLM failure code into the runtime's retry policy.
 *
 * Unknown codes are not treated as permanent: a novel transient code would be
 * retried once and dropped, never halt the session. Only the explicit
 * credential/adapter/model/unsupported families halt.
 *
 * @param code - a provider-neutral failure code, possibly absent.
 * @returns one of transient, quota, permanent, aborted, unknown.
 */
export function classifyFailure(code) {
  if (typeof code !== 'string' || code === '') return 'unknown'
  const upper = code.toUpperCase()
  if (upper === 'ABORTED') return 'aborted'
  if (QUOTA_CODES.includes(upper)) return 'quota'
  if (TRANSIENT_CODES.includes(upper)) return 'transient'
  if (PERMANENT_PATTERN.test(upper)) return 'permanent'
  return 'unknown'
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

/** Read a thrown value as a provider-neutral failure without trusting accessors. */
function failureOf(value) {
  if (isObject(value)) {
    const carried = value.failure
    if (isObject(carried) && typeof carried.code === 'string' && carried.code !== '') {
      return {
        message: typeof carried.message === 'string' ? carried.message : '',
        code: carried.code,
        status: carried.status,
      }
    }
    if (typeof value.code === 'string' && value.code !== '') {
      return {
        message: typeof value.message === 'string' ? value.message : '',
        code: value.code,
        status: value.status,
      }
    }
  }
  if (value instanceof Error) return { message: value.message, code: '' }
  return { message: '', code: '' }
}

/** Close an async iterator without awaiting a hostile iterator's return. */
function closeIterator(iterator) {
  try {
    if (!iterator || typeof iterator.return !== 'function') return
    const result = iterator.return()
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch (error) {
    // A hostile iterator.return() is not fatal: the runtime already moved on.
  }
}

/**
 * Create one per-session reviewer runtime.
 *
 * @param options.getStream - resolves the current model-stream function; may
 *   return undefined when the LLM service is not mounted.
 * @param options.resolveModelInfo - capability lookup for one provider/model.
 * @param options.parseReply - the strict whole-response verdict parser.
 * @param options.onNote - human-only delivery callback; its return value names
 *   the terminal outcome.
 * @param options.onError - contained diagnostic sink for stream/capability failures.
 * @param options.now - clock.
 * @param options.setTimer - timer schedule function (injectable for tests).
 * @param options.clearTimer - timer cancel function (injectable for tests).
 * @param options.maxQueued, options.deadlineMs, options.retryDelayMs,
 *   options.maxReplyChars - budget overrides, mainly for tests.
 */
export function createRuntime(options = {}) {
  const {
    getStream,
    resolveModelInfo,
    parseReply,
    onNote,
    onError,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle),
  } = options
  const maxQueued = Number.isInteger(options.maxQueued) && options.maxQueued > 0 ? options.maxQueued : RUNTIME_LIMITS.maxQueued
  const deadlineMs = Number.isFinite(options.deadlineMs) && options.deadlineMs > 0 ? options.deadlineMs : RUNTIME_LIMITS.deadlineMs
  const retryDelayMs = Number.isFinite(options.retryDelayMs) && options.retryDelayMs >= 0 ? options.retryDelayMs : RUNTIME_LIMITS.retryDelayMs
  const maxReplyChars = Number.isInteger(options.maxReplyChars) && options.maxReplyChars > 0 ? options.maxReplyChars : RUNTIME_LIMITS.maxReplyChars
  const transportDropFlushThreshold = Number.isInteger(options.transportDropFlushThreshold) && options.transportDropFlushThreshold > 0
    ? options.transportDropFlushThreshold
    : RUNTIME_LIMITS.transportDropFlushThreshold

  const queue = []
  const pendingWaits = new Set()
  const capabilityCache = new Map()
  let draining = false
  let disposed = false
  let paused = false
  let halted = false
  let degraded = false
  let currentEntry = null
  let currentController = null
  let consecutiveTransportDrops = 0
  let runtimeStatus = RUNTIME_STATUS.idle
  let idleResolvers = []
  let releaseDispose
  const disposePromise = new Promise((resolve) => {
    releaseDispose = resolve
  })

  const counters = {
    reviewStarts: 0,
    completedReviews: 0,
    emptyReplies: 0,
    lastEmptyReplyAt: null,
    unparsedReplies: 0,
    lastUnparsedReplyAt: null,
    transportDrops: 0,
    lastTransportDropAt: null,
    queueDrops: 0,
    lastQueueDropAt: null,
    backlogFlushes: 0,
    lastReviewAt: null,
    lastOutcome: null,
  }

  function reportFailure(failure, cause) {
    if (typeof onError !== 'function') return
    if (cause !== undefined) {
      onError(cause)
      return
    }
    const error = new Error(failure && failure.message ? failure.message : 'LLM stream failed')
    if (failure && typeof failure.code === 'string' && failure.code !== '') error.code = failure.code
    onError(error)
  }

  /** Sleep before the transient retry; resolves false when dispose cancels it. */
  function waitRetry(ms) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        pendingWaits.delete(cancel)
        resolve(value)
      }
      const handle = setTimer(() => finish(true), ms)
      const cancel = () => {
        clearTimer(handle)
        finish(false)
      }
      pendingWaits.add(cancel)
    })
  }

  /** Resolve the advertised reasoning effort for a route, caching only a successful lookup. */
  async function capabilityFor(provider, model) {
    const key = `${provider}\u0000${model}`
    if (capabilityCache.has(key)) return capabilityCache.get(key)
    if (typeof resolveModelInfo !== 'function') return undefined
    const info = await resolveModelInfo(provider, model)
    const reasoning = isObject(info) ? info.reasoning : undefined
    const efforts = isObject(reasoning) && Array.isArray(reasoning.efforts) ? reasoning.efforts : []
    const value = efforts.some((effort) => isObject(effort) && effort.id === 'off') ? 'off' : undefined
    capabilityCache.set(key, value)
    return value
  }

  function buildOptions(job, signal, reasoningEffort) {
    const built = {
      provider: job.provider,
      model: job.model,
      system: job.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: job.message }] }],
      temperature: 0,
      maxTokens: job.maxTokens,
      signal,
    }
    if (reasoningEffort !== undefined) built.reasoningEffort = reasoningEffort
    return built
  }

  /** Race the stream consumption against the whole-call deadline and dispose. */
  async function withDeadline(consume) {
    let timedOut = false
    let handle
    const deadline = new Promise((resolve) => {
      handle = setTimer(() => {
        timedOut = true
        resolve('deadline')
      }, deadlineMs)
    })
    const winner = await Promise.race([
      consume.then(() => 'done'),
      deadline,
      disposePromise.then(() => 'disposed'),
    ])
    clearTimer(handle)
    return { winner, timedOut }
  }

  /** One model stream attempt; never throws out of the runtime. */
  async function attemptOnce(job, controller) {
    if (disposed || controller.signal.aborted) return { kind: 'failure', failure: { message: 'aborted', code: 'ABORTED' } }
    const streamFn = typeof getStream === 'function' ? getStream() : undefined
    if (typeof streamFn !== 'function') return { kind: 'unavailable' }

    let reasoningEffort
    try {
      reasoningEffort = await capabilityFor(job.provider, job.model)
    } catch (error) {
      // A failed capability lookup is omitted, never fatal, and retried later.
      if (typeof onError === 'function') onError(error)
      reasoningEffort = undefined
    }
    if (disposed || controller.signal.aborted) return { kind: 'failure', failure: { message: 'aborted', code: 'ABORTED' } }

    let iterable
    try {
      iterable = streamFn(buildOptions(job, controller.signal, reasoningEffort))
    } catch (error) {
      return { kind: 'failure', failure: failureOf(error), cause: error }
    }
    if (!iterable || (typeof iterable[Symbol.asyncIterator] !== 'function' && typeof iterable[Symbol.iterator] !== 'function')) {
      return { kind: 'failure', failure: { message: 'stream returned a non-iterable', code: '' } }
    }
    let iterator
    try {
      iterator = typeof iterable[Symbol.asyncIterator] === 'function' ? iterable[Symbol.asyncIterator]() : iterable[Symbol.iterator]()
    } catch (error) {
      return { kind: 'failure', failure: failureOf(error), cause: error }
    }

    let text = ''
    let finishFailure = null
    let thrown = null
    let cause
    const consume = (async () => {
      try {
        for (;;) {
          const step = await iterator.next()
          if (!step || step.done) break
          const chunk = step.value
          if (isObject(chunk) && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            text += chunk.text
            if (text.length >= maxReplyChars) {
              text = text.slice(0, maxReplyChars)
              closeIterator(iterator)
              break
            }
          } else if (isObject(chunk) && chunk.type === 'finish') {
            const reason = chunk.reason
            if (isObject(reason) && (reason.kind === 'error' || reason.kind === 'aborted')) {
              finishFailure = isObject(reason.failure)
                ? reason.failure
                : { message: '', code: reason.kind === 'aborted' ? 'ABORTED' : '' }
            }
            break
          }
        }
      } catch (error) {
        cause = error
        thrown = failureOf(error)
      }
    })()

    const { winner, timedOut } = await withDeadline(consume)
    if (timedOut || winner === 'deadline') {
      try {
        controller.abort()
      } catch (error) {
        // A hostile AbortController is not fatal here.
      }
      closeIterator(iterator)
      return { kind: 'failure', failure: { message: 'review deadline exceeded', code: 'TIMEOUT' } }
    }
    if (winner === 'disposed' || disposed) {
      try {
        controller.abort()
      } catch (error) {
        // A hostile AbortController is not fatal here.
      }
      closeIterator(iterator)
      return { kind: 'failure', failure: { message: 'aborted', code: 'ABORTED' } }
    }
    if (thrown !== null) return { kind: 'failure', failure: thrown, cause }
    if (finishFailure !== null) return { kind: 'failure', failure: failureOf({ failure: finishFailure }) }
    return { kind: 'ok', text }
  }

  function classifyReply(text) {
    if (text === '') {
      counters.emptyReplies += 1
      counters.lastEmptyReplyAt = now()
      counters.completedReviews += 1
      counters.lastOutcome = 'empty'
      return { status: 'empty' }
    }
    let verdict
    try {
      verdict = typeof parseReply === 'function' ? parseReply(text) : null
    } catch (error) {
      if (typeof onError === 'function') onError(error)
      verdict = null
    }
    degraded = false
    if (verdict === null || verdict === undefined) {
      counters.unparsedReplies += 1
      counters.lastUnparsedReplyAt = now()
      counters.completedReviews += 1
      counters.lastOutcome = 'unparsed'
      return { status: 'unparsed' }
    }
    if (verdict.note === null) {
      counters.completedReviews += 1
      counters.lastOutcome = 'silent'
      return { status: 'silent' }
    }
    const delivered = typeof onNote === 'function' ? onNote(verdict) : 'noted'
    counters.completedReviews += 1
    counters.lastOutcome = typeof delivered === 'string' && delivered !== '' ? delivered : 'noted'
    return { status: counters.lastOutcome, note: verdict.note, importance: verdict.importance }
  }

  function flushBacklog() {
    counters.backlogFlushes += 1
    const dropped = queue.length
    if (dropped > 0) {
      counters.queueDrops += dropped
      counters.lastQueueDropAt = now()
    }
    while (queue.length > 0) queue.shift().resolve({ status: 'dropped' })
    degraded = true
    consecutiveTransportDrops = 0
    runtimeStatus = RUNTIME_STATUS.degraded
  }

  async function runEntry(entry) {
    const { job } = entry
    let attempt = 0
    for (;;) {
      attempt += 1
      counters.reviewStarts += 1
      counters.lastReviewAt = now()
      runtimeStatus = RUNTIME_STATUS.reviewing
      const controller = new AbortController()
      currentController = controller
      const result = await attemptOnce(job, controller)
      currentController = null
      if (disposed) {
        counters.completedReviews += 1
        counters.lastOutcome = 'aborted'
        return { result: { status: 'aborted' } }
      }
      if (result.kind === 'unavailable') {
        counters.completedReviews += 1
        counters.lastOutcome = 'unroutable'
        return { result: { status: 'unroutable' } }
      }
      if (result.kind === 'ok') {
        consecutiveTransportDrops = 0
        return { result: classifyReply(result.text) }
      }
      const failure = result.failure || { code: '' }
      const code = typeof failure.code === 'string' ? failure.code : ''
      const classification = classifyFailure(code)
      if (classification === 'aborted') {
        counters.completedReviews += 1
        counters.lastOutcome = 'aborted'
        return { result: { status: 'aborted', failure } }
      }
      if (classification === 'quota') {
        // The current job is retained at the front; no timer is scheduled.
        counters.lastOutcome = 'quota_exhausted'
        return { retain: true, result: { status: 'quota_exhausted', failure } }
      }
      if (classification === 'permanent') {
        reportFailure(failure, result.cause)
        counters.completedReviews += 1
        counters.lastOutcome = 'halted'
        return { halt: true, result: { status: 'halted', failure } }
      }
      if (classification === 'transient' && attempt === 1) {
        reportFailure(failure, result.cause)
        const waited = await waitRetry(retryDelayMs)
        if (!waited || disposed) {
          counters.completedReviews += 1
          counters.lastOutcome = 'aborted'
          return { result: { status: 'aborted' } }
        }
        continue
      }
      reportFailure(failure, result.cause)
      counters.completedReviews += 1
      if (code === 'TRANSPORT') {
        counters.transportDrops += 1
        counters.lastTransportDropAt = now()
        consecutiveTransportDrops += 1
      } else {
        consecutiveTransportDrops = 0
      }
      counters.lastOutcome = 'dropped'
      if (consecutiveTransportDrops >= transportDropFlushThreshold) flushBacklog()
      return { result: { status: 'dropped', failure } }
    }
  }

  async function runDrain() {
    while (!disposed && !paused && !halted && queue.length > 0) {
      const entry = queue.shift()
      currentEntry = entry
      const outcome = await runEntry(entry)
      currentEntry = null
      if (outcome.retain) {
        queue.unshift(entry)
        paused = true
        runtimeStatus = RUNTIME_STATUS.quotaExhausted
        break
      }
      entry.resolve(outcome.result)
      if (outcome.halt) {
        halted = true
        runtimeStatus = RUNTIME_STATUS.halted
        while (queue.length > 0) queue.shift().resolve({ status: 'halted' })
        break
      }
    }
    if (disposed) runtimeStatus = RUNTIME_STATUS.disposed
    else if (halted) runtimeStatus = RUNTIME_STATUS.halted
    else if (paused) runtimeStatus = RUNTIME_STATUS.quotaExhausted
    else if (degraded) runtimeStatus = RUNTIME_STATUS.degraded
    else if (queue.length > 0) runtimeStatus = RUNTIME_STATUS.reviewing
    else runtimeStatus = RUNTIME_STATUS.idle
  }

  function drain() {
    if (draining) return
    draining = true
    runDrain()
      .catch((error) => {
        if (typeof onError === 'function') onError(error)
      })
      .finally(() => {
        draining = false
        // A caller woken by a resolved job may enqueue its next job before this
        // finally runs; restart the drain so that job cannot be stranded.
        if (queue.length > 0 && !paused && !halted && !disposed) {
          drain()
          return
        }
        const resolvers = idleResolvers
        idleResolvers = []
        for (const resolve of resolvers) resolve()
      })
  }

  function pendingReviews() {
    return queue.length
  }

  function enqueue(job) {
    if (disposed) return Promise.resolve({ status: 'disposed' })
    if (halted) return Promise.resolve({ status: 'halted' })
    if (queue.length >= maxQueued) {
      counters.queueDrops += 1
      counters.lastQueueDropAt = now()
      return Promise.resolve({ status: 'queue_full' })
    }
    let resolve
    const promise = new Promise((resolver) => {
      resolve = resolver
    })
    queue.push({ job, resolve })
    drain()
    return promise
  }

  function resume() {
    if (disposed) return false
    if (!paused) return false
    paused = false
    drain()
    return true
  }

  function dispose() {
    if (disposed) return
    disposed = true
    paused = false
    releaseDispose()
    for (const cancel of [...pendingWaits]) cancel()
    pendingWaits.clear()
    if (currentController) {
      try {
        currentController.abort()
      } catch (error) {
        // A hostile AbortController is not fatal during teardown.
      }
    }
    while (queue.length > 0) queue.shift().resolve({ status: 'aborted' })
    runtimeStatus = RUNTIME_STATUS.disposed
  }

  function whenIdle() {
    if (!draining) return Promise.resolve()
    return new Promise((resolve) => idleResolvers.push(resolve))
  }

  function status() {
    return {
      pendingReviews: pendingReviews(),
      reviewStarts: counters.reviewStarts,
      completedReviews: counters.completedReviews,
      emptyReplies: counters.emptyReplies,
      lastEmptyReplyAt: counters.lastEmptyReplyAt,
      unparsedReplies: counters.unparsedReplies,
      lastUnparsedReplyAt: counters.lastUnparsedReplyAt,
      transportDrops: counters.transportDrops,
      lastTransportDropAt: counters.lastTransportDropAt,
      queueDrops: counters.queueDrops,
      lastQueueDropAt: counters.lastQueueDropAt,
      backlogFlushes: counters.backlogFlushes,
      lastReviewAt: counters.lastReviewAt,
      lastOutcome: counters.lastOutcome,
      runtimeStatus,
    }
  }

  return { enqueue, resume, dispose, status, whenIdle }
}
