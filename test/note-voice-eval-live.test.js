// Offline contract tests for the manual, opt-in live runner and its DeepSeek
// Messages adapter. No test opens a provider connection: every transport is an
// injected fake. The tests pin the request that mirrors the configured
// deepseek-official/deepseek-flash route, the bounded spend shape, SSE
// reassembly, usage reporting, single-attempt behavior, and the fail-closed
// CLI gate.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { REVIEW_INSTRUCTIONS } from '../lib/core.js'
import { runEvaluation } from '../scripts/note-voice-eval.mjs'
import {
  DEEPSEEK_MESSAGES_URL,
  DEEPSEEK_MODEL,
  DEEPSEEK_PROVIDER,
  DEEPSEEK_RAW_REPLY_MAX_CHARS,
  buildMessagesRequest,
  createDeepSeekStream,
} from '../scripts/note-voice-eval-deepseek.mjs'
import {
  LIVE_LIMITS,
  LIVE_ROUTE,
  LIVE_RUNNER_VERSION,
  runLiveEvaluation,
  resolveLiveRunGate,
} from '../scripts/note-voice-eval-live.mjs'

const encoder = new TextEncoder()

/** One Anthropic-style Messages SSE reply carrying a single text delta. */
function replyFrames(text, { inputTokens = 111, outputTokens = 22 } = {}) {
  return [
    'event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: inputTokens, output_tokens: 1 } } }) + '\n\n',
    'event: content_block_start\ndata: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + '\n\n',
    'event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) + '\n\n',
    'event: content_block_stop\ndata: ' + JSON.stringify({ type: 'content_block_stop', index: 0 }) + '\n\n',
    'event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outputTokens } }) + '\n\n',
    'event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n',
  ].join('')
}

/** A Response whose body is released in fixed-size byte chunks. */
function responseFromText(text, { status = 200, chunk = 7 } = {}) {
  const bytes = encoder.encode(text)
  let index = 0
  const body = new ReadableStream({
    pull(controller) {
      if (index >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(index, index + chunk))
      index += chunk
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

/** A Response whose body refuses cooperative cancellation. */
function uncancellableResponse(text) {
  const bytes = encoder.encode(text)
  let sent = false
  const body = new ReadableStream({
    pull(controller) {
      if (sent) return
      sent = true
      controller.enqueue(bytes)
    },
    cancel() {
      throw new Error('cancel refused')
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** A Response that emits the given SSE text once and then never closes. */
function openResponse(text) {
  const bytes = encoder.encode(text)
  let sent = false
  const body = new ReadableStream({
    pull(controller) {
      if (sent) return
      sent = true
      controller.enqueue(bytes)
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function collect(streamFn, options) {
  return (async () => {
    const iterator = streamFn(options)[Symbol.asyncIterator]()
    const chunks = []
    for (;;) {
      const step = await iterator.next()
      if (!step || step.done) return chunks
      chunks.push(step.value)
    }
  })()
}

const baseOptions = () => ({
  provider: DEEPSEEK_PROVIDER,
  model: DEEPSEEK_MODEL,
  system: 'SYSTEM',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'EXCERPT' }] }],
  temperature: 0,
  maxTokens: 768,
})

test('the adapter request mirrors the configured deepseek-official/deepseek-flash route', () => {
  const { url, body } = buildMessagesRequest({
    baseURL: 'https://api.deepseek.com/anthropic',
    model: DEEPSEEK_MODEL,
    options: baseOptions(),
  })
  assert.equal(url, DEEPSEEK_MESSAGES_URL)
  assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages')
  const parsed = JSON.parse(body)
  assert.equal(parsed.model, 'deepseek-flash')
  assert.equal(parsed.stream, true)
  assert.equal(parsed.max_tokens, 768)
  assert.deepEqual(parsed.thinking, { type: 'disabled' })
  assert.equal(parsed.temperature, 0)
  assert.equal(parsed.system, 'SYSTEM')
  assert.deepEqual(parsed.messages, baseOptions().messages)
})

test('an explicit /v1 base root is never duplicated', () => {
  const { url } = buildMessagesRequest({
    baseURL: 'https://api.deepseek.com/anthropic/v1',
    model: DEEPSEEK_MODEL,
    options: baseOptions(),
  })
  assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages')
})

test('the adapter refuses to build without a key and the error never echoes one', () => {
  let error
  try {
    createDeepSeekStream({ apiKey: '', fetchImpl: () => { throw new Error('must not be called') } })
  } catch (caught) {
    error = caught
  }
  assert.ok(error instanceof Error)
  assert.match(error.message, /API key/)
  assert.equal(error.message.includes('sk-'), false)
})

test('text deltas reassemble across arbitrary byte chunk boundaries', async () => {
  const text = 'the main agent — you should know'
  const streamFn = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => responseFromText(replyFrames(text), { chunk: 1 }),
  })
  const chunks = await collect(streamFn, baseOptions())
  assert.ok(chunks.every((chunk) => chunk.type === 'text-delta' && typeof chunk.text === 'string'))
  assert.equal(chunks.map((chunk) => chunk.text).join(''), text)
})

test('usage is reported exactly once per call from message_start and message_delta', async () => {
  const seen = []
  const streamFn = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => responseFromText(replyFrames('{"note":null,"importance":null}', { inputTokens: 321, outputTokens: 12 })),
    onUsage: (usage) => seen.push(usage),
  })
  await collect(streamFn, baseOptions())
  assert.equal(seen.length, 1)
  assert.equal(seen[0].inputTokens, 321)
  assert.equal(seen[0].outputTokens, 12)
  assert.equal(seen[0].provider, DEEPSEEK_PROVIDER)
  assert.equal(seen[0].model, DEEPSEEK_MODEL)
})

test('the request carries the route headers and exactly one attempt even on a server error', async () => {
  const calls = []
  const streamFn = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return new Response('upstream unavailable', { status: 503, headers: { 'content-type': 'text/plain' } })
    },
  })
  let error
  try {
    await collect(streamFn, baseOptions())
  } catch (caught) {
    error = caught
  }
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, DEEPSEEK_MESSAGES_URL)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-test-not-a-real-key')
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01')
  assert.equal(calls[0].init.headers.accept, 'text/event-stream')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.equal(error.code, 'SERVER')
})

