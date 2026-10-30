# Final report - stage4c-recent-check-diagnostics-20261030

**Status:** READY_FOR_CHATGPT_REVIEW

**Base:** 96b728166eabd5e360d0d55ec31f544aab573b01

**Branch:** task/stage4c-recent-check-diagnostics-20261030

**Product head:** 08d3ea2f5dc21c294f2ce30b3390e53db50e3d0d (feat: add opt-in bounded recent-check diagnostics)

**Final head:** the report commit that adds this file (report-only; product files are identical to the product head)

**PR:** to be opened from the branch above

**Tool:** DeepSeek Harness supervised Stage 4C implementation. One implementation subagent wrote the red tests and the product code; a separate DSH review subagent reviewed the result and returned CHANGES_REQUIRED; the implementation subagent fixed every finding; a delta review verifies this final tree. DSH did not merge.

---

## 1. Request and scope

Stage 4C adds one opt-in, bounded, local recent-check diagnostic history to the existing
read-only status route. It is the only Stage 3/4 idea scoped for this patch: mid-task
context (A) and persistent memory (B) stay out of scope because their decisions remain
open.

In scope: the opt-in config key, a per-session in-memory history with a fixed record
shape, a finite cap, reset paths, the status-route field, the self-check capability flag,
tests, and the matching reference and README text.

Out of scope and unchanged: the reviewer prompt and cadence, the primary-agent seam,
persistent memory, the web UI and client bundle, telemetry, external network, file or
browser storage, environment variables, live model calls, tags, releases, and npm
install or publish. Product version stays 0.4.6.

## 2. Preflight

| Fact | Value |
| --- | --- |
| Repository | PipaGs/dsh-you-should-know |
| Worktree | .worktrees/task-4c-recent-check-diagnostics |
| Branch | task/stage4c-recent-check-diagnostics-20261030 |
| Base commit | 96b728166eabd5e360d0d55ec31f544aab573b01 |
| origin/main at start | 96b728166eabd5e360d0d55ec31f544aab573b01 |
| Product version | 0.4.6 (unchanged) |
| Node / npm | v26.12.1 / 11.20.0 |
| Baseline full test | 642 tests, 642 pass, 0 fail, exit 0 |
| Baseline check | exit 0 |
| Open PRs touching these paths | none |
| Main worktree | not touched; its untracked .rollout-restart-verify.log was left in place |

## 3. Implementation

- **Config.** `recentCheckDiagnostics` is a volatile boolean field, default `false`,
  added to the host Config schema and to normalized config. A non-boolean value falls
  back to the default with one warning; the config route rejects a present non-boolean.
  Both automatic and pinned saves carry the live value when the request omits it, so a
  settings save cannot silently disable the opt-in.
- **Record.** One review that reaches a terminal outcome stores one object with exactly
  `at`, `turn`, and `outcome`. `at` is a non-negative safe integer timestamp or
  `null` when the clock is unusable. `turn` is the reviewed turn's engine ordinal,
  captured when that review starts; a later completed turn that arrives while the first
  review is in flight cannot change it. `outcome` is folded onto the exported frozen
  allowlist (`noted`, `silent`, `duplicate`, `suppressed`, `budget`,
  `unroutable`, `error`, `aborted`, `quota_exhausted`, `halted`,
  `queue_full`, `disposed`, `other`). No free-form string is stored.
- **Bounds.** The cap is `LIMITS.maxRecentChecks = 12`. It deliberately reuses the
  existing per-session note ceiling as the explicit product choice. The oldest record
  is evicted first. The array is per session and in memory only.
- **Read path.** `status(sessionId).session.recentChecks` is present only while the
  opt-in is on; when it is off the key is absent, not an empty array. Records are
  newest-first and are returned as fresh objects. While off, no record is written.
- **Self-check.** The authenticated self-check reports the live opt-in as
  `capabilities.recentCheckDiagnostics`. It carries no history because it has no
  session context.
- **Reset.** Turning the opt-in off clears retained history. Forgetting, disposing, or
  evicting a session drops its array with the state object. A restart drops it. Nothing
  is persisted.
