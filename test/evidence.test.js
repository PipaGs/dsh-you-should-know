import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EVIDENCE_LIMITS,
  buildEvidenceCapsule,
  collectEpisodeEvidence,
} from '../lib/evidence.js'
import { REVIEW_INSTRUCTIONS, createEngine, normalizeConfig } from '../lib/core.js'

function toolCall(seq, turn, step, name, callId, args) {
  return { type: 'tool/call', seq, data: { turn, step, callId, name, arguments: args } }
}

function toolResult(seq, turn, step, callId, isError, extra = {}) {
  return {
    type: 'tool/result',
    seq,
    data: {
      turn,
      step,
      message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: 'RAW-OUTPUT-SECRET' }], isError },
      ...extra,
    },
  }
}

function agentStart(seq, runId, childId) {
  return { type: 'tool-workflow/agent-start', seq, data: { runId, seq: 1, label: 'private label text', childId, phase: 'tool' } }
}

function agentEnd(seq, runId, outcome) {
  return { type: 'tool-workflow/agent-end', seq, data: { runId, seq: 1, outcome } }
}

test('collectEpisodeEvidence reads only the allowlisted public metadata for one turn', () => {
  const events = [
    { type: 'user/message', seq: 1, data: { turn: 1, content: [{ type: 'text', text: 'do work' }] } },
    toolCall(2, 1, 0, 'edit', 'c1', { path: '/tmp/a.ts', apiKey: 'SECRET-KEY' }),
    toolResult(3, 1, 0, 'c1', false, { meta: { diffs: [{ path: 'src/a.ts', oldText: 'OLD-SECRET', newText: 'NEW-SECRET' }] } }),
    toolCall(4, 1, 1, 'bash', 'c2', { command: 'rm -rf /', token: 'SECRET-TOKEN' }),
    toolResult(5, 1, 1, 'c2', true, { error: { name: 'SandboxError', code: 'SANDBOX_DENIED', message: 'SECRET-MESSAGE' }, meta: { output: 'RAW-OUTPUT-SECRET' } }),
    // Another turn's activity must never leak in.
    toolCall(6, 2, 0, 'other-turn-tool', 'c9', {}),
    { type: 'turn/end', seq: 7, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const evidence = collectEpisodeEvidence(events, 1)
  assert.equal(evidence.turn, 1)
  assert.equal(evidence.provenance, 'root')
  assert.equal(evidence.meaningful, true)
  assert.deepEqual(evidence.toolCalls.map((entry) => entry.name), ['edit', 'bash'])
  assert.equal(evidence.toolCalls[0].failed, false)
  assert.equal(evidence.toolCalls[1].failed, true)
  assert.equal(evidence.toolCalls[1].errorCode, 'SANDBOX_DENIED')
  assert.equal(evidence.toolCount, 2)
  assert.equal(evidence.failureCount, 1)
  assert.deepEqual(evidence.resources, ['src/a.ts'], 'only the documented path member is read from presentation meta')
  assert.deepEqual(evidence.turnReason, { kind: 'completed' })
  const capsule = buildEvidenceCapsule(evidence)
  assert.ok(capsule.includes('src/a.ts'))
  assert.equal(capsule.includes('OLD-SECRET'), false)
  assert.equal(capsule.includes('NEW-SECRET'), false)
})

test('subagent provenance is read from the parent catalog and the settled relay only', () => {
  const events = [
    toolCall(1, 1, 0, 'subagent', 'c1', { prompt: 'SECRET-PROMPT' }),
    toolResult(2, 1, 0, 'c1', false),
    { type: 'subagent/catalog', seq: 3, data: { version: 1, childId: 'child-1', childCreatedAt: 1, mode: 'one-shot', label: 'PRIVATE-LABEL' } },
    { type: 'user/message', seq: 4, data: { id: 'settled-1', role: 'user', content: [{ type: 'text', text: 'PRIVATE-RESULT' }], source: { kind: 'subagent-settled', senderSessionId: 'child-1' } } },
    { type: 'turn/end', seq: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const evidence = collectEpisodeEvidence(events, 1)
  assert.deepEqual(evidence.subagents.map((entry) => [entry.kind, entry.childId]), [
    ['catalog', 'child-1'],
    ['result', 'child-1'],
  ])
  const capsule = buildEvidenceCapsule(evidence)
  assert.ok(capsule.includes('child-1'))
  for (const secret of ['PRIVATE-LABEL', 'PRIVATE-RESULT', 'SECRET-PROMPT']) {
    assert.equal(capsule.includes(secret), false, 'capsule must not contain ' + secret)
  }
})

test('the capsule never carries raw arguments, output, meta, error messages, or the subagent label', () => {
  const events = [
    toolCall(1, 1, 0, 'write', 'c1', { path: '/tmp/a.ts', secret: 'SECRET-ARG' }),
    toolResult(2, 1, 0, 'c1', true, { error: { name: 'X', code: 'E_FAIL', message: 'SECRET-MESSAGE' }, meta: { blob: 'SECRET-META' } }),
    agentStart(3, 'run-1', 'child-abc'),
    agentEnd(4, 'run-1', 'completed'),
    { type: 'tool-workflow/run-start', seq: 5, data: { runId: 'run-1', name: 'workflow-name' } },
    { type: 'tool-workflow/run-end', seq: 6, data: { runId: 'run-1', stopReason: 'done' } },
    { type: 'turn/end', seq: 7, data: { turn: 1, reason: { kind: 'error', error: { message: 'SECRET-REASON', code: 'LLM_DOWN' } } } },
  ]
  const capsule = buildEvidenceCapsule(collectEpisodeEvidence(events, 1))
  for (const secret of ['SECRET-ARG', 'SECRET-MESSAGE', 'SECRET-META', 'RAW-OUTPUT-SECRET', 'private label text', 'SECRET-REASON']) {
    assert.equal(capsule.includes(secret), false, 'capsule must not contain ' + secret)
  }
  assert.ok(capsule.includes('write'), 'the tool name is allowlisted')
  assert.ok(capsule.includes('E_FAIL'), 'a bounded failure code is allowlisted')
  assert.ok(capsule.includes('LLM_DOWN'), 'a bounded turn error code is allowlisted')
  assert.ok(capsule.includes('child-abc'), 'the child id is allowlisted provenance')
})

test('the capsule is bounded by entry count and total characters', () => {
  const events = []
  let seq = 1
  for (let index = 0; index < 50; index += 1) {
    events.push(toolCall(seq += 1, 1, index, 'tool-' + index + '-' + 'x'.repeat(200), 'c' + index, {}))
  }
  events.push({ type: 'turn/end', seq: seq += 1, data: { turn: 1, reason: { kind: 'completed' } } })
  const evidence = collectEpisodeEvidence(events, 1)
  assert.ok(evidence.toolCalls.length <= EVIDENCE_LIMITS.maxTools)
  const capsule = buildEvidenceCapsule(evidence)
  assert.ok(capsule.length <= EVIDENCE_LIMITS.maxCapsuleChars, 'capsule length ' + capsule.length)
})

test('a hostile or malformed event shape contributes nothing and never throws', () => {
  const events = [
    null,
    42,
    { type: 'tool/call', seq: 1, data: null },
    { type: 'tool/call', seq: 2, data: { turn: 1, name: 42 } },
    { type: 'tool/result', seq: 3, data: { turn: 1, message: { isError: 'yes' } } },
    { type: 'tool-workflow/agent-start', seq: 4, data: { runId: 1, childId: {} } },
    { type: 'turn/end', seq: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const evidence = collectEpisodeEvidence(events, 1)
  assert.equal(evidence.meaningful, false)
  assert.equal(buildEvidenceCapsule(evidence), '')
})

test('a short ordinary Q&A with no tool or subagent work is not a meaningful episode', () => {
  const events = [
    { type: 'user/message', seq: 1, data: { turn: 1, content: [{ type: 'text', text: 'what is 2+2?' }] } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, message: { content: [{ type: 'text', text: '4' }] } } },
    { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  assert.equal(collectEpisodeEvidence(events, 1).meaningful, false)
  assert.equal(buildEvidenceCapsule(collectEpisodeEvidence(events, 1)), '')
})

test('a meaningful episode is review-eligible even when assistant prose is short', async () => {
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
    // minDeltaChars and cooldown stay as secondary guards; the tool episode is enough.
    config: normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 1200, cooldownTurns: 3 }).config,
    getLlm: () => llm,
    now: () => 1700000000000,
    onError: () => {},
  })
  const events = [
    { type: 'user/message', seq: 1, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'run the tests' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'ok' }], source: { kind: 'model' } }, stream: [] } },
    { type: 'tool/call', seq: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: { command: 'npm test' } } },
    { type: 'tool/result', seq: 4, data: { turn: 1, step: 1, message: { role: 'tool', callId: 'c1', content: [{ type: 'text', text: 'RAW' }], isError: true } } },
    { type: 'turn/end', seq: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const session = { id: 's1', header: { id: 's1' }, events, lastEvent: events[4] }
  const outcome = engine.observe(session, session.lastEvent)
  if (outcome.promise) await outcome.promise
  assert.equal(calls.length, 1, 'a meaningful tool episode bypasses the text-delta guard')
  const message = calls[0].messages[0].content[0].text
  assert.ok(message.includes('npm test') === false, 'raw arguments never reach the prompt')
  assert.ok(message.includes('RAW') === false, 'raw tool output never reaches the prompt')
  assert.ok(message.includes('bash'), 'the allowlisted tool name reaches the reviewer as evidence')
})

