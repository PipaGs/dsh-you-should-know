# Final report - ysk-consequence-scope-20261023

**Status:** READY_FOR_CHATGPT_REVIEW. DSH did not merge, tag, release, publish, or install.
**PR:** #21 - https://github.com/PipaGs/dsh-you-should-know/pull/21
**Base:** main a7b652ed41cd2683bf7e491dccc07c3448d05990 (verified with `git rev-parse main`; `git merge-base main HEAD` equals it).
**Branch:** task/ysk-quality-improvement.
**Worktree:** .worktrees/ysk-quality-improvement.
**Implementation commits:** c87a33e58fe8178e7461d9a5860110dfb0088f10 (runtime-failure and NOT_VERIFIED fix) and b5e3a146dbcc9f643946429e5679ce69d9cc6fad (baseline contract and documentation alignment). The feature branch starts at 4d8cdf507950c2d1c8b0ebce8e08800c4225070e and was reviewed at fa9d6ce08409c014b466dc5bdedd938bc22ba6ce.
**Final head:** the commit that adds this report and evidence. A file cannot contain its own hash, so the exact SHA is recorded in the PR #21 body; `evidence/final-head.txt` points to it.
**Task:** rework PR #21 after CHANGES_REQUIRED: separate runtime failures from intentional silence, stop presenting structural admission as semantic quality, and add the task-owned final report and evidence.
**Tool:** DeepSeek Harness, supervised goal goal-session-74020845-5c21-42b3-a243-2feef386f005, revision 2, mode strict. The goal belongs to the supervising session; `get_goal` in this report-writing subagent session returns null, so the goal id, revision, and mode above are controller-supplied header facts.

## 1. Request

The reviewer posted CHANGES_REQUIRED on 2026-10-23T18:22:13Z against head
fa9d6ce08409c014b466dc5bdedd938bc22ba6ce and base main
a7b652ed41cd2683bf7e491dccc07c3448d05990. The review is preserved in
`evidence/pr-review.txt`. It contains three technical findings:

- **A. Runtime failures were scored as correct silence.** The fixtures
  `runtime-timeout` and `runtime-malformed-reply` carry `runtimeError` and
  `reply: null` with `expect: silent`. The scorer never read `runtimeError`
  and awarded both `SILENT_OK`, so a failed reviewer call was reported as an
  intentional, correct decision to stay quiet.
- **B. Author-authored replies were presented as semantic quality.** The
  `entail` value is an author label. An admitted speaking reply received
  `SPEAK_OK` from `expect: speak` after parsing, the mode gate, and verbatim
  grounding, but no semantic or attribution check. An
  `ENTAIL_UNSUPPORTED` consequence and a voice case whose note blamed the main
  agent although the message said "You required..." both scored `SPEAK_OK`.
- **C. The task-owned final report and evidence were missing.** The PR body
  claimed `npm test` 601 PASS, `npm run check`, and `git diff --check`, but
  added no run-level logs, acceptance matrix, or evidence tied to the final
  head.

The same review comment withdraws the earlier authorization and scope
objection: the owner had directly confirmed separate permission for DSH to
implement, and the reviewer said that objection must not be used to block the
PR. That objection is not a technical finding and is not part of this rework.

## 2. Reproduction and root cause (A and B)

The audit is recorded in
`.superpowers/sdd/2026-10-23-ysk-consequence-scope/progress.md` section
"Review round 2" (lines 110-115). It reproduced A and B at fa9d6ce on
2026-10-23T18:27:15Z.

This report re-ran the pre-fix reproduction on 2026-10-23T18:41:00Z and the
current reproduction on 2026-10-23T18:42:58Z. The pre-fix module and fixture
set were exported from fa9d6ce with `git archive` into a temporary directory
and scored with the same inputs. Raw output: `evidence/repro-prefix.txt` and
`evidence/repro-current.txt`.

| Case | Pre-fix at fa9d6ce | Current at b5e3a14 |
|---|---|---|
| `runtime-timeout` | `SILENT_OK` | `RUNTIME_ERROR` |
| `runtime-malformed-reply` | `SILENT_OK` | `RUNTIME_ERROR` |
| `runtime-speak-timeout` (21st fixture) | did not exist | `RUNTIME_ERROR` |
| Unsupported entailment counterexample | `SPEAK_OK`, `entail: ENTAIL_UNSUPPORTED`, no semantics marker | `SPEAK_OK`, `entailVerified: false`, `semantics: NOT_VERIFIED` |
| Misattributed voice counterexample | `SPEAK_OK`, no attribution marker | `SPEAK_OK`, `attributionVerified: false`, `semantics: NOT_VERIFIED` |