- **Scope.** `lib/client.js` and every UI surface are unchanged. Only the existing local
  read-only diagnostic API returns one additional bounded field, so a visual gate is not
  required.

## 4. Acceptance matrix

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 default OFF and compatible | PASS | Disabled status keeps its previous shape with no `recentChecks` key; existing counters are untouched. The only additive fields are `recentCheckDiagnostics` in the config view, engine diagnostics, and self-check capabilities. No persistence. Tests: "recent-check diagnostics stay off by default...", "the plugin serves the opt-in history and capability over its routes". |
| AC-2 enabled bounded history | PASS | Status route returns newest-first records with exactly `at`, `turn`, `outcome`; the outcome allowlist is exported, frozen, and tested. Tests: "enabled diagnostics expose newest-first records...", "the recent-check outcome allowlist and the cap are explicit and frozen". |
| AC-3 finite cap and reset | PASS | Cap 12 with oldest-first eviction; forget, dispose, session eviction, disable, and restart reset paths. Tests: "the per-session history keeps only the newest records up to the cap", "the tracked-session cap drops the oldest history with its session", "forget, dispose, and a disabled toggle drop or hide the per-session history". |
| AC-4 human-only rule unchanged | PASS | No steer/inject/followup, telemetry, network, storage, environment, or client change. The reviewer-call probe stayed at 2 calls with the flag off and 2 with it on. `test/invariant.test.js`, part of the full suite, passes. |
| AC-5 failure and poisoning safety | PASS | A throwing or unusable clock yields `at: null` and never throws. Malformed events, null events, and events carrying secret data are ignored without leaking values. A runtime failure records only an allowlisted outcome. Tests: "an unusable clock never breaks a record...", "secret event, reason, and note text never reach the diagnostic records", "a reviewer failure and an unexpected failure stay allowlisted and never throw". |
| AC-6 red before green at the final tree | PASS | Base-tree reproduction of the final 13-test file: 13 tests, 0 pass, 13 fail, exit 1. Green: 13/13 targeted, 656/656 full, check exit 0, whitespace check exit 0. The whole product tree is committed at 08d3ea2; the evidence headers name that tree. |
| Version 0.4.6 | PASS | `package.json` and `PLUGIN_VERSION` both stay 0.4.6; the release-consistency tests pass. |
| Visual gate | NOT REQUIRED | No rendering or UI change. The patch only extends data returned by the existing local diagnostic API. |

## 5. Verification

All product checks ran in the task worktree. The final evidence files name the product
tree they describe.

| Stage | Command | Result |
| --- | --- | --- |
| Baseline | `npm test` on a clean 96b7281 worktree | 642 tests, 642 pass, exit 0 |
| Red | `node --test test/recent-check-diagnostics.test.js` on a clean 96b7281 worktree with the final 13-test file | 13 tests, 0 pass, 13 fail, exit 1 |
| Targeted green | same command on the product tree | 13 tests, 13 pass, exit 0 |
| Full green | `npm test` | 656 tests, 656 pass, 0 fail, exit 0 |
| Check | `npm run check` | exit 0 |
| Whitespace | `git diff --cached --check 96b7281` on the staged final tree | exit 0 |

The red failures were all 13 tests in the final file: missing allowlist and cap, missing
diagnostics flag, missing `recentChecks`, missing cap/reset/privacy/failure/config/route
behavior, plus the turn-ordinal, pinned-save, tracked-session eviction, and unusable-clock
regressions. The green run covers the same 13 tests.

Evidence: `evidence/test-baseline.txt`, `test-red.txt`, `test-red-raw.txt`,
`test-green.txt`, `test-full.txt`, `check.txt`, `diff-check.txt`, and
`run-meta.txt`.

### Evidence chronology

The implementation subagent wrote the tests before the product code. Its first red run
covered 9 tests and was replaced during evidence normalization by base-tree
reproductions; the committed red log is a reproduction of the final 13-test file. It
proves that all final tests fail on the base tree; it does not by itself prove the
authoring order. This is a process deviation and is recorded here instead of being
presented as a test-first capture.

