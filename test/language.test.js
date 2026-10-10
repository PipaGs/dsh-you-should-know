import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_OUTPUT_LANGUAGE,
  MAX_LANGUAGE_TAG_CHARS,
  hasGenuineHumanMessage,
  languageDirectiveFor,
  normalizeHostLanguage,
  resolveOutputLanguage,
} from '../lib/language.js'
import { buildReviewerSystemPrompt, createEngine, normalizeConfig } from '../lib/core.js'
import { buildReviewProfileSection } from '../lib/review-profile.js'

function user(text) {
  return { role: 'user', text }
}

function assistant(text) {
  return { role: 'assistant', text }
}

test('a host language tag is normalized only when it is a bounded BCP-47-like value', () => {
  assert.equal(normalizeHostLanguage('ru'), 'ru')
  assert.equal(normalizeHostLanguage(' en-US '), 'en-US')
  assert.equal(normalizeHostLanguage('pt_BR'), 'pt-BR')
  assert.equal(normalizeHostLanguage('zh-Hans-CN'), 'zh-Hans-CN')
  for (const rejected of [
    undefined,
    null,
    42,
    '',
    '   ',
    'e',
    'english language',
    'en US',
    '<script>',
    'en\u0000',
    'a'.repeat(MAX_LANGUAGE_TAG_CHARS + 1),
    'en;rm -rf',
  ]) {
    assert.equal(normalizeHostLanguage(rejected), undefined, 'must reject ' + JSON.stringify(rejected))
  }
})

test('the latest genuine human message is detected only from a visible human entry', () => {
  assert.equal(hasGenuineHumanMessage([user('hello')]), true)
  assert.equal(hasGenuineHumanMessage([assistant('hello'), user('there')]), true)
  assert.equal(hasGenuineHumanMessage([assistant('hello')]), false)
  assert.equal(hasGenuineHumanMessage([user('   ')]), false)
  assert.equal(hasGenuineHumanMessage([{ type: 'tool/result', data: {} }]), false)
  assert.equal(hasGenuineHumanMessage([]), false)
  assert.equal(hasGenuineHumanMessage(undefined), false)
})

test('language priority is host setting, then latest human message, then English', () => {
  assert.deepEqual(
    resolveOutputLanguage({ hostLanguage: 'ru', messages: [user('hi')] }),
    { source: 'host', language: 'ru' },
  )
  assert.deepEqual(
    resolveOutputLanguage({ messages: [user('hi')] }),
    { source: 'human-message', language: undefined },
  )
  assert.deepEqual(
    resolveOutputLanguage({ messages: [assistant('done')] }),
    { source: 'fallback', language: FALLBACK_OUTPUT_LANGUAGE },
  )
  assert.deepEqual(resolveOutputLanguage(), { source: 'fallback', language: FALLBACK_OUTPUT_LANGUAGE })
  // An unusable host value never wins over the existing behavior.
  assert.deepEqual(
    resolveOutputLanguage({ hostLanguage: 'not a tag', messages: [user('hi')] }),
    { source: 'human-message', language: undefined },
  )
})

test('each language source yields a distinct, deterministic directive', () => {
  const host = languageDirectiveFor({ hostLanguage: 'de', messages: [user('hi')] })
  assert.match(host, /host setting/)
  assert.match(host, /"de"/)
  assert.equal(host.includes('latest genuine human user message'), false)

  const human = languageDirectiveFor({ messages: [user('hi')] })
  assert.match(human, /latest genuine human user message/)
  assert.match(human, /nearest earlier genuine human user message/)
  assert.match(human, /use English/)

  const fallback = languageDirectiveFor({ messages: [] })
  assert.match(fallback, /no genuine human user message/)
  assert.match(fallback, /English/)
})

test('the reviewer system prompt carries the resolved host language and never leaks an invalid one', () => {
  const withHost = buildReviewerSystemPrompt([user('hello')], { hostLanguage: 'fr' })
  assert.ok(withHost.includes('Response language:'))
  assert.match(withHost, /"fr"/)
  const withoutHost = buildReviewerSystemPrompt([user('hello')])
  assert.equal(withoutHost.includes('"fr"'), false)
  assert.match(withoutHost, /latest genuine human user message/)
  const withBadHost = buildReviewerSystemPrompt([user('hello')], { hostLanguage: 'nope nope' })
  assert.equal(withBadHost, withoutHost, 'an unusable host value must not change the prompt')
})

test('the profile section alone accepts a host language without a conversation entry', () => {
  const section = buildReviewProfileSection([], { hostLanguage: 'ja' })
  assert.ok(section.includes('Response language:'))
  assert.match(section, /"ja"/)
})

test('the engine passes the resolved host language into the reviewer system prompt', async () => {
  const calls = []
  const llm = {
    resolveModelInfo: (provider, model) => Promise.resolve({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
      })()
    },
  }
  const engine = createEngine({
    config: normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 }).config,
    getLlm: () => llm,
    getHostLanguage: () => 'es',
    now: () => 1700000000000,
    onError: () => {},
  })
  const events = [
    { type: 'user/message', seq: 1, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hola' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model' } }, stream: [] } },
    { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const session = { id: 's1', header: { id: 's1' }, events, lastEvent: events[2] }
  const outcome = engine.observe(session, session.lastEvent)
  if (outcome.promise) await outcome.promise
  assert.equal(calls.length, 1)
  assert.match(calls[0].system, /"es"/)
})

test('a throwing host-language resolver never breaks the review call', async () => {
  const calls = []
  const llm = {
    resolveModelInfo: (provider, model) => Promise.resolve({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
      })()
    },
  }
  const errors = []
  const engine = createEngine({
    config: normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 0, cooldownTurns: 1 }).config,
    getLlm: () => llm,
    getHostLanguage: () => { throw new Error('hostile language seam') },
    now: () => 1700000000000,
    onError: (error) => errors.push(error),
  })
  const events = [
    { type: 'user/message', seq: 1, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model' } }, stream: [] } },
    { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const session = { id: 's2', header: { id: 's2' }, events, lastEvent: events[2] }
  const outcome = engine.observe(session, session.lastEvent)
  if (outcome.promise) await outcome.promise
  assert.equal(calls.length, 1)
  assert.match(calls[0].system, /latest genuine human user message/)
  assert.equal(errors.length, 1)
})
