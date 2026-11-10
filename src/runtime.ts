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
} as const)

/** One terminal/observable runtime state; the closed vocabulary of RUNTIME_STATUS. */
export type RuntimeStatus = (typeof RUNTIME_STATUS)[keyof typeof RUNTIME_STATUS]

/** The retry-policy class of one provider-neutral failure code. */
export type FailureClassification = 'transient' | 'quota' | 'permanent' | 'aborted' | 'unknown'

/** One provider-neutral failure read from a thrown value or a finish reason. */
export interface Failure {
  message: string
  code: string
  status?: unknown
}

/** The parsed verdict members the runtime reads and hands to delivery. */
export interface RuntimeVerdict {
  note: string | null
  importance: 'high' | 'critical' | null
}

/** The exact model call options handed to the injected stream function. */
export interface StreamCallOptions {
  provider: string
  model: string
  system: string
  messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>
  temperature: number
  maxTokens: number
  signal: AbortSignal
  reasoningEffort?: string
}

/** One injected model stream factory. */
export type StreamFunction = (options: StreamCallOptions) => unknown

/** One review job handed to the per-session runtime. */
export interface ReviewJob {
  provider: string
  model: string
  system: string
  message: string
  maxTokens: number
}

/** One terminal runtime outcome; the failure that caused it is carried along. */
export interface RuntimeOutcome {
  /** A runtime-decided status name, or the delivery callback's own label. */
  status: string
  failure?: Failure
}

/** The counter snapshot status() reports; only the members above are read here. */
export interface RuntimeStatusSnapshot {
  pendingReviews: number
  reviewStarts: number
  completedReviews: number
  emptyReplies: number
  lastEmptyReplyAt: number | null
  unparsedReplies: number
  lastUnparsedReplyAt: number | null
  transportDrops: number
  lastTransportDropAt: number | null
  queueDrops: number
  lastQueueDropAt: number | null
  backlogFlushes: number
  lastReviewAt: number | null
  /** The last reply/queue outcome; the delivery callback may name its own label. */
  lastOutcome: string | null
  runtimeStatus: RuntimeStatus
}

/** The injected seams and budget overrides createRuntime accepts. */
export interface RuntimeOptions {
  getStream?: () => StreamFunction | undefined
  resolveModelInfo?: (provider: string, model: string) => unknown
  parseReply?: (text: string) => RuntimeVerdict | null | undefined
  onNote?: (verdict: RuntimeVerdict) => unknown
  onError?: (error: unknown) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout
  clearTimer?: (handle: NodeJS.Timeout) => void
  maxQueued?: number
  deadlineMs?: number
  retryDelayMs?: number
  maxReplyChars?: number
  transportDropFlushThreshold?: number
}

/** One queued review plus the resolver of the promise enqueue() returned. */
interface QueuedReview {
  job: ReviewJob
  resolve: (outcome: RuntimeOutcome) => void
}

/** One reply classification returned to the waiting caller. */
interface ReplyOutcome {
  status: string
  note?: string
  importance?: 'high' | 'critical' | null
}

/** One outcome of one stream attempt; never throws out of the runtime. */
type AttemptResult =
  | { kind: 'ok'; text: string }
  | { kind: 'unavailable' }
  | { kind: 'failure'; failure: Failure; cause?: unknown }

/** One drain outcome: settle, retain for a resume, or halt the session. */
interface RunOutcome {
  result: RuntimeOutcome
  retain?: boolean
  halt?: boolean
}

/** The mutable counter block reported by status(). */
interface RuntimeCounters {
  reviewStarts: number
  completedReviews: number
  emptyReplies: number
  lastEmptyReplyAt: number | null
  unparsedReplies: number
  lastUnparsedReplyAt: number | null
  transportDrops: number
  lastTransportDropAt: number | null
  queueDrops: number
  lastQueueDropAt: number | null
  backlogFlushes: number
  lastReviewAt: number | null
  lastOutcome: string | null
}

/** The iterator factories an injected stream source can expose. */
interface StreamSource {
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>
  [Symbol.iterator]: () => Iterator<unknown>
}

