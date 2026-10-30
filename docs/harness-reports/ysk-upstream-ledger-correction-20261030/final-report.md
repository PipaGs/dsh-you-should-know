# Final report - ysk-upstream-ledger-correction-20261030

**Status:** READY_FOR_CHATGPT_REVIEW

**Base:** 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2 (origin/main, tag v0.4.6)

**Branch:** task/upstream-ledger-correction-20261030

**Product head:** recorded in the handoff block after the product commit.

**PR:** recorded in the handoff block after creation.

**Tool:** DeepSeek Harness, supervised goal, strict mode.

---

## 1. Request and scope

Task 1A corrects the upstream ledger for the Claude Code "You should know"
tracking. The task has four parts:

1. Record the historical 2026-10-14 source-policy deviation in a dated English
   addendum. Do not retroactively authorize the docs page and do not change the
   source policy; Stage 1B owns that decision.
2. Correct the 2.1.288 and 2.1.290 item dates from the 2026-10-14 fetch day to
   the immutable GitHub release dates, keep the earlier fetch timestamps, and
   keep the changelog quote trace.
3. Replace the stale 0.4.3 local baseline with the shipped 0.4.6 baseline and
   record the previous baseline history without conflating the v0.4.3 tag target
   with the previous ledger head.
4. Record coverage through v2.1.312 (2026-10-27) with a method and a limit that
   do not claim that upstream behavior did not change.

Out of scope: product code, prompts, config, package.json, version changes,
tags, releases, npm publication, paid model calls, and the 0.4.6 to 0.5.0 PR.
The product version stays 0.4.6.

## 2. Preflight

| Fact | Value |
| --- | --- |
| Repository | PipaGs/dsh-you-should-know |
| origin/main at start | 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2 (tag v0.4.6) |
| Local main at start | 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2 |
| Untracked file in the main worktree | .rollout-restart-verify.log, left untouched |
| Isolation | worktree .worktrees/task-1a, branch task/upstream-ledger-correction-20261030 |
| Package version | 0.4.6 |
| Baseline targeted test | node --test test/upstream-ledger.test.js: 8 pass / 0 fail |
| Baseline full test | npm test: 611 pass / 0 fail |

The preflight read AGENTS.md, docs/upstream/workflow.md, docs/upstream/ledger.json,
docs/upstream/README.md, docs/upstream/evidence/claude-code-upstream-20261014.json,
and test/upstream-ledger.test.js. The main worktree untracked file was not moved,
deleted, or committed.

## 3. Audit findings

### 3.1 Source-policy inconsistency

workflow.md accepts only GitHub tagged release notes and CHANGELOG.md under
https://github.com/anthropics/claude-code/. The 2026-10-14 ledger and test also
accepted https://code.claude.com/docs/. The 2.1.288 item was read from
https://code.claude.com/docs/en/changelog.md on 2026-10-14 because the GitHub
hosts were unreachable that day. The 2.1.290 item used the pinned CHANGELOG.md
source, and the docs page contained the same line. The test allowance let the
docs-page source pass even though the policy did not accept it.

This was a process deviation, not a policy change. Task 1A records it in
docs/upstream/addendum-20261030-source-policy-deviation.md. The docs page stays
in the ledger as a historicalOnly source with a policyDeviation marker. It is no
longer an active item source. The test now accepts a docs-page source only when
it is this recorded historical deviation.

### 3.2 Wrong upstream dates

The old ledger set upstreamDate to 2026-10-14 for 2.1.288 and 2.1.290. That was
the fetch day. The immutable GitHub releases were published on 2026-10-02 and
2026-10-05.

Task 1A adds release sources for v2.1.288 and v2.1.290 with publishedAt, tag ref
SHA, release-body SHA-256, and provenance. It sets upstreamDate to 2026-10-02 and
2026-10-05. The earlier fetchedAt values stay in the historical docs-page
source.

### 3.3 Stale local baseline

The old ledger said 0.4.3 / 746d1caa2101b96c97f85b0a0e387b57e77fc436. The shipped
baseline is 0.4.6 / 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2.

The v0.4.3 annotated tag object 7d392bd65e07fdbd42530e56d32698a05edeba52 points
at b6a202d00e80e6069c07b03e65034b4280756f1d, not at 746d1ca. The head 746d1ca is
an untagged commit five commits after v0.4.3 and is contained in v0.4.4. The new
previousBaseline block records that distinction explicitly.

