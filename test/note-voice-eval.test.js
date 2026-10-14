// Offline contract tests for the note-voice evaluator.
//
// The evaluator exists to make the merged 2.1.288 responsibility-attribution
// prompt testable against live model output. These tests never touch the
// network: they pin the evaluator's synthetic cases, its deterministic
// adjudication rules, its bounds, and its fail-closed live gate. A live run is
// opt-in and, when it cannot be proven cost-neutral, every case is NOT_RUN.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import {
  EVAL_LIMITS,
  EVAL_VERSION,
  SYNTHETIC_CASES,
  adjudicateCase,
  attributeOwners,
  buildCasePrompt,
  resolveLiveGate,
  runEvaluation,
} from '../scripts/note-voice-eval.mjs'
import { REVIEW_INSTRUCTIONS } from '../lib/core.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = join(repoRoot, 'scripts/note-voice-eval.mjs')

function caseById(id) {
  const found = SYNTHETIC_CASES.find((entry) => entry.id === id)
  assert.ok(found, 'synthetic case exists: ' + id)
  return found
}

function reply(text) {
  return { kind: 'reply', raw: text }
}

function verdict(note, extra = {}) {
  return reply(JSON.stringify({ note, importance: 'high', ...extra }))
}

test('AC1: the evaluator ships exactly four labelled synthetic cases with deterministic criteria', () => {
  assert.equal(EVAL_VERSION, 'note-voice-eval-1')
  assert.equal(SYNTHETIC_CASES.length, 4)
  assert.deepEqual(
    SYNTHETIC_CASES.map((entry) => entry.id),
    ['agent-owned', 'human-owned', 'joint', 'unclear'],
  )
  const expected = { 'agent-owned': 'agent', 'human-owned': 'human', joint: 'joint', unclear: 'none' }
  for (const entry of SYNTHETIC_CASES) {
    assert.equal(entry.responsibility, expected[entry.id], entry.id + ' labels responsibility')
    assert.equal(entry.expectation.owner, entry.responsibility, entry.id + ' expectation matches its label')
    assert.equal(typeof entry.excerpt, 'string')
    assert.ok(entry.excerpt.length > 0, entry.id + ' carries a fixed excerpt')
    assert.ok(entry.title && entry.rationale, entry.id + ' explains why the owner is unambiguous')
  }
})

