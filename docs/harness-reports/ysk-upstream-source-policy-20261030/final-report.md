# Final report - ysk-upstream-source-policy-20261030

**Status:** READY_FOR_CHATGPT_REVIEW (draft)

**Base:** 0419b70797a8d37db245d55817a7be273b5edcdb

**Branch:** task/upstream-source-policy-20261030

**Product head:** PENDING

**PR:** PENDING

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
releases, npm install or publish, live model calls, commits, pushes, merges, and
functional behavior findings. Stage 1C owns interactive-mode behavior findings.

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
- No commit, push, or merge.
- local.head, local.tag, local.tagIdentity, local.previousBaseline, coverage,
  existing source entries, existing items, and existing openUnknowns are
  unchanged.
- No new docs page source and no new upstream item.

## 8. Independent review

PENDING. This report does not claim any review approval.

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
- The product head and the PR remain PENDING until the parent agent commits and
  opens the PR.

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

PENDING. The parent agent commits on task/upstream-source-policy-20261030 and
opens the PR. This report must not claim an approved review or a created PR
before those events happen.
