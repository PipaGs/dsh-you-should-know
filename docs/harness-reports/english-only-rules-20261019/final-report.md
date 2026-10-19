# Final report - english-only-rules-20261019

**Status:** READY_FOR_CHATGPT_REVIEW. DSH will not merge, tag, release, publish, or install.
**PR:** #20 - https://github.com/PipaGs/dsh-you-should-know/pull/20
**Base:** origin/main 5929bb3547ba7c8f9f91e711a30880b9d201ea94 (merge PR #19).
**Branch:** docs/english-only-rules-20261019.
**Worktree:** .worktrees/english-only-rules-20261019.
**Rule commit:** 16cc7857e8a586665abb0fcb175ae2a2ac8d2d58.
**Final head:** the commit that adds this report and evidence; the exact SHA is recorded in the PR body because a file cannot contain its own hash.
**Task:** establish English-only as the explicit mandatory rule for repository-facing artifacts, without rewriting historical evidence.
**Tool:** DeepSeek Harness, supervised goal goal-session-2d67076e-1475-4d51-8827-3c68fa11d4ef, revision 2, mode strict.

## 1. Request

After the PR #19 post-merge verification, establish English-only as an explicit
mandatory rule in the repository's actual authoritative rules. The rule must
cover new pull request titles and descriptions, commit messages, review
comments, task-owned final reports, documentation, and other repository-facing
prose. It must distinguish human chat language from repository artifacts and
must not silently rewrite historical artifacts. Record that PR #19 contained
Russian prose as a process deviation, and propose a dated English addendum or
correction instead of rewriting the historical evidence.

## 2. Audit of the existing rules and index

The audit is recorded in evidence/audit-existing-rules.txt.

- origin/main has no project-level AGENTS.md, CLAUDE.md, CONTRIBUTING.md,
  CODE_OF_CONDUCT.md, GOVERNANCE.md, STYLE.md, RULES.md, or POLICY.md. It also
  has no .github, .cursor, or .agents rule directory.
- The only root documentation files are README.md and docs/reference.md. Both
  are product documentation, not a repository rule index.
- README.md and docs/reference.md already say that shipped and public product
  text is English-only. That statement covers the plugin's public surface, not
  commit messages, pull request prose, review comments, or task reports.
- docs/harness-reports/ is historical task evidence; docs/upstream/ is the
  upstream adoption record. Neither is an authoritative rule source.
- The user-level ~/.dsh/AGENTS.md is not a project rule. It currently asks for
  commit messages and pull request descriptions in Russian. The owner's
  2026-10-19 instruction and the new project rule supersede that user-level
  line for repository artifacts in this repository; human chat remains in the
  human's language, including Russian.
- No existing English-only policy branch or pull request was found. The only
  branch with "english" in its name is the historical backup/pre-english-history
  branch, which contains no rule file.

Because no project rule file existed, this task creates the authoritative
AGENTS.md rather than duplicating or overwriting an existing rule.

## 3. Implementation

- AGENTS.md is the new authoritative repository rule and rules index. It covers
  pull request titles and descriptions, commit messages, review comments,
  task-owned final reports, documentation, release notes, changelogs, code
  comments, and any other prose committed to the repository. It separates
  repository artifacts from human chat, requires dated English addenda for
  historical corrections, and includes a review checklist.
- README.md gains a short "Repository rules" section that links to AGENTS.md.
  It is an index pointer, not a duplicate of the rule.
- test/repository-language.test.js is a six-test regression gate. It pins the
  rule text, the README pointer, the English-only status of the new artifacts,
  the chat-versus-artifact distinction, the historical-preservation language,
  and the PR #19 addendum. It also asserts that the historical PR #19 report
  still contains its original non-English text, so a silent translation fails
  the gate.
- docs/harness-reports/ysk-version-bump-0.4.5-20261019/english-addendum-20261019.md
  is a dated English addendum for PR #19. It records the process deviation and
  summarizes the merged change without editing the original report.

No product code, package version, runtime behavior, dependency, or release
metadata changed.

## 4. PR #19 deviation and addendum

PR #19 was merged as 5929bb3547ba7c8f9f91e711a30880b9d201ea94; the reviewed head
was 5e1725566a45be62e05cfc55f27932faca968099. Its title, body, commit messages,
and task-owned final report contain Russian prose. The English-only rule for
repository-facing artifacts was established on 2026-10-19, after that merge.
This is recorded as a historical process deviation, not as compliance with the
new rule.

The original report is preserved byte-for-byte. Its SHA256 at origin/main and in
this task tree is 646e08a66b48432934e2f500c1e3f3c9ad8c58a148a8b279e84db297d74fbb7e;
git diff --exit-code origin/main -- the report exits 0. The correction is a new
dated English addendum, not an edit. Evidence:
evidence/historical-pr19-deviation.txt.

## 5. Acceptance matrix

| AC | Requirement | Status | Evidence |
|---|---|---|---|
| AC1 | An authoritative project rule exists and covers PR titles and descriptions, commit messages, review comments, task reports, documentation, and other repository prose | PASS | AGENTS.md; test 1 |
| AC2 | The rule is indexed without duplicating or overwriting existing docs | PASS | AGENTS.md rules index; README pointer; audit-existing-rules.txt |
| AC3 | Human chat stays separate; historical artifacts are preserved; corrections are dated English addenda | PASS | AGENTS.md; english-addendum-20261019.md; test 4 |
| AC4 | PR #19 is recorded as a Russian-prose process deviation and its original report is not rewritten | PASS | historical-pr19-deviation.txt; hash match; empty diff |
| AC5 | A regression test proves the rule and artifacts, with a real RED/GREEN cycle | PASS | test-run-red.txt (0/6); test-run-green.txt (6/6) |
| AC6 | Full repository checks pass on the final tree | PASS | npm test 569/569; npm run check exit 0; git diff --check clean |
| AC7 | New repository-facing artifacts are English-only | PASS | language-scan.txt |
| Gate | DIFF_SANITY | PASS | final diff-and-security-sanity.txt |
| Gate | SECURITY_SANITY | PASS | final diff-and-security-sanity.txt |
| Gate | VISUAL_GATE | NOT REQUIRED | no UI or client change |

## 6. Verification

- RED: 6 tests, 0 pass, 6 fail, exit 1. The rule, README pointer, and addendum
  did not exist yet. See evidence/test-run-red.txt.
- GREEN: 6 tests, 6 pass, 0 fail, exit 0. See evidence/test-run-green.txt.
- Full suite: 569 tests, 569 pass, 0 fail, exit 0. See evidence/test-run-final.txt.
- Static check: npm run check exit 0. See evidence/check.txt.
- Whitespace: git diff --check exit 0. See evidence/whitespace-and-status.txt.
- English-only scan of the new artifacts: PASS. See evidence/language-scan.txt.
- Original PR #19 report: SHA256 unchanged and diff empty. See
  evidence/historical-pr19-deviation.txt.
- Runtime: Node v26.9.0, npm 11.19.1.

The final full test, language scan, diff/security log, and whitespace/status log
are generated after this report is written. Their hashes are recorded in
evidence/evidence-sha256.txt; they are not duplicated here to avoid a
self-referential hash cycle.

## 7. Evidence

| Log | SHA256 | What it records |
|---|---|---|
| evidence/test-run-red.txt | 551fbd2a23e25baf5ae8735d32aab7a797c87432f2ea6e762f9eae05b8a4298e | RED: 6 tests, 0 pass, 6 fail |
| evidence/test-run-green.txt | b0262072779f32f45ee992d6067c4bf3b73b8c9475698576000beb9b60da8628 | GREEN: 6 tests, 6 pass |
| evidence/check.txt | 0d679710aa575b49ded0007a033e2656c10f0b5e62a0c71f01a6cfe2cb0e9bff | npm run check exit 0 |
| evidence/audit-existing-rules.txt | 69cac9921e9c1a8be43a2e72f09308fa0d22c84cb05ac1289e9985a01ad8ad47 | existing rule audit |
| evidence/historical-pr19-deviation.txt | 7441d007983cf236f802617188280c9f7bc56257c506a579e105a72c95bea741 | PR #19 language flags and preservation |
| evidence/test-run-final.txt | hash in evidence/evidence-sha256.txt | final full npm test |
| evidence/language-scan.txt | hash in evidence/evidence-sha256.txt | final English-only scan |
| evidence/diff-and-security-sanity.txt | hash in evidence/evidence-sha256.txt | final diff and security sanity |
| evidence/whitespace-and-status.txt | hash in evidence/evidence-sha256.txt | final whitespace and status |
| evidence/provenance.json | hash in evidence/evidence-sha256.txt | task provenance |
| evidence/evidence-sha256.txt | - | manifest of all evidence files |

## 8. Diff and security sanity

The change set is documentation and test only: AGENTS.md, README.md, the dated
English addendum, the regression test, this report, and evidence. It introduces
no dependency, route, configuration field, outbound request, secret, token, or
URL. The final numstat and the secret/URL scan are recorded in
evidence/diff-and-security-sanity.txt.

The historical PR #19 report and all other historical reports are unchanged.
No product file under lib/ or scripts/ changed. package.json, cordis.patch.yml,
and the runtime version stay at 0.4.5.

## 9. Rulings

- The rule was placed in AGENTS.md because no project-level rule file existed.
  README.md and docs/reference.md remain product documentation; the README only
  indexes the new rule. This avoids both duplication and a second rule source.
- The user-level instruction to write commits and pull requests in Russian is
  superseded for this repository's artifacts by the owner's 2026-10-19
  instruction and this project-specific rule. Human chat is explicitly outside
  the rule and remains Russian in this session.
- The PR #19 correction is an addendum, not an edit, because the original report
  is historical evidence. The original bytes and hash are preserved.
- The test deliberately asserts that the historical PR #19 report still carries
  its original non-English prose. This is a guard against a silent translation,
  not a requirement that new artifacts contain non-English text.

## 10. Not done

- No merge, tag, GitHub Release, npm publish, or install.
- No product code, package version, or runtime behavior change.
- No historical report was rewritten or translated in place.
- No existing rule, README product statement, or reference contract was
  overwritten; the README addition is a new index section.

## 11. External research

NOT REQUIRED. The change introduces no library, API, or dependency version
question; Context7 and web search were not needed.
