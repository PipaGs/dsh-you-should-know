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
//   * official code.claude.com docs pages are behavior evidence only: no date,
//     no version, no publishedAt, and a documented lastModified is not proof;
//   * the one 2026-10-14 docs-page source stays a recorded historical deviation
//     and is not reused as an active source;
//   * the coverage boundary is pinned and does not claim behavior stability.
//
// It reads repository documentation only; it never touches the network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ledgerPath = join(repoRoot, 'docs/upstream/ledger.json')
const workflowPath = join(repoRoot, 'docs/upstream/workflow.md')
const baselinePath = join(repoRoot, 'docs/upstream/README.md')
const addendumPath = join(repoRoot, 'docs/upstream/addendum-20261030-source-policy-deviation.md')
const rawEvidencePath = join(repoRoot, 'docs/upstream/evidence/claude-code-upstream-20261014.json')
const correctionEvidencePath = join(repoRoot, 'docs/harness-reports/ysk-upstream-ledger-correction-20261030/evidence/github-releases-2.1.287-2.1.312.json')

const LOCAL_STATUSES = new Set(['equivalent', 'adapted', 'partial', 'missing', 'not-applicable', 'unknown'])
const DISPOSITIONS = new Set(['applicable', 'deferred', 'rejected'])
const DOCS_ALLOWLIST = { scheme: 'https', host: 'code.claude.com', pathPrefix: '/docs/' }
const RELEASE_URL_PREFIX = 'https://github.com/anthropics/claude-code/releases/tag/'
const CHANGELOG_URL_PATTERN = /^https:\/\/github\.com\/anthropics\/claude-code\/blob\/([0-9a-f]{40})\/CHANGELOG\.md$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const SHA256_HEX = /^[0-9a-f]{64}$/
const SHA1_HEX = /^[0-9a-f]{40}$/

function readLedger() {
  assert.ok(existsSync(ledgerPath), 'docs/upstream/ledger.json must exist')
  return JSON.parse(readFileSync(ledgerPath, 'utf8'))
}