test('AC1: every excerpt is non-sensitive synthetic data, not session or private content', () => {
  const forbidden = [/\bozon\b/i, /\/Users\//, /api[-_]?key/i, /bearer\s/i, /chatgpt/i, /BEGIN (?:PRIVATE|RSA)/]
  const joined = JSON.stringify(SYNTHETIC_CASES)
  for (const pattern of forbidden) {
    assert.equal(pattern.test(joined), false, 'synthetic cases avoid ' + pattern)
  }
  const ids = new Set(SYNTHETIC_CASES.map((entry) => entry.id))
  assert.equal(ids.size, SYNTHETIC_CASES.length, 'case ids are unique')
})

test('AC1: each case prompt targets the merged base policy and carries the excerpt verbatim', () => {
  for (const entry of SYNTHETIC_CASES) {
    const prompt = buildCasePrompt(entry)
    assert.ok(prompt.system.startsWith(REVIEW_INSTRUCTIONS), entry.id + ' composes the merged base policy first')
    assert.ok(prompt.message.includes(entry.excerpt), entry.id + ' sends the synthetic excerpt verbatim')
    assert.ok(prompt.system.includes('Let the note voice follow who was responsible'), entry.id + ' targets the 2.1.288 voice rule')
  }
})

test('attributeOwners finds the responsibility marker and nothing else', () => {
  assert.deepEqual(attributeOwners('The main agent lowered the timeout without being asked.'), { agent: true, joint: false, human: false })
  assert.deepEqual(attributeOwners('You required disabling certificate verification.'), { agent: false, joint: false, human: true })
  assert.deepEqual(attributeOwners('We settled on three retry attempts.'), { agent: false, joint: true, human: false })
  assert.deepEqual(attributeOwners('The export job failed with a checksum mismatch.'), { agent: false, joint: false, human: false })
})

test('AC1/AC2: adjudication passes the labelled owner and fails a contradictory one', () => {
  const agent = caseById('agent-owned')
  const human = caseById('human-owned')
  const joint = caseById('joint')
  const unclear = caseById('unclear')

  assert.equal(adjudicateCase(agent, verdict('The main agent lowered the default timeout without being asked.')).status, 'PASS')
  assert.equal(adjudicateCase(agent, verdict('We lowered the default timeout.')).status, 'FAIL')
  assert.equal(adjudicateCase(human, verdict('You required disabling certificate verification in staging.')).status, 'PASS')
  assert.equal(adjudicateCase(human, verdict('The main agent disabled certificate verification.')).status, 'FAIL')
  assert.equal(adjudicateCase(joint, verdict('We settled on three retry attempts.')).status, 'PASS')
  assert.equal(adjudicateCase(joint, verdict('You settled on three retry attempts.')).status, 'FAIL')
  assert.equal(adjudicateCase(unclear, verdict('The export job failed with a checksum mismatch in the archive.')).status, 'PASS')
  assert.equal(adjudicateCase(unclear, verdict('The main agent broke the archive checksum.')).status, 'FAIL')
})

test('AC2: a failed attribution reports the matched evidence and reasons', () => {
  const result = adjudicateCase(caseById('unclear'), verdict('You caused the export to fail.'))
  assert.equal(result.status, 'FAIL')
  assert.equal(result.noteOwners.human, true)
  assert.ok(result.reasons.some((line) => /attribut/i.test(line)), 'failure explains the attribution problem')
})

test('AC2: invalid, silent, dropped, and timed-out attempts are distinct from PASS', () => {
  const spec = caseById('agent-owned')
  assert.equal(adjudicateCase(spec, reply('not json')).status, 'INVALID')
  assert.equal(adjudicateCase(spec, reply('{"note":null,"importance":null}')).status, 'SILENT')
  assert.equal(adjudicateCase(spec, { kind: 'error', error: { code: 'TIMEOUT', message: 'deadline' } }).status, 'DROPPED')
  assert.equal(adjudicateCase(spec, { kind: 'timeout' }).status, 'TIMEOUT')
  for (const status of ['INVALID', 'SILENT', 'DROPPED', 'TIMEOUT']) {
    assert.notEqual(status, 'PASS')
  }
})

test('AC5: the note-to-human voice and the optional repair action are adjudicated separately', () => {
  const spec = caseById('human-owned')
  const verdict = JSON.stringify({
    note: 'You required disabling certificate verification in staging, which exposes the client to interception.',
    importance: 'high',
    action: 'Fix the staging client so certificate verification is enabled again.',
  })
  const result = adjudicateCase(spec, reply(verdict))
  assert.equal(result.status, 'PASS', 'the human voice in the note is judged on its own')
  assert.equal(result.actionPresent, true)
  assert.ok(result.action.length > 0, 'the agent-facing action is reported separately')
  // A contradictory action must not rewrite the note's verdict, but it is
  // still reported so a human can see both halves.
  const mixed = adjudicateCase(spec, reply(JSON.stringify({
    note: 'You required disabling certificate verification in staging.',
    importance: 'high',
    action: 'The main agent should restore certificate verification.',
  })))
  assert.equal(mixed.status, 'PASS')
  assert.equal(mixed.actionOwners.agent, true, 'the action keeps its own attribution evidence')
})

test('AC1: an unrun case reports NOT_RUN with a precise blocker, never a fabricated verdict', async () => {
  const result = await runEvaluation({ gate: { live: false, blocker: 'no cost-neutral entitlement established' } })
  assert.equal(result.live, false)
  assert.equal(result.summary.notRun, 4)
  assert.equal(result.summary.pass + result.summary.fail, 0)
  const ids = result.results.map((entry) => entry.caseId)
  assert.deepEqual(ids, SYNTHETIC_CASES.map((entry) => entry.id))
  for (const entry of result.results) {
    assert.equal(entry.status, 'NOT_RUN')
    assert.match(entry.reason, /entitlement/i)
  }
})

test('AC3: the default run makes no model call at all', async () => {
  let called = 0
  const result = await runEvaluation({
    gate: { live: false, blocker: 'live not requested' },
    stream: () => { called += 1; throw new Error('must not be called') },
  })
  assert.equal(called, 0)
  assert.equal(result.results.every((entry) => entry.status === 'NOT_RUN'), true)
})

test('AC3: an enabled bounded live run uses one attempt per case, concurrency one, and captures the route', async () => {
  const calls = []
  const stream = async function* stream(options) {
    calls.push(options)
    const spec = options.messages[0].content[0].text
    let note = 'The export job failed with a checksum mismatch in the archive.'
    if (spec.includes('lowered the default request timeout')) note = 'The main agent lowered the default request timeout without being asked.'
    if (spec.includes('Disable TLS certificate verification')) note = 'You required disabling certificate verification in staging.'
    if (spec.includes('cap the retry count')) note = 'We settled on three retry attempts.'
    yield { type: 'text-delta', index: 0, text: JSON.stringify({ note, importance: 'high' }) }
  }
  const result = await runEvaluation({
    gate: { live: true },
    stream,
    route: { provider: 'synthetic', model: 'fake-flash' },
  })
  assert.equal(calls.length, 4, 'exactly one attempt per case, no hidden retries')
  assert.equal(result.live, true)
  assert.deepEqual(result.route, { provider: 'synthetic', model: 'fake-flash' })
  assert.match(result.promptVersion, /^[0-9a-f]{64}$/, 'the evaluated prompt text is pinned by hash')
  assert.equal(result.results.length, 4)
  assert.equal(result.summary.notRun, 0)
  assert.equal(result.results.every((entry) => ['PASS', 'FAIL'].includes(entry.status)), true)
  assert.ok(result.limitations.some((line) => /sample|proxy|lexical/i.test(line)), 'sample limitations stay explicit')
})

test('AC3: a non-cancellable stream stops the run and launches no later case', async () => {
  const track = { calls: 0, returnCalled: false }
  const stream = () => {
    track.calls += 1
    let first = true
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (first) {
              first = false
              return Promise.resolve({ done: false, value: { type: 'text-delta', index: 0, text: 'partial' } })
            }
            // The injected call ignores the abort and never settles.
            return new Promise(() => {})
          },
          return() {
            track.returnCalled = true
            // Cannot be cancelled: cleanup never settles either.
            return new Promise(() => {})
          },
        }
      },
    }
  }
  const result = await runEvaluation({
    gate: { live: true },
    stream,
    route: { provider: 'synthetic', model: 'stuck' },
    limits: { callTimeoutMs: 20, closeGraceMs: 20 },
  })
  assert.equal(track.calls, 1, 'no later case starts while the first call may still be active')
  assert.equal(track.returnCalled, true, 'the evaluator requests iterator.return before giving up')
  assert.equal(result.results[0].status, 'TIMEOUT')
  assert.equal(result.results[0].closed, false)
  assert.equal(result.stopped, true)
  assert.equal(result.stoppedAfterCaseId, 'agent-owned')
  assert.equal(result.results.slice(1).every((entry) => entry.status === 'NOT_RUN'), true)
  assert.match(result.results[1].reason, /previous|not started/i)
  assert.equal(result.summary.timeout, 1)
  assert.equal(result.summary.notRun, 3)
  assert.equal(result.summary.pass + result.summary.fail, 0)
})

