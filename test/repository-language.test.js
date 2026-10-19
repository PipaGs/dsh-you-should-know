// Regression gate for the project's repository-facing language rule.
//
// AGENTS.md is the authoritative rule for this repository. This test pins the
// rule itself, the README index pointer, and the English-only status of the
// artifacts introduced with the rule. Historical reports are intentionally
// excluded from the general scan: they are preserved as written, and
// corrections live in separate dated English addenda.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RULE = 'AGENTS.md'
const TASK = 'docs/harness-reports/english-only-rules-20261019'
const PR19 = 'docs/harness-reports/ysk-version-bump-0.4.5-20261019'
const ADDENDUM = `${PR19}/english-addendum-20261019.md`
const NON_LATIN = /[\u0370-\u03ff\u0400-\u04ff\u1100-\u11ff\u1f00-\u1fff\u3000-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/
const ENGLISH_ONLY_ARTIFACTS = [
  RULE,
  'README.md',
  `${TASK}/final-report.md`,
  ADDENDUM,
]

function read(path) {
  return readFileSync(join(repoRoot, path), 'utf8')
}

test('the authoritative repository rule exists and covers every required artifact', () => {
  const rule = read(RULE)
  for (const phrase of [
    'English-only repository artifacts',
    'pull request titles and descriptions',
    'commit messages',
    'review comments',
    'task-owned final reports',
    'documentation',
    'other prose committed to the repository',
    'repository artifacts, not human chat',
    'Historical artifacts and corrections',
  ]) {
    assert.ok(rule.includes(phrase), 'the rule covers: ' + phrase)
  }
})

test('the README indexes the authoritative repository rules', () => {
  const readme = read('README.md')
  assert.match(readme, /\]\(\.\/AGENTS\.md\)/, 'the README links to AGENTS.md')
  assert.match(readme, /English-only/i, 'the README summary names the English-only rule')
})

test('the new repository-facing artifacts are English-only', () => {
  for (const path of ENGLISH_ONLY_ARTIFACTS) {
    const source = read(path)
    assert.equal(NON_LATIN.test(source), false, path + ' contains non-English text')
  }
})

test('the rule separates human chat from repository artifacts and preserves history', () => {
  const rule = read(RULE)
  assert.match(rule, /Chat responses may be\s+written in the human's language/i, 'chat language is explicitly separate')
  assert.match(rule, /not silently rewritten/i, 'historical artifacts are preserved')
  assert.match(rule, /separate dated English addendum/i, 'corrections use a dated English addendum')
})

test('the PR #19 addendum records the deviation and links the preserved report', () => {
  const addendum = read(ADDENDUM)
  for (const phrase of [
    '2026-10-19',
    '5929bb3547ba7c8f9f91e711a30880b9d201ea94',
    '5e1725566a45be62e05cfc55f27932faca968099',
    'final-report.md',
    'process deviation',
    'has not been edited',
  ]) {
    assert.ok(addendum.includes(phrase), 'the addendum records: ' + phrase)
  }
})

test('the PR #19 historical report is preserved rather than silently translated', () => {
  const original = read(`${PR19}/final-report.md`)
  assert.equal(NON_LATIN.test(original), true, 'the original report keeps its historical non-English prose')
  const addendum = read(ADDENDUM)
  assert.ok(addendum.includes(`${PR19}/final-report.md`), 'the addendum names the preserved original report')
})