Root cause A is the null-reply branch in the pre-fix `scoreCase`
(`scripts/note-voice-baseline.mjs` at fa9d6ce, lines 116-117):

```js
if (caseDef.reply === null) {
  return { ...base, ...extra, status: SILENT_STATUS[caseDef.expect], gated: false }
}
```

The branch runs before any `runtimeError` read, and the pre-fix function did
not read `runtimeError` at all. `SILENT_STATUS` maps `expect: silent` to
`SILENT_OK`, so a provider timeout and a malformed reply were indistinguishable
from a deliberate silence. The fixture annotation was dead data.

Root cause B is the final return in the same function (lines 139-144):

```js
return {
  ...base,
  ...extra,
  status: caseDef.expect === 'speak' ? 'SPEAK_OK' : 'SPEAK_UNWARRANTED',
  gated: false,
}
```

That return runs after parsing, `admitsVerdict`, and `groundVerdict` only. The
`entail` value was copied from the author label at lines 107-111, and
`becauseGrounded` was a literal substring check at lines 122-125. Voice
attribution was never inspected. A reply that cleared the structural checks
therefore received `SPEAK_OK` even when the author had labeled its entailment
unsupported or its voice attribution wrong. The status name presented
structural admission as a quality result.

The current run still returns `SPEAK_OK` for the two B counterexamples. That
status now means "a note cleared the parser, the mode gate, and verbatim
grounding"; it is not a semantic success claim. The same result carries
`semantics: NOT_VERIFIED`, `entailVerified: false`, and
`attributionVerified: false`, and the CLI prints that semantic quality is NOT
VERIFIED. Section 11 states the limit.

## 3. Fix

- **New `RUNTIME_ERROR` status.** `CASE_STATUS` gained the status at
  `scripts/note-voice-baseline.mjs:54`. `scoreCase` now:
  - rejects a present `runtimeError` that is not a non-blank string as
    `INVALID` (lines 128-134);
  - scores `reply: null` plus a valid `runtimeError` as `RUNTIME_ERROR`
    (lines 135-136);
  - keeps intentional silence without a `runtimeError` as
    `SILENT_OK`/`SILENT_MISSED` (line 137);
  - scores a `runtimeError` next to a real reply as contradictory and
    `INVALID` (line 140);
  - keeps a malformed reply `INVALID` (line 141).
- **`summarize` totals.** The summary returns `runtimeErrors` and
  `semantics: { notVerified }` in addition to the per-class table
  (lines 177-208). The CLI prints `runtime errors: N` and the NOT_VERIFIED
  sentence (lines 265-273).
- **NOT_VERIFIED segregation.** Every admitted note now carries
  `semantics: 'NOT_VERIFIED'` (lines 161-166); b5e3a14 extended the marker from
  `SPEAK_OK` only to `SPEAK_UNWARRANTED` as well, so a wrongly admitted note
  is not presented as verified either. A case with an author `entail` label
  carries `entailVerified: false` (line 122). A `voice_attribution` case
  carries `attributionVerified: false` (line 117). No `accuracy` or
  `precision` field exists (section 11 and `evidence/18-no-quality-metric.txt`).
- **21st fixture.** `scripts/fixtures/note-voice-baseline/cases.json:200-207`
  adds `runtime-speak-timeout`: class `model_runtime_error`, `expect: speak`,
  `runtimeError: "timeout before any reply"`, `reply: null`. It proves a
  speaking case that fails at runtime is a `RUNTIME_ERROR`, not a
  `SILENT_MISSED` and not an admitted note.
- **Tests.** `test/note-voice-baseline.test.js` now has 27 tests. The runtime
  rules are pinned at lines 233-279, intentional silence at 281-288, the
  semantic counterexamples at 290-316, and the no-network/no-environment
  property at 349-354.