The v0.4.6 annotated tag object 2dd722eb691493281aefa081ebfc722afb7d117f points
at 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2. The new test re-checks the real tag
object, its type, and its peeled commit.

### 3.4 Missing coverage after 2.1.290

The old ledger stopped at the 2.1.290 item. Task 1A checks the published GitHub
release bodies for v2.1.291 through v2.1.312, records the pinned boundary, and
records that no release body in that range contains a direct "You should know"
line. It also records that this is not a claim about behavior.

## 4. Upstream verification

The GitHub REST API and tag refs were reachable on 2026-10-30. The sanitized
extract is
[github-releases-2.1.287-2.1.312.json](evidence/github-releases-2.1.287-2.1.312.json).

| Release | URL | publishedAt | tag ref SHA | release body SHA-256 | direct YSK line |
| --- | --- | --- | --- | --- | --- |
| v2.1.287 | https://github.com/anthropics/claude-code/releases/tag/v2.1.287 | 2026-10-01T18:00:22Z | 816ec211a648f17a411f63a45cfd44ddf8db00d9 | 54729a449b821d8d4d58b1eaeae082e6427cc6a3a72871260c2fa366bd0fc8a5 | yes |
| v2.1.288 | https://github.com/anthropics/claude-code/releases/tag/v2.1.288 | 2026-10-02T20:19:57Z | 1c229fcd1e1e4e452e29a8f116b45fe4cfe2c528 | a9bb9cf4a1a26b4766ed5dd2a1cbff01b9cbf34dbc523f29f83888c876b6cee1 | yes |
| v2.1.290 | https://github.com/anthropics/claude-code/releases/tag/v2.1.290 | 2026-10-05T23:33:17Z | e8ae451830fb8d1d8edf853c7830ff6c650d3ee3 | 91c665a1614eeb707db9f206d4ba071530c15ab442a665c959b0e82e9a58ee9c | yes |
| v2.1.312 | https://github.com/anthropics/claude-code/releases/tag/v2.1.312 | 2026-10-27T20:24:20Z | 0e1f4789406477380b267a01f3ddd50b0211e5b3 | 9d4b2e43c12591836e0b1cd65c302e58fbf5ad6bf589643414d7158be0c75eb7 | no |

The coverage check read 24 releases published from 2026-10-01 through
2026-10-27. It checked 20 release bodies after v2.1.290, from v2.1.291 through
v2.1.312. The tag numbers v2.1.297 and v2.1.298 have no tag or release. The
check found no direct "You should know" line after v2.1.290.

The check does not claim that upstream behavior did not change. It records only
the absence of direct release notes. Behavior can change without a named release
note.

## 5. Changes

Changed tracked files:

- docs/upstream/ledger.json: release sources, corrected dates, changelog trace,
  local 0.4.6 baseline, previous baseline history, coverage block, open policy
  decision.
- docs/upstream/README.md: local baseline, source table, parity dates, coverage
  section, source-policy deviation section.
- docs/upstream/workflow.md: one "Known source-policy deviation" note. The
  source policy text is unchanged.
- test/upstream-ledger.test.js: release-date provenance, failure cases, historical
  state regression, tag identity, source-policy deviation, coverage evidence.

New files:

- docs/upstream/addendum-20261030-source-policy-deviation.md
- docs/harness-reports/ysk-upstream-ledger-correction-20261030/final-report.md
- docs/harness-reports/ysk-upstream-ledger-correction-20261030/evidence/

No file under lib/, scripts/, package.json, cordis.patch.yml, or any prompt or
config path changed. The product version stays 0.4.6.

## 6. Tests

Full logs are under
[docs/harness-reports/ysk-upstream-ledger-correction-20261030/evidence](evidence/).

| Check | Result | Log |
| --- | --- | --- |
| node --test test/upstream-ledger.test.js, baseline | 8 pass / 0 fail | test-run-baseline-targeted.txt |
| npm test, baseline | 611 pass / 0 fail | test-run-baseline-full.txt |
| node --test test/upstream-ledger.test.js, final | 15 pass / 0 fail | test-run-targeted.txt |
| npm test, final | 618 pass / 0 fail | test-run-full.txt |
| npm run check | exit 0 | check.txt |
| git diff --check | exit 0, no output | diff-check.txt |