The red raw log is committed with only trailing spaces and tabs removed, because the
repository PR whitespace gate rejects them. The readable copy also replaces the
temporary-worktree path with `<base-worktree>` and adds one command header and one
exit-code footer. Counts, durations, and assertion text are unchanged. SHA-256 values
for both committed files and every normalization rule are in `run-meta.txt`.

## 6. Security, privacy, and scope

- The record schema is a closed allowlist of three primitive fields. Event data, reason
  text, note text, prompts, source paths, errors, credentials, and conversation text
  are never copied.
- Poisoning tests feed distinctive secret markers through the answer, reason, reviewer
  note, and event data; the status JSON contains none of them.
- No credential, cookie, token, home path, or private project data is committed. The
  raw red log keeps only a temporary-worktree path, not a user home path.
- No telemetry, new external network, file or browser storage, environment read, or
  reviewer call is added. No primary-agent seam is touched.
- `docs/upstream` is byte-identical (`dc829fc186779aa5e97b3683cdd89c86d0ed8884`).
- No UI file, package manifest version, tag, release, or npm command changed.

## 7. Independent review

A fresh DSH review subagent reviewed the pre-fix working tree on 2026-10-30. The
round-1 diff SHA-256 was
`895a4559bdec64db0b09e93668b5573125434e9c1a87c9e1ce3d7505cdb7f642`; the fixes below are
in product head `08d3ea2`. The reviewer did not edit, commit, push, or call a model.

**First verdict: CHANGES_REQUIRED.** The product behavior otherwise matched AC-1 through
AC-6, but the reviewer found one real product bug and several evidence or coverage gaps:

- **F1 HIGH, fixed:** a pinned-mode config save cleared the live opt-in because the
  pinned branch did not carry preserved fields. The pinned branch now carries
  `readPreservedFields(preserveFields)` before the explicit request fields, and a
  regression test starts enabled and posts a pinned save without the flag.
- **F2 HIGH, fixed:** the handoff had no commit, so green evidence could not be bound to
  a tree. The product tree is now committed at `08d3ea2`; the evidence headers name it.
- **F3 HIGH, fixed:** this task-owned report was missing. It now exists.
- **F4 MEDIUM, fixed:** baseline metadata, the committed raw red log, and a recorded
  whitespace check were missing. They are now present, and `run-meta.txt` states every
  normalization rule and SHA-256.
- **F5 MEDIUM, fixed:** capacity eviction and poisoned clocks had no committed tests.
  Tests now cover the 201st tracked session and NaN, negative, float, large, string, and
  object clock values.
- **F6 LOW, fixed:** disabling retained hidden records and re-enabling revealed them.
  Disabling now clears the history, and the docs say so.
- **F7 LOW, fixed:** review scaffolding was removed from the worktree before the commit.
- **F8 LOW, fixed:** the reference now qualifies recording as "while the opt-in is on
  when it settles".

**Delta review.** The reviewer re-checked product head `08d3ea2` and all AC as PASS. It
returned CHANGES_REQUIRED only for report and evidence text: R1 review provenance,
R2 the red test count, R3 the diff-check description, R4 the baseline annotation,
R5 the invariant-scan claim, and R6 the report's whitespace scope. All six are corrected
here. **Delta verdict: PASS; R1-R6 corrected; no remaining findings.**

## 8. Residual risks

- The status route is the only surface that carries the records; the self-check carries
  only the opt-in flag. This is the deliberate scope of the contract.
- Only reviews that reach a terminal outcome are recorded. Gate skips that never start a
  review add no record.
- The timestamp is sampled when the review settles, not when it starts.
- The red log is a base-tree reproduction, not the first pre-implementation capture; the
  chronology section states this explicitly.
- The opt-in is a config value, not a rendered settings control. A user enables it in a
  profile patch or the config route. This is deliberate because the PR does not change
  the UI.

## 9. Handoff

READY_FOR_CHATGPT_REVIEW. Base
`96b728166eabd5e360d0d55ec31f544aab573b01`; product head `08d3ea2`; final head is
the report commit. ChatGPT reviews and merges. DSH does not merge. Product version stays
0.4.6.
