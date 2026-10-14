// DeepSeek Messages adapter for the note-voice live evaluation.
//
// This is the sanctioned fallback when the standalone evaluator cannot reach the
// host's llm.stream bridge: it speaks the exact wire protocol the mounted
// deepseek-official provider uses (Anthropic-compatible Messages at
// https://api.deepseek.com/anthropic/v1/messages, authenticated with x-api-key),
// then translates the SSE stream into the Harness stream protocol the evaluator
// consumes ({ type: 'text-delta', text }).
//
// Design rules:
//   * No default network use. The caller must construct this with an explicit
//     apiKey and fetch implementation; nothing here reads the environment.
//   * No retries. One streamFn call is exactly one HTTP request.
//   * Cancellation is cooperative and never overclaimed: options.signal is
//     carried into fetch, and the iterator's return() reports done === true
//     only after the stream reached a natural end or the body reader confirmed
//     a successful cancel(). A failed cancel, or a request that never produced
//     a reader, reports done === false so the evaluator stops instead of
//     starting another billed call. This adapter never invents that a remote
//     provider stopped.
//   * Secrets stay in memory. The key is never logged, echoed in an error, or
//     included in a returned value.
//   * Raw reply capture is opt-in, bounded, and explicitly synthetic-only. The
//     captured text is model output for the fixed synthetic excerpts; it never
//     contains request headers, credentials, or provider auth data.
//
// Request shape mirrors lib/runtime.js buildOptions -> dsh-llm-deepseek
// serialize: stream true, the given max_tokens, temperature 0, thinking
// disabled (the reviewer runtime resolves reasoningEffort "off"), and the
// composed reviewer system prompt.
export const DEEPSEEK_PROVIDER = 'deepseek-official'
export const DEEPSEEK_MODEL = 'deepseek-flash'
export const DEEPSEEK_MESSAGES_BASE_URL = 'https://api.deepseek.com/anthropic'
export const DEEPSEEK_MESSAGES_URL = 'https://api.deepseek.com/anthropic/v1/messages'
export const DEEPSEEK_ANTHROPIC_VERSION = '2023-06-01'
export const DEEPSEEK_USER_AGENT = 'dsh-you-should-know-note-voice-eval/1 (+https://github.com/PipaGs/dsh-you-should-know)'
export const DEFAULT_MAX_TOKENS = 768
/** Hard cap for the opt-in synthetic raw reply capture. */
export const DEEPSEEK_RAW_REPLY_MAX_CHARS = 4096

/** Join a configured base root with the Messages resource path exactly once. */
export function messagesUrl(baseURL) {
  const base = typeof baseURL === 'string' && baseURL.trim() !== ''
    ? baseURL.trim().replace(/\/+$/u, '')
    : DEEPSEEK_MESSAGES_BASE_URL
  return /\/v1$/u.test(base) ? base + '/messages' : base + '/v1/messages'
}

/** Build the request target and JSON body for one bounded reviewer call. */
export function buildMessagesRequest({ baseURL = DEEPSEEK_MESSAGES_BASE_URL, model = DEEPSEEK_MODEL, options = {} } = {}) {
  const requestedModel = options !== null && typeof options === 'object' && typeof options.model === 'string' && options.model.trim() !== ''
    ? options.model.trim()
    : model
  const maxTokens = options !== null && typeof options === 'object' && Number.isFinite(options.maxTokens) && options.maxTokens > 0
    ? options.maxTokens
    : DEFAULT_MAX_TOKENS
  const body = {
    model: requestedModel,
    stream: true,
    messages: options !== null && typeof options === 'object' && Array.isArray(options.messages) ? options.messages : [],
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    ...(options !== null && typeof options === 'object' && typeof options.system === 'string' && options.system !== ''
      ? { system: options.system }
      : {}),
    ...(options !== null && typeof options === 'object' && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
  }
  return { url: messagesUrl(baseURL), body: JSON.stringify(body) }
}

/** Split complete SSE frames out of an accumulating buffer. */
function extractFrames(buffer) {
  const frames = []
  let rest = buffer
  for (;;) {
    const boundary = rest.indexOf('\n\n')
    if (boundary === -1) break
    const raw = rest.slice(0, boundary)
    rest = rest.slice(boundary + 2)
    const data = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /u, ''))
    }
    if (data.length > 0) frames.push(data.join('\n'))
  }
  return { frames, rest }
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 402) return 'QUOTA'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400 || status === 413) return 'INVALID_REQUEST'
  if (typeof status === 'number' && status >= 500) return 'SERVER'
  return 'HTTP_' + String(status)
}

/**
 * Read one HTTP response body to completion. Closure may be claimed only when
 * this reports ok === true; a throwing text() leaves the body unconsumed and
 * therefore unconfirmed.
 * @returns { ok: true, text } | { ok: false }
 */
async function readBodyText(response) {
  if (!response || typeof response.text !== 'function') return { ok: false }
  try {
    return { ok: true, text: await response.text() }
  } catch (error) {
    return { ok: false }
  }
}

