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
2. The only accepted sources are official Anthropic pages under
   https://github.com/anthropics/claude-code/ : the tagged release notes and
   CHANGELOG.md.
3. Each run reads the source, not a memory of it. Nothing is inferred from
   unofficial mirrors, blog posts, or the product's private behavior.

## Known source-policy deviation

On 2026-10-14 the cycle read https://code.claude.com/docs/en/changelog.md, which
is outside the source policy in "Cadence and inputs". The deviation is recorded
in [addendum-20261030-source-policy-deviation.md](./addendum-20261030-source-policy-deviation.md).
This note does not authorize that page as an accepted source. The policy decision
is deferred to Stage 1B.

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

- The local status is one of: equivalent, adapted, partial, missing,
  not-applicable, unknown.
- A status must be supported by named local evidence that exists in the
  repository: source files, tests, or documentation. The ledger test fails when
  an evidence path is missing, so a claim of parity can never be an assertion.
- unknown is a first-class status. It is used when the official text does not
  describe the behavior and the local code does not settle it.

## Source outage

If a primary source is unreachable, moved, truncated, or otherwise
unverifiable, the affected item is recorded as unknown for that cycle. It is
never recorded as "no change". The previous verified baseline stays in place,
and the outage and the attempted URLs are recorded in the next update. A week
with no reachable source is not evidence that upstream stayed the same.

## Disposition to implementation

A deferred or applicable gap is handed off as its own task with its own
acceptance criteria. The triage itself never edits the product. When that task
lands, the ledger item moves to applicable or equivalent with the new evidence.

## Record keeping

- docs/upstream/ledger.json is the machine-readable record.
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
- Public sources only: never send repository content, note text, prompts, or
  any private data to a public search.

## Running the check

Run the structural ledger test with:

    node --test test/upstream-ledger.test.js

or as part of the full suite with:

    npm test
