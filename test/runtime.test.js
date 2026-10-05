import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVerdict } from '../lib/core.js'
import { RUNTIME_LIMITS, classifyFailure, createRuntime } from '../lib/runtime.js'

function delta(text) {
  return { type: 'text-delta', index: 0, text }
}

function stop() {
  return { type: 'finish', reason: { kind: 'stop' } }
}

function failureChunk(code) {
  return { type: 'finish', reason: { kind: 'error', failure: { message: `failure ${code}`, code } } }
}

/** Turn a scripted reply into an async iterable of stream chunks. */
function replyStream(reply) {
  if (typeof reply === 'function') return reply()
  if (reply instanceof Error) {
    return (async function* stream() {
      throw reply
    })()
  }
  if (Array.isArray(reply)) {
    return (async function* stream() {
      for (const chunk of reply) yield chunk
    })()
  }
  const text = reply === undefined ? '{"note":null,"importance":null}' : reply
  return (async function* stream() {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield delta(text)
    yield stop()
  })()
}

function job(overrides = {}) {
  return { provider: 'p', model: 'm', system: 'reviewer system', message: 'excerpt', maxTokens: 768, ...overrides }
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function harness(options = {}) {
  const script = options.script ? [...options.script] : []
  const calls = []
  const notes = []
  const errors = []
  const resolveCalls = []
  let clock = 0
  const runtime = createRuntime({
    getStream:
      options.getStream ??
      (() =>
        (callOptions) => {
          calls.push(callOptions)
          return replyStream(script.shift())
        }),
    resolveModelInfo:
      options.resolveModelInfo ??
      (async (provider, model) => {
        resolveCalls.push([provider, model])
        return { provider, id: model, name: model }
      }),
    parseReply: parseVerdict,
    onNote: (verdict) => {
      notes.push(verdict)
      return 'noted'
    },
    onError: (error) => errors.push(error),
    now: () => (clock += 1),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
    retryDelayMs: 5,
    deadlineMs: 100,
    ...options.runtime,
  })
  return { runtime, calls, notes, errors, resolveCalls }
}

test('classifyFailure maps current DSH LLM failure codes', () => {
  assert.equal(classifyFailure('TIMEOUT'), 'transient')
  assert.equal(classifyFailure('SERVER'), 'transient')
  assert.equal(classifyFailure('TRANSPORT'), 'transient')
  assert.equal(classifyFailure('EMPTY_RESPONSE'), 'transient')
  assert.equal(classifyFailure('RATE_LIMIT'), 'quota')
  assert.equal(classifyFailure('QUOTA'), 'quota')
  assert.equal(classifyFailure('ACCOUNT_QUOTA'), 'quota')
  assert.equal(classifyFailure('ABORTED'), 'aborted')
  assert.equal(classifyFailure('INVALID_CREDENTIAL'), 'permanent')
  assert.equal(classifyFailure('MISSING_CREDENTIAL'), 'permanent')
  assert.equal(classifyFailure('NO_ADAPTER'), 'permanent')
  assert.equal(classifyFailure('MODEL_NOT_FOUND'), 'permanent')
  assert.equal(classifyFailure('UNSUPPORTED_REASONING_EFFORT'), 'permanent')
  assert.equal(classifyFailure(''), 'unknown')
  assert.equal(classifyFailure('SOMETHING_NEW'), 'unknown')
})

test('the runtime starts at idle with zeroed counters', () => {
  const { runtime } = harness()
  assert.deepEqual(runtime.status(), {
    pendingReviews: 0,
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
    runtimeStatus: 'idle',
  })
})

test('a valid reply is delivered through onNote and counted once', async () => {
  const { runtime, notes, calls } = harness({ script: ['{"note":"Rotate the key.","importance":"critical"}'] })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'noted')
  assert.deepEqual(notes, [{ note: 'Rotate the key.', importance: 'critical' }])
  assert.equal(calls.length, 1)
  const status = runtime.status()
  assert.equal(status.reviewStarts, 1)
  assert.equal(status.completedReviews, 1)
  assert.equal(status.pendingReviews, 0)
  assert.equal(status.lastOutcome, 'noted')
  assert.equal(status.runtimeStatus, 'idle')
})

test('an empty model body increments emptyReplies and is never delivered', async () => {
  const { runtime, notes } = harness({ script: [''] })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'empty')
  assert.equal(notes.length, 0)
  const status = runtime.status()
  assert.equal(status.emptyReplies, 1)
  assert.notEqual(status.lastEmptyReplyAt, null)
  assert.equal(status.unparsedReplies, 0)
  assert.equal(status.lastOutcome, 'empty')
})

