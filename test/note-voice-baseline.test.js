// Offline baseline scorer tests.
//
// The scorer reads hand-authored fixtures and applies the same `admitsVerdict`
// gate the engine applies at runtime. These tests pin the deterministic scoring
// rules, the fixture inventory, and the CLI contract. Nothing here touches the
// network or a model.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BASELINE_CLASSES,
  BASELINE_VERSION,
  CASE_STATUS,
  ENTAIL_VERDICTS,
  scoreCase,
  summarize,
} from '../scripts/note-voice-baseline.mjs'
import { REVIEW_MODES } from '../lib/review-strictness.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = join(repoRoot, 'scripts/note-voice-baseline.mjs')
const fixturePath = join(repoRoot, 'scripts/fixtures/note-voice-baseline/cases.json')
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'))
const REQUIRED_KEYS = ['id', 'class', 'mode', 'expect', 'message', 'reply']
const AUTHOR_ENTAIL_LABELS = ['ok', 'weak', 'unsupported']
const NON_LATIN = /[\u0370-\u03ff\u0400-\u04ff\u1100-\u11ff\u1f00-\u1fff\u3000-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/

test('a silent reply never counts as a pass and is never scored as speak', () => {
  assert.equal(scoreCase({ id: 'a', class: 'legitimate_silence', expect: 'silent', reply: null }).status, 'SILENT_OK')
  assert.equal(scoreCase({ id: 'b', class: 'material_defect', expect: 'speak', reply: null }).status, 'SILENT_MISSED')
})

test('an unexpected note is unwarranted and a matching one is ok', () => {
  assert.equal(scoreCase({ id: 'c', class: 'material_defect', expect: 'speak', reply: { note: 'N', importance: 'high' } }).status, 'SPEAK_OK')
  assert.equal(scoreCase({ id: 'd', class: 'legitimate_silence', expect: 'silent', reply: { note: 'N', importance: 'high' } }).status, 'SPEAK_UNWARRANTED')
})

test('entailment is never derived from a substring', () => {
  const result = scoreCase({
    id: 'e', class: 'consequence_of_correct_work', expect: 'speak', entail: 'unsupported',
    message: 'we use the cache',
    reply: { note: 'N', importance: 'high', kind: 'consequence', because: 'we use the cache' },
  })
  assert.equal(result.entail, 'ENTAIL_UNSUPPORTED')
  assert.equal(result.becauseGrounded, true)
})

test('a mode gate that drops a finding is a gated miss, not silence', () => {
  const result = scoreCase({
    id: 'g', class: 'consequence_of_correct_work', expect: 'speak', mode: 'paranoid',
    reply: { note: 'N', importance: 'high', kind: 'consequence', because: 'x' },
  })
  assert.equal(result.gated, true)
  assert.equal(result.status, 'SILENT_MISSED')
  assert.equal(scoreCase({
    id: 'h', class: 'consequence_of_correct_work', expect: 'speak', mode: 'balanced',
    reply: { note: 'N', importance: 'high', kind: 'consequence', because: 'x' },
  }).gated, false)
})

test('summarize counts per class and keeps unclassified separate', () => {
  const counts = summarize([
    { class: 'material_defect', status: 'SPEAK_OK' },
    { class: 'material_defect', status: 'SPEAK_UNWARRANTED' },
    { class: 'unclassified', status: 'SPEAK_OK' },
  ])
  assert.equal(counts.byClass.material_defect.SPEAK_OK, 1)
  assert.equal(counts.byClass.material_defect.SPEAK_UNWARRANTED, 1)
  assert.equal(counts.byClass.unclassified.SPEAK_OK, 1)
})

test('the module pins its version, classes, statuses, and entailment labels', () => {
  assert.equal(BASELINE_VERSION, 'note-voice-baseline-1')
  assert.deepEqual([...BASELINE_CLASSES], [
    'material_defect',
    'requirement_violation',
    'consequence_of_correct_work',
    'hidden_tradeoff',
    'unsupported_success',
    'duplicate_known',
    'legitimate_silence',
    'ambiguous_evidence',
    'model_runtime_error',
    'voice_attribution',
  ])
  assert.deepEqual([...CASE_STATUS], [
    'SPEAK_OK',
    'SPEAK_UNWARRANTED',
    'SILENT_OK',
    'SILENT_MISSED',
    'RUNTIME_ERROR',
    'INVALID',
    'NOT_RUN',
  ])
  assert.deepEqual([...ENTAIL_VERDICTS], ['ENTAIL_OK', 'ENTAIL_WEAK', 'ENTAIL_UNSUPPORTED'])
})

test('the fixture set is twenty-one synthetic English cases, two per class plus a speak runtime failure', () => {
  assert.equal(fixtures.length, 21)
  assert.equal(new Set(fixtures.map((entry) => entry.id)).size, 21, 'case ids are unique')
  for (const className of BASELINE_CLASSES) {
    const members = fixtures.filter((entry) => entry.class === className)
    const expected = className === 'model_runtime_error' ? 3 : 2
    assert.equal(members.length, expected, className + ' has ' + expected + ' cases')
  }
  const joined = JSON.stringify(fixtures)
  assert.equal(NON_LATIN.test(joined), false, 'fixtures are English-only')
  for (const pattern of [/\bozon\b/i, /\/Users\//, /api[-_]?key/i, /bearer\s/i, /BEGIN (?:PRIVATE|RSA)/]) {
    assert.equal(pattern.test(joined), false, 'fixtures avoid ' + pattern)
  }
  for (const entry of fixtures) {
    for (const key of REQUIRED_KEYS) {
      assert.equal(Object.prototype.hasOwnProperty.call(entry, key), true, entry.id + ' carries ' + key)
    }
    assert.equal(REVIEW_MODES.includes(entry.mode), true, entry.id + ' records a real mode')
    assert.equal(entry.expect === 'speak' || entry.expect === 'silent', true, entry.id + ' records an expectation')
    assert.equal(typeof entry.message === 'string' && entry.message.length > 0, true, entry.id + ' carries a message')
    assert.equal(entry.reply === null || (typeof entry.reply === 'object' && !Array.isArray(entry.reply)), true, entry.id + ' carries a reply or null')
  }
})

test('the fixture set records at least two paranoid cases', () => {
  const paranoid = fixtures.filter((entry) => entry.mode === 'paranoid')
  assert.ok(paranoid.length >= 2, 'at least two cases run behind the Paranoid gate')
})

test('the gated paranoid consequence fixture stays a pinned miss', () => {
  const gatedCase = fixtures.find((entry) => entry.id === 'consequence-cache-growth')
  assert.ok(gatedCase, 'the gated consequence fixture stays in the set')
  const scored = scoreCase(gatedCase)
  assert.equal(scored.gated, true)
  assert.equal(scored.status, 'SILENT_MISSED')
  assert.equal(summarize(fixtures.map(scoreCase)).gated, 1)
})

test('every consequence and tradeoff case carries a grounded author entailment label', () => {
  const evidence = fixtures.filter((entry) =>
    entry.class === 'consequence_of_correct_work' || entry.class === 'hidden_tradeoff')
  assert.equal(evidence.length, 4, 'two consequence and two tradeoff cases')
  for (const entry of evidence) {
    assert.equal(AUTHOR_ENTAIL_LABELS.includes(entry.entail), true, entry.id + ' carries an author entail label')
    assert.equal(typeof entry.reply.because, 'string', entry.id + ' quotes its basis')
    assert.ok(entry.reply.because.length > 0 && entry.reply.because.length <= 240, entry.id + ' keeps the quotation bounded')
    assert.equal(entry.message.includes(entry.reply.because), true, entry.id + ' grounds the quotation verbatim')
    assert.equal(entry.reply.kind, entry.class === 'consequence_of_correct_work' ? 'consequence' : 'tradeoff')
    const result = scoreCase(entry)
    assert.equal(result.entail, 'ENTAIL_' + entry.entail.toUpperCase())
    assert.equal(result.becauseGrounded, true)
    assert.notEqual(result.status, 'INVALID', entry.id + ' is a valid fixture')
  }
})

test('the CLI prints one row per class, reports no INVALID case, and stays unvalidated', () => {
  const run = spawnSync(process.execPath, [scriptPath], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.ok(run.stdout.includes(BASELINE_VERSION), 'the output names the baseline version')
  for (const className of [...BASELINE_CLASSES, 'unclassified']) {
    assert.ok(run.stdout.includes(className), 'the table includes ' + className)
  }
  assert.ok(run.stdout.includes('baseline is unvalidated until the owner sets a threshold'))
  assert.ok(run.stdout.includes('runtime errors: 3'), 'the output totals runtime failures')
  assert.ok(run.stdout.includes(
    'semantic quality (entailment, voice attribution): NOT_VERIFIED — structural admission only; no accuracy or precision is computed',
  ), 'the output marks semantic quality unverified')
  assert.equal(/\baccuracy\s*[:=]\s*\d/i.test(run.stdout), false, 'the baseline computes no accuracy metric')
  assert.equal(/\bprecision\s*[:=]\s*\d/i.test(run.stdout), false, 'the baseline computes no precision metric')
})

test('the CLI refuses a case with a missing required key and exits non-zero', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ysk-baseline-'))
  try {
    const file = join(directory, 'cases.json')
    writeFileSync(file, JSON.stringify([
      { id: 'broken', class: 'material_defect', mode: 'balanced', expect: 'speak', message: 'an excerpt' },
    ]))
    const run = spawnSync(process.execPath, [scriptPath, file], { cwd: repoRoot, encoding: 'utf8' })
    assert.notEqual(run.status, 0, 'an incomplete case is not scored as a pass')
    assert.match(run.stderr + run.stdout, /refusing case 1/)
    assert.match(run.stderr + run.stdout, /reply/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('summarize keeps gated and invalid counts and initializes every class bucket', () => {
  const counts = summarize([
    { class: 'material_defect', status: 'SPEAK_OK' },
    { class: 'material_defect', status: 'SILENT_MISSED', gated: true },
    { class: 'unknown_class', status: 'INVALID' },
  ])
  assert.equal(counts.total, 3)
  assert.equal(counts.gated, 1)
  assert.equal(counts.invalid, 1)
  assert.equal(counts.byClass.unclassified.INVALID, 1)
  assert.equal(counts.byClass.hidden_tradeoff.SPEAK_OK, 0)
  for (const className of [...BASELINE_CLASSES, 'unclassified']) {
    assert.deepEqual(Object.keys(counts.byClass[className]).sort(), [...CASE_STATUS].sort())
  }
})

test('a malformed reply is INVALID, never a silent pass', () => {
  assert.equal(scoreCase({
    id: 'malformed', class: 'material_defect', expect: 'speak',
    reply: { note: null, importance: 'high' },
  }).status, 'INVALID')
  assert.equal(scoreCase({
    id: 'not-json', class: 'material_defect', expect: 'speak', reply: 'not json',
  }).status, 'INVALID')
})

test('an ungrounded because drops the reply as a miss instead of admitting it', () => {
  const result = scoreCase({
    id: 'ungrounded', class: 'consequence_of_correct_work', expect: 'speak', mode: 'balanced',
    message: 'the cache is warm',
    reply: { note: 'N', importance: 'high', kind: 'consequence', because: 'a paraphrase' },
  })
  assert.equal(result.becauseGrounded, false)
  assert.equal(result.status, 'SILENT_MISSED')
  assert.equal(result.gated, false, 'grounding is not the mode gate')
})

test('a silent voice reply is a miss, never a pass', () => {
  const result = scoreCase({ id: 'voice-silent', class: 'voice_attribution', expect: 'speak', reply: null })
  assert.equal(result.status, 'SILENT_MISSED')
  assert.notEqual(result.status, 'SPEAK_OK')
})

test('a runtime failure is its own status, never intentional silence', () => {
  const runtimeCases = fixtures.filter((entry) => entry.class === 'model_runtime_error')
  assert.equal(runtimeCases.length, 3, 'the class keeps two fixtures and adds one speak case')
  for (const entry of runtimeCases) {
    assert.equal(scoreCase(entry).status, 'RUNTIME_ERROR', entry.id)
  }
  const counts = summarize(runtimeCases.map(scoreCase))
  assert.equal(counts.byClass.model_runtime_error.RUNTIME_ERROR, 3)
  assert.equal(counts.byClass.model_runtime_error.SILENT_OK, 0)
  assert.equal(counts.byClass.model_runtime_error.SILENT_MISSED, 0)
  assert.equal(counts.runtimeErrors, 3)
})

test('a speak case that fails at runtime is a runtime error, not an admitted note', () => {
  const result = scoreCase({
    id: 'runtime-speak', class: 'model_runtime_error', mode: 'balanced', expect: 'speak',
    message: 'The change adds a validation branch and the existing tests pass.',
    runtimeError: 'timeout before any reply', reply: null,
  })
  assert.equal(result.status, 'RUNTIME_ERROR')
  assert.notEqual(result.status, 'SPEAK_OK')
  assert.equal(result.gated, false)
})

test('a runtime error next to a real reply is contradictory and invalid', () => {
  const base = {
    class: 'model_runtime_error', mode: 'balanced', expect: 'speak',
    message: 'The change adds a validation branch and the existing tests pass.',
    runtimeError: 'timeout before any reply',
  }
  assert.equal(scoreCase({
    ...base, id: 'runtime-contradiction', reply: { note: 'N', importance: 'high' },
  }).status, 'INVALID')
  assert.equal(scoreCase({ ...base, id: 'runtime-blank', runtimeError: '   ', reply: null }).status, 'INVALID')
})

test('a non-string runtime error is invalid, never a runtime failure', () => {
  const base = {
    class: 'model_runtime_error', mode: 'balanced', expect: 'silent',
    message: 'The change renames one private helper and all tests pass.', reply: null,
  }
  assert.equal(scoreCase({ ...base, id: 'runtime-number', runtimeError: 504 }).status, 'INVALID')
  assert.equal(
    scoreCase({ ...base, id: 'runtime-object', runtimeError: { message: 'timeout' } }).status,
    'INVALID',
  )
})

test('intentional silence without a runtime error stays SILENT_OK', () => {
  const result = scoreCase({
    id: 'silence-clean', class: 'legitimate_silence', mode: 'balanced', expect: 'silent',
    message: 'The change renames one private helper and all tests pass.', reply: null,
  })
  assert.equal(result.status, 'SILENT_OK')
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'semantics'), false)
})

test('an unsupported entailment is admitted structurally with semantics unverified', () => {
  const result = scoreCase({
    id: 'entail-unsupported', class: 'consequence_of_correct_work', expect: 'speak',
    mode: 'balanced', entail: 'unsupported', message: 'we use the cache',
    reply: { note: 'N', importance: 'high', kind: 'consequence', because: 'we use the cache' },
  })
  assert.equal(result.status, 'SPEAK_OK')
  assert.equal(result.semantics, 'NOT_VERIFIED')
  assert.equal(result.entailVerified, false)
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'accuracy'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'precision'), false)
})

test('a misattributed voice reply is admitted structurally with attribution unverified', () => {
  const result = scoreCase({
    id: 'voice-wrong-actor', class: 'voice_attribution', mode: 'balanced', expect: 'speak',
    message: 'You required disabling certificate verification in staging.',
    reply: {
      note: 'The main agent disabled certificate verification in staging, which exposes the client to interception.',
      importance: 'high',
      action: 'Enable certificate verification again in staging.',
    },
  })
  assert.equal(result.status, 'SPEAK_OK')
  assert.equal(result.semantics, 'NOT_VERIFIED')
  assert.equal(result.attributionVerified, false)
})

test('an unwarranted admitted note is marked semantically unverified too', () => {
  const result = scoreCase({
    id: 'unwarranted', class: 'legitimate_silence', mode: 'balanced', expect: 'silent',
    message: 'The change renames one private helper and all tests pass.',
    reply: { note: 'N', importance: 'high' },
  })
  assert.equal(result.status, 'SPEAK_UNWARRANTED')
  assert.equal(result.semantics, 'NOT_VERIFIED')
  assert.deepEqual(summarize([result]).semantics, { notVerified: 1 })
})

test('summarize reports runtime errors and unverified semantics without a quality score', () => {
  const counts = summarize([
    { class: 'model_runtime_error', status: 'RUNTIME_ERROR' },
    { class: 'material_defect', status: 'SPEAK_OK', semantics: 'NOT_VERIFIED' },
  ])
  assert.equal(counts.runtimeErrors, 1)
  assert.deepEqual(counts.semantics, { notVerified: 1 })
  assert.equal(Object.prototype.hasOwnProperty.call(counts, 'accuracy'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(counts, 'precision'), false)
})

test('the CLI states that semantic quality is not verified', () => {
  const run = spawnSync(process.execPath, [scriptPath], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.ok(run.stdout.includes('runtime errors: 3'))
  assert.ok(run.stdout.includes(
    'semantic quality (entailment, voice attribution): NOT_VERIFIED — structural admission only; no accuracy or precision is computed',
  ))
})

test('the scorer opens no network connection and reads no environment variable', () => {
  const source = readFileSync(scriptPath, 'utf8')
  for (const pattern of [/\bfetch\s*\(/, /node:https?/, /XMLHttpRequest/, /process\.env/]) {
    assert.equal(pattern.test(source), false, 'the scorer avoids ' + pattern)
  }
})