- **Documentation.** README lines 217-233 and `docs/reference.md` lines 48-64
  describe the status table, `RUNTIME_ERROR`, and the NOT_VERIFIED boundary.
  The spec addendum at
  `docs/superpowers/specs/2026-10-23-ysk-consequence-scope-design.md:271-288`
  records the status change without rewriting the original section 11.

## 4. Acceptance matrix

| AC | Requirement | Status | Evidence |
|---|---|---|---|
| AC-1 | The original two `runtimeError` fixtures cannot be `SILENT_OK`; errors are separable per class; tests prove it | PASS | `evidence/repro-prefix.txt`, `evidence/repro-current.txt`, `evidence/04-note-voice-baseline-test.txt` (27/27), fixtures lines 182-208, test lines 233-244 |
| AC-2 | Static admission is not semantic correctness; unsupported entailment and misattribution are not claimed successful; counterexamples exist; no model accuracy claim | PASS | `evidence/repro-current.txt`, tests 290-316, `evidence/05-note-voice-baseline-cli.txt`, `evidence/18-no-quality-metric.txt`, README 233 and reference 64 |
| AC-3 | Complete task-owned report with real final-head evidence | PASS | This report, `evidence/final-head.txt`, `evidence/evidence-sha256.txt`, PR #21 body for the exact final SHA |
| AC-4 | Targeted and full tests, check, diff-check, offline CLI outcomes, human-only isolation, no telemetry/secret/leak/excerpt-boundary regression | PASS | `evidence/01-npm-test.txt` (611/611), `evidence/02-npm-check.txt` (exit 0), `evidence/03-git-diff-check.txt` (exit 0), `evidence/04-note-voice-baseline-test.txt` (27/27), `evidence/05-note-voice-baseline-cli.txt` (21 cases, exit 0), `evidence/08-invariant-test.txt` (11/11), `evidence/09-evidence-test.txt` (9/9), `evidence/10-plugin-status-test.txt` (1/1), `evidence/11-diff-sanity.txt`, `evidence/13-secret-grep.txt`, `evidence/15-evidence-bounds.txt`, `evidence/17-telemetry-deps.txt` |
| AC-5 | PR #21 updated at the reviewed branch head; no second PR, no merge, no paid calls, no upstream refresh | PASS at handoff | `evidence/12-inventory.txt`, `evidence/pr-before-report.txt`, `evidence/pr-review.txt`, `evidence/11-diff-sanity.txt`, PR #21 body for the final SHA |

AC-2 is the reviewer's second option: express semantic quality as NOT VERIFIED
and keep it out of any readiness claim. The two counterexamples still clear the
structural scorer. Their rows are not evidence that the entailment or the
attribution is right; the markers and the CLI statement say the opposite.

AC-5 describes the handoff. PR #21 is the only PR for the branch and the only
open PR in the repository. It is OPEN, not merged. The branch moved
fast-forward from fa9d6ce to b5e3a14, then the report commit follows. No tag,
release, publish, or install command was run. No live evaluation runner was
executed, so no paid model call was made. `docs/upstream` has no diff against
main, so the upstream ledger was not refreshed. The exact report-commit SHA is
recorded in the PR body because this file cannot contain its own hash.

## 5. Verification at the tested tree

All product verification ran on a clean tree at
b5e3a146dbcc9f643946429e5679ce69d9cc6fad. Every transcript records
`dirty_entries_before: 0`. The report commit is later and adds only
`docs/harness-reports/ysk-consequence-scope-20261023/`; it does not change
code, tests, or fixtures. Runtime: Node v26.9.0, npm 11.19.1.