test('a nonempty invalid body increments unparsedReplies and is never delivered', async () => {
  const { runtime, notes } = harness({ script: ['not json at all'] })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'unparsed')
  assert.equal(notes.length, 0)
  const status = runtime.status()
  assert.equal(status.unparsedReplies, 1)
  assert.notEqual(status.lastUnparsedReplyAt, null)
  assert.equal(status.emptyReplies, 0)
  assert.equal(status.lastOutcome, 'unparsed')
})

test('the exact null/null verdict is silent and is not a drop', async () => {
  const { runtime, notes } = harness({ script: ['{"note":null,"importance":null}'] })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'silent')
  assert.equal(notes.length, 0)
  const status = runtime.status()
  assert.equal(status.lastOutcome, 'silent')
  assert.equal(status.emptyReplies, 0)
  assert.equal(status.unparsedReplies, 0)
  assert.equal(status.transportDrops, 0)
  assert.equal(status.queueDrops, 0)
})

test('queued jobs drain in strict FIFO order with never more than one stream in flight', async () => {
  let active = 0
  let maxActive = 0
  const order = []
  const { runtime } = harness({
    getStream: () =>
      (callOptions) => {
        const text = callOptions.messages[0].content[0].text
        return (async function* stream() {
          active += 1
          maxActive = Math.max(maxActive, active)
          order.push(text)
          await new Promise((resolve) => setTimeout(resolve, 1))
          yield delta(`{"note":"${text}","importance":"high"}`)
          active -= 1
        })()
      },
  })
  const first = runtime.enqueue(job({ message: 'one' }))
  const second = runtime.enqueue(job({ message: 'two' }))
  const third = runtime.enqueue(job({ message: 'three' }))
  await Promise.all([first, second, third])
  assert.equal(maxActive, 1)
  assert.deepEqual(order, ['one', 'two', 'three'])
  assert.equal(runtime.status().completedReviews, 3)
})

test('pendingReviews reports the queued backlog', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { runtime } = harness({
    getStream: () => () =>
      (async function* stream() {
        await gate
        yield delta('{"note":null,"importance":null}')
      })(),
  })
  const first = runtime.enqueue(job())
  await tick()
  assert.equal(runtime.status().pendingReviews, 0, 'the in-flight job is not queued')
  const second = runtime.enqueue(job())
  const third = runtime.enqueue(job())
  assert.equal(runtime.status().pendingReviews, 2)
  release()
  await Promise.all([first, second, third])
  assert.equal(runtime.status().pendingReviews, 0)
})

test('the queue drops the newest job once maxQueued is reached', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { runtime } = harness({
    getStream: () => () =>
      (async function* stream() {
        await gate
        yield delta('{"note":null,"importance":null}')
      })(),
  })
  const first = runtime.enqueue(job())
  await tick()
  const queued = []
  for (let index = 0; index < RUNTIME_LIMITS.maxQueued; index += 1) queued.push(runtime.enqueue(job()))
  const overflow = await runtime.enqueue(job())
  assert.equal(overflow.status, 'queue_full')
  assert.equal(runtime.status().pendingReviews, RUNTIME_LIMITS.maxQueued)
  assert.equal(runtime.status().queueDrops, 1)
  assert.notEqual(runtime.status().lastQueueDropAt, null)
  release()
  await Promise.all([first, ...queued])
  assert.equal(runtime.status().completedReviews, RUNTIME_LIMITS.maxQueued + 1)
})

test('a transient failure is retried once after the delay and then dropped', async () => {
  const { runtime, errors } = harness({ script: [[failureChunk('TIMEOUT')], [failureChunk('TIMEOUT')]] })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'dropped')
  const status = runtime.status()
  assert.equal(status.reviewStarts, 2)
  assert.equal(status.completedReviews, 1)
  assert.equal(status.lastOutcome, 'dropped')
  assert.equal(errors.length, 2)
  assert.equal(errors[0].code, 'TIMEOUT')
})

test('a transient failure that recovers on the retry delivers the note', async () => {
  const { runtime, notes } = harness({ script: [[failureChunk('SERVER')], '{"note":"Recovered.","importance":"high"}'] })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'noted')
  assert.equal(runtime.status().reviewStarts, 2)
  assert.deepEqual(notes, [{ note: 'Recovered.', importance: 'high' }])
})

