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
//     "no change";
//   * an item date must come from an immutable release, not from the fetch day;
//   * the one 2026-10-14 docs-page source stays a recorded historical deviation
//     and is not reused as an active source;
//   * the coverage boundary is pinned and does not claim behavior stability.
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
const addendumPath = join(repoRoot, 'docs/upstream/addendum-20261030-source-policy-deviation.md')
const correctionEvidencePath = join(repoRoot, 'docs/harness-reports/ysk-upstream-ledger-correction-20261030/evidence/github-releases-2.1.287-2.1.312.json')

const LOCAL_STATUSES = new Set(['equivalent', 'adapted', 'partial', 'missing', 'not-applicable', 'unknown'])
const DISPOSITIONS = new Set(['applicable', 'deferred', 'rejected'])
const GITHUB_SOURCE_HOST = 'https://github.com/anthropics/claude-code/'
const HISTORICAL_DOCS_HOST = 'https://code.claude.com/docs/'
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

function readLedger() {
  assert.ok(existsSync(ledgerPath), 'docs/upstream/ledger.json must exist')
  return JSON.parse(readFileSync(ledgerPath, 'utf8'))
}

function sourceMap(ledger) {
  return new Map(ledger.upstream.sources.map((source) => [source.id, source]))
}

/** Remove formatting that differs between the release body and the docs capture. */
function normalizeQuote(text) {
  return text.replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * An item date must be the published date of an immutable GitHub release.
 * The historical defect was a fetch-day date, so the failure cases below
 * deliberately reintroduce it.
 */
function assertItemDateProvenance(item, sources) {
  const fail = (message) => {
    throw new Error(message)
  }
  const source = sources.get(item.upstreamSourceId)
  if (!source) fail(item.id + ' names an unknown source: ' + item.upstreamSourceId)
  if (source.kind !== 'github-release') fail(item.id + ' uses a non-release source for its date: ' + source.kind)
  if (source.immutable !== true) fail(item.id + ' source is not immutable')
  if (source.draft !== false) fail(item.id + ' source is a draft release')
  if (source.prerelease !== false) fail(item.id + ' source is a prerelease')
  if (!ISO_TIMESTAMP.test(source.publishedAt || '')) fail(item.id + ' source has no ISO publishedAt')
  if (item.upstreamDate !== source.publishedAt.slice(0, 10)) {
    fail(item.id + ' upstreamDate ' + item.upstreamDate + ' does not match publishedAt ' + source.publishedAt)
  }
  if (source.tag !== 'v' + item.upstreamVersion) fail(item.id + ' source tag does not match the item version')
  if (source.url !== 'https://github.com/anthropics/claude-code/releases/tag/v' + item.upstreamVersion) {
    fail(item.id + ' source URL does not name its release')
  }
  if (source.tagObjectType !== 'commit') fail(item.id + ' tag ref is not a commit')
  if (!/^[0-9a-f]{40}$/.test(source.tagRefSha || '')) fail(item.id + ' tag ref is not a full commit SHA')
  if (!/^[0-9a-f]{64}$/.test(source.releaseBodySha256 || '')) fail(item.id + ' release body hash is missing')
  if (typeof source.provenance !== 'string' || source.provenance.trim().length === 0) {
    fail(item.id + ' source has no provenance')
  }
}

/** The quote must stay traceable to the 2026-10-14 changelog capture. */
function assertChangelogTrace(item, sources) {
  const fail = (message) => {
    throw new Error(message)
  }
  const trace = item.changelogTrace
  if (!trace) fail(item.id + ' has no changelogTrace')
  const source = sources.get(trace.sourceId)
  if (!source) fail(item.id + ' changelogTrace names an unknown source')
  if (source.historicalOnly !== true) fail(item.id + ' changelogTrace does not point at the historical source')
  if (!source.policyDeviation || !existsSync(join(repoRoot, source.policyDeviation.recordedIn))) {
    fail(item.id + ' changelogTrace source has no recorded policy deviation')
  }
  const line = source.matchedLines.find((candidate) => candidate.version === item.upstreamVersion && candidate.line === trace.line)
  if (!line) fail(item.id + ' changelogTrace line is not in the captured source')
  if (!normalizeQuote(line.text).includes(normalizeQuote(item.upstreamQuote))) {
    fail(item.id + ' quote is not traceable to the captured changelog line')
  }
  if (typeof trace.note !== 'string' || trace.note.trim().length === 0) fail(item.id + ' changelogTrace has no note')
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
    const accepted = source.url.startsWith(GITHUB_SOURCE_HOST)
    const historicalDeviation = source.url.startsWith(HISTORICAL_DOCS_HOST) && source.historicalOnly === true
    assert.ok(accepted || historicalDeviation, source.id + ' uses an accepted GitHub source or the recorded historical deviation')
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
  const tagObject = execFileSync('git', ['rev-parse', ledger.local.tag], { cwd: repoRoot, encoding: 'utf8' }).trim()
  assert.equal(tagObject, ledger.local.tagIdentity.tagObject, 'the recorded tag object is the real tag object')
  assert.equal(
    execFileSync('git', ['cat-file', '-t', tagObject], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    'tag',
    'the reference tag is an annotated tag object',
  )
  assert.equal(
    execFileSync('git', ['rev-parse', ledger.local.tag + '^{}'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    ledger.local.head,
    'the reference tag peels to the recorded baseline head',
  )
})

test('the local baseline records v0.4.6 and the v0.4.3 predecessor without conflating them', () => {
  const ledger = readLedger()
  assert.equal(ledger.local.version, '0.4.6')
  assert.equal(ledger.local.tag, 'v0.4.6')
  assert.equal(ledger.local.head, '038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2')
  assert.equal(ledger.local.tagIdentity.tagObject, '2dd722eb691493281aefa081ebfc722afb7d117f')
  assert.equal(ledger.local.tagIdentity.tagObjectType, 'tag')
  assert.equal(ledger.local.tagIdentity.pointsAt, ledger.local.head)
  const previous = ledger.local.previousBaseline
  assert.equal(previous.version, '0.4.3')
  assert.equal(previous.tag, 'v0.4.3')
  assert.equal(previous.head, '746d1caa2101b96c97f85b0a0e387b57e77fc436')
  assert.equal(previous.tagObject, '7d392bd65e07fdbd42530e56d32698a05edeba52')
  assert.equal(previous.tagPointsAt, 'b6a202d00e80e6069c07b03e65034b4280756f1d')
  assert.notEqual(previous.tagPointsAt, previous.head, 'the historical v0.4.3 tag does not point at the previous ledger head')
})

test('every tracked upstream signal has its own item with evidence and a disposition', () => {
  const ledger = readLedger()
  const sources = sourceMap(ledger)
  const seen = new Set()
  for (const item of ledger.upstream.items) {
    assert.ok(item.id && !seen.has(item.id), 'item ids are unique: ' + item.id)
    seen.add(item.id)
    assert.ok(sources.has(item.upstreamSourceId), item.id + ' names a known source')
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

test('every item date comes from an immutable release and keeps its changelog trace', () => {
  const ledger = readLedger()
  const sources = sourceMap(ledger)
  for (const item of ledger.upstream.items) {
    assertItemDateProvenance(item, sources)
    assertChangelogTrace(item, sources)
  }
})

test('the date provenance check rejects a fetch-day date and an unpinned release', () => {
  const ledger = readLedger()
  const sources = sourceMap(ledger)
  const base = structuredClone(ledger.upstream.items.find((item) => item.id === 'U-2.1.288-note-voice'))
  const cases = [
    ['the fetch day is used as upstreamDate', (item) => { item.upstreamDate = '2026-10-14' }],
    ['the release has no publishedAt', (item, local) => { delete local.get(item.upstreamSourceId).publishedAt }],
    ['the release is not immutable', (item, local) => { local.get(item.upstreamSourceId).immutable = false }],
    ['the release is a draft', (item, local) => { local.get(item.upstreamSourceId).draft = true }],
    ['the tag ref is not a full SHA', (item, local) => { local.get(item.upstreamSourceId).tagRefSha = 'abc123' }],
    ['the tag does not match the item version', (item, local) => { local.get(item.upstreamSourceId).tag = 'v2.1.999' }],
    ['the release body hash is missing', (item, local) => { delete local.get(item.upstreamSourceId).releaseBodySha256 }],
    ['the provenance is empty', (item, local) => { local.get(item.upstreamSourceId).provenance = '   ' }],
  ]
  for (const [name, mutate] of cases) {
    const item = structuredClone(base)
    const localSources = new Map([...sources].map(([id, source]) => [id, structuredClone(source)]))
    mutate(item, localSources)
    assert.throws(() => assertItemDateProvenance(item, localSources), Error, name)
  }
})

test('the new provenance check rejects the historical 2026-10-14 ledger state', () => {
  const baseCommit = '038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2'
  const historical = JSON.parse(execFileSync('git', ['show', baseCommit + ':docs/upstream/ledger.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }))
  const sources = sourceMap(historical)
  const item = historical.upstream.items.find((candidate) => candidate.id === 'U-2.1.288-note-voice')
  assert.equal(item.upstreamDate, '2026-10-14', 'the historical ledger used the fetch day')
  assert.throws(
    () => assertItemDateProvenance(item, sources),
    /non-release source/,
    'the new check rejects the historical docs-page source as a date source',
  )
})

test('a gap or an adaptation is never dispositioned as applicable-with-nothing-to-do', () => {
  const ledger = readLedger()
  for (const item of ledger.upstream.items) {
    const gap = item.localStatus === 'missing' || item.localStatus === 'partial'
    // An adapted item may carry a scoped acceptance: the adaptation is real and
    // is verified, but the upstream behavior itself is not claimed as proven.
    const needsAcceptance = item.disposition === 'deferred' || gap
    if (item.disposition === 'applicable' && gap) {
      assert.ok(item.acceptance, item.id + ' is an applicable gap and must carry an acceptance')
    }
    if (needsAcceptance) {
      assert.ok(item.acceptance && item.acceptance.summary && item.acceptance.testableAs,
        item.id + ' must name a separately scoped, testable acceptance')
    }
    if (item.disposition === 'rejected') {
      assert.ok(item.rejectionReason && item.rejectionReason.trim().length > 0,
        item.id + ' is rejected and must say why')
      assert.equal(item.acceptance, null, item.id + ' rejected items carry no acceptance')
    }
    if (item.disposition === 'applicable' && !gap && item.localStatus !== 'adapted') {
      assert.equal(item.acceptance, null, item.id + ' already has parity and needs no acceptance')
    }
    if (item.acceptance) {
      assert.ok(item.acceptance.summary && item.acceptance.testableAs,
        item.id + ' carries a scoped acceptance with a summary and a testable claim')
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

test('the source policy keeps only the 2026-10-14 docs page as a recorded deviation', () => {
  const ledger = readLedger()
  const docsSources = ledger.upstream.sources.filter((source) => source.url.startsWith(HISTORICAL_DOCS_HOST))
  assert.equal(docsSources.length, 1, 'exactly one historical docs source is recorded')
  for (const source of docsSources) {
    assert.equal(source.historicalOnly, true, source.id + ' is marked historicalOnly')
    assert.ok(source.policyDeviation, source.id + ' carries a policyDeviation record')
    assert.ok(existsSync(join(repoRoot, source.policyDeviation.recordedIn)), source.id + ' names an existing addendum')
    assert.equal(
      ledger.upstream.items.some((item) => item.upstreamSourceId === source.id),
      false,
      'the historical docs source is not used as an active item source',
    )
  }
  for (const source of ledger.upstream.sources) {
    if (source.url.startsWith(HISTORICAL_DOCS_HOST)) continue
    assert.ok(source.url.startsWith(GITHUB_SOURCE_HOST), source.id + ' uses an accepted GitHub source')
  }
  const decisions = ledger.openPolicyDecisions
  assert.ok(Array.isArray(decisions) && decisions.length === 1, 'one open source-policy decision is recorded')
  assert.equal(decisions[0].id, 'stage-1b-official-docs-source-policy')
  assert.equal(decisions[0].status, 'deferred-to-stage-1b')
  assert.ok(existsSync(join(repoRoot, decisions[0].evidence)), 'the open decision names its evidence')
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /tagged release notes/i, 'the workflow still names tagged release notes')
  assert.match(workflow, /CHANGELOG\.md/, 'the workflow still names CHANGELOG.md')
  assert.match(workflow, /addendum-20261030-source-policy-deviation\.md/, 'the workflow points at the deviation addendum')
  const addendum = readFileSync(addendumPath, 'utf8')
  for (const phrase of [
    '2026-10-14',
    'process deviation',
    'does not retroactively authorize',
    'Stage 1B',
    'c5fac2b1502d8a221ec4a7e229012c645f84be0d9310791173af84031e809d7a',
  ]) {
    assert.ok(addendum.includes(phrase), 'the addendum records: ' + phrase)
  }
})

test('the coverage record is pinned to v2.1.312 and does not claim behavior stability', () => {
  const ledger = readLedger()
  const coverage = ledger.coverage
  assert.equal(coverage.checkedThrough.version, '2.1.312')
  assert.equal(coverage.checkedThrough.tag, 'v2.1.312')
  assert.equal(coverage.checkedThrough.url, 'https://github.com/anthropics/claude-code/releases/tag/v2.1.312')
  assert.equal(coverage.checkedThrough.publishedAt, '2026-10-27T20:24:20Z')
  assert.match(coverage.checkedThrough.tagRefSha, /^[0-9a-f]{40}$/)
  assert.equal(coverage.checkedThrough.tagObjectType, 'commit')
  assert.match(coverage.checkedThrough.releaseBodySha256, /^[0-9a-f]{64}$/)
  assert.equal(coverage.lastDirectSignalVersion, '2.1.290')
  assert.equal(coverage.range.after, 'v2.1.290')
  assert.equal(coverage.range.through, 'v2.1.312')
  assert.equal(coverage.range.releaseCount, coverage.range.versions.length)
  assert.equal(coverage.range.releaseCount, 20)
  for (const version of coverage.range.versions) {
    assert.match(version, /^v2\.1\.\d+$/, version + ' is a version tag')
    assert.ok(version > 'v2.1.290', version + ' is after the last direct signal')
  }
  assert.deepEqual(coverage.range.missingTagNumbers, ['v2.1.297', 'v2.1.298'])
  assert.match(coverage.doesNotClaim, /not claim/i)
  assert.match(coverage.doesNotClaim, /behavior/i)
  assert.ok(existsSync(join(repoRoot, coverage.evidence)), 'the coverage record names its evidence')
})

test('the committed coverage evidence supports the recorded release dates', () => {
  assert.ok(existsSync(correctionEvidencePath), 'the coverage evidence exists')
  const evidence = JSON.parse(readFileSync(correctionEvidencePath, 'utf8'))
  assert.equal(evidence.releaseCount, evidence.releases.length)
  assert.equal(evidence.releaseCount, 24)
  const byTag = new Map(evidence.releases.map((release) => [release.tag, release]))
  for (const [tag, publishedAt, tagRefSha] of [
    ['v2.1.287', '2026-10-01T18:00:22Z', '816ec211a648f17a411f63a45cfd44ddf8db00d9'],
    ['v2.1.288', '2026-10-02T20:19:57Z', '1c229fcd1e1e4e452e29a8f116b45fe4cfe2c528'],
    ['v2.1.290', '2026-10-05T23:33:17Z', 'e8ae451830fb8d1d8edf853c7830ff6c650d3ee3'],
    ['v2.1.312', '2026-10-27T20:24:20Z', '0e1f4789406477380b267a01f3ddd50b0211e5b3'],
  ]) {
    const release = byTag.get(tag)
    assert.ok(release, tag + ' is in the coverage evidence')
    assert.equal(release.publishedAt, publishedAt, tag + ' keeps its published date')
    assert.equal(release.immutable, true, tag + ' is immutable')
    assert.equal(release.tagRefSha, tagRefSha, tag + ' keeps its tag ref')
    assert.match(release.bodySha256, /^[0-9a-f]{64}$/, tag + ' carries a body hash')
  }
  const after = evidence.releases.filter((release) => release.tag > 'v2.1.290' && release.tag <= 'v2.1.312')
  assert.equal(after.length, 20, 'twenty release bodies were checked after 2.1.290')
  for (const release of after) {
    assert.deepEqual(release.youShouldKnowLines, [], release.tag + ' has no direct You should know line')
  }
  const signals = evidence.releases.filter((release) => release.youShouldKnowLines.length > 0).map((release) => release.tag)
  assert.deepEqual(signals, ['v2.1.287', 'v2.1.288', 'v2.1.290'], 'only the three known releases carry a direct line')
  const ledger = readLedger()
  for (const [tag, id] of [
    ['v2.1.287', 'U-2.1.287-builtin-side-agent'],
    ['v2.1.288', 'U-2.1.288-note-voice'],
    ['v2.1.290', 'U-2.1.290-language-setting'],
  ]) {
    const item = ledger.upstream.items.find((candidate) => candidate.id === id)
    assert.equal(item.upstreamDate, byTag.get(tag).publishedAt.slice(0, 10), id + ' uses the evidence date')
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