test('a provider auth failure is classified without a retry', async () => {
  let calls = 0
  const streamFn = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => {
      calls += 1
      return new Response('{"error":{"type":"authentication_error"}}', { status: 401, headers: { 'content-type': 'application/json' } })
    },
  })
  let error
  try {
    await collect(streamFn, baseOptions())
  } catch (caught) {
    error = caught
  }
  assert.equal(calls, 1)
  assert.equal(error.code, 'AUTH')
})

test('iterator.return() aborts the request signal and confirms closure', async () => {
  let capturedSignal
  const streamFn = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async (url, init) => {
      capturedSignal = init.signal
      return openResponse(replyFrames('partial'))
    },
  })
  const iterator = streamFn(baseOptions())[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.equal(first.done, false)
  assert.equal(first.value.type, 'text-delta')
  const closed = await iterator.return()
  assert.equal(closed.done, true)
  assert.equal(capturedSignal.aborted, true)
})

test('an external abort signal stops the stream', async () => {
  const controller = new AbortController()
  const streamFn = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async (url, init) => openResponse(replyFrames('x')),
  })
  const iterator = streamFn({ ...baseOptions(), signal: controller.signal })[Symbol.asyncIterator]()
  await iterator.next()
  controller.abort()
  const closed = await iterator.return()
  assert.equal(closed.done, true)
})

test('the CLI gate fails closed without an explicit request, confirmation, and key', () => {
  assert.deepEqual(resolveLiveRunGate({ argv: [], env: { DEEPSEEK_API_KEY: 'sk-x' } }).enabled, false)
  assert.equal(resolveLiveRunGate({ argv: ['--live'], env: { DEEPSEEK_API_KEY: 'sk-x' } }).enabled, false)
  assert.equal(resolveLiveRunGate({ argv: ['--live', '--confirm-spend'], env: {} }).enabled, false)
  assert.equal(resolveLiveRunGate({ argv: ['--live', '--confirm-spend'], env: { DEEPSEEK_API_KEY: 'sk-x' } }).enabled, true)
})

test('without --live the runner is not live and opens no connection', async () => {
  let calls = 0
  const result = await runLiveEvaluation({
    argv: [],
    env: { DEEPSEEK_API_KEY: 'sk-secret-must-not-leak' },
    fetchImpl: async () => { calls += 1; throw new Error('no network allowed') },
    now: () => '2026-10-14T00:00:00.000Z',
  })
  assert.equal(calls, 0)
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.evaluation.live, false)
  assert.equal(parsed.evaluation.summary.notRun, 4)
  assert.equal(result.output.includes('sk-secret-must-not-leak'), false)
  assert.equal(result.exitCode, 0)
})

test('a live request without confirmation or key refuses without spending', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; throw new Error('no network allowed') }
  const unconfirmed = await runLiveEvaluation({ argv: ['--live'], env: { DEEPSEEK_API_KEY: 'sk-x' }, fetchImpl })
  const keyless = await runLiveEvaluation({ argv: ['--live', '--confirm-spend'], env: {}, fetchImpl })
  assert.equal(calls, 0)
  assert.equal(unconfirmed.exitCode, 2)
  assert.equal(keyless.exitCode, 2)
  assert.equal(JSON.parse(unconfirmed.output).evaluation.live, false)
  assert.equal(JSON.parse(keyless.output).evaluation.live, false)
})

