# Upstream adoption workflow

This is the reproducible, read-only process for bringing an official Claude
Code "You should know" change into this repository. Triage records facts and
dispositions; every real gap becomes its own separately scoped task before any
code, prompt, or config is edited.

## Non-goals

- No automatic edit of the reviewer prompt, the plugin config, or any source.
- No creation or modification of any Scheduled Task. The weekly read-only
  "You Should Know Upstream" notification is an external, human-facing trigger
  that this repository consumes; it is never re-created or changed here.
- No cloning or reverse engineering of undisclosed Claude internals.
- No private, session, or conversation content sent to a public search.

## Cadence and inputs

1. The weekly read-only "You Should Know Upstream" notification is the intake
   trigger. A human may also run the check on demand.
2. Two source classes are accepted. Release sources are the official GitHub
   tagged releases and CHANGELOG.md under
   https://github.com/anthropics/claude-code/; they are canonical for version,
   date, and release content. Behavior sources are official Anthropic Claude
   Code documentation pages under https://code.claude.com/docs/; they are
   behavior evidence only.
3. Each run reads the source, not a memory of it. Nothing is inferred from
   unofficial mirrors, blog posts, or the product's private behavior.

## Source policy

### Release sources (canonical for version, date, and release content)

- https://github.com/anthropics/claude-code/releases/tag/<tag> - an immutable,
  non-draft, non-prerelease GitHub release. Record the tag, the tag ref SHA,
  publishedAt, releaseBodySha256, and provenance.
- https://github.com/anthropics/claude-code/blob/<full-40-hex-commit>/CHANGELOG.md
  - the changelog pinned to a full commit. Record commitSha, commitDate,
  fetchedAt, and sha256.

Release sources are canonical. A version, a publication date, and a release
note or changelog line come from these sources and from no other source.

### Behavior sources (official documentation; behavior evidence only)

The only accepted behavior source is an official Anthropic Claude Code
documentation page under https://code.claude.com/docs/. The exact allowlist is:

- scheme: https only.
- host: exactly code.claude.com (case-insensitive after URL parsing). No
  subdomain, no other host, no userinfo, and no non-default port.
- path: starts with /docs/. Query strings and fragments are not part of the
  source identity and are rejected for source records. Parent path segments,
  including encoded %2e%2e, are rejected. The raw path is checked before URL
  normalization; a normalized path alone is not accepted.
- No other website and no other Anthropic host is accepted.

A docs source record has these fields:

- required: id, kind "official-docs-page", url, immutable false, sha256 (64
  lowercase hex of the exact retrieved page bytes), fetchedAt (ISO UTC
  timestamp of this capture).
- optional: lastModified (ISO timestamp). It is metadata only. If present, the
  record must carry lastModifiedIsPublicationProof: false. It never becomes
  publishedAt or upstreamDate.
- A docs source record must not carry publishedAt.

A docs page is behavior evidence only: documented feature behavior,
availability, cost, and UI contract. It is never a versioned release signal. It
never establishes a version or a publication date.

Re-fetch and change detection:

- Re-fetch every cycle. Compare sha256 with the previous verified capture.
- A changed hash is a new capture with a new fetchedAt. It is not a silent
  update.
- An unchanged hash is not a new upstream signal. A re-fetch of the same bytes
  changes nothing.

Immutable versus mutable handling: a GitHub release is immutable; its identity
is the tag, the tag ref SHA, and the release body hash. A CHANGELOG.md URL is
mutable, so it is pinned to a full commit SHA and hashed. A docs page is
mutable, so it is never a versioned signal; every capture is dated and hashed
instead.

Excerpts: capture short official sentences only. Never copy a full page, a full
release body, or code. SHA-256 (sha256) covers the exact bytes; the excerpt is
evidence, not a substitute for the hash.

## Known source-policy deviation

On 2026-10-14 the cycle read https://code.claude.com/docs/en/changelog.md, which
was outside the source policy at that time. Stage 1B accepts official
code.claude.com documentation as a behavior source, but that capture remains a
recorded deviation and is not retroactively authorized. The historical addendum
is preserved unchanged:
[addendum-20261030-source-policy-deviation.md](./addendum-20261030-source-policy-deviation.md).
A historical-only record is never reused as an active source, and its fetchedAt
is not a publication date.

