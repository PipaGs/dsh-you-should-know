# Final report - ysk-version-bump-0.5.0-20261030

**STATUS: READY_FOR_CHATGPT_REVIEW**

## Provenance

- Base commit: 992de15cd4c32b3f8c625a7cdb97ec2daa8dbe09 (Merge pull request #28).
- Product commit A: fe7bdef008983443c647a7fa8234930a8da52ccc, "chore: raise the version to 0.5.0 after
  the validated stage merges"; nine files, 72 insertions and 36 deletions.
- Report and evidence commit: the final PR head, recorded in the PR body.
- Branch: task/release-0.5.0-version-20261030. Date: 2026-10-30.
- Toolchain: Node v26.12.1, npm 11.20.0. Local time zone MSK (UTC+3); every evidence header carries UTC and local time.
- Evidence: evidence/01 through evidence/13; SHA256 values in evidence/09-provenance.txt.

## Scope

Deliberate MINOR bump from 0.4.6 to 0.5.0, nine files:

- package.json: version 0.5.0. lib/index.js: PLUGIN_VERSION 0.5.0. No other library change.
- README.md: six current-version literals (status line, install address, three self-check fields, update
  currentVersion); docs/reference.md: four current-version literals in the self-check sample. No version
  history and no prospective-tag prose was added.
- test/invariant.test.js, test/plugin.test.js, test/update-route.test.js, test/recent-check-diagnostics.test.js:
  current-version assertions and the fixture moved to 0.5.0; no behavioral change. test/release-consistency.test.js:
  gate redesign (below).

No feature was added. Historical artifacts were not touched: docs/harness-reports/**, docs/upstream/**
(ledger local.version and tag stay at 0.4.6), docs/superpowers/**, old tag targets, and source provenance.
No existing docs/harness-reports path is modified; the change only adds a new report directory.

## Publication status

No v0.5.0 tag and no GitHub release exist. evidence/12 shows an empty local v0.5* tag list, an empty remote
refs/tags/v0.5* list, and "release not found" for the GitHub release. npm publication was not attempted,
and its registry state is out of scope and NOT verified. No publication date is claimed.

## Gate redesign

The gate accepts exactly one patch step (same minor, patch + 1) or exactly one minor step (minor + 1,
patch 0), and rejects an arbitrary jump or a major change. It parses both sides with parseStableTag and
compareVersions from lib/update.js. It pins package.json, PLUGIN_VERSION, the README status line and
install address, and the self-check samples in README.md and docs/reference.md; it scans package.json,
README.md, docs/reference.md, and lib/index.js for the previous version. Version dots are escaped in the
three RegExp constructions. PREVIOUS is hand-maintained: the gate must not use the network or read tags,
so a future editor must advance PREVIOUS honestly. The gate never asserts that the tag or the GitHub
release exists.

## RED and GREEN

- 01 baseline at 0.4.6, before any edit: 109 tests, 109 pass, 0 fail, exit 0.
- 02 RED with the old patch-only rule, only the constants changed to 0.5.0 / 0.4.6: 4 tests, 0 pass,
  4 fail, exit 1; "the minor version does not change on this release" plus the mirror mismatches.
- 03 dirty targeted 109/109 exit 0; 03b same on commit A 109/109 exit 0 (final committed-head run).
- 04 full npm test on the dirty tree: 656/656, exit 0. 04b full npm test on commit A: 656/656, exit 0.
- 05 npm run check: exit 0. 06 git diff --check 992de15: exit 0. 06b git diff --check 992de15..A: exit 0.
- 10 negative probes (0.5.2, 0.6.0, 1.0.0): each 4 tests, 1 pass, 3 fail, exit 1; file restored byte-identical.
- 11 final dirty-tree re-run before commit A: 109/109 and 656/656, both exit 0, check 0, diff --check 0.
- 12 publication check: local and remote v0.5* tag lists empty, GitHub release not found.
- 13 full npm test on the pre-amend B tree after normalization: 656/656, exit 0, including the PR whitespace gate.

## Current surfaces audit

| Surface | Value | Evidence |
|---|---|---|
| package.json version | 0.5.0 | 03b, 07 |
| lib/index.js PLUGIN_VERSION | 0.5.0 | 03b, 07 |
| README status line | 0.5.0 | 03b, 07 |
| README install address | github:PipaGs/dsh-you-should-know#v0.5.0 | 03b |
| README self-check sample | 0.5.0 in all four fields | 03b |
| docs/reference.md self-check sample | 0.5.0 in all four fields | 03b |
| Remaining 0.4.6 literals | gate PREVIOUS, upstream-ledger baseline, docs/upstream, historical reports | 07 |

## Acceptance matrix

| Criterion | Result | Evidence |
|---|---|---|
| Current version is 0.5.0 on every current surface | PASS | 03b, 07 |
| Historical v0.4.6 baseline and historical reports untouched | PASS | 08 section 2; no existing docs/harness-reports path is modified; the change only adds a new report directory |
| Gate accepts one patch step or one minor step | PASS | 03b; 02 shows the old rule red |
| Gate rejects a jump and a major change | PASS | 10 |
| Targeted 7-file suite on commit A | PASS | 03b: 109/109, exit 0 |
| Full npm test on commit A | PASS | 04b: 656/656, exit 0 |
| npm run check | PASS | 05: exit 0 |
| git diff --check | PASS | 06 and 06b: exit 0. 06b is base..A; the final PR-head check is recorded in the PR body |
| Secret and privacy scan | PASS | 08 sections 4 to 7: 0 token hits, 0 path hits, 0 Cyrillic or CJK |
| No tag or GitHub release was created; npm publication was not attempted and is not verified (out of scope) | PASS | 12 |
| No functional library edit beyond PLUGIN_VERSION | PASS | 08 section 1: lib/index.js shows 1 insertion and 1 deletion |

## Independent review

A fresh DSH reviewer inspected the change on 2026-10-30 and returned verdict APPROVE with no blockers and
four nits, all now fixed: F1, the acceptance-matrix wording claimed docs/upstream and docs/harness-reports
were absent from git status, which was false because the new task directory is untracked; F2, the tag row
over-claimed and covered npm, so it now names only the tag and the GitHub release and cites evidence/12;
F3, the gate header now states that PREVIOUS is hand-maintained; F4, the three RegExp constructions escape
the version dots through CURRENT_PATTERN. The reviewer reported reproducing 109/109 targeted, 656/656
full, npm run check exit 0, git diff --check exit 0, all provenance hashes, the historical ledger and tag
identity, and the absence of a v0.5.0 tag. The reviewer could not verify npm registry state, and that state
remains NOT verified here.

## Known limitations

- The tag is absent, so the pinned install address fails until the publication step creates v0.5.0.
- docs/upstream keeps 0.4.6 as the recorded upstream baseline, so two versions appear in the tree by design.
- .rollout-restart-verify.log is a pre-existing untracked file dated 2026-10-24; this task did not create or touch it.
- evidence/02 quotes a diff, so eight lines ended with a space; those were removed after capture so the PR
  whitespace gate passes. No non-whitespace byte changed (whitespace-insensitive diff is empty); evidence/11
  lost one EOF blank line likewise.
- evidence/08 excludes itself (it quotes the pattern inventory) and evidence/09 (which quotes the redaction
  expression); every other file, including this report, is covered by the 08 scan.
