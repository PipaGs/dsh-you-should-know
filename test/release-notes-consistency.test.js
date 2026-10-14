// Documentation regression gate for the v0.4.4 publication candidate.
//
// The release-notes body must stay factually aligned with the merged stage-5
// semantic review (docs/harness-reports/ysk-note-voice-semantic-20261014) and
// with the historical evaluation record (docs/harness-reports/ysk-note-voice-live-20261014):
//
//   * the publication body starts at \`## Highlights\` so it can be pasted into
//     the GitHub Release as-is;
//   * the historical v1 result stays 0 PASS / 2 FAIL / 2 SILENT and is not
//     rewritten;
//   * the v2 retrospective classification is 1 PASS, 1 FAIL, 1 EXPECTED_SILENCE,
//     1 SILENT_UNKNOWN over preserved text only, and is not presented as a new
//     model run;
//   * the agent-owned FAIL -> PASS is named as the one lexical false positive,
//     the human-owned FAIL stays a substantive attribution gap, and the unclear
//     silence is not called confirmed;
//   * no generated model pass is claimed, the historical full raw reply is
//     described as absent, and the ledger is described as retained rather than
//     edited by stage 5.
//
// It reads repository files only; it never touches the network and never edits
// the historical reports.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const notesPath = join(repoRoot, 'docs/harness-reports/ysk-release-prep-0.4.4/release-notes-v0.4.4.md')
const stage5Path = join(repoRoot, 'docs/harness-reports/ysk-note-voice-semantic-20261014/final-report.md')
const livePath = join(repoRoot, 'docs/harness-reports/ysk-note-voice-live-20261014/evidence/note-voice-eval-live-run.json')

const notes = readFileSync(notesPath, 'utf8')
const stage5 = readFileSync(stage5Path, 'utf8')

test('the publication body starts at the Highlights section', () => {
  assert.ok(notes.startsWith('## Highlights\n'), 'the body starts at the ## Highlights heading')
  assert.equal(/^#\s/m.test(notes), false, 'the body has no top-level title of its own')
  assert.equal(/proposed release notes/i.test(notes), false, 'the body carries no "proposed" heading')
  assert.equal(/candidate text, not published/i.test(notes), false, 'the body carries no candidate-status preamble')
})

test('the body states the historical and retrospective statuses exactly', () => {
  for (const phrase of [
    '0 PASS / 2 FAIL / 2 SILENT',
    '1 PASS, 1 FAIL, 1 EXPECTED_SILENCE, 1',
    'SILENT_UNKNOWN',
    'EXPECTED_SILENCE',
    '0.4.4',
    'github:PipaGs/dsh-you-should-know#v0.4.4',
  ]) {
    assert.ok(notes.includes(phrase), 'the body states: ' + phrase)
  }
})

test('the body does not repeat the two contradicted claims', () => {
  assert.equal(/proxy false positives/i.test(notes), false, 'no "proxy false positives" claim')
  assert.equal(/legitimate silence/i.test(notes), false, 'no "legitimate silence" claim')
  assert.equal(/ledger.{0,80}corrected forward/i.test(notes), false, 'no claim that the ledger label was corrected forward in stage 5')
  assert.equal(/equivalent.{0,40}(?:->|→|to).{0,40}adapted/i.test(notes), false, 'no claim of an equivalent -> adapted transition')
})

test('the body states no generated model pass and the missing historical raw reply', () => {
  assert.match(notes, /no generated\s+model pass is claimed/i, 'the body says no generated model pass is claimed')
  assert.match(notes, /recalibration, not a model run/i, 'the v2 pass is labelled a recalibration, not a model run')
  assert.match(notes, /historical full raw reply/i, 'the body names the historical full raw reply')
  assert.match(notes, /not preserved|is absent/i, 'the body says the raw reply is absent or not preserved')
})

test('the body describes the ledger as retained rather than edited by stage 5', () => {
  assert.match(notes, /did \*\*not\*\* modify\s+\`docs\/upstream\/ledger\.json\`/i, 'the body says stage 5 did not modify the ledger')
  assert.match(notes, /retained/i, 'the body says the ledger status was retained')
  assert.ok(notes.includes('run-no-pass'), 'the body keeps the recorded run-no-pass status')
})

test('the merged stage-5 report still carries the four retrospective statuses', () => {
  for (const row of [
    '| agent-owned | FAIL | PASS |',
    '| human-owned | FAIL | FAIL |',
    '| joint | SILENT | EXPECTED_SILENCE |',
    '| unclear | SILENT | SILENT_UNKNOWN |',
  ]) {
    assert.ok(stage5.includes(row), 'the stage-5 report still records: ' + row)
  }
  assert.ok(stage5.includes('docs/upstream/ledger.json') && stage5.includes('не изменялся'), 'the stage-5 report still records that the ledger was not modified')
})

test('the historical live record is 0 PASS / 2 FAIL / 2 SILENT and was not touched', () => {
  const live = JSON.parse(readFileSync(livePath, 'utf8'))
  const summary = live.evaluation.summary
  assert.equal(summary.pass, 0, 'the historical record reports 0 passes')
  assert.equal(summary.fail, 2, 'the historical record reports 2 fails')
  assert.equal(summary.silent, 2, 'the historical record reports 2 silents')
  assert.equal(summary.total, 4, 'the historical denominator stays four cases')
  assert.equal(live.evaluation.equivalenceClaimed, false, 'the historical record claims no equivalence')
})
