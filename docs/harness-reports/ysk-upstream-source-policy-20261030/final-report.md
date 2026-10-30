# Final report - ysk-upstream-source-policy-20261030

**Status:** READY_FOR_CHATGPT_REVIEW

**Base:** 0419b70797a8d37db245d55817a7be273b5edcdb

**Branch:** task/upstream-source-policy-20261030

**Product head:** b62215b2434f9015dd6499b74ef14e45b16a2b07

**PR:** https://github.com/PipaGs/dsh-you-should-know/pull/25

**Tool:** DeepSeek Harness, delegated implementation subagent, Stage 1B.

---

## 1. Request and scope

Stage 1B changes the upstream adoption policy so that official Anthropic Claude
Code documentation under HTTPS https://code.claude.com/docs/ is accepted only as
behavior evidence. Docs pages cover documented feature behavior, availability,
cost, and UI contract. A docs page is never a versioned release signal and never
establishes a version or a publication date. GitHub tagged Releases and
CHANGELOG.md remain canonical for version, date, and release content.

The task updates the workflow policy, the human-readable baseline, the
machine-readable ledger, the structural ledger test, and this report. It also
captures raw verification evidence. The historical 2026-10-14 docs-page deviation
stays explicit and is not retroactively authorized.

Out of scope: product code, prompts, configs, package.json, the version, tags,
releases, npm install or publish, live model calls, and functional behavior
findings. Stage 1C owns interactive-mode behavior findings. The implementation
subagent made no commit, push, or merge. The parent created the product commit
and the report-only handoff commit, opened PR #25, and left merge to the
reviewer.

## 2. Preflight facts

| Fact | Value |
| --- | --- |
| Repository | PipaGs/dsh-you-should-know |
| Worktree | .worktrees/task-1b |
| Branch | task/upstream-source-policy-20261030 |
| Base commit | 0419b70797a8d37db245d55817a7be273b5edcdb |
| origin/main at preflight | 0419b70797a8d37db245d55817a7be273b5edcdb |
| Open PRs at preflight | none |
| Worktree state at evidence capture | uncommitted; HEAD is the base commit 0419b70; no commit exists on the branch |
| Product version | 0.4.6 |
| Baseline targeted test | node --test test/upstream-ledger.test.js: 15 pass, 0 fail, exit 0 |
| Baseline full test | npm test: 618 pass, 0 fail, exit 0 |
| Baseline check | npm run check: exit 0 |
| Addendum sha256 | 1355c524b48e01a6d870fd010ccdcc4456c5070991f8ded2b2ff9035776eedc7 |
| Raw evidence sha256 | c5fac2b1502d8a221ec4a7e229012c645f84be0d9310791173af84031e809d7a |

The baseline evidence files under
docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/ were read and
preserved. The main worktree and its untracked files were not touched.

## 3. Accepted policy

Accepted on 2026-10-30 (ledger generatedAt 2026-10-30T07:14:50Z).

### 3.1 Release sources (canonical for version and date)

1. https://github.com/anthropics/claude-code/releases/tag/<tag> - an immutable,
   non-draft, non-prerelease GitHub release. Required fields: tag, tagRefSha,
   publishedAt, releaseBodySha256, provenance.
2. https://github.com/anthropics/claude-code/blob/<full-40-hex-commit>/CHANGELOG.md
   - a changelog pinned to a full commit. Required fields: commitSha, commitDate,
   fetchedAt, sha256.

Release sources establish version, publication date, and release content.

### 3.2 Behavior sources (official documentation; behavior only)

Exact allowlist:

- scheme: https only.
- host: exactly code.claude.com, case-insensitive after URL parsing. No
  subdomain, no other host, no userinfo, no non-default port.
- path: starts with /docs/. Query strings and fragments are rejected for source
  records. Parent path segments, including encoded %2e%2e, are rejected.
- no other website or Anthropic host is accepted.

Required source fields: id, kind "official-docs-page", url, immutable false,
sha256 (64 lowercase hex of the exact retrieved page bytes), fetchedAt (ISO UTC
timestamp of this capture). Optional lastModified is metadata only; when present
the record must carry lastModifiedIsPublicationProof false. It never becomes
publishedAt or upstreamDate. A docs record must not carry publishedAt.

Re-fetch every cycle. Compare sha256 with the previous verified capture. A
changed hash is a new capture with a new fetchedAt. An unchanged hash is not a
new upstream signal. Docs pages are behavior evidence only; they never supply a
version or a date.