| Command | UTC start | HEAD | Exit | Result | Evidence |
|---|---|---|---|---|---|
| `npm test` | 2026-10-23T18:41:08Z | b5e3a14 | 0 | 611 tests, 611 pass, 0 fail | `evidence/01-npm-test.txt` |
| `npm run check` | 2026-10-23T18:41:12Z | b5e3a14 | 0 | exit 0; no diagnostics | `evidence/02-npm-check.txt` |
| `git diff --check` | 2026-10-23T18:41:15Z | b5e3a14 | 0 | no output | `evidence/03-git-diff-check.txt` |
| `node --test test/note-voice-baseline.test.js` | 2026-10-23T18:41:15Z | b5e3a14 | 0 | 27 pass, 0 fail | `evidence/04-note-voice-baseline-test.txt` |
| `node scripts/note-voice-baseline.mjs` | 2026-10-23T18:41:16Z | b5e3a14 | 0 | 21 cases, gated 1, invalid 0, runtime errors 3 | `evidence/05-note-voice-baseline-cli.txt` |
| `git diff --stat a7b652e..HEAD` and `git log --oneline a7b652e..HEAD` | 2026-10-23T18:41:16Z | b5e3a14 | 0 | 14 files, 2038 insertions, 27 deletions; 13 commits | `evidence/06-diff-stat-and-log.txt` |
| `git status --porcelain=v1` | 2026-10-23T18:41:16Z | b5e3a14 | 0 | empty | `evidence/07-git-status.txt` |
| `node --test test/invariant.test.js` | 2026-10-23T18:41:16Z | b5e3a14 | 0 | 11 pass, 0 fail | `evidence/08-invariant-test.txt` |
| `node --test test/evidence.test.js` | 2026-10-23T18:41:17Z | b5e3a14 | 0 | 9 pass, 0 fail | `evidence/09-evidence-test.txt` |
| `node --test --test-name-pattern="status route reports activity" test/plugin.test.js` | 2026-10-23T18:41:17Z | b5e3a14 | 0 | 1 pass, 0 fail | `evidence/10-plugin-status-test.txt` |

The report-level language scan and the staged whitespace check are recorded in
`evidence/19-report-language.txt` and `evidence/20-report-whitespace.txt`.
The language scan ran on the report and evidence in a staging directory while
the repository tree was clean at b5e3a14. The whitespace check ran on the
git-staged set. The later commit is the report commit; its exact SHA is in the
PR body.

## 6. Failure status census

The CLI output at `evidence/05-note-voice-baseline-cli.txt` reproduces this
per-class table. The `model_runtime_error` row is 3 `RUNTIME_ERROR`, 0
`SILENT_OK`, and 0 `SILENT_MISSED`.

| Class | SPEAK_OK | SPEAK_UNWARRANTED | SILENT_OK | SILENT_MISSED | RUNTIME_ERROR | INVALID | NOT_RUN |
|---|---:|---:|---:|---:|---:|---:|---:|
| material_defect | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| requirement_violation | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| consequence_of_correct_work | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| hidden_tradeoff | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| unsupported_success | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| duplicate_known | 0 | 1 | 1 | 0 | 0 | 0 | 0 |
| legitimate_silence | 0 | 0 | 2 | 0 | 0 | 0 | 0 |
| ambiguous_evidence | 0 | 0 | 2 | 0 | 0 | 0 | 0 |
| model_runtime_error | 0 | 0 | 0 | 0 | 3 | 0 | 0 |
| voice_attribution | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| unclassified | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

The single `consequence_of_correct_work` `SILENT_MISSED` is the pinned
Paranoid gate on `consequence-cache-growth`, with `gated: 1`. The two
`voice_attribution` `SPEAK_OK` rows are structural admissions with
`attributionVerified: false`; they are not voice-quality passes. The CLI
prints `invalid: 0` and exits 0; no threshold is approved, so a runtime error
alone does not change the exit code.

## 7. Security, privacy, invariants

- **No network or model call in the scorer.** `evidence/13-secret-grep.txt`
  finds no `fetch`, `node:http`, `XMLHttpRequest`, or `process.env` in
  `scripts/note-voice-baseline.mjs`. The same property is pinned by
  `test/note-voice-baseline.test.js:349-354`.
- **No telemetry.** `evidence/17-telemetry-deps.txt` finds no telemetry or
  analytics reference in shipped code, scripts, tests, or docs. The diff also
  adds no dependency block and no route, server, or HTTP file.
- **No credentials in fixtures.** `evidence/13-secret-grep.txt` finds no
  private-key header, API-key pattern, bearer token, `sk-live` value, or home
  directory in the fixture file. The fixture test additionally rejects the
  user-home path prefix, `api_key`, `bearer`, and private-key headers at
  `test/note-voice-baseline.test.js:103-125`.