test('a thrown error without a code is reported once and dropped without a retry', async () => {
  const { runtime, errors } = harness({ script: [new Error('provider down')] })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'dropped')
  assert.equal(runtime.status().reviewStarts, 1)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].message, 'provider down')
})

test('a thrown LlmError-shaped failure is classified by its carried code', async () => {
  const thrown = new Error('no adapter registered')
  thrown.code = 'NO_ADAPTER'
  const { runtime, errors } = harness({ script: [thrown] })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'halted')
  assert.equal(runtime.status().runtimeStatus, 'halted')
  assert.equal(errors.length, 1)
})

test('three consecutive transport drops flush the queued backlog', async () => {
  const script = []
  for (let index = 0; index < 6; index += 1) script.push([failureChunk('TRANSPORT')])
  const { runtime } = harness({ script })
  const jobs = []
  for (let index = 0; index < 5; index += 1) jobs.push(runtime.enqueue(job()))
  const results = await Promise.all(jobs)
  assert.deepEqual(results.map((result) => result.status), ['dropped', 'dropped', 'dropped', 'dropped', 'dropped'])
  const status = runtime.status()
  assert.equal(status.transportDrops, 3)
  assert.notEqual(status.lastTransportDropAt, null)
  assert.equal(status.backlogFlushes, 1)
  assert.equal(status.queueDrops, 2)
  assert.notEqual(status.lastQueueDropAt, null)
  assert.equal(status.reviewStarts, 6, 'each of the three drops burned its one retry')
  assert.equal(status.runtimeStatus, 'degraded')
})

test('a quota failure pauses with the current job retained at the front and no timer', async () => {
  const { runtime, notes } = harness({ script: [[failureChunk('RATE_LIMIT')], '{"note":"After resume.","importance":"high"}'] })
  const first = runtime.enqueue(job())
  await runtime.whenIdle()
  let status = runtime.status()
  assert.equal(status.runtimeStatus, 'quota_exhausted')
  assert.equal(status.pendingReviews, 1)
  assert.equal(status.reviewStarts, 1)
  assert.equal(notes.length, 0)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(runtime.status().reviewStarts, 1, 'quota must not schedule an automatic retry')
  assert.equal(runtime.resume(), true)
  await runtime.whenIdle()
  const result = await first
  assert.equal(result.status, 'noted')
  assert.deepEqual(notes, [{ note: 'After resume.', importance: 'high' }])
  status = runtime.status()
  assert.equal(status.reviewStarts, 2)
  assert.equal(status.pendingReviews, 0)
  assert.equal(status.runtimeStatus, 'idle')
})

test('resume is a no-op unless the runtime is quota-paused', async () => {
  const { runtime } = harness({ script: ['{"note":null,"importance":null}'] })
  assert.equal(runtime.resume(), false)
  await runtime.enqueue(job())
  assert.equal(runtime.resume(), false)
})

test('a permanent failure halts the runtime and flushes the queue', async () => {
  const { runtime, errors } = harness({ script: [[failureChunk('INVALID_CREDENTIAL')]] })
  const jobs = [runtime.enqueue(job()), runtime.enqueue(job()), runtime.enqueue(job())]
  const results = await Promise.all(jobs)
  assert.deepEqual(results.map((result) => result.status), ['halted', 'halted', 'halted'])
  const status = runtime.status()
  assert.equal(status.runtimeStatus, 'halted')
  assert.equal(status.reviewStarts, 1)
  assert.equal(status.pendingReviews, 0)
  assert.equal(errors.length, 1)
  const late = await runtime.enqueue(job())
  assert.equal(late.status, 'halted')
})

test('a permanent model-not-found or unsupported failure also halts', async () => {
  for (const code of ['MODEL_NOT_FOUND', 'UNSUPPORTED_REASONING_EFFORT', 'NO_ADAPTER']) {
    const { runtime } = harness({ script: [[failureChunk(code)]] })
    const result = await runtime.enqueue(job())
    assert.equal(result.status, 'halted', `${code} must halt`)
  }
})

test('dispose aborts the in-flight job and clears the queue', async () => {
  let started = 0
  const { runtime } = harness({
    getStream: () => () =>
      (async function* stream() {
        started += 1
        await new Promise(() => {})
        yield delta('{"note":null,"importance":null}')
      })(),
  })
  const first = runtime.enqueue(job())
  await tick()
  const second = runtime.enqueue(job())
  assert.equal(started, 1)
  runtime.dispose()
  const results = await Promise.all([first, second])
  assert.deepEqual(results.map((result) => result.status), ['aborted', 'aborted'])
  const status = runtime.status()
  assert.equal(status.pendingReviews, 0)
  assert.equal(status.runtimeStatus, 'disposed')
  const late = await runtime.enqueue(job())
  assert.equal(late.status, 'disposed')
  assert.equal(started, 1, 'dispose must not start another stream')
})

