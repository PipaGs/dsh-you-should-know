// Structural contract for the in-repository upstream baseline ledger.
//
// docs/upstream/ledger.json is the machine-readable half of the upstream
// adoption workflow: every versioned upstream "You should know" signal we
// track, the verified local status, the evidence, and the disposition. This
// test keeps the workflow honest:
//
//   * an item cannot claim local parity without naming local evidence that
//     exists in this repository;
//   * a real gap (missing/partial) cannot be silently marked applicable with
//     nothing to do;
//   * a deferred gap must name a separately scoped, testable acceptance;
//   * a rejected item must say why;
//   * sources must be official and pinned, and an outage is "unknown", never
//     "no change".
//
// It reads repository documentation only; it never touches the network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ledgerPath = join(repoRoot, 'docs/upstream/ledger.json')
const workflowPath = join(repoRoot, 'docs/upstream/workflow.md')
const baselinePath = join(repoRoot, 'docs/upstream/README.md')

const LOCAL_STATUSES = new Set(['equivalent', 'adapted', 'partial', 'missing', 'not-applicable', 'unknown'])
const DISPOSITIONS = new Set(['applicable', 'deferred', 'rejected'])
const OFFICIAL_SOURCE_HOSTS = [
  'https://github.com/anthropics/claude-code/',
  'https://code.claude.com/docs/',
]

function readLedger() {
  assert.ok(existsSync(ledgerPath), 'docs/upstream/ledger.json must exist')
  return JSON.parse(readFileSync(ledgerPath, 'utf8'))
}

test('the upstream ledger cites pinned official Claude Code sources', () => {
  const ledger = readLedger()
  assert.equal(ledger.schemaVersion, 1, 'ledger schemaVersion is 1')
  assert.equal(typeof ledger.taskId, 'string', 'ledger carries the task id')
  assert.ok(ledger.taskId.trim().length > 0, 'the task id is nonempty')
  assert.match(ledger.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'ledger records an ISO timestamp for when it was generated')
  assert.equal(ledger.upstream.project, 'anthropics/claude-code', 'upstream project is official')
  assert.equal(ledger.upstream.algorithmDisclosed, false, 'the upstream algorithm stays undisclosed')
  assert.ok(Array.isArray(ledger.upstream.sources) && ledger.upstream.sources.length >= 2, 'at least two official sources')
  for (const source of ledger.upstream.sources) {
    assert.ok(source.id, 'every source has an id')
    assert.ok(source.kind, source.id + ' has a kind')
    assert.ok(OFFICIAL_SOURCE_HOSTS.some((host) => source.url.startsWith(host)), source.id + ' points at an official Claude Code source')
    assert.ok(source.fetchedAt, source.id + ' records when it was fetched')
    const pinned = source.immutable === true || /^[0-9a-f]{40}$/.test(source.commitSha || '') || /^[0-9a-f]{64}$/.test(source.sha256 || '')
    assert.ok(pinned, source.id + ' is immutable, pinned to a full commit SHA, or carries a content hash')
  }
})

test('the ledger records the local baseline on a real named revision', () => {
  const ledger = readLedger()
  assert.equal(ledger.local.repository, 'PipaGs/dsh-you-should-know')
  assert.match(ledger.local.version, /^\d+\.\d+\.\d+$/, 'the local version is a released semver')
  assert.equal(ledger.local.tag, 'v' + ledger.local.version, 'the reference tag names the product version')
  assert.match(ledger.local.head, /^[0-9a-f]{40}$/, 'the local head is a full commit SHA')
  assert.doesNotThrow(
    () => execFileSync('git', ['cat-file', '-e', ledger.local.head + '^{commit}'], { cwd: repoRoot, stdio: 'ignore' }),
    'the recorded baseline head is a real commit in this repository',
  )
})