test('episode evidence composes with strictness, custom prompt, and instructions without touching the base policy', async () => {
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
    config: normalizeConfig({
      provider: 'p',
      model: 'm',
      minDeltaChars: 1200,
      cooldownTurns: 3,
      reviewerMode: 'custom',
      customReviewerPrompt: 'Only report tenant isolation failures.',
      additionalInstructions: 'Focus on multi-tenant isolation.',
    }).config,
    getLlm: () => llm,
    now: () => 1700000000000,
    onError: () => {},
  })
  const events = [
    { type: 'user/message', seq: 1, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'run the checks' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'ok' }], source: { kind: 'model' } }, stream: [] } },
    { type: 'tool/call', seq: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: { command: 'npm test' } } },
    { type: 'tool/result', seq: 4, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'RAW' }], isError: false } } },
    { type: 'turn/end', seq: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const session = { id: 's-compose', header: { id: 's-compose' }, events, lastEvent: events[4] }
  const outcome = engine.observe(session, session.lastEvent)
  if (outcome.promise) await outcome.promise
  assert.equal(calls.length, 1)
  // The trusted system prompt is the v0.3.8 composition, byte for byte: the
  // new evidence rides only in the untrusted user message.
  assert.ok(calls[0].system.startsWith(REVIEW_INSTRUCTIONS))
  assert.match(calls[0].system, /Strictness profile: Custom\./)
  assert.match(calls[0].system, /Only report tenant isolation failures\./)
  assert.match(calls[0].system, /Focus on multi-tenant isolation\./)
  assert.equal(calls[0].system.includes('EPISODE EVIDENCE'), false, 'evidence stays out of the system prompt')
  const message = calls[0].messages[0].content[0].text
  assert.ok(message.includes('BEGIN EPISODE EVIDENCE'))
  assert.ok(message.includes('bash'))
  assert.equal(message.includes('npm test'), false, 'raw arguments never reach the prompt')
})

test('a short Q&A with no meaningful work stays ineligible under the delta guard', async () => {
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
    config: normalizeConfig({ provider: 'p', model: 'm', minDeltaChars: 1200, cooldownTurns: 3 }).config,
    getLlm: () => llm,
    now: () => 1700000000000,
    onError: () => {},
  })
  const events = [
    { type: 'user/message', seq: 1, data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hello' }], source: { kind: 'model' } }, stream: [] } },
    { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const session = { id: 's2', header: { id: 's2' }, events, lastEvent: events[2] }
  const outcome = engine.observe(session, session.lastEvent)
  assert.equal(outcome.status, 'delta')
  assert.equal(calls.length, 0)
})