test('the whole-call deadline bounds a hung iterator that ignores AbortSignal', async () => {
  const { runtime, errors } = harness({
    getStream: () => () =>
      (async function* stream() {
        await new Promise(() => {})
        yield delta('never')
      })(),
    runtime: { deadlineMs: 15, retryDelayMs: 2 },
  })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'dropped')
  assert.equal(runtime.status().reviewStarts, 2)
  assert.equal(runtime.status().completedReviews, 1)
  assert.equal(errors.length, 2)
  assert.equal(errors[0].code, 'TIMEOUT')
})

test('the reply text is collected boundedly and the iterator is closed early', async () => {
  let pulled = 0
  const { runtime } = harness({
    getStream: () => () =>
      (async function* stream() {
        for (;;) {
          pulled += 1
          yield delta('xxxx')
        }
      })(),
    runtime: { maxReplyChars: 10 },
  })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'unparsed')
  assert.ok(pulled <= 4, `expected a bounded pull, saw ${pulled}`)
  assert.equal(runtime.status().unparsedReplies, 1)
})

test('the call carries the reviewer contract with no tools', async () => {
  const { runtime, calls } = harness({ script: ['{"note":null,"importance":null}'] })
  await runtime.enqueue(job({ provider: 'deepseek-official', model: 'deepseek-flash', message: 'the excerpt', maxTokens: 900 }))
  assert.equal(calls.length, 1)
  const options = calls[0]
  assert.equal(options.provider, 'deepseek-official')
  assert.equal(options.model, 'deepseek-flash')
  assert.equal(options.system, 'reviewer system')
  assert.equal(options.temperature, 0)
  assert.equal(options.maxTokens, 900)
  assert.equal(options.tools, undefined)
  assert.equal(options.reasoningEffort, undefined)
  assert.equal(options.messages.length, 1)
  assert.equal(options.messages[0].role, 'user')
  assert.deepEqual(options.messages[0].content, [{ type: 'text', text: 'the excerpt' }])
  assert.ok(options.signal instanceof AbortSignal)
})

test("reasoningEffort is 'off' only when resolveModelInfo advertises it", async () => {
  const off = harness({
    script: ['{"note":null,"importance":null}', '{"note":null,"importance":null}'],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, reasoning: { efforts: [{ id: 'low' }, { id: 'off' }] } }),
  })
  await off.runtime.enqueue(job())
  assert.equal(off.calls[0].reasoningEffort, 'off')

  const notOff = harness({
    script: ['{"note":null,"importance":null}'],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, reasoning: { efforts: [{ id: 'high' }] } }),
  })
  await notOff.runtime.enqueue(job())
  assert.equal(notOff.calls[0].reasoningEffort, undefined)
})

test('a successful capability resolution is cached for the runtime lifetime', async () => {
  let resolutions = 0
  const { runtime, calls } = harness({
    script: ['{"note":null,"importance":null}', '{"note":null,"importance":null}'],
    resolveModelInfo: async (provider, model) => {
      resolutions += 1
      return { provider, id: model, reasoning: { efforts: [{ id: 'off' }] } }
    },
  })
  await runtime.enqueue(job())
  await runtime.enqueue(job())
  assert.equal(resolutions, 1)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].reasoningEffort, 'off')
})

test('a failed capability lookup is omitted and retried on the next job', async () => {
  let resolutions = 0
  const { runtime, calls } = harness({
    script: ['{"note":null,"importance":null}', '{"note":null,"importance":null}'],
    resolveModelInfo: async (provider, model) => {
      resolutions += 1
      if (resolutions === 1) throw new Error('capability unavailable')
      return { provider, id: model, reasoning: { efforts: [{ id: 'off' }] } }
    },
  })
  await runtime.enqueue(job())
  assert.equal(calls[0].reasoningEffort, undefined)
  await runtime.enqueue(job())
  assert.equal(resolutions, 2)
  assert.equal(calls[1].reasoningEffort, 'off')
})

test('a missing stream function resolves quietly as unroutable', async () => {
  const { runtime } = harness({ getStream: () => undefined })
  const result = await runtime.enqueue(job())
  assert.equal(result.status, 'unroutable')
  assert.equal(runtime.status().lastOutcome, 'unroutable')
})