test('every tracked upstream signal has its own item with evidence and a disposition', () => {
  const ledger = readLedger()
  const sourceIds = new Set(ledger.upstream.sources.map((s) => s.id))
  const seen = new Set()
  for (const item of ledger.upstream.items) {
    assert.ok(item.id && !seen.has(item.id), 'item ids are unique: ' + item.id)
    seen.add(item.id)
    assert.ok(sourceIds.has(item.upstreamSourceId), item.id + ' names a known source')
    assert.ok(item.upstreamQuote && item.upstreamQuote.trim().length > 0, item.id + ' quotes the official text')
    assert.ok(item.claim && item.claim.trim().length > 0, item.id + ' states its claim')
    assert.ok(LOCAL_STATUSES.has(item.localStatus), item.id + ' has a valid local status')
    assert.ok(DISPOSITIONS.has(item.disposition), item.id + ' has a valid disposition')
    assert.ok(Array.isArray(item.localEvidence) && item.localEvidence.length > 0, item.id + ' names local evidence')
    for (const path of item.localEvidence) {
      assert.ok(existsSync(join(repoRoot, path)), item.id + ' evidence path exists: ' + path)
    }
  }
  const versions = new Set(ledger.upstream.items.map((item) => item.upstreamVersion))
  for (const version of ['2.1.287', '2.1.288', '2.1.290']) {
    assert.ok(versions.has(version), 'the seeded baseline covers upstream version ' + version)
  }
})

test('a gap is never dispositioned as applicable-with-nothing-to-do', () => {
  const ledger = readLedger()
  for (const item of ledger.upstream.items) {
    const gap = item.localStatus === 'missing' || item.localStatus === 'partial'
    if (item.disposition === 'applicable' && gap) {
      assert.ok(item.acceptance, item.id + ' is an applicable gap and must carry an acceptance')
    }
    if (item.disposition === 'deferred' || (item.disposition === 'applicable' && gap)) {
      assert.ok(item.acceptance && item.acceptance.summary && item.acceptance.testableAs,
        item.id + ' must name a separately scoped, testable acceptance')
    }
    if (item.disposition === 'rejected') {
      assert.ok(item.rejectionReason && item.rejectionReason.trim().length > 0,
        item.id + ' is rejected and must say why')
      assert.equal(item.acceptance, null, item.id + ' rejected items carry no acceptance')
    }
    if (item.disposition === 'applicable' && !gap) {
      assert.equal(item.acceptance, null, item.id + ' already has parity and needs no acceptance')
    }
  }
})

test('an uncontested upstream unknown is recorded, not resolved by guessing', () => {
  const ledger = readLedger()
  assert.ok(Array.isArray(ledger.openUnknowns) && ledger.openUnknowns.length > 0, 'open unknowns are recorded')
  for (const unknown of ledger.openUnknowns) {
    assert.ok(unknown.id && unknown.question && unknown.whyUnknown, 'each unknown states its question and why it is open')
    assert.equal(unknown.policy, 'unknown-not-no-change', unknown.id + ' keeps the unknown-not-no-change policy')
  }
})

test('a source outage is recorded as unknown, never as no change', () => {
  const ledger = readLedger()
  assert.ok(ledger.outagePolicy && typeof ledger.outagePolicy.rule === 'string', 'the outage policy is stated')
  assert.match(ledger.outagePolicy.rule, /unknown/i, 'the outage rule defaults to unknown')
  assert.match(ledger.outagePolicy.rule, /no change/i, 'the outage rule explicitly forbids "no change"')
})

test('the ledger carries no private or unrelated project data', () => {
  const raw = readFileSync(ledgerPath, 'utf8')
  const forbidden = [/\bozon\b/i, /\/Users\//, /http:\/\//, /api[-_]?key/i, /bearer\s/i, /chatgpt/i]
  for (const pattern of forbidden) {
    assert.equal(pattern.test(raw), false, 'ledger avoids ' + pattern)
  }
})

test('the human-readable workflow and baseline documents exist and agree with the ledger', () => {
  assert.ok(existsSync(workflowPath), 'docs/upstream/workflow.md must exist')
  assert.ok(existsSync(baselinePath), 'docs/upstream/README.md must exist')
  const workflow = readFileSync(workflowPath, 'utf8')
  for (const token of ['candidate', 'verified', 'applicable', 'deferred', 'rejected', 'unknown', 'Scheduled Task']) {
    assert.ok(workflow.toLowerCase().includes(token.toLowerCase()), 'workflow documents the "' + token + '" step')
  }
  const baseline = readFileSync(baselinePath, 'utf8')
  for (const version of ['2.1.287', '2.1.288', '2.1.290']) {
    assert.ok(baseline.includes(version), 'baseline names upstream version ' + version)
  }
  assert.ok(baseline.includes('ledger.json'), 'baseline points at the machine-readable ledger')
})