test('a confirmed live run issues four sequential bounded requests and never leaks the key', async () => {
  const replies = [
    '{"note":"The main agent lowered the timeout with no requirement asking for it.","importance":"high"}',
    '{"note":"You disabled certificate verification and accepted the risk.","importance":"critical"}',
    '{"note":"We agreed to cap the retries at three.","importance":"high"}',
    '{"note":"The nightly export job failed with a checksum mismatch.","importance":"high"}',
  ]
  const bodies = []
  const signals = []
  let calls = 0
  const result = await runLiveEvaluation({
    argv: ['--live', '--confirm-spend'],
    env: { DEEPSEEK_API_KEY: 'sk-secret-must-not-leak' },
    fetchImpl: async (url, init) => {
      signals.push(init.signal)
      bodies.push(JSON.parse(init.body))
      const reply = replies[calls]
      calls += 1
      return responseFromText(replyFrames(reply, { inputTokens: 100 + calls, outputTokens: 10 + calls }))
    },
    now: () => '2026-10-14T00:00:00.000Z',
  })
  assert.equal(calls, 4)
  assert.equal(bodies.length, 4)
  for (const body of bodies) {
    assert.equal(body.model, 'deepseek-flash')
    assert.equal(body.max_tokens, 768)
    assert.equal(body.stream, true)
    assert.deepEqual(body.thinking, { type: 'disabled' })
  }
  const parsed = JSON.parse(result.output)
  assert.equal(result.exitCode, 0)
  assert.equal(parsed.evaluation.live, true)
  assert.equal(parsed.evaluation.summary.total, 4)
  assert.equal(parsed.evaluation.summary.pass, 2, 'only the two selected scenarios can pass')
  assert.equal(parsed.evaluation.summary.unwarrantedNote, 1, 'the excluded joint note is not a pass')
  assert.equal(parsed.evaluation.summary.selectionUnknown, 1, 'the unproven unclear gate is not a pass')
  assert.equal(parsed.evaluation.route.provider, 'deepseek-official')
  assert.equal(parsed.evaluation.route.model, 'deepseek-flash')
  assert.equal(parsed.usage.length, 4)
  assert.equal(parsed.syntheticOnly, true)
  assert.equal(parsed.rawReplies.length, 4)
  for (let index = 0; index < 4; index += 1) {
    assert.equal(parsed.rawReplies[index].text, replies[index])
    assert.equal(parsed.rawReplies[index].syntheticOnly, true)
    assert.equal(parsed.rawReplies[index].complete, true)
    assert.equal(parsed.rawReplies[index].truncated, false)
  }
  assert.equal(result.output.includes('sk-secret-must-not-leak'), false)
  assert.equal(result.output.includes('must-not-leak'), false)
})

test('raw reply capture is synthetic-only and capped at the exported bound', async () => {
  const long = 'y'.repeat(DEEPSEEK_RAW_REPLY_MAX_CHARS + 500)
  let calls = 0
  const result = await runLiveEvaluation({
    argv: ['--live', '--confirm-spend'],
    env: { DEEPSEEK_API_KEY: 'sk-test-not-a-real-key' },
    fetchImpl: async () => {
      calls += 1
      return responseFromText(replyFrames(long))
    },
    now: () => '2026-10-14T00:00:00.000Z',
  })
  const parsed = JSON.parse(result.output)
  assert.equal(calls, 4)
  assert.equal(parsed.syntheticOnly, true)
  assert.equal(parsed.rawReplies.length, 4)
  for (const entry of parsed.rawReplies) {
    assert.equal(entry.syntheticOnly, true)
    assert.equal(entry.truncated, true)
    assert.equal(entry.chars, long.length)
    assert.equal(entry.text.length, DEEPSEEK_RAW_REPLY_MAX_CHARS)
  }
  assert.equal(result.output.includes('sk-test-not-a-real-key'), false)
})

test('a non-OK response whose body cannot be read stays unconfirmed and stops the run', async () => {
  let calls = 0
  const stream = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => {
      calls += 1
      return { ok: false, status: 500, text: async () => { throw new Error('text refused') } }
    },
  })
  const result = await runEvaluation({
    gate: { live: true },
    stream,
    route: LIVE_ROUTE,
    now: () => '2026-10-14T00:00:00.000Z',
  })
  assert.equal(calls, 1)
  assert.equal(result.stopped, true)
  assert.equal(result.results[0].status, 'DROPPED')
  assert.equal(result.results[0].closed, false)
  assert.equal(result.summary.notRun, 3)
})