/** Whether one value owns a `return` method that may be called blindly. */
interface Closable {
  return?: () => unknown
}

/** Whether one value exposes a promise-like `catch` method. */
interface Catchable {
  catch: (onRejected: () => void) => unknown
}

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
export function classifyFailure(code: unknown): FailureClassification {
  if (typeof code !== 'string' || code === '') return 'unknown'
  const upper = code.toUpperCase()
  if (upper === 'ABORTED') return 'aborted'
  if (QUOTA_CODES.includes(upper)) return 'quota'
  if (TRANSIENT_CODES.includes(upper)) return 'transient'
  if (PERMANENT_PATTERN.test(upper)) return 'permanent'
  return 'unknown'
}

/** Whether one untrusted value is a plain object to the runtime's readers. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** One positive integer budget override; the guard is the documented contract. */
function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

/** One finite positive budget override. */
function isPositiveFinite(value: unknown): value is number {
  return Number.isFinite(value) && (value as number) > 0
}

/** One finite non-negative budget override. */
function isNonNegativeFinite(value: unknown): value is number {
  return Number.isFinite(value) && (value as number) >= 0
}

/** Whether one value can be treated as an injected stream source. */
function isStreamSource(value: unknown): value is StreamSource {
  if (value === null) return false
  if (typeof value !== 'object' && typeof value !== 'function' && typeof value !== 'string') return false
  const candidate = value as Partial<StreamSource>
  return typeof candidate[Symbol.asyncIterator] === 'function' || typeof candidate[Symbol.iterator] === 'function'
}

