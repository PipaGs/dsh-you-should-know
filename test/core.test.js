import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CONFIG,
  LIMITS,
  accumulatedDelta,
  buildReviewPrompt,
  collectContext,
  createRequestHandlers,
  dedupeKey,
  isChildSession,
  isConfigured,
  lastSeq,
  messageText,
  normalizeConfig,
  parseVerdict,
  readJsonBody,
  sessionIdOf,
  textOfBlocks,
  turnOutputText,
} from '../lib/core.js'

function assistantEvent(seq, turn, text) {
  return {
    type: 'assistant/message',
    seq,
    data: {
      turn,
      step: 0,
      message: { id: `a${seq}`, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } },
      stream: [],
    },
  }
}

function userEvent(seq, text) {
  return {
    type: 'user/message',
    seq,
    data: { id: `u${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
  }
}

test('normalizeConfig supplies conservative defaults for an absent config', () => {
  const { config, warnings } = normalizeConfig(undefined)
  assert.deepEqual(config, DEFAULT_CONFIG)
  assert.deepEqual(warnings, [])
  assert.equal(isConfigured(config), false)
})

test('normalizeConfig trims provider and model and honours the activation gate', () => {
  const { config } = normalizeConfig({ provider: '  deepseek ', model: ' reviewer ' })
  assert.equal(config.provider, 'deepseek')
  assert.equal(config.model, 'reviewer')
  assert.equal(isConfigured(config), true)
})

test('normalizeConfig keeps the plugin loadable when config is malformed or volatile', () => {
  for (const raw of [null, 42, 'text', [], true]) {
    const { config } = normalizeConfig(raw)
    assert.deepEqual(config, DEFAULT_CONFIG)
  }
  const { config, warnings } = normalizeConfig({
    provider: 123,
    model: false,
    minDeltaChars: -5,
    cooldownTurns: 1.5,
    maxContextMessages: 100000,
    maxTokens: 'many',
  })
  assert.deepEqual(config, DEFAULT_CONFIG)
  assert.equal(warnings.length, 6)
})

test('normalizeConfig accepts in-range overrides and rejects out-of-range values', () => {
  const { config, warnings } = normalizeConfig({
    minDeltaChars: 0,
    cooldownTurns: LIMITS.cooldownTurns.max,
    maxContextMessages: 1,
    maxTokens: 32,
  })
  assert.equal(config.minDeltaChars, 0)
  assert.equal(config.cooldownTurns, LIMITS.cooldownTurns.max)
  assert.equal(config.maxContextMessages, 1)
  assert.equal(config.maxTokens, 32)
  assert.deepEqual(warnings, [])

  const high = normalizeConfig({ maxTokens: LIMITS.maxTokens.max + 1 })
  assert.equal(high.config.maxTokens, DEFAULT_CONFIG.maxTokens)
  assert.equal(high.warnings.length, 1)
})

test('parseVerdict accepts a valid high and critical note', () => {
  assert.deepEqual(parseVerdict('{"note":"Rotate the leaked key.","importance":"high"}'), {
    note: 'Rotate the leaked key.',
    importance: 'high',
  })
  assert.deepEqual(parseVerdict('{"note":"Data loss risk on rerun.","importance":"critical"}'), {
    note: 'Data loss risk on rerun.',
    importance: 'critical',
  })
})

test('parseVerdict treats an explicit silence as a silent verdict', () => {
  assert.deepEqual(parseVerdict('{"note":null,"importance":null}'), { note: null, importance: null })
  assert.deepEqual(parseVerdict('{"note":"","importance":null}'), { note: null, importance: null })
})

test('parseVerdict recovers JSON from fences and surrounding prose', () => {
  assert.deepEqual(parseVerdict('```json\n{"note":"A","importance":"high"}\n```'), { note: 'A', importance: 'high' })
  assert.deepEqual(parseVerdict('Here it is: {"note":"B","importance":"critical"} thanks'), {
    note: 'B',
    importance: 'critical',
  })
})

test('parseVerdict drops every malformed reply quietly', () => {
  const malformed = [
    '',
    '   ',
    'no json here',
    '{"note":"A"}',
    '{"note":"A","importance":"low"}',
    '{"note":"A","importance":null}',
    '{"note":42,"importance":"high"}',
    '{"note":{"text":"A"},"importance":"high"}',
    '{"note":"A","importance":"high"',
    '["A"]',
    null,
    undefined,
    42,
  ]
  for (const raw of malformed) {
    assert.equal(parseVerdict(raw), null, `expected null for ${String(raw)}`)
  }
})

test('parseVerdict truncates an overlong note instead of rejecting it', () => {
  const long = 'x'.repeat(LIMITS.maxNoteChars + 100)
  const verdict = parseVerdict(JSON.stringify({ note: long, importance: 'high' }))
  assert.equal(verdict.note.length, LIMITS.maxNoteChars + 1)
  assert.ok(verdict.note.endsWith('…'))
})

test('dedupeKey normalizes case, punctuation, and whitespace', () => {
  assert.equal(dedupeKey('  Use HTTPS!!  '), 'use https')
  assert.equal(dedupeKey('use-https'), 'use https')
  assert.equal(dedupeKey(''), '')
  assert.equal(dedupeKey('   '), '')
  assert.equal(dedupeKey(null), '')
  assert.equal(dedupeKey('!!!'), '!!!')
  assert.equal(dedupeKey('  !!!  '), '!!!')
})

test('textOfBlocks and messageText read only visible text', () => {
  assert.equal(textOfBlocks([{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.deepEqual(messageText(userEvent(1, ' hi ')), { role: 'user', text: 'hi' })
  assert.deepEqual(messageText(assistantEvent(1, 1, 'answer')), { role: 'assistant', text: 'answer' })
  assert.equal(messageText({ type: 'turn/end', seq: 1, data: {} }), null)
})

test('messageText never leaks machine-authored user-role events to the reviewer', () => {
  const sources = ['tool', 'agent-instructions', 'agent-message', 'compact-checkpoint', 'schedule', 'team-message']
  for (const kind of sources) {
    const event = userEvent(1, 'machine traffic')
    event.data.source = { kind }
    assert.equal(messageText(event), null, `source kind ${kind} must stay in the host`)
  }
  const missingSource = userEvent(2, 'no source')
  delete missingSource.data.source
  assert.equal(messageText(missingSource), null)
  assert.equal(collectContext([missingSource], 5), '')
  assert.equal(accumulatedDelta([missingSource], -1), 0)
})

test('turnOutputText only reads the requested turn', () => {
  const events = [assistantEvent(1, 1, 'one'), assistantEvent(2, 2, 'two')]
  assert.equal(turnOutputText(events, 1), 'one')
  assert.equal(turnOutputText(events, 3), '')
})

test('accumulatedDelta counts visible text after the watermark', () => {
  const events = [userEvent(1, 'aaaa'), assistantEvent(2, 1, 'bb'), userEvent(3, 'ccc')]
  assert.equal(accumulatedDelta(events, -1), 9)
  assert.equal(accumulatedDelta(events, 1), 5)
  assert.equal(accumulatedDelta(events, 3), 0)
  assert.equal(lastSeq(events), 3)
  assert.equal(lastSeq([]), -1)
})

test('collectContext stays within the message and character budgets', () => {
  const events = []
  for (let index = 0; index < 40; index += 1) {
    events.push(userEvent(index * 2 + 1, `question ${index}`))
    events.push(assistantEvent(index * 2 + 2, index, 'y'.repeat(LIMITS.maxMessageChars * 2)))
  }
  const context = collectContext(events, 3)
  const markers = context.match(/\[(user|assistant)\]/g) || []
  assert.equal(markers.length, 3)
  assert.ok(context.length <= LIMITS.maxContextChars + LIMITS.maxMessageChars)
  assert.ok(context.includes('[user]\nquestion 39'))

  const ordered = collectContext([
    userEvent(1, 'older question'),
    assistantEvent(2, 1, 'older answer'),
    userEvent(3, 'newer question'),
    assistantEvent(4, 2, 'newer answer'),
  ], 2)
  assert.ok(ordered.indexOf('newer question') < ordered.indexOf('newer answer'))
  assert.ok(!ordered.includes('older question'))
})

test('collectContext returns an empty string for an empty log', () => {
  assert.equal(collectContext([], 5), '')
  assert.equal(collectContext(null, 5), '')
})

test('buildReviewPrompt embeds the excerpt between explicit markers', () => {
  const prompt = buildReviewPrompt('hello there')
  assert.ok(prompt.includes('BEGIN RECENT CONVERSATION'))
  assert.ok(prompt.includes('END RECENT CONVERSATION'))
  assert.ok(prompt.includes('hello there'))
  assert.ok(prompt.includes('"importance": "high" | "critical"'))
})

test('isChildSession detects subagent children and delegated sessions', () => {
  assert.equal(isChildSession({ header: { origin: 'subagent' } }), true)
  assert.equal(isChildSession({ header: { delegationDepth: 2 } }), true)
  assert.equal(isChildSession({ header: { delegationDepth: 0 } }), false)
  assert.equal(isChildSession({ header: {} }), false)
  assert.equal(isChildSession(null), false)
  assert.equal(sessionIdOf({ header: { id: 's1' } }), 's1')
  assert.equal(sessionIdOf({ id: 's2' }), 's2')
  assert.equal(sessionIdOf({}), undefined)
})

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers || {}
    },
    end(body) {
      if (typeof body === 'string') this.body = body
    },
  }
}

test('notes handler answers with the session notes and rejects non-GET', async () => {
  const engine = {
    calls: [],
    notes(sessionId) {
      this.calls.push(sessionId)
      return [{ id: 's1:1', note: 'N', importance: 'high', createdAt: 7 }]
    },
    dismiss() {
      return false
    },
  }
  const handlers = createRequestHandlers(engine)

  const ok = fakeResponse()
  await handlers.notes({ method: 'GET', url: '/dsh-you-should-know/notes?sessionId=s1' }, ok)
  assert.equal(ok.status, 200)
  assert.deepEqual(JSON.parse(ok.body), { ok: true, notes: [{ id: 's1:1', note: 'N', importance: 'high', createdAt: 7 }] })
  assert.equal(engine.calls.at(-1), 's1')

  const missing = fakeResponse()
  await handlers.notes({ method: 'GET', url: '/dsh-you-should-know/notes' }, missing)
  assert.deepEqual(JSON.parse(missing.body), { ok: true, notes: [{ id: 's1:1', note: 'N', importance: 'high', createdAt: 7 }] })
  assert.equal(engine.calls.at(-1), '')

  const rejected = fakeResponse()
  await handlers.notes({ method: 'POST', url: '/dsh-you-should-know/notes' }, rejected)
  assert.equal(rejected.status, 405)
})

function bodyRequest(body) {
  const listeners = new Map()
  return {
    method: 'POST',
    on(name, listener) {
      listeners.set(name, listener)
      return this
    },
    async emitBody() {
      if (listeners.has('data')) listeners.get('data')(body)
      if (listeners.has('end')) listeners.get('end')()
    },
  }
}

test('dismiss handler forwards a parsed body and reports the outcome', async () => {
  const seen = []
  const engine = {
    notes: () => [],
    dismiss(sessionId, noteId) {
      seen.push([sessionId, noteId])
      return true
    },
  }
  const handlers = createRequestHandlers(engine)

  const request = bodyRequest(JSON.stringify({ sessionId: 's1', noteId: 's1:2' }))
  const response = fakeResponse()
  const pending = handlers.dismiss(request, response)
  await request.emitBody()
  await pending
  assert.deepEqual(seen, [['s1', 's1:2']])
  assert.deepEqual(JSON.parse(response.body), { ok: true, dismissed: true })

  const bad = bodyRequest('{not json')
  const badResponse = fakeResponse()
  const badPending = handlers.dismiss(bad, badResponse)
  await bad.emitBody()
  await badPending
  assert.equal(badResponse.status, 400)

  const wrongMethod = fakeResponse()
  await handlers.dismiss({ method: 'GET' }, wrongMethod)
  assert.equal(wrongMethod.status, 405)
})

test('readJsonBody is bounded and never throws', async () => {
  const request = bodyRequest(JSON.stringify({ a: 1 }))
  const pending = readJsonBody(request, 100)
  await request.emitBody()
  assert.deepEqual(await pending, { a: 1 })

  const huge = bodyRequest(JSON.stringify({ a: 'x'.repeat(500) }))
  const hugePending = readJsonBody(huge, 10)
  await huge.emitBody()
  assert.equal(await hugePending, undefined)

  assert.equal(await readJsonBody(undefined, 10), undefined)
})