function sourceMap(ledger) {
  return new Map(ledger.upstream.sources.map((source) => [source.id, source]))
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Remove formatting that differs between the release body and the docs capture. */
function normalizeQuote(text) {
  return text.replace(/\x60/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * The exact behavior-source allowlist: https only, host exactly
 * code.claude.com, path under /docs/, no userinfo, no non-default port, no
 * query, no fragment, no parent segment (including encoded %2e%2e).
 * Returns null when the URL is accepted, otherwise a short reason.
 */
function docsUrlProblem(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return 'url is missing'
  const text = raw.trim()
  if (text.includes('?') || text.includes('#')) return 'query strings and fragments are not part of the source identity'
  let url
  try {
    url = new URL(raw)
  } catch {
    return 'url is not absolute'
  }
  if (url.protocol !== DOCS_ALLOWLIST.scheme + ':') return 'scheme must be https'
  if (url.hostname.toLowerCase() !== DOCS_ALLOWLIST.host) return 'host must be code.claude.com'
  if (url.username !== '' || url.password !== '') return 'userinfo is not allowed'
  if (url.port !== '') return 'non-default port is not allowed'
  if (url.search !== '') return 'query strings are not part of the source identity'
  if (url.hash !== '') return 'fragments are not part of the source identity'
  const path = url.pathname
  if (!path.startsWith(DOCS_ALLOWLIST.pathPrefix)) return 'path must start with /docs/'
  if (/%2e/i.test(path)) return 'encoded dot segments are not allowed'
  let decoded
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return 'path is not valid percent-encoding'
  }
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) {
    return 'parent path segments are not allowed'
  }
  return null
}

/** A behavior source is mutable, hashed, dated, and never a date source. */
function assertBehaviorSource(source) {
  const fail = (message) => {
    throw new Error(message)
  }
  if (!source || typeof source !== 'object') fail('behavior source is missing')
  const id = typeof source.id === 'string' && source.id.trim().length > 0 ? source.id : 'behavior source'
  if (typeof source.id !== 'string' || source.id.trim().length === 0) fail('behavior source has no id')
  if (source.kind !== 'official-docs-page') fail(id + ' is not an official-docs-page')
  const problem = docsUrlProblem(source.url)
  if (problem) fail(id + ' has an unaccepted URL: ' + problem)
  if (source.immutable !== false) fail(id + ' must carry immutable false')
  if (!SHA256_HEX.test(source.sha256 || '')) fail(id + ' has no 64 lowercase hex sha256')
  if (!ISO_TIMESTAMP.test(source.fetchedAt || '')) fail(id + ' has no ISO UTC fetchedAt')
  if (Object.hasOwn(source, 'publishedAt')) fail(id + ' must not carry publishedAt')
  if (source.historicalOnly === true) fail(id + ' must not be a historical-only record')
  if (Object.hasOwn(source, 'lastModified')) {
    if (!ISO_TIMESTAMP.test(source.lastModified || '')) fail(id + ' lastModified is not an ISO UTC timestamp')
    if (source.lastModifiedIsPublicationProof !== false) {
      fail(id + ' lastModified requires lastModifiedIsPublicationProof false')
    }
  }
  if (source.lastModifiedIsPublicationProof === true) fail(id + ' lastModifiedIsPublicationProof must never be true')
}

/** A release source is immutable and carries the exact release identity. */
function assertReleaseSource(source) {
  const fail = (message) => {
    throw new Error(message)
  }
  if (!source || typeof source !== 'object') fail('release source is missing')
  const id = typeof source.id === 'string' && source.id.trim().length > 0 ? source.id : 'release source'
  if (source.kind !== 'github-release') fail(id + ' is not a github-release')
  if (typeof source.tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(source.tag)) fail(id + ' has no release tag')
  const expectedUrl = RELEASE_URL_PREFIX + source.tag
  if (source.url !== expectedUrl) fail(id + ' URL must be exactly ' + expectedUrl)
  if (source.immutable !== true) fail(id + ' must be immutable')
  if (source.draft !== false) fail(id + ' must not be a draft')
  if (source.prerelease !== false) fail(id + ' must not be a prerelease')
  if (!ISO_TIMESTAMP.test(source.publishedAt || '')) fail(id + ' has no ISO UTC publishedAt')
  if (!SHA1_HEX.test(source.tagRefSha || '')) fail(id + ' tag ref is not a full commit SHA')
  if (!SHA256_HEX.test(source.releaseBodySha256 || '')) fail(id + ' release body hash is missing')
  if (typeof source.provenance !== 'string' || source.provenance.trim().length === 0) {
    fail(id + ' has no provenance')
  }
}

/** A changelog source is pinned to a full commit and hashed. */
function assertChangelogSource(source) {
  const fail = (message) => {
    throw new Error(message)
  }
  if (!source || typeof source !== 'object') fail('changelog source is missing')
  const id = typeof source.id === 'string' && source.id.trim().length > 0 ? source.id : 'changelog source'
  if (source.kind !== 'github-changelog') fail(id + ' is not a github-changelog')
  const match = CHANGELOG_URL_PATTERN.exec(source.url || '')
  if (!match) fail(id + ' URL is not a commit-pinned CHANGELOG.md URL')
  if (!SHA1_HEX.test(source.commitSha || '')) fail(id + ' commitSha is not a full commit SHA')
  if (match[1] !== source.commitSha) fail(id + ' URL commit does not match commitSha')
  if (!ISO_TIMESTAMP.test(source.commitDate || '')) fail(id + ' has no ISO UTC commitDate')
  if (!ISO_TIMESTAMP.test(source.fetchedAt || '')) fail(id + ' has no ISO UTC fetchedAt')
  if (!SHA256_HEX.test(source.sha256 || '')) fail(id + ' has no 64 lowercase hex sha256')
}

function validDocsSource() {
  return {
    id: 'docs-fixture',
    kind: 'official-docs-page',
    url: 'https://code.claude.com/docs/en/example',
    immutable: false,
    sha256: 'a'.repeat(64),
    fetchedAt: '2026-10-30T07:00:00Z',
    lastModified: '2026-10-29T12:00:00Z',
    lastModifiedIsPublicationProof: false,
  }
}

function validReleaseSource() {
  return {
    id: 'release-fixture',
    kind: 'github-release',
    url: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.288',
    tag: 'v2.1.288',
    immutable: true,
    draft: false,
    prerelease: false,
    publishedAt: '2026-10-02T20:19:57Z',
    tagRefSha: '1'.repeat(40),
    releaseBodySha256: '2'.repeat(64),
    provenance: 'Fixture provenance recorded for the structural test.',
  }
}

function validChangelogSource() {
  return {
    id: 'changelog-fixture',
    kind: 'github-changelog',
    url: 'https://github.com/anthropics/claude-code/blob/' + 'a'.repeat(40) + '/CHANGELOG.md',
    commitSha: 'a'.repeat(40),
    commitDate: '2026-10-14T02:49:24Z',
    fetchedAt: '2026-10-14T09:43:02Z',
    sha256: 'b'.repeat(64),
  }
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
  if (!SHA1_HEX.test(source.tagRefSha || '')) fail(item.id + ' tag ref is not a full commit SHA')
  if (!SHA256_HEX.test(source.releaseBodySha256 || '')) fail(item.id + ' release body hash is missing')
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
  assert.match(ledger.generatedAt, ISO_TIMESTAMP, 'ledger records an ISO timestamp for when it was generated')
  assert.equal(ledger.upstream.project, 'anthropics/claude-code', 'upstream project is official')
  assert.equal(ledger.upstream.algorithmDisclosed, false, 'the upstream algorithm stays undisclosed')
  assert.ok(Array.isArray(ledger.upstream.sources) && ledger.upstream.sources.length >= 2, 'at least two official sources')
  for (const source of ledger.upstream.sources) {
    assert.ok(source.id, 'every source has an id')
    assert.ok(source.kind, source.id + ' has a kind')
    if (source.kind === 'official-docs-page') {
      assertBehaviorSource(source)
    } else if (source.kind === 'github-release') {
      assertReleaseSource(source)
    } else if (source.kind === 'github-changelog') {
      assertChangelogSource(source)
    } else {
      assert.equal(source.historicalOnly, true, source.id + ' is only accepted as the recorded historical deviation')
      assert.equal(source.id, 'claude-code-changelog-page-20261014')
      assert.equal(source.kind, 'official-docs-changelog')
      assert.equal(source.url, 'https://code.claude.com/docs/en/changelog.md')
    }
    assert.ok(source.fetchedAt, source.id + ' records when it was fetched')
    const pinned = source.immutable === true || SHA1_HEX.test(source.commitSha || '') || SHA256_HEX.test(source.sha256 || '')
    assert.ok(pinned, source.id + ' is immutable, pinned to a full commit SHA, or carries a content hash')
  }
  // An unapproved host never passes any class-specific validator.
  assert.throws(() => assertBehaviorSource({ ...validDocsSource(), url: 'https://example.com/docs/en/x' }), /unaccepted URL/)
  assert.throws(() => assertReleaseSource({ ...validReleaseSource(), url: 'https://example.com/anthropics/claude-code/releases/tag/v2.1.288' }), /URL must be exactly/)
  assert.throws(() => assertChangelogSource({ ...validChangelogSource(), url: 'https://example.com/anthropics/claude-code/blob/' + 'a'.repeat(40) + '/CHANGELOG.md' }), /commit-pinned CHANGELOG/)
})