### 3.3 Outage, provenance, security, and the historical deviation

The outage rule records unknown, never "no change", retains the previous
verified baseline explicitly, and records the attempted URLs. A source is
verified only when the exact bytes were retrieved and hashed in the same cycle.
An offline, cached, or remembered copy is not a fresh verification.

Security: never send a private project, session, note, prompt, transcript,
credential, or repository content to a public page or search. Never copy private
Claude internals or closed-source code. Use short official excerpts only.

The 2026-10-14 docs-page capture remains a recorded deviation with
historicalOnly true. It is not retroactively authorized, it is not an active item
source, and the historical addendum is preserved unchanged. Stage 1B accepts the
behavior class; it does not retroactively authorize that capture.

## 4. Changes

1. docs/upstream/workflow.md - replaced the single-class "Cadence and inputs"
   item with the two-class summary; added the full "Source policy" section with
   release and behavior subsections; updated the deviation note, assessment and
   evidence, "Source outage and provenance", record keeping, and guardrails.
2. docs/upstream/README.md - added "Source policy accepted in Stage 1B" with the
   class table, exact allowlist, docs fields, re-fetch/change detection,
   outage/provenance, and security rules; updated "Source-policy deviation" and
   "Keeping this current".
3. docs/upstream/ledger.json - set taskId and previousTaskId, refreshed
   generatedAt, added the sourcePolicy block, updated outagePolicy with
   provenanceRule, offlineCopyRule, and silentFallback; kept
   openPolicyDecisions as an empty array and added one resolvedPolicyDecisions
   entry.
4. test/upstream-ledger.test.js - added the docs allowlist constants,
   docsUrlProblem, assertBehaviorSource, assertReleaseSource, and
   assertChangelogSource; added positive and negative docs/release/changelog
   matrices, the cross-role date test, the exact policy and prose match, the
   historical deviation test, the immutable evidence hash test, and the
   outage/provenance test. The historical git-show test stays.
5. docs/harness-reports/ysk-upstream-source-policy-20261030/final-report.md -
   this report.
6. Raw evidence files in docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/
   as listed in the evidence index.

No new docs page source and no new upstream item were added. No product file
changed.

## 5. Tests

| Check | Baseline | Final | Exit |
| --- | --- | --- | --- |
| node --test test/upstream-ledger.test.js | 15 pass, 0 fail | 23 pass, 0 fail | 0 |
| npm test | 618 pass, 0 fail | 626 pass, 0 fail | 0 |
| npm run check | exit 0 | exit 0 | 0 |
| git diff --check | exit 0, no output | exit 0, no output | 0 |

The final suite count is 626 because Stage 1B added nine tests and replaced one
test. Raw output is in the evidence directory:
test-run-targeted.txt, test-run-full.txt, check.txt, and diff-check.txt.

## 6. Security, content, and PII

- security-scan.txt scans the changed and new authored files for absolute local
  paths, email addresses, tokens, private keys, insecure plain-HTTP URLs, and
  non-English prose. Only the required READY_FOR_CHATGPT_REVIEW status word and
  the test pattern literals are allowlisted. Result: PASS.
- content-scan.txt confirms that no full upstream page, full release body, or
  code was copied. The record keeps short official sentences only and reports
  the artifact byte sizes and the longest quoted line.
- No private project, session, note, prompt, transcript, credential, or
  repository content was sent to a public page or search. No live fetch or model
  call was made in Stage 1B.

## 7. Invariants

- Product version stays 0.4.6.
- No lib/, scripts/, cordis.patch.yml, or package.json change.
- The addendum and the raw 2026-10-14 evidence are byte-identical. Their hashes
  are unchanged and asserted by test.
- No tag, release, npm install, npm publish, or live model call.
- The implementation subagent made no commit, push, or merge. The parent
  created product commit b62215b2434f9015dd6499b74ef14e45b16a2b07. This
  report-only handoff commit is next. DSH did not merge.
- local.head, local.tag, local.tagIdentity, local.previousBaseline, coverage,
  existing source entries, existing items, and existing openUnknowns are
  unchanged.
- No new docs page source and no new upstream item.

## 8. Independent review