/** Whether one value may own a `return` method. */
function isClosable(value: unknown): value is Closable {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/** Whether one value exposes a promise-like `catch` method. */
function isCatchable(value: unknown): value is Catchable {
  if (value === null) return false
  if (typeof value !== 'object' && typeof value !== 'function') return false
  return typeof (value as { catch?: unknown }).catch === 'function'
}

/** Read a thrown value as a provider-neutral failure without trusting accessors. */
function failureOf(value: unknown): Failure {
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
function closeIterator(iterator: unknown): void {
  try {
    if (!iterator || !isClosable(iterator)) return
    if (typeof iterator.return !== 'function') return
    const result = iterator.return()
    if (isCatchable(result)) result.catch(() => {})
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
export function createRuntime(options: RuntimeOptions = {}) {
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
  const maxQueued = isPositiveInteger(options.maxQueued) ? options.maxQueued : RUNTIME_LIMITS.maxQueued
  const deadlineMs = isPositiveFinite(options.deadlineMs) ? options.deadlineMs : RUNTIME_LIMITS.deadlineMs
  const retryDelayMs = isNonNegativeFinite(options.retryDelayMs) ? options.retryDelayMs : RUNTIME_LIMITS.retryDelayMs
  const maxReplyChars = isPositiveInteger(options.maxReplyChars) ? options.maxReplyChars : RUNTIME_LIMITS.maxReplyChars
  const transportDropFlushThreshold = isPositiveInteger(options.transportDropFlushThreshold)
    ? options.transportDropFlushThreshold
    : RUNTIME_LIMITS.transportDropFlushThreshold

  const queue: QueuedReview[] = []
  const pendingWaits = new Set<() => void>()
  const capabilityCache = new Map<string, 'off' | undefined>()
  let draining = false
  let disposed = false
  let paused = false
  let halted = false
  let degraded = false
  let currentEntry: QueuedReview | null = null
  let currentController: AbortController | null = null
  let consecutiveTransportDrops = 0
  let runtimeStatus: RuntimeStatus = RUNTIME_STATUS.idle
  let idleResolvers: Array<() => void> = []
  let releaseDispose: (value?: void) => void = () => {}
  const disposePromise = new Promise<void>((resolve) => {
    releaseDispose = resolve
  })

  const counters: RuntimeCounters = {
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

  function reportFailure(failure: Failure | null | undefined, cause?: unknown): void {
    if (typeof onError !== 'function') return
    if (cause !== undefined) {
      onError(cause)
      return
    }
    const error: Error & { code?: string } = new Error(failure && failure.message ? failure.message : 'LLM stream failed')
    if (failure && typeof failure.code === 'string' && failure.code !== '') error.code = failure.code
    onError(error)
  }

  /** Sleep before the transient retry; resolves false when dispose cancels it. */
  function waitRetry(ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (value: boolean): void => {
        if (settled) return
        settled = true
        pendingWaits.delete(cancel)
        resolve(value)
      }
      const handle = setTimer(() => finish(true), ms)
      const cancel = (): void => {
        clearTimer(handle)
        finish(false)
      }
      pendingWaits.add(cancel)
    })
  }

  /**
   * Resolve the advertised reasoning effort for a route, caching only a
   * successful lookup. The lookup is bounded by the whole-call deadline and by
   * dispose/abort: a hung registry call resolves to undefined, the stream still
   * starts, and the next call retries instead of caching the timeout.
   */
  async function capabilityFor(provider: string, model: string, signal: AbortSignal): Promise<'off' | undefined> {
    const key = `${provider}\u0000${model}`
    if (capabilityCache.has(key)) return capabilityCache.get(key)
    if (typeof resolveModelInfo !== 'function') return undefined
    if (disposed || (signal && signal.aborted)) return undefined
    const deadline = Symbol('capability-deadline')
    const aborted = Symbol('capability-aborted')
    let timedOut = false
    let handle: NodeJS.Timeout | undefined
    let onAbort: (() => void) | undefined
    const limits: Array<Promise<unknown>> = [
      new Promise((resolve) => {
        handle = setTimer(() => {
          timedOut = true
          resolve(deadline)
        }, deadlineMs)
      }),
      disposePromise,
    ]
    if (signal && typeof signal.addEventListener === 'function') {
      limits.push(new Promise((resolve) => {
        onAbort = () => resolve(aborted)
        signal.addEventListener('abort', onAbort, { once: true })
      }))
    }
    try {
      const info = await Promise.race([
        Promise.resolve().then(() => resolveModelInfo(provider, model)),
        ...limits,
      ])
      if (timedOut || info === deadline || info === aborted || disposed || (signal && signal.aborted)) return undefined
      const reasoning = isObject(info) ? info.reasoning : undefined
      const efforts: readonly unknown[] = isObject(reasoning) && Array.isArray(reasoning.efforts) ? reasoning.efforts : []
      const value: 'off' | undefined = efforts.some((effort) => isObject(effort) && effort.id === 'off') ? 'off' : undefined
      capabilityCache.set(key, value)
      return value
    } finally {
      if (handle !== undefined) clearTimer(handle)
      if (onAbort && signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort)
      }
    }
  }

  function buildOptions(job: ReviewJob, signal: AbortSignal, reasoningEffort: string | undefined): StreamCallOptions {
    const built: StreamCallOptions = {
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
  async function withDeadline(consume: Promise<void>): Promise<{ winner: string; timedOut: boolean }> {
    let timedOut = false
    // The resolver is captured in the executor below; the seed only satisfies
    // definite assignment because the executor runs before the timer can fire.
    let resolveDeadline: (winner: 'deadline') => void = () => {}
    const deadline = new Promise<'deadline'>((resolve) => {
      resolveDeadline = resolve
    })
    const handle = setTimer(() => {
      timedOut = true
      resolveDeadline('deadline')
    }, deadlineMs)
    const winner = await Promise.race([
      consume.then(() => 'done'),
      deadline,
      disposePromise.then(() => 'disposed'),
    ])
    clearTimer(handle)
    return { winner, timedOut }
  }

  /** One model stream attempt; never throws out of the runtime. */
  async function attemptOnce(job: ReviewJob, controller: AbortController): Promise<AttemptResult> {
    if (disposed || controller.signal.aborted) return { kind: 'failure', failure: { message: 'aborted', code: 'ABORTED' } }
    const streamFn = typeof getStream === 'function' ? getStream() : undefined
    if (typeof streamFn !== 'function') return { kind: 'unavailable' }

    let reasoningEffort: string | undefined
    try {
      reasoningEffort = await capabilityFor(job.provider, job.model, controller.signal)
    } catch (error) {
      // A failed capability lookup is omitted, never fatal, and retried later.
      if (typeof onError === 'function') onError(error)
      reasoningEffort = undefined
    }
    if (disposed || controller.signal.aborted) return { kind: 'failure', failure: { message: 'aborted', code: 'ABORTED' } }

    let iterable: unknown
    try {
      iterable = streamFn(buildOptions(job, controller.signal, reasoningEffort))
    } catch (error) {
      return { kind: 'failure', failure: failureOf(error), cause: error }
    }
    if (!iterable || !isStreamSource(iterable)) {
      return { kind: 'failure', failure: { message: 'stream returned a non-iterable', code: '' } }
    }
    let iterator: AsyncIterator<unknown> | Iterator<unknown>
    try {
      iterator = typeof iterable[Symbol.asyncIterator] === 'function' ? iterable[Symbol.asyncIterator]() : iterable[Symbol.iterator]()
    } catch (error) {
      return { kind: 'failure', failure: failureOf(error), cause: error }
    }

    let text = ''
    let finishFailure: unknown = null
    let thrown: Failure | null = null
    let cause: unknown
    const consume = (async () => {
      try {
        for (;;) {
          const step = await iterator.next()
          if (!step || step.done) break
          const chunk: unknown = step.value
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

  function classifyReply(text: string): ReplyOutcome {
    if (text === '') {
      counters.emptyReplies += 1
      counters.lastEmptyReplyAt = now()
      counters.completedReviews += 1
      counters.lastOutcome = 'empty'
      return { status: 'empty' }
    }
    let verdict: RuntimeVerdict | null | undefined
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

  function flushBacklog(): void {
    counters.backlogFlushes += 1
    const dropped = queue.length
    if (dropped > 0) {
      counters.queueDrops += dropped
      counters.lastQueueDropAt = now()
    }
    while (queue.length > 0) dequeue().resolve({ status: 'dropped' })
    degraded = true
    consecutiveTransportDrops = 0
    runtimeStatus = RUNTIME_STATUS.degraded
  }

  /**
   * Remove the oldest queued entry. Every caller has just checked that the queue
   * is nonempty, so the entry is present.
   */
  function dequeue(): QueuedReview {
    return queue.splice(0, 1)[0]
  }

  async function runEntry(entry: QueuedReview): Promise<RunOutcome> {
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
      const failure: Failure = result.failure || { message: '', code: '' }
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

  async function runDrain(): Promise<void> {
    while (!disposed && !paused && !halted && queue.length > 0) {
      const entry = dequeue()
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
        while (queue.length > 0) dequeue().resolve({ status: 'halted' })
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

  function drain(): void {
    if (draining) return
    draining = true
    runDrain()
      .catch((error: unknown) => {
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

  function pendingReviews(): number {
    return queue.length
  }

  function enqueue(job: ReviewJob): Promise<RuntimeOutcome> {
    if (disposed) return Promise.resolve({ status: 'disposed' })
    if (halted) return Promise.resolve({ status: 'halted' })
    if (queue.length >= maxQueued) {
      counters.queueDrops += 1
      counters.lastQueueDropAt = now()
      return Promise.resolve({ status: 'queue_full' })
    }
    // The queue entry and its resolver are created together, before the drain
    // starts, so a settled job can never race an unregistered entry.
    const promise = new Promise<RuntimeOutcome>((resolve) => {
      queue.push({ job, resolve })
    })
    drain()
    return promise
  }

  function resume(): boolean {
    if (disposed) return false
    if (!paused) return false
    paused = false
    drain()
    return true
  }

  function dispose(): void {
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
    while (queue.length > 0) dequeue().resolve({ status: 'aborted' })
    runtimeStatus = RUNTIME_STATUS.disposed
  }

  function whenIdle(): Promise<void> {
    if (!draining) return Promise.resolve()
    return new Promise<void>((resolve) => idleResolvers.push(() => resolve()))
  }

  function status(): RuntimeStatusSnapshot {
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