test('a valid official docs page is accepted as a behavior source only', () => {
  const source = validDocsSource()
  assert.doesNotThrow(() => assertBehaviorSource(source))
  assert.equal(docsUrlProblem(source.url), null)
  assert.equal(docsUrlProblem('https://CODE.CLAUDE.COM/docs/en/x'), null, 'the host is case-insensitive after URL parsing')
  assert.equal(docsUrlProblem('https://code.claude.com:443/docs/en/x'), null, 'the default https port is accepted')
  const withoutLastModified = { ...source }
  delete withoutLastModified.lastModified
  delete withoutLastModified.lastModifiedIsPublicationProof
  assert.doesNotThrow(() => assertBehaviorSource(withoutLastModified))
})

test('the docs allowlist rejects every unaccepted URL shape and field', () => {
  const cases = [
    ['http scheme', () => ({ url: 'http://code.claude.com/docs/en/x' })],
    ['docs.claude.com host', () => ({ url: 'https://docs.claude.com/docs/en/x' })],
    ['host suffix attack', () => ({ url: 'https://code.claude.com.evil.example/docs/en/x' })],
    ['example.com host', () => ({ url: 'https://example.com/docs/en/x' })],
    ['path outside /docs/', () => ({ url: 'https://code.claude.com/en/docs/x' })],
    ['path /docs without a trailing slash', () => ({ url: 'https://code.claude.com/docs' })],
    ['plain parent segment', () => ({ url: 'https://code.claude.com/docs/../admin' })],
    ['encoded parent segment', () => ({ url: 'https://code.claude.com/docs/%2e%2e/admin' })],
    ['query string', () => ({ url: 'https://code.claude.com/docs/en/x?ref=1' })],
    ['empty query', () => ({ url: 'https://code.claude.com/docs/en/x?' })],
    ['fragment', () => ({ url: 'https://code.claude.com/docs/en/x#section' })],
    ['empty fragment', () => ({ url: 'https://code.claude.com/docs/en/x#' })],
    ['userinfo', () => ({ url: 'https://user:secret@code.claude.com/docs/en/x' })],
    ['non-default port', () => ({ url: 'https://code.claude.com:8443/docs/en/x' })],
    ['missing sha256', () => ({ removeSha256: true })],
    ['short sha256', () => ({ sha256: 'abc123' })],
    ['missing fetchedAt', () => ({ removeFetchedAt: true })],
    ['non-ISO fetchedAt', () => ({ fetchedAt: '2026-10-30' })],
    ['immutable true', () => ({ immutable: true })],
    ['historicalOnly true', () => ({ historicalOnly: true })],
    ['kind official-docs-changelog', () => ({ kind: 'official-docs-changelog' })],
    ['publishedAt present', () => ({ publishedAt: '2026-10-14T09:54:42Z' })],
    ['lastModified without the publication-proof flag', () => ({ removeLastModifiedFlag: true })],
    ['lastModifiedIsPublicationProof true', () => ({ lastModifiedIsPublicationProof: true })],
    ['GitHub release URL', () => ({ url: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.288' })],
  ]
  for (const [name, mutate] of cases) {
    const source = validDocsSource()
    const patch = mutate()
    if (patch.removeSha256) delete source.sha256
    if (patch.removeFetchedAt) delete source.fetchedAt
    if (patch.removeLastModifiedFlag) delete source.lastModifiedIsPublicationProof
    delete patch.removeSha256
    delete patch.removeFetchedAt
    delete patch.removeLastModifiedFlag
    Object.assign(source, patch)
    assert.throws(() => assertBehaviorSource(source), Error, name)
  }
})

test('a release source must be immutable and carry its exact identity', () => {
  assert.doesNotThrow(() => assertReleaseSource(validReleaseSource()))
  const cases = [
    ['immutable false', (s) => { s.immutable = false }],
    ['draft true', (s) => { s.draft = true }],
    ['prerelease true', (s) => { s.prerelease = true }],
    ['missing publishedAt', (s) => { delete s.publishedAt }],
    ['short tagRefSha', (s) => { s.tagRefSha = 'abc123' }],
    ['missing releaseBodySha256', (s) => { delete s.releaseBodySha256 }],
    ['empty provenance', (s) => { s.provenance = '   ' }],
    ['docs URL', (s) => { s.url = 'https://code.claude.com/docs/en/interactive-mode' }],
    ['URL with query', (s) => { s.url += '?ref=1' }],
    ['kind official-docs-page', (s) => { s.kind = 'official-docs-page' }],
  ]
  for (const [name, mutate] of cases) {
    const source = validReleaseSource()
    mutate(source)
    assert.throws(() => assertReleaseSource(source), Error, name)
  }
})

test('a changelog source is pinned to a full commit and hashed', () => {
  assert.doesNotThrow(() => assertChangelogSource(validChangelogSource()))
  const cases = [
    ['unpinned URL', (s) => { s.url = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md' }],
    ['commit mismatch', (s) => { s.commitSha = 'c'.repeat(40) }],
    ['short sha256', (s) => { s.sha256 = 'abc123' }],
    ['missing commitDate', (s) => { delete s.commitDate }],
    ['non-ISO commitDate', (s) => { s.commitDate = '2026-10-14' }],
    ['missing fetchedAt', (s) => { delete s.fetchedAt }],
    ['wrong kind', (s) => { s.kind = 'github-release' }],
  ]
  for (const [name, mutate] of cases) {
    const source = validChangelogSource()
    mutate(source)
    assert.throws(() => assertChangelogSource(source), Error, name)
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

test('the date provenance check rejects a behavior source and a docs lastModified date', () => {
  const docs = validDocsSource()
  const docsSources = new Map([[docs.id, docs]])
  const docsItem = {
    id: 'docs-as-date-source',
    upstreamSourceId: docs.id,
    upstreamVersion: '2.1.288',
    upstreamDate: docs.lastModified.slice(0, 10),
  }
  assert.throws(
    () => assertItemDateProvenance(docsItem, docsSources),
    /non-release source/,
    'a behavior source never provides an item date',
  )

  const ledger = readLedger()
  const releaseSources = sourceMap(ledger)
  const releaseItem = structuredClone(ledger.upstream.items.find((item) => item.id === 'U-2.1.288-note-voice'))
  releaseItem.upstreamDate = docs.lastModified.slice(0, 10)
  assert.throws(
    () => assertItemDateProvenance(releaseItem, releaseSources),
    /does not match publishedAt/,
    'the docs lastModified date never becomes upstreamDate',
  )
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

test('the outage and provenance policy keeps the previous verified baseline', () => {
  const ledger = readLedger()
  const outage = ledger.outagePolicy
  assert.match(outage.rule, /unknown/i)
  assert.match(outage.rule, /no change/i)
  assert.match(outage.rule, /previous verified baseline/i)
  assert.match(outage.rule, /unreachable|unverifiable/i)
  assert.match(outage.provenanceRule, /exact bytes/i)
  assert.match(outage.provenanceRule, /hashed/i)
  assert.match(outage.offlineCopyRule, /not a fresh verification/i)
  assert.equal(outage.silentFallback, false)
  const provenance = ledger.sourcePolicy.provenance
  assert.deepEqual(provenance, {
    verifiedOnlyWithExactBytes: true,
    requireContentHash: true,
    requireFetchedAt: true,
    retainPreviousVerifiedBaselineOnFailure: true,
    unreachableState: 'unknown',
    silentNoChangeFallback: false,
  })
})

test('the ledger carries no private or unrelated project data', () => {
  const raw = readFileSync(ledgerPath, 'utf8')
  const forbidden = [/\bozon\b/i, /\/Users\//, /http:\/\//, /api[-_]?key/i, /bearer\s/i, /chatgpt/i]
  for (const pattern of forbidden) {
    assert.equal(pattern.test(raw), false, 'ledger avoids ' + pattern)
  }
})

test('the historical 2026-10-14 docs capture stays a recorded deviation', () => {
  const ledger = readLedger()
  const historical = ledger.upstream.sources.filter((source) => source.historicalOnly === true)
  assert.equal(historical.length, 1, 'exactly one historical docs source is recorded')
  const source = historical[0]
  assert.equal(source.id, 'claude-code-changelog-page-20261014')
  assert.equal(source.kind, 'official-docs-changelog')
  assert.equal(source.url, 'https://code.claude.com/docs/en/changelog.md')
  assert.equal(source.sha256, 'dfc62da25a39339848ffedb7cf2beadf51f41458d7b681d79d25b22274550d5e')
  assert.equal(source.fetchedAt, '2026-10-14T09:54:42Z')
  assert.ok(source.policyDeviation && source.policyDeviation.recordedIn, source.id + ' carries a policyDeviation record')
  assert.ok(existsSync(join(repoRoot, source.policyDeviation.recordedIn)), source.id + ' names an existing addendum')
  assert.match(source.policyDeviation.reason, /not retroactively authorized/)
  assert.equal(
    ledger.upstream.items.some((item) => item.upstreamSourceId === source.id),
    false,
    'the historical docs source is not used as an active item source',
  )
  assert.equal(ledger.sourcePolicy.historicalDeviation.sourceId, source.id)
  assert.equal(ledger.sourcePolicy.historicalDeviation.retroactivelyAuthorized, false)
  const addendum = readFileSync(addendumPath, 'utf8')
  assert.ok(addendum.includes('does not retroactively authorize'), 'the addendum keeps the non-retroactive statement')
  assert.ok(addendum.includes('Stage 1B'), 'the addendum keeps the Stage 1B deferral history')
})

test('the addendum and the raw 2026-10-14 evidence stay byte-identical', () => {
  assert.equal(sha256File(addendumPath), '1355c524b48e01a6d870fd010ccdcc4456c5070991f8ded2b2ff9035776eedc7')
  assert.equal(sha256File(rawEvidencePath), 'c5fac2b1502d8a221ec4a7e229012c645f84be0d9310791173af84031e809d7a')
})

test('the ledger source policy matches the exact allowlist and role limits', () => {
  const ledger = readLedger()
  const policy = ledger.sourcePolicy
  assert.equal(policy.acceptedIn, 'Stage 1B')
  assert.match(policy.acceptedAt, ISO_TIMESTAMP)
  assert.equal(policy.policyDocument, 'docs/upstream/workflow.md')
  assert.deepEqual(policy.behaviorSources.allowlist, DOCS_ALLOWLIST)
  assert.equal(policy.releaseSources.role, 'canonical-release-version-date')
  assert.equal(policy.behaviorSources.role, 'behavior-evidence-only')
  assert.equal(policy.behaviorSources.kind, 'official-docs-page')
  assert.equal(policy.behaviorSources.allowedForVersionDate, false)
  assert.equal(policy.behaviorSources.allowedForPublicationDate, false)
  assert.equal(policy.behaviorSources.reFetchEveryCycle, true)
  assert.equal(policy.behaviorSources.changeDetection, 'sha256')
  assert.equal(policy.behaviorSources.lastModifiedIsPublicationProof, false)
  assert.equal(policy.behaviorSources.immutable, false)
  assert.deepEqual(policy.behaviorSources.required, ['id', 'kind', 'url', 'immutable', 'sha256', 'fetchedAt'])
  assert.deepEqual(policy.behaviorSources.optionalMetadata, ['lastModified'])
  assert.equal(policy.behaviorSources.excerptPolicy, 'short-official-sentences-only')
  assert.deepEqual(policy.releaseSources.githubRelease, {
    kind: 'github-release',
    scheme: 'https',
    host: 'github.com',
    pathPrefix: '/anthropics/claude-code/releases/tag/',
    immutable: true,
    required: ['tag', 'tagRefSha', 'publishedAt', 'releaseBodySha256', 'provenance'],
  })
  assert.deepEqual(policy.releaseSources.githubChangelog, {
    kind: 'github-changelog',
    scheme: 'https',
    host: 'github.com',
    pathPrefix: '/anthropics/claude-code/blob/',
    pin: 'commitSha',
    required: ['commitSha', 'commitDate', 'fetchedAt', 'sha256'],
  })
  assert.deepEqual(policy.provenance, {
    verifiedOnlyWithExactBytes: true,
    requireContentHash: true,
    requireFetchedAt: true,
    retainPreviousVerifiedBaselineOnFailure: true,
    unreachableState: 'unknown',
    silentNoChangeFallback: false,
  })
  assert.deepEqual(policy.security, {
    privateProjectOrSessionDataToPublicPages: 'forbidden',
    copyPrivateClaudeInternals: 'forbidden',
    copyClosedSourceCode: 'forbidden',
  })
  assert.equal(policy.historicalDeviation.retroactivelyAuthorized, false)
  assert.ok(existsSync(join(repoRoot, policy.historicalDeviation.recordedIn)), 'the historical deviation names an existing record')
  assert.deepEqual(ledger.openPolicyDecisions, [], 'the open policy decision list stays present and empty')
  assert.equal(ledger.resolvedPolicyDecisions.length, 1)
  const decision = ledger.resolvedPolicyDecisions[0]
  assert.equal(decision.id, 'stage-1b-official-docs-source-policy')
  assert.equal(decision.status, 'accepted')
  assert.equal(decision.acceptedIn, 'Stage 1B')
  assert.match(decision.acceptedAt, ISO_TIMESTAMP)
  assert.equal(decision.decision, 'Official Anthropic Claude Code documentation under HTTPS https://code.claude.com/docs/ is accepted as behavior evidence only, for documented feature behavior, availability, cost, and UI contract. It is never a versioned release signal and never establishes a version or a publication date. GitHub tagged releases and CHANGELOG.md remain canonical for version, date, and release content.')
  assert.deepEqual(decision.scope, ['feature behavior', 'availability', 'cost', 'UI contract'])
  assert.deepEqual(decision.outOfScope, ['version', 'publication date', 'release note', 'changelog line'])
  assert.equal(decision.notRetroactive, 'The 2026-10-14 docs-page capture remains a recorded deviation and is not retroactively authorized.')
  assert.ok(Array.isArray(decision.evidence) && decision.evidence.length > 0, 'the accepted decision names its evidence')
  for (const path of decision.evidence) {
    assert.ok(existsSync(join(repoRoot, path)), 'the accepted decision evidence path exists: ' + path)
  }

  const workflow = readFileSync(workflowPath, 'utf8')
  for (const phrase of [
    'https://code.claude.com/docs/',
    'code.claude.com',
    '/docs/',
    'behavior',
    'versioned release signal',
    'canonical',
    'SHA-256',
    'sha256',
    'fetchedAt',
    'lastModified',
    're-fetch',
    'unknown',
    'no change',
    'previous verified baseline',
    'private',
    'closed-source',
  ]) {
    assert.ok(workflow.includes(phrase), 'workflow records: ' + phrase)
  }

  const baseline = readFileSync(baselinePath, 'utf8')
  assert.match(baseline, /accepted in Stage 1B/i)
  for (const phrase of ['behavior evidence', 'code.claude.com/docs', 'canonical', 'sha256', 'fetchedAt', 'not retroactively authorized']) {
    assert.ok(baseline.includes(phrase), 'baseline records: ' + phrase)
  }
})

test('the coverage record is pinned to v2.1.312 and does not claim behavior stability', () => {
  const ledger = readLedger()
  const coverage = ledger.coverage
  assert.equal(coverage.checkedThrough.version, '2.1.312')
  assert.equal(coverage.checkedThrough.tag, 'v2.1.312')
  assert.equal(coverage.checkedThrough.url, 'https://github.com/anthropics/claude-code/releases/tag/v2.1.312')
  assert.equal(coverage.checkedThrough.publishedAt, '2026-10-27T20:24:20Z')
  assert.match(coverage.checkedThrough.tagRefSha, SHA1_HEX)
  assert.equal(coverage.checkedThrough.tagObjectType, 'commit')
  assert.match(coverage.checkedThrough.releaseBodySha256, SHA256_HEX)
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
    assert.match(release.bodySha256, SHA256_HEX, tag + ' carries a body hash')
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