APPROVE from the independent review, on both the first review and the
re-review. The review found no BLOCKER, HIGH, or MEDIUM finding. One LOW defect
was found: a bare trailing empty query or fragment passed docsUrlProblem. The
implementation fixed it with a raw-string guard and two negative cases, and the
review re-approved. Two non-blocking NITs remain: the baseline check log lacks an
exit=0 line (baseline-meta.txt records check_exit=0), and the security scan lists
the five authored files without evidence/*.txt. Neither NIT gates the handoff.

## 9. Limitations

- Stage 1B made no live fetch of code.claude.com or GitHub. The policy and its
  checks are structural and offline; no new source capture was created.
- The docs validators are exercised with positive and negative fixtures, not with
  a live docs page.
- Stage 1C owns interactive-mode behavior findings. Stage 1B adds none.
- The historical docs source is not validated by assertBehaviorSource because it
  predates the accepted class and keeps its distinct official-docs-changelog
  kind. The test asserts that it stays the single recorded deviation.
- Timestamps in this repository use second precision with a Z suffix. The
  validators accept that exact ISO UTC form, which is the stricter reading of the
  requirement.
- The final PR head is the report-only handoff commit that contains this block.
  GitHub records its SHA in PR #25.
- Two residual review NITs are non-blocking: the baseline check log lacks an
  exit=0 line (baseline-meta.txt records check_exit=0), and the security scan
  lists the five authored files without evidence/*.txt.

## 10. Evidence index

- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/baseline-meta.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/check-baseline.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/test-run-baseline-full.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/test-run-baseline-targeted.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/test-run-targeted.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/test-run-full.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/check.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/diff-check.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/diff-summary.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/security-scan.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/content-scan.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/invariants.txt
- docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/artifacts-hashes.txt

## 11. Handoff

- Base: 0419b70797a8d37db245d55817a7be273b5edcdb
- Branch: task/upstream-source-policy-20261030
- Product commit: b62215b2434f9015dd6499b74ef14e45b16a2b07
- PR: https://github.com/PipaGs/dsh-you-should-know/pull/25
- Product version: 0.4.6
- Verification at the product commit: node --test test/upstream-ledger.test.js
  23 pass / 0 fail; npm test 626 pass / 0 fail; npm run check exit 0;
  git diff --check exit 0; security and content scans PASS.
- Independent review: APPROVE.
- Status: READY_FOR_CHATGPT_REVIEW.
- DSH did not merge. No tag, release, npm publish, or live model call.
- The final PR head is the report-only handoff commit that contains this block.

## Follow-up review round - 2026-10-30

PR #25 review comment P2: WHATWG URL normalization removed raw parent segments
before docsUrlProblem inspected the path. The two reported URLs,
https://code.claude.com/docs/en/../example and
https://code.claude.com/docs/en/%2e%2e/example, were accepted with problem null.

Root cause: docsUrlProblem called new URL(raw).pathname first. The parser
resolves ../ and %2e%2e, so the path became /docs/example and the later dot
segment check no longer saw a parent segment. The exact pre-fix command and
output are in defect-repro.txt.

Failing regression evidence: test-run-failing-regression.txt shows 24 tests, 23
pass, 1 fail before the fix. The new test is "the docs allowlist rejects raw
parent segments that normalize inside /docs".

Fix: validate the raw path before URL normalization. The validator strips the
scheme and host from the trimmed raw string, rejects ASCII tab, CR, and LF before
parsing, normalizes backslashes, checks the /docs/ prefix, rejects any %2e, runs a
bounded decode loop of eight passes and rejects remaining encoded dot escapes
after the bound, and then rejects ., .., and segments beginning with ..; or ..,.
Only the first decode is authoritative: a later decode failure breaks the loop
and keeps the previous probe, so a valid encoded percent such as /docs/en/100%25,
/docs/en/100%25ab, or /docs/en/100%25zz stays accepted. The existing normalized
pathname checks stay as defense in depth.

When a later decode fails, a per-segment decode-error fallback inspects the
current probe. It decodes each segment up to eight times, uses a decoded-segment
classifier, and salvages a segment that cannot decode as a whole. The classifier
rejects a segment that is ., .., starts with ..; or ..,, or starts with a ..
prefix followed by a character that is not a filename character [A-Za-z0-9._-].
That covers the same-segment invalid-tail form, such as ..%zz and ..%. After
salvage, a changed segment that still carries %2e or a residual percent escape is
rejected; this covers the ten-times-encoded parent with a same-segment tail and
deeper encodings. The fallback also rejects, after at least one successful
decode, a residual percent escape on the original part. This covers the
decode-error path without rejecting a valid encoded percent. The exact regression
cases are plain ../, %2e%2e, %2E%2E, %2e., .%2e, ..%2f, %2e%2e%2f, double-encoded
%252e%252e, ..%5c, ..;, ..%3b, literal tab/CR/LF inside a dot segment, the
six-times-encoded %25252525252e%25252525252e, the seven-times-encoded
%2525252525252e%2525252525252e, the nine-times-encoded
%25252525252525252e%25252525252525252e, the ten-times-encoded
%2525252525252525252e%2525252525252525252e, the three-times-encoded parent with
an invalid-escape tail: %25252e%25252e/%25zz, %25252e%25252e/%25ab, and
%25252e%25252e/%25, the same-segment form: %25252e%25252e%25zz,
%25252e%25252e%25ab, %25252e%25252e%25, and %2525252e%2525252e%25zz, and the
ten-times-encoded parent with a same-segment tail:
%2525252525252525252e%2525252525252525252e%25zz,
%2525252525252525252e%2525252525252525252e%25ab, and
%2525252525252525252e%2525252525252525252e%25. The regression test covers the
eight-pass bound and both post-loop branches: the residual %2e branch for 9x and
the residual-percent branch for 10x, plus the decode-error fallback. The exact host and path allowlist is unchanged.
workflow.md and README.md now state that the raw path is checked before URL
normalization.

Tests: 24 pass / 0 fail targeted; 627 pass / 0 fail full; npm run check exit 0;
git diff --check exit 0; security and content scans PASS.

Follow-up evidence files:
- defect-repro.txt
- test-run-failing-regression.txt
- test-run-targeted-followup.txt
- test-run-full-followup.txt
- check-followup.txt
- diff-check-followup.txt
- diff-summary-followup.txt
- security-scan-followup.txt
- content-scan-followup.txt
- invariants-followup.txt
- artifacts-hashes-followup.txt

Follow-up commit: the follow-up commit that contains this block; GitHub records
its SHA in PR #25.

This follow-up block supersedes the 98040f9 final-head note in the original
handoff.

The original product-commit evidence, including artifacts-hashes.txt, is
preserved as historical evidence; artifacts-hashes-followup.txt is the current
manifest.

The pre-fix failing-regression log predates the final control-character and
deep-encoding additions; it remains the historical failing evidence for the
original P2 repro.

Independent review: APPROVE. A fresh independent DSH reviewer verified the
raw-path fix, control-character rejection, eight-pass bound, 6x/7x/9x/10x
branches, same-segment invalid-tail classifier and salvage, 10x+tail/deeper
residual checks, 100%25/100%25ab/100%25zz positives, safe ..foo/.../..-/.._
names, host/default-port/relative/query/fragment controls, scope, and evidence;
no BLOCKER/HIGH/MEDIUM/LOW defect.

Status: READY_FOR_CHATGPT_REVIEW. DSH did not merge. No tag, release, npm
publish, or live model call.

## Privacy remediation - 2026-10-30

Finding: the ChatGPT review found an absolute workstation file URL in
test-run-failing-regression.txt in the public PR diff. The earlier security scan
covered only five authored files and skipped the evidence directory.

Audit: the audit scanned every added or modified PR file by category, without
printing match content. Only test-run-failing-regression.txt had an absolute workstation
path. The email-pattern matches are grounded test fixtures at
test/upstream-ledger.test.js:401, security-scan.txt:19, and
security-scan-followup.txt:19. No secrets were found.

Sanitization: the absolute file URL in the stack frame is replaced with the
portable relative location test/upstream-ledger.test.js, with the trailing
line:column and all test title, output, failure, and exit=1 text preserved. The
historical failing-regression log stays as evidence. The old
artifacts-hashes-followup.txt still records the pre-sanitization hash and is
historical; artifacts-hashes-privacy.txt is the current manifest.

Coverage: security-scan-privacy.txt directly scans 38 of the 40 added or
modified PR files; the two it does not scan directly are the scan log itself and
artifacts-hashes-privacy.txt, which is generated after the scan. privacy-audit.txt
also records a direct scan of 38 of 40 and the same category counts. The final
post-write audit privacy-audit-final.txt scans all 40 existing PR files, reports
40/40, and passes. The final-audit file itself is post-manifest and is covered by
test/task-evidence-paths.test.js in the 628-test suite, so no task artifact is
left unscanned for absolute paths. The allowlist contains only the grounded
fixtures above. The deterministic test scans this task report directory for
absolute file URLs and home-path markers, and fails with only the artifact path
and a generic category. Targeted tests are 24/24 and the full suite is 628/628.

History: the prior unmerged tip 98a05f4 contained the leak. The parent amended
only that tip (parent 98040f9); this block is in the amended tip, and the parent
force-with-lease pushes it to the same branch; main is not rewritten. The
independent review verified that no reachable commit in the amended ancestry
contains the leak; the parent will verify the remote head after force-push. Main,
the historical 2026-10-14 evidence, and the old product-commit evidence remain
unchanged. Residual risk: GitHub may
retain the old commit in the PR timeline or caches, or in the existing review
comment. Force-push cannot guarantee removal from GitHub object caches or
comments.

New head: the rewritten follow-up commit that contains this block; GitHub records
its SHA in PR #25.

Independent review: APPROVE. An independent DSH reviewer verified the 41-file
audit, sanitized regression evidence, the new task-artifact path test, privacy
scan/audit coverage, scope, and the amended ancestry; no
BLOCKER/HIGH/MEDIUM/LOW defect.

Status: READY_FOR_CHATGPT_REVIEW. DSH did not merge. No tag, release, npm
publish, or live model call.

## PR-range diff-check correction - 2026-10-30

Finding: `git diff --check 0419b70..16c0891` exits 2 with one hunk at
`docs/harness-reports/ysk-upstream-source-policy-20261030/evidence/check-baseline.txt:4`
("new blank line at EOF"). The earlier gate ran `git diff --check` with no range.
That command compares the index and the working tree. It passed because the tree
was clean. It did not inspect the committed PR patch, so the committed trailing
blank line reached the PR.

Reproduction:
- command: `git diff --check 0419b70797a8d37db245d55817a7be273b5edcdb..16c08918333d6884d98d334d0141ee6a5820094f`
- exit code: 2
- output: one hunk, `check-baseline.txt:4: new blank line at EOF.`
- before: 649 bytes, last two bytes `0a 0a`
- after: 648 bytes, last byte `0a`
- first 648 bytes: identical, sha256 0724714785ae32754f864a9e74086a317970de58ffd8e8d8f8e0be54ca40987e
- change: one newline removed at offset 648 (value 0x0a)
Raw output: pr-diff-check-before.txt and pr-diff-check-after.txt.

Fix: the whitespace fix removes only the final newline. The substantive command
and exit metadata in check-baseline.txt are unchanged. `test/pr-diff-check.test.js`
is added; it compares the PR base commit to the working tree. It failed before
the fix with the hunk above and passes after it. The exact BASE..new_HEAD check is
re-run after the rev4 commit and recorded; this block does not claim a committed
range pass before that commit.

Checks on the rev4 pre-commit working tree:
- `node --test test/upstream-ledger.test.js`: 24 pass, 0 fail
- `npm test`: 629 pass, 0 fail
- `npm run check`: exit 0
- `git diff --check`: exit 0
- `git diff --check 0419b70` (base to working tree): exit 0
- `git diff --check 0419b70..16c0891` (old HEAD): exit 2, one hunk; this is the
  pre-fix state and is not a pass
Evidence: test-run-targeted-rev4.txt, test-run-full-rev4.txt, check-rev4.txt,
diff-check-rev4.txt, check-baseline-fix.txt.

Scans: security-scan-rev4.txt and privacy-audit-rev4.txt scan every changed file
and all evidence. privacy-audit-final-rev4.txt re-scans the final set.
content-scan-rev4.txt checks quoted length. The scans report zero absolute file
URLs, zero home-directory markers, and zero secrets. The only email-pattern
matches are the three grounded fixtures at test/upstream-ledger.test.js:401,
security-scan.txt:19, and security-scan-followup.txt:19. artifacts-hashes-rev4.txt
records the rev4 manifest with zero mismatches.

History: this rev4 commit is a new commit on top of approved 16c0891. It does not
rewrite history. The old unmerged tip 98a05f4 remains not an ancestor. The final
head is the rev4 commit. Residual risk remains: GitHub may keep the old commit in
the PR timeline or caches, or in an existing review comment.

Independent review: APPROVE. An independent DSH reviewer verified the
base-to-working-tree range check, the one-newline fix, the guard test, 24/629, the
56-file privacy scan, the manifest, and the report; one non-blocking count typo
was corrected before commit. No BLOCKER/HIGH/MEDIUM/LOW defect.

Status: READY_FOR_CHATGPT_REVIEW. DSH did not merge. No tag, release, npm
publish, or live model call.