## The triage pipeline

Every upstream signal moves through the same states:

candidate -> verified -> applicable | deferred | rejected

- candidate: a release line or changelog entry that mentions "You should know"
  and is not yet in the ledger.
- verified: the exact wording is confirmed against a primary official source,
  and the version, URL, capture date, and source identity are recorded. If the
  source cannot be reached or read in full, the state is unknown, not verified.
- applicable: the signal is relevant to this plugin. Record the verified local
  status and the named local evidence. If local parity is already present, the
  item is done and carries no acceptance. If it is a real gap, it proceeds to a
  separately scoped implementation.
- deferred: the signal is real but is intentionally not implemented now. A
  deferred item must name a testable acceptance and its own future task.
- rejected: the signal does not apply, or applying it would violate an
  invariant. A rejected item must state why.

## Dedupe

Before adding an item, compare it with the ledger:

- The same upstream version and the same wording is a duplicate: do nothing.
- A later upstream rewrite of a line the ledger already has updates that item;
  record the new quote and re-verify the local status. It is not a new item.
- Distinct behavior in the same release is a distinct item with a distinct id.

## Assessment and evidence

- Release evidence establishes version, publication date, and release content.
  A version or date claim must cite a release source or a commit-pinned
  CHANGELOG.md.
- Behavior evidence establishes documented feature behavior, availability, cost,
  or UI contract. A behavior claim cites a docs page record with its sha256 and
  fetchedAt. A docs record carries no publishedAt and may not set a version or a
  date.
- The local status is one of: equivalent, adapted, partial, missing,
  not-applicable, unknown.
- A status must be supported by named local evidence that exists in the
  repository: source files, tests, or documentation. The ledger test fails when
  an evidence path is missing, so a claim of parity can never be an assertion.
- unknown is a first-class status. It is used when the official text does not
  describe the behavior and the local code does not settle it.

## Source outage and provenance

If any primary source is unreachable, moved, truncated, rate-limited, or
otherwise unverifiable, the affected item and cycle are unknown. It is never
recorded as "no change". The previous verified baseline is retained explicitly,
and the outage plus the attempted URLs are recorded in the next update. A week
with no reachable source is not evidence that upstream stayed the same.

A source is verified only when the exact bytes were retrieved and hashed in the
same cycle. An offline, cached, or remembered copy is not a fresh verification.
It may be cited only as the previous verified baseline. Provenance therefore
requires the URL, the content hash, and fetchedAt.

## Disposition to implementation

A deferred or applicable gap is handed off as its own task with its own
acceptance criteria. The triage itself never edits the product. When that task
lands, the ledger item moves to applicable or equivalent with the new evidence.

## Record keeping

- docs/upstream/ledger.json is the machine-readable record. It carries the
  machine-readable sourcePolicy block and, for each docs capture, the url,
  sha256, fetchedAt, and the optional lastModified metadata with
  lastModifiedIsPublicationProof false.
- docs/upstream/README.md is the human-readable baseline.
- docs/upstream/evidence/ holds the raw captured source and its hashes.
- Update all three in the same change; the ledger test is the structural gate.

## Guardrails

- Human-only invariant: no adopted item may add steering, injection, wake-up,
  transcript writes, or any path that reaches the primary agent.
  test/invariant.test.js is the source-level guard and must stay green.
- Privacy: the plugin has no telemetry. An upstream signal that assumes
  telemetry is rejected, not adopted.
- Licensing: the upstream repository has no detectable license. Quote only
  short official sentences for factual tracking; never copy upstream code.
- Security: never send a private project, session, note, prompt, transcript,
  credential, or repository content to a public page or a public search. Never
  copy private Claude internals or closed-source code.
- Public sources only: quote short official excerpts and keep private data out
  of every public page and search.

## Running the check

Run the structural ledger test with:

    node --test test/upstream-ledger.test.js

or as part of the full suite with:

    npm test