- **Human-only isolation.** `evidence/08-invariant-test.txt` is 11 pass, 0
  fail. `test/invariant.test.js:40-47` forbids delivery paths to the primary
  agent, lines 91-108 forbid cookie, token, auth-header, browser-storage, and
  environment access, and lines 152-160 pin the Add-to-chat no-send rule. The
  full suite also passes.
- **Bounded excerpt and 1200-character capsule.** `lib/evidence.js` has no
  diff against main (`evidence/11-diff-sanity.txt`, `evidence_js_exit=0`).
  `EVIDENCE_LIMITS.maxCapsuleChars` is still 1200 and the slice still uses it
  (`lib/evidence.js:45,323`; `evidence/15-evidence-bounds.txt`).
  `test/evidence.test.js:104-114` pins the entry and character bounds and
  passes 9/9.
- **Status diagnostics carry no note text.** The targeted status test passes
  1/1 (`evidence/10-plugin-status-test.txt`). It injects a private marker into
  the note and conversation and asserts the status response does not contain it
  (`test/plugin.test.js:594-619`).
- **`kind` and `because` are not rendered in the UI.** The browser half has no
  note-field reference to either key (`evidence/14-ui-kind.txt`);
  `docs/reference.md:36` states the browser renders neither. The client UI
  suite passes inside the full 611-test run.
- **No new network surface.** `evidence/17-telemetry-deps.txt` reports no
  route, server, or HTTP file added or modified. The only new executable file
  is the offline baseline scorer.

## 8. DIFF_SANITY and SECURITY_SANITY

**DIFF_SANITY.** The reviewed code diff against main before this report touches
14 files, 2038 insertions and 27 deletions
(`evidence/06-diff-stat-and-log.txt`, `evidence/11-diff-sanity.txt`):

- `README.md`
- `docs/reference.md`
- `docs/superpowers/plans/2026-10-23-ysk-consequence-scope.md`
- `docs/superpowers/specs/2026-10-23-ysk-consequence-scope-design.md`
- `lib/core.js`
- `lib/review-strictness.js`
- `package.json`
- `scripts/fixtures/note-voice-baseline/cases.json`
- `scripts/note-voice-baseline.mjs`
- `test/core.test.js`
- `test/engine.test.js`
- `test/note-voice-baseline.test.js`
- `test/plugin.test.js`
- `test/strictness.test.js`

This report commit adds only
`docs/harness-reports/ysk-consequence-scope-20261023/`. The binary/numstat scan
is empty (`end_binary_scan` in `evidence/11-diff-sanity.txt`). The branch was
advanced by a fast-forward push from fa9d6ce to b5e3a14; the report commit is a
normal child. No history rewrite and no force push were performed.

**SECURITY_SANITY.** No secret, token, credential, private path, or real session
data was added. The fixtures are synthetic and English-only; the fixture test
rejects non-Latin text, `ozon`, the user-home path prefix, API-key patterns,
bearer values, and private-key headers
(`test/note-voice-baseline.test.js:103-125`). The
evidence directory contains command transcripts, public repository and PR URLs,
and the synthetic fixture output. A home-directory scan of the evidence
directory found no private path. No dependency was added: `package.json` only
gained the `eval:note-voice:baseline` script and the `node --check` entry for
the new file, and the dependency blocks are unchanged
(`evidence/17-telemetry-deps.txt`). No network surface was added.

## 9. Pending owner decisions and blocked work

None of these is approved by this report or by the rework.

- **P1. Noise threshold and release gate.** Still pending, to be set after at
  least two offline runs with the per-class table. The CLI says the baseline is
  unvalidated until the owner sets a threshold.
- **P2. Any live or paid run.** Not authorized and not run. The existing
  `scripts/note-voice-eval-live.mjs` was not executed; only the offline
  baseline was run.
- **P3. Paranoid exemption.** Unchanged. `admitsVerdict` still requires a
  non-blank `action` on a `high` finding, whatever its class; the guard is in
  `test/strictness.test.js` and the gated case `consequence-cache-growth`
  remains a pinned `SILENT_MISSED` with `gated: 1`.
- **P4. Visible `kind` label.** Still pending; the default remains "not
  shown", and the browser renders neither `kind` nor `because`.
- **Upstream Task 8.** Blocked without a separate network authorization. The
  ledger keeps its 2026-10-14 entry; `docs/upstream` has no diff against main
  (`evidence/11-diff-sanity.txt`, `upstream_exit=0`).