test('AC3: a closeable stream is cleaned up, and an overlong reply closes its iterator without stopping the run', async () => {
  const track = { calls: 0, returnCalls: [] }
  const stream = (options) => {
    track.calls += 1
    const index = track.calls
    const spec = options.messages[0].content[0].text
    let yielded = false
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (yielded) return Promise.resolve({ done: true, value: undefined })
            yielded = true
            if (spec.includes('lowered the default request timeout')) {
              return Promise.resolve({ done: false, value: { type: 'text-delta', index: 0, text: 'x'.repeat(5000) } })
            }
            return Promise.resolve({
              done: false,
              value: { type: 'text-delta', index: 0, text: JSON.stringify({ note: 'The export job failed with a checksum mismatch in the archive.', importance: 'high' }) },
            })
          },
          return() {
            track.returnCalls.push(index)
            return Promise.resolve({ done: true, value: undefined })
          },
        }
      },
    }
  }
  const result = await runEvaluation({
    gate: { live: true },
    stream,
    route: { provider: 'synthetic', model: 'closeable' },
    limits: { callTimeoutMs: 500, closeGraceMs: 100 },
  })
  assert.equal(track.calls, 4, 'a confirmed close still allows the remaining bounded cases')
  assert.equal(track.returnCalls.length, 1, 'the overlong reply requests exactly one iterator close')
  assert.equal(result.results[0].truncated, true)
  assert.equal(result.results[0].closed, true)
  assert.equal(result.stopped, false)
  assert.equal(result.summary.notRun, 0)
  assert.equal(result.results.length, 4)
})