test('a non-OK response with a fully read body confirms closure and the run may continue', async () => {
  let calls = 0
  const stream = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => {
      calls += 1
      return new Response('upstream unavailable', { status: 500, headers: { 'content-type': 'text/plain' } })
    },
  })
  const result = await runEvaluation({
    gate: { live: true },
    stream,
    route: LIVE_ROUTE,
    now: () => '2026-10-14T00:00:00.000Z',
  })
  assert.equal(calls, 4)
  assert.equal(result.stopped, false)
  for (const entry of result.results) {
    assert.equal(entry.status, 'DROPPED')
    assert.equal(entry.closed, true)
  }
})

test('a success response without a readable body cannot confirm closure and stops the run', async () => {
  let calls = 0
  const stream = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => {
      calls += 1
      return { ok: true, status: 200, text: async () => { throw new Error('text refused') } }
    },
  })
  const result = await runEvaluation({
    gate: { live: true },
    stream,
    route: LIVE_ROUTE,
    now: () => '2026-10-14T00:00:00.000Z',
  })
  assert.equal(calls, 1)
  assert.equal(result.stopped, true)
  assert.equal(result.results[0].closed, false)
  assert.equal(result.summary.notRun, 3)
})

test('a body read failure is closed cooperatively when cancel succeeds', async () => {
  let cancelled = false
  const reader = { read: async () => { throw new Error('read failed') }, cancel: async () => { cancelled = true } }
  const stream = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => ({ ok: true, status: 200, body: { getReader: () => reader } }),
  })
  const iterator = stream(baseOptions())[Symbol.asyncIterator]()
  await assert.rejects(iterator.next(), (error) => error.code === 'TRANSPORT')
  const closed = await iterator.return()
  assert.equal(cancelled, true)
  assert.equal(closed.done, true)
})

test('a body read failure stays unconfirmed when cancel also fails', async () => {
  const reader = { read: async () => { throw new Error('read failed') }, cancel: async () => { throw new Error('cancel failed') } }
  const stream = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => ({ ok: true, status: 200, body: { getReader: () => reader } }),
  })
  const iterator = stream(baseOptions())[Symbol.asyncIterator]()
  await assert.rejects(iterator.next(), (error) => error.code === 'TRANSPORT')
  const closed = await iterator.return()
  assert.equal(closed.done, false)
})

test('the live run carries the merged promptVersion and the fixed bounded limits', async () => {
  const expected = createHash('sha256').update(REVIEW_INSTRUCTIONS, 'utf8').digest('hex')
  const result = await runLiveEvaluation({
    argv: ['--live', '--confirm-spend'],
    env: { DEEPSEEK_API_KEY: 'sk-test-not-a-real-key' },
    fetchImpl: async () => responseFromText(replyFrames('{"note":null,"importance":null}')),
    now: () => '2026-10-14T00:00:00.000Z',
  })
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.runnerVersion, LIVE_RUNNER_VERSION)
  assert.equal(parsed.evaluation.promptVersion, expected)
  assert.equal(parsed.evaluation.equivalenceClaimed, false)
  assert.equal(LIVE_LIMITS.maxAttemptsPerCase, undefined)
  assert.ok(LIVE_LIMITS.callTimeoutMs > 0 && LIVE_LIMITS.totalDeadlineMs > 0)
  assert.deepEqual(LIVE_ROUTE, { provider: 'deepseek-official', model: 'deepseek-flash' })
})

test('iterator.return() reports unconfirmed closure when the body cannot be cancelled', async () => {
  const streamFn = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => uncancellableResponse(replyFrames('partial')),
  })
  const iterator = streamFn(baseOptions())[Symbol.asyncIterator]()
  await iterator.next()
  const closed = await iterator.return()
  assert.equal(closed.done, false)
})

test('iterator.return() never claims closure while the request is still pending', async () => {
  let aborted = false
  const streamFn = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true
        reject(new Error('aborted before response'))
      }, { once: true })
    }),
  })
  const iterator = streamFn(baseOptions())[Symbol.asyncIterator]()
  const pending = iterator.next().then(() => 'settled', () => 'aborted')
  const closed = await iterator.return()
  assert.equal(closed.done, false)
  assert.equal(await pending, 'aborted')
  assert.equal(aborted, true)
})

test('an unconfirmed close stops the run before any later billed call', async () => {
  let calls = 0
  const stream = createDeepSeekStream({
    apiKey: 'sk-test-not-a-real-key',
    fetchImpl: async () => {
      calls += 1
      return uncancellableResponse(replyFrames('x'.repeat(6000)))
    },
  })
  const result = await runEvaluation({
    gate: { live: true },
    stream,
    route: LIVE_ROUTE,
    now: () => '2026-10-14T00:00:00.000Z',
  })
  assert.equal(calls, 1)
  assert.equal(result.stopped, true)
  assert.equal(result.stoppedAfterCaseId, 'agent-owned')
  assert.equal(result.results[0].closed, false)
  for (const entry of result.results.slice(1)) assert.equal(entry.status, 'NOT_RUN')
  assert.equal(result.summary.notRun, 3)
})