## 10. Process deviations

1. **The spec was amended, not rewritten.** The original section 11 still lists
   six statuses. A dated addendum at
   `docs/superpowers/specs/2026-10-23-ysk-consequence-scope-design.md:271-288`
   records `RUNTIME_ERROR`, the 21st fixture, and the NOT_VERIFIED boundary.
   The original bytes are preserved.
2. **The plan was not addended.** It still lists the six original statuses at
   `docs/superpowers/plans/2026-10-23-ysk-consequence-scope.md:378` and has no
   addendum. The code, the tests, README, and the reference have seven; the plan
   text is stale on this point.
3. **The report commit cannot contain its own SHA.** The exact final head is in
   the PR #21 body, and `evidence/final-head.txt` points there.
4. **`BASELINE_VERSION` stayed `note-voice-baseline-1`.** The fixture set grew
   from 20 to 21 and the scoring rules gained `RUNTIME_ERROR` before merge, but
   the version string was not bumped (`scripts/note-voice-baseline.mjs:32`).
   This is a versioning deviation; the changed fixture set is not distinguishable
   from the first one by the version string alone.
5. **The CLI exits 0 when runtime errors exist.** No threshold is approved, so
   `main` sets a non-zero exit for `INVALID` cases (line 274) and for a fixture
   read failure (line 254), not for runtime errors. The run with 3 runtime
   errors exits 0 by design, not because the errors are ignored; they are
   printed and counted in `runtimeErrors`.
6. **`scoreCase` does not reject an unknown mode.** It falls back to Balanced
   through `reviewModeProfile` (`lib/review-strictness.js:134-146`). This is
   pre-existing: the same fallback is in main
   (`git show a7b652e:lib/review-strictness.js` lines 129-131). The fixture test
   requires a real mode, but a direct `scoreCase` call with `mode: "mystery"`
   scores as Balanced (`evidence/16-unknown-mode.txt`).
7. **The baseline remains structural-admission-only.** It does not adjudicate
   entailment or voice attribution and does not measure reviewer quality.
8. **Chronology.** The product transcripts were produced at b5e3a14 on a clean
   tree before the report was written. The report commit is later and is
   documentation-only. The report-level language scan and whitespace check ran
   during staging, before that commit; their transcripts are in the evidence
   directory.

## 11. NOT_VERIFIED and NOT_REQUIRED

- **Semantic voice and consequence quality is NOT_VERIFIED.** No independent
  adjudicator runs offline. The `entail` label is the fixture author's label,
  not a measurement; the voice attribution is not checked. Every admitted note
  carries `semantics: NOT_VERIFIED`; the entail cases carry
  `entailVerified: false`, and the voice cases carry
  `attributionVerified: false`. No accuracy or precision is computed
  (`evidence/18-no-quality-metric.txt`).
- **The author labels are not a measurement.** The 21 fixtures are static,
  author-authored replies, not live model output. A `SPEAK_OK` row means the
  reply cleared parsing, the mode gate, and verbatim grounding. It does not mean
  the note is correct, entailed, or correctly attributed.
- **Live evaluation is NOT_REQUIRED for this rework.** The review allowed either
  distinct offline adjudication or an express NOT_VERIFIED boundary; this rework
  chose the boundary and added counterexample tests. Any live run remains P2.
- **The historical eval-2 run is not comparable.** The reviewer instruction
  changed, and `docs/reference.md:44` records the old and current prompt hashes
  without claiming comparability.

## 12. Rulings

The ledger records these controller rulings. This report adds no new ruling.