function httpError(response, text) {
  const status = response && Number.isFinite(response.status) ? response.status : undefined
  let message = 'DeepSeek Messages request failed'
  try {
    const parsed = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && parsed.error !== null && typeof parsed.error === 'object'
      && typeof parsed.error.message === 'string' && parsed.error.message !== '') {
      message = parsed.error.message
    }
  } catch (error) {
    // A non-JSON error body keeps the generic message.
  }
  const failure = new Error(message)
  failure.code = classifyStatus(status)
  failure.status = status
  return failure
}

function streamError(message, code) {
  const failure = new Error(message)
  failure.code = code
  return failure
}

/** Create a streamFn compatible with runEvaluation's injected-stream contract. */
export function createDeepSeekStream({
  apiKey,
  baseURL = DEEPSEEK_MESSAGES_BASE_URL,
  model = DEEPSEEK_MODEL,
  fetchImpl = globalThis.fetch,
  onUsage,
  onReply,
  rawReplyMaxChars = DEEPSEEK_RAW_REPLY_MAX_CHARS,
  userAgent = DEEPSEEK_USER_AGENT,
} = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error('note-voice-eval-deepseek: an API key is required; nothing was sent')
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('note-voice-eval-deepseek: a fetch implementation is required; nothing was sent')
  }
  const resolvedKey = apiKey.trim()
  const replyCap = Number.isFinite(rawReplyMaxChars) && rawReplyMaxChars > 0 ? rawReplyMaxChars : DEEPSEEK_RAW_REPLY_MAX_CHARS

  return function streamFn(options) {
    const callOptions = options !== null && typeof options === 'object' ? options : {}
    const controller = new AbortController()
    const external = callOptions.signal
    let onExternalAbort
    if (external && typeof external === 'object') {
      if (external.aborted === true) {
        controller.abort()
      } else if (typeof external.addEventListener === 'function') {
        onExternalAbort = () => { controller.abort() }
        external.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    const { url, body } = buildMessagesRequest({ baseURL, model, options: callOptions })
    const decoder = new TextDecoder()
    const usage = { provider: DEEPSEEK_PROVIDER, model: callOptions.model || model, inputTokens: 0, outputTokens: 0 }
    const queue = []
    let reader = null
    let started = false
    let finished = false
    let stopped = false
    let exhausted = false
    let naturalEnd = false
    let bodyConsumed = false
    let usageSeen = false
    let usageReported = false
    let replyChars = 0
    let replyText = ''
    let replyReported = false
    let buffer = ''

    function reportUsage() {
      if (usageReported || !usageSeen) return
      usageReported = true
      if (typeof onUsage === 'function') {
        try {
          onUsage({ provider: usage.provider, model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        } catch (error) {
          // A usage sink must never break the stream.
        }
      }
    }

    function reportReply(complete) {
      if (replyReported) return
      replyReported = true
      if (typeof onReply !== 'function') return
      try {
        onReply({
          provider: DEEPSEEK_PROVIDER,
          model: usage.model,
          syntheticOnly: true,
          complete: complete === true,
          truncated: replyChars > replyText.length,
          chars: replyChars,
          text: replyText,
        })
      } catch (error) {
        // A raw-capture sink must never break the stream.
      }
    }

    function detach() {
      if (onExternalAbort && external && typeof external.removeEventListener === 'function') {
        try {
          external.removeEventListener('abort', onExternalAbort)
        } catch (error) {
          // A hostile signal is not fatal here.
        }
        onExternalAbort = undefined
      }
    }

    function ingest(rawFrame) {
      let event
      try {
        event = JSON.parse(rawFrame)
      } catch (error) {
        throw streamError('DeepSeek Messages SSE contains invalid JSON', 'MALFORMED_RESPONSE')
      }
      if (event === null || typeof event !== 'object') return
      if (event.type === 'error') {
        const envelope = event.error !== null && typeof event.error === 'object' ? event.error : {}
        const type = typeof envelope.type === 'string' ? envelope.type : ''
        const httpLike = type === 'authentication_error' || type === 'permission_error' ? 401
          : type === 'rate_limit_error' ? 429
            : type === 'invalid_request_error' ? 400
              : type === 'api_error' || type === 'overloaded_error' ? 503
                : undefined
        throw streamError(
          typeof envelope.message === 'string' && envelope.message !== '' ? envelope.message : 'DeepSeek Messages stream error',
          httpLike === undefined ? 'SERVER' : classifyStatus(httpLike),
        )
      }
      if (event.type === 'message_start') {
        const startUsage = event.message !== null && typeof event.message === 'object' ? event.message.usage : undefined
        if (startUsage !== null && typeof startUsage === 'object') {
          if (Number.isFinite(startUsage.input_tokens)) usage.inputTokens = startUsage.input_tokens
          if (Number.isFinite(startUsage.output_tokens)) usage.outputTokens = Math.max(usage.outputTokens, startUsage.output_tokens)
          usageSeen = true
        }
        return
      }
      if (event.type === 'message_delta') {
        const deltaUsage = event.usage
        if (deltaUsage !== null && typeof deltaUsage === 'object' && Number.isFinite(deltaUsage.output_tokens)) {
          usage.outputTokens = Math.max(usage.outputTokens, deltaUsage.output_tokens)
          usageSeen = true
        }
        return
      }
      if (event.type === 'content_block_delta') {
        const delta = event.delta
        if (delta !== null && typeof delta === 'object' && delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text !== '') {
          queue.push({ type: 'text-delta', text: delta.text })
          replyChars += delta.text.length
          if (replyText.length < replyCap) {
            const remaining = replyCap - replyText.length
            replyText += delta.text.length > remaining ? delta.text.slice(0, remaining) : delta.text
          }
        }
        return
      }
      if (event.type === 'message_stop') {
        exhausted = true
      }
    }

    function ingestBuffer() {
      const { frames, rest } = extractFrames(buffer)
      buffer = rest
      for (const frame of frames) ingest(frame)
    }

    async function start() {
      started = true
      let response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept': 'text/event-stream',
            'x-api-key': resolvedKey,
            'anthropic-version': DEEPSEEK_ANTHROPIC_VERSION,
            'user-agent': userAgent,
          },
          body,
          redirect: 'error',
          signal: controller.signal,
        })
      } catch (error) {
        throw streamError(
          controller.signal.aborted ? 'DeepSeek Messages request was aborted' : 'DeepSeek Messages transport failure',
          controller.signal.aborted ? 'ABORTED' : 'TRANSPORT',
        )
      }
      if (!response || response.ok !== true) {
        // Closure is confirmed only when the error body was actually read to
        // completion. A throwing text() leaves the body unconsumed, so return()
        // must stay unconfirmed and stop any later billed call.
        const read = await readBodyText(response)
        if (read.ok === true) bodyConsumed = true
        throw httpError(response, read.ok === true ? read.text : '')
      }
      if (response.body !== null && response.body !== undefined && typeof response.body.getReader === 'function') {
        reader = response.body.getReader()
        return
      }
      // No stream reader is exposed by this response. Only a successful,
      // complete body read confirms closure; a failed read leaves the body
      // uncancelled and unconfirmed rather than guessing.
      const read = await readBodyText(response)
      if (read.ok !== true) {
        throw streamError('DeepSeek Messages response body could not be read', 'TRANSPORT')
      }
      buffer += read.text
      ingestBuffer()
      bodyConsumed = true
      exhausted = true
    }

    async function cancelReader() {
      if (reader === null || typeof reader.cancel !== 'function') return false
      try {
        await reader.cancel()
        return true
      } catch (error) {
        return false
      }
    }

    const iterator = {
      async next() {
        for (;;) {
          if (queue.length > 0) return { done: false, value: queue.shift() }
          if (finished || stopped) return { done: true, value: undefined }
          if (!started) {
            await start()
            continue
          }
          if (exhausted) {
            finished = true
            naturalEnd = true
            // The stream is complete; release the body without letting a
            // cleanup failure change the confirmed result.
            if (reader !== null && typeof reader.cancel === 'function') {
              try {
                Promise.resolve(reader.cancel()).catch(() => {})
              } catch (error) {
                // Best-effort release only.
              }
            }
            reportUsage()
            reportReply(true)
            detach()
            return { done: true, value: undefined }
          }
          let step
          try {
            step = await reader.read()
          } catch (error) {
            throw streamError('DeepSeek Messages body read failed', 'TRANSPORT')
          }
          if (step === undefined || step === null || step.done === true) {
            const tail = buffer
            buffer = ''
            if (tail !== '') ingestBuffer()
            exhausted = true
            continue
          }
          buffer += decoder.decode(step.value, { stream: true })
          buffer = buffer.replace(/\r\n/gu, '\n')
          ingestBuffer()
        }
      },
      async return() {
        stopped = true
        detach()
        try {
          controller.abort()
        } catch (error) {
          // A hostile AbortController is not fatal here.
        }
        // Closure is confirmed only for a stream that already ended naturally,
        // a body that was fully consumed, or a body reader whose cancel()
        // resolved. Everything else reports done === false so the evaluator
        // stops instead of starting another billed call.
        if (naturalEnd || bodyConsumed) {
          reportUsage()
          reportReply(true)
          return { done: true, value: undefined }
        }
        if (reader === null) {
          reportReply(false)
          return { done: !started, value: undefined }
        }
        const cancelled = await cancelReader()
        if (cancelled) {
          reportUsage()
          reportReply(false)
          return { done: true, value: undefined }
        }
        reportReply(false)
        return { done: false, value: undefined }
      },
    }

    return { [Symbol.asyncIterator]() { return iterator } }
  }
}