The new tests assert:

- every item date equals the publishedAt date of its immutable release source;
- the source is not a draft or prerelease and carries a full tag ref SHA, a
  release-body SHA-256, and provenance;
- the date check rejects the historical fetch-day value, a missing publishedAt,
  a mutable release, a draft, a short tag ref, a tag mismatch, a missing body
  hash, and empty provenance;
- the new check rejects the actual historical ledger state at the base commit,
  where 2.1.288 had upstreamDate 2026-10-14 and a docs-page source;
- the v0.4.6 tag object, its type, and its peeled commit match the recorded
  baseline, while the v0.4.3 tag target is not presented as the previous ledger
  head;
- the historical docs page is not an active item source and carries the recorded
  policy deviation;
- the coverage boundary and its evidence agree, and no checked release body after
  2.1.290 has a direct "You should know" line.

The test suite runs offline. It reads repository files and local git objects
only.

## 7. Security, content, and PII

- security-scan.txt: PASS. No email, absolute local path, token, private key,
  plain http URL, or non-English text in the changed or new files. The
  allowlisted hits are pattern literals used by the ledger test and the required
  review-status word.
- content-scan.txt: PASS. The coverage evidence keeps release metadata and three
  short official lines, not the full upstream bodies. The longest quoted line is
  231 characters.
- The raw file docs/upstream/evidence/claude-code-upstream-20261014.json is
  unchanged. Its sha256 is
  c5fac2b1502d8a221ec4a7e229012c645f84be0d9310791173af84031e809d7a.
- The local tag-identity evidence redacts the tagger identity and keeps the
  object, type, target, and date.
- The ledger test keeps its existing forbidden-token list for ledger.json.

## 8. Invariants

- package.json version: 0.4.6.
- PLUGIN_VERSION: 0.4.6.
- Product paths changed: none.
- Raw upstream evidence changed: no.
- v0.4.6 tag object: 2dd722eb691493281aefa081ebfc722afb7d117f.
- v0.4.6 tag target: 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2.
- The main worktree untracked .rollout-restart-verify.log was not touched.

## 9. Independent review

An independent DSH subagent reviewed the worktree. First verdict:
CHANGES_REQUIRED, limited to three evidence-manifest consistency findings. The
review found no defect in the ledger dates, the release provenance, the source
policy, the local baseline history, the coverage wording, or the tests.

- MEDIUM: artifacts-hashes.txt recorded hashes from an earlier draft of
  README.md, the addendum, and this report.
- LOW: content-scan.txt recorded stale byte sizes for the same files.
- LOW: security-scan.txt cited an older line number for the allowlisted literal.

The cause was that the manifest and the content scan were generated before the
last prose edits. The correction was to regenerate both from the final bytes and
to rerun the scan. The re-review approved the fixes: 20 of 20 manifest entries
matched, the content-scan byte sizes matched, and the security scan cited the
correct line. The re-review found no product, ledger, policy, or test defect.

## 10. Diff summary

The pre-commit diff and file list are in diff-summary.txt and artifacts-hashes.txt.
The tracked diff changes only docs/upstream/README.md, docs/upstream/ledger.json,
docs/upstream/workflow.md, and test/upstream-ledger.test.js. The new files are the
addendum, this report, and the evidence directory.

## 11. Limitations

- The coverage check reads release bodies only. It cannot prove that upstream
  behavior did not change.
- The v2.1.288 lane remains an instruction-level adaptation. The live model
  output is not proven; that status is unchanged.
- The docs page stays a historical deviation. A future policy decision is
  deferred to Stage 1B.
- The release-body SHA-256 is a hash of the exact markdown body returned by the
  GitHub REST API. It is not the hash of the rendered HTML page.

## 12. Evidence index

- check.txt
- content-scan.txt
- diff-check.txt
- diff-summary.txt
- github-releases-2.1.287-2.1.312.json
- invariants.txt
- local-tag-identity.txt
- release-body-hashes.txt
- security-scan.txt
- test-run-baseline-full.txt
- test-run-baseline-targeted.txt
- test-run-full.txt
- test-run-targeted.txt
- upstream-tag-refs.txt
- artifacts-hashes.txt

## 13. Handoff

The product commit, PR number, exact base and head, changed-file list, and the
independent review verdict are appended here after the commit and PR steps.