| Ledger | Ruling |
|---|---|
| progress.md:39 | A silent verdict that carries `kind` or `because` is dropped, although the reference said harmless extra keys are ignored; the two fields could smuggle unvalidated grounding past the contract. |
| progress.md:40 | Task 4 updates the pinned `promptVersion` hash instead of freezing `REVIEW_INSTRUCTIONS`, because the hash is derived state and freezing the prompt would leave the new class unrequested. |
| progress.md:41 | Task 8 is not executed: it needs network access that this session forbids and the owner has not authorized. |
| progress.md:53 | A padded known `kind` is normalized to its trimmed value rather than kept raw or degraded, so `" consequence "` cannot bypass the `because` gate. |
| progress.md:55 | The brief's Task 2 and Task 3 test snippets were corrected to the real `{ status, note }` interface; the `kind` assertion moved to Task 3. |
| progress.md:61 | The brief's dedupe test was vacuous; the implementer kept its values and added a real second turn so the second observe rereads the log. |
| progress.md:69 | No literal `promptVersion` pin existed to update; the test derives the hash from the instruction, the old hash stays in historical evidence, and the new one is recorded in the reference. |
| progress.md:102 | The plan's prompt sentence was rewritten as two sentences (classify every finding; consequence and tradeoff must quote) and the `promptVersion` hash change was accepted. |
| progress.md:108 | The plan workspace and ledger are kept instead of deleted, because they hold the only non-git record of deferred minors, parked findings, and rulings. |

The round-2 entry at `progress.md:115` records a decision, not a new ruling:
fix A with a distinct `RUNTIME_ERROR` status; fix B by segregating semantics as
NOT_VERIFIED, removing any quality claim, and adding counterexample tests.

## 13. Evidence index

| File | What it records |
|---|---|
| `evidence/00-environment.txt` | Branch, base, merge base, Node/npm versions, remotes, clean tree |
| `evidence/01-npm-test.txt` | Full suite: 611 tests, 611 pass, 0 fail |
| `evidence/02-npm-check.txt` | `npm run check` exit 0 |
| `evidence/03-git-diff-check.txt` | `git diff --check` exit 0, no output |
| `evidence/04-note-voice-baseline-test.txt` | Baseline suite: 27 pass, 0 fail |
| `evidence/05-note-voice-baseline-cli.txt` | 21 cases, gated 1, invalid 0, runtime errors 3, exit 0 |
| `evidence/06-diff-stat-and-log.txt` | 14-file diff stat and 13-commit log against main |
| `evidence/07-git-status.txt` | Empty porcelain output at b5e3a14 |
| `evidence/08-invariant-test.txt` | Human-only invariant: 11 pass, 0 fail |
| `evidence/09-evidence-test.txt` | Evidence/capsule suite: 9 pass, 0 fail |
| `evidence/10-plugin-status-test.txt` | Status diagnostics non-leak test: 1 pass |
| `evidence/11-diff-sanity.txt` | File list, no binary entries, no `lib/evidence.js` or upstream diff |
| `evidence/12-inventory.txt` | SHAs, versions, no tags, one open PR (#21) |
| `evidence/13-secret-grep.txt` | No fixture credentials or home path; no scorer network/env access |
| `evidence/14-ui-kind.txt` | No `kind`/`because` note-field reference in the browser half |
| `evidence/15-evidence-bounds.txt` | 1200-character capsule and bounded-evidence test line |
| `evidence/16-unknown-mode.txt` | Unknown mode falls back to Balanced; pre-existing in main |
| `evidence/17-telemetry-deps.txt` | No telemetry, no dependency change, no new route/server/HTTP file |
| `evidence/18-no-quality-metric.txt` | No accuracy/precision field; only NOT_VERIFIED statements and tests |
| `evidence/19-report-language.txt` | English-only scan of this report and evidence |
| `evidence/20-report-whitespace.txt` | Staged `git diff --cached --check` for the report commit |
| `evidence/repro-prefix.txt` | Pre-fix reproduction from fa9d6ce |
| `evidence/repro-current.txt` | Current reproduction at b5e3a14 |
| `evidence/pr-review.txt` | The CHANGES_REQUIRED review comment and withdrawal of the authorization objection |
| `evidence/pr-before-report.txt` | PR #21 OPEN at b5e3a14, MERGEABLE, one PR for the branch, no tags |
| `evidence/final-head.txt` | Points to the PR body for the exact report-commit SHA |
| `evidence/evidence-sha256.txt` | SHA256 manifest of the evidence files |

## 14. Not done

- No merge, tag, GitHub Release, npm publish, or install.
- No code, test, fixture, or documentation change outside
  `docs/harness-reports/ysk-consequence-scope-20261023/` in the report commit.
- No live model call, paid evaluation, or live-runner execution.
- No upstream ledger refresh; Task 8 remains blocked.
- No second PR and no force push or history rewrite.
- No claim that the author-authored fixtures measure reviewer quality.