test('AC3: live authorization is a trusted-caller assertion, not independent cost verification', async () => {
  const offline = await runEvaluation({ gate: { live: false, blocker: 'cost not established' } })
  assert.equal(offline.authorizationBasis, 'none')
  const online = await runEvaluation({
    gate: { live: true },
    stream: async function* stream() {
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ note: 'The export job failed with a checksum mismatch.', importance: 'high' }) }
    },
    route: { provider: 'p', model: 'm' },
    limits: { callTimeoutMs: 200, closeGraceMs: 50 },
  })
  assert.equal(online.authorizationBasis, 'trusted-caller')
  const source = readFileSync(scriptPath, 'utf8')
  assert.match(source, /trusted caller/i)
  assert.match(source, /does not (?:independently )?verify/i)
})

test('AC3: the live gate is fail-closed on missing or uncertain cost metadata', () => {
  const off = resolveLiveGate({ argv: [], env: {} })
  assert.equal(off.enabled, false)
  assert.match(off.blocker, /live/i)
  const requested = resolveLiveGate({ argv: ['--live'], env: {} })
  assert.equal(requested.enabled, false)
  assert.match(requested.blocker, /cost/i)
  const wrong = resolveLiveGate({ argv: ['--live'], env: { YSK_EVAL_COST_ATTESTATION: 'trust-me' } })
  assert.equal(wrong.enabled, false)
  const on = resolveLiveGate({ argv: ['--live'], env: { YSK_EVAL_COST_ATTESTATION: 'zero-incremental-cost' } })
  assert.equal(on.enabled, true)
  assert.equal(on.blocker, null)
})

test('AC3/SECURITY: the evaluator module opens no network connection of its own', () => {
  const source = readFileSync(scriptPath, 'utf8')
  for (const pattern of [/\bfetch\s*\(/, /node:https?/, /require\(['"]https?['"]\)/, /XMLHttpRequest/]) {
    assert.equal(pattern.test(source), false, 'evaluator avoids ' + pattern)
  }
})

test('AC4/AC5: results carry no steering channel and never claim upstream equivalence', async () => {
  const result = await runEvaluation({ gate: { live: false, blocker: 'cost not established' } })
  const serialized = JSON.stringify(result)
  for (const token of ['inject', 'followup', 'follow-up', 'systemPromptToAgent', 'steer']) {
    assert.equal(serialized.includes(token), false, 'results expose no ' + token + ' channel')
  }
  assert.equal(result.equivalenceClaimed, false, 'a short offline sample never claims behavioral equivalence')
  assert.ok(result.limitations.length > 0)
})

test('EVAL_LIMITS bound the run and forbid automatic retries', () => {
  assert.equal(EVAL_LIMITS.maxCases, 4)
  assert.equal(EVAL_LIMITS.maxAttemptsPerCase, 1)
  assert.equal(EVAL_LIMITS.concurrency, 1)
  assert.ok(EVAL_LIMITS.callTimeoutMs > 0)
  assert.ok(EVAL_LIMITS.totalDeadlineMs >= EVAL_LIMITS.callTimeoutMs)
})
