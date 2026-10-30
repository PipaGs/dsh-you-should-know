# Final report - ysk-stage2-prompt-rtl-actions-20261030

**Status:** READY_FOR_CHATGPT_REVIEW

**Base:** 697765379635e75e0c690db22f53aa1550b90a1f

**Branch:** task/stage2-prompt-rtl-actions-20261030

**Product head:** 9c93017 (fix: name all verdict keys and give RTL notes a base direction)

**PR:** https://github.com/PipaGs/dsh-you-should-know/pull/27

**Tool:** DeepSeek Harness, Stage 2 scoped implementation. Two read-only DSH
subagents audited the focus areas before the fix. A fresh implementation
subagent wrote the red tests and the minimal code changes. A separate DSH
subagent reviews the result; DSH did not merge.

---

## 1. Request and scope

Stage 2 covers three focus areas on verified main
697765379635e75e0c690db22f53aa1550b90a1f (v0.4.6, after PR #24, #25, #26):

1. prompt composition and localization: the JSON keys in the language
   directive must match the keys the verdict parser reads;
2. mixed Hebrew/Arabic/Latin RTL layout in the human-visible note card and the
   composer, but only when a real defect is reproduced;
3. human-only action semantics: Add to chat stays a draft-only, action-first
   write, and Explain, Knew it, Thanks, and Dismiss never reach the primary
   agent.

A bug is reported only when a deterministic offline test or a rendered
reproduction shows it. No version, tag, release, npm publish/install, live paid
model call, telemetry, browser storage, or persistent-memory change is in
scope. `docs/upstream` provenance is not changed. The deliberate local
adaptations and action names stay as they are.

## 2. Preflight

| Fact | Value |
| --- | --- |
| Repository | PipaGs/dsh-you-should-know |
| Worktree | .worktrees/task-2a |
| Branch | task/stage2-prompt-rtl-actions-20261030 |
| Base commit | 697765379635e75e0c690db22f53aa1550b90a1f |
| origin/main at preflight | 697765379635e75e0c690db22f53aa1550b90a1f |
| Product version | 0.4.6 (unchanged) |
| Node / npm | v26.12.1 / 11.20.0 |
| Baseline full test | 635 tests, 635 pass, 0 fail, exit 0 |
| Baseline check | exit 0 |
| Open PRs touching these paths | none |
| Main worktree | not touched; its untracked files were left in place |

## 3. Audit, reproduction, and disposition

### 3.1 Confirmed defect: the localized JSON contract omitted two parser keys

`lib/language.js` told the model to keep `note, importance, source, action`
untranslated. `lib/core.js` `parseVerdict` also reads `kind` and `because`;
`because` is required for a consequence or tradeoff, and a malformed
`because` drops the whole reply. The base `REVIEW_INSTRUCTIONS` already names
all six keys, so a localized prompt contained a direct contradiction.

Reproduction is deterministic and offline: build a maximal valid verdict
(`note, importance, kind, because, source, action`), parse it, and inspect the
JSON-contract sentence in `languageDirectiveFor`. Before the fix the sentence
named four keys; the red test reported `actual: ['kind', 'because'], expected: []`.
The Explain prompt is unaffected: it uses `languageSentenceFor` and its own
single-key contract.

Fix: add `kind` and `because` to the untranslatable key list. The parser,
base policy, and Explanation prompt are unchanged. The new test starts from a
maximal valid verdict, so it fails if the directive stops naming any key in
that verdict. It does not discover a future parser key by itself; the payload
would have to be extended as well.

### 3.2 Confirmed defect: RTL note and explanation text inherited the host LTR base direction

The note card and history set no `dir` and no `direction`; all human text
inherited the host LTR paragraph direction. For a Hebrew or Arabic note this is
visible: the first logical character renders at the left edge and the final
period at the wrong end. The product intends RTL output because the note
follows the host language or the human message language.

Rendered reproduction: `evidence/rtl-card-repro.html` uses the exact note-body
inline style from `lib/client.js`; a local Blink page measured the first and
last character of each note with a DOM Range (viewport 1000x440, host LTR):

| Case | dir | computed | first char x | last char x |
| --- | --- | --- | --- | --- |
| Hebrew, current | none | ltr | 61 | 318 |
| Hebrew, fixed | auto | rtl | 687 | 410 |
| Arabic, current | none | ltr | 53 | 283 |
| Arabic, fixed | auto | rtl | 692 | 444 |

The screenshot is `evidence/rtl-card-before-after.png`. The offline tests
assert the markup contract on the note, Explanation, and History text nodes.
In the captured red run the note assertion failed first, so the Explanation
assertions are exercised green only. The node:test harness has no layout
engine, so the rendered measurement is the visual evidence.

Fix: add `dir="auto"` to the four human-language text nodes: the note body,
the Explanation block, the History note, and the History explanation. The
English title, action labels, timestamp, source path, and draft are unchanged.
A note that starts with a Latin token keeps its current LTR direction, so the
change does not flip existing English cards.

### 3.3 No defect: human-only action semantics

Both audits traced the handlers and the routes:

- Add to chat calls only `inputActions.setDraft` and then resolves the note as
  `added_to_chat`; it never calls `submit`, `captureInsertion`, `insertText`,
  steer, inject, or follow up. The action-first branch inserts the reviewer's
  action; an actionless note falls back to an imperative wrapper.
- Knew it and Thanks only mark the note resolved and post the exact resolution
  to the plugin's dismiss route.
- Dismiss only resolves the note through the same plugin route.
- Explain performs one bounded call on the reviewer route and caches the
  explanation; it never writes the session, the transcript, or the primary
  agent.

Existing tests already covered most of this and the source-level invariant
scan. This task adds one behavioral regression: on separate mounts, Knew it,
Thanks, Explain, and Dismiss leave the composer draft and the sent list empty.

### 3.4 Deliberate no-change: composer draft bytes for RTL notes

An actionless RTL note currently yields
`Fix this reviewer finding: <note>` in the draft. The leading English text can
force an LTR base direction in a plain textarea, so the note's final
punctuation can display at the wrong end. The independent RTL audit rejected
the only plugin-side fix (U+2068/U+2069 bidi isolates) for concrete reasons:

- the draft is submitted verbatim to the primary agent on Enter, so invisible
  controls would enter the agent context;
- the real composer is host-rendered and outside this repository, so the
  plugin cannot verify or control its bidi behavior;
- the card defect is fixed by `dir="auto"`, while the draft bytes stay stable.

The no-change is now a regression contract: an actionless Hebrew or Arabic note
keeps the exact old draft, contains no isolate controls, and Add to chat still
never sends. If the host composer is later shown to misrender the draft, the
correct fix belongs to that host or to a separately reviewed draft-format
change.

## 4. Changes

| File | Change |
| --- | --- |
| `lib/language.js` | JSON-contract sentence names `kind` and `because` as well |
| `lib/client.js` | `dir="auto"` on the note, Explanation, History note, and History explanation text nodes |
| `test/language.test.js` | directive-key test anchored to a maximal valid verdict |
| `test/client-ui.test.js` | Hebrew/Arabic note and Explanation direction tests; History note and History explanation direction tests; composer no-change tests; human-only action regression |
| `docs/reference.md` | one sentence documenting the automatic base direction and the plain-text draft |

No other source, prompt, action label, parser, route, config, package manifest,
or `docs/upstream` file changed. Product version stays 0.4.6.

## 5. Verification

Chronology (all commands were run in the task worktree; raw logs are kept, and
the red log is committed with the documented sanitization: the worktree
file-URL prefix and trailing spaces on the test runner's formatting lines):

| Stage | Command | Result |
| --- | --- | --- |
| Baseline | `npm test` | 635 tests, 635 pass, 0 fail, exit 0 |
| Baseline | `npm run check` | exit 0 |
| Red (tests only) | `node --test test/language.test.js test/client-ui.test.js` | 98 tests, 94 pass, 4 fail, exit 1 |
| Green targeted | same targeted command | 98 tests, 98 pass, 0 fail, exit 0 |
| Green full | `npm test` | 642 tests, 642 pass, 0 fail, exit 0 |
| Check | `npm run check` | exit 0 |
| Whitespace | `git diff --check 6977653..HEAD` | exit 0 |

The first full-suite run after the tests were added failed only on the
repository's PR-range whitespace test: the new language test had one blank line
at EOF. The file was corrected; the whitespace test was not changed. The rerun
is the green full result above.

Red failures were exactly:

1. the Hebrew note did not declare `dir="auto"` (`actual: undefined`,
   `expected: 'auto'`);
2. the Arabic note did not declare `dir="auto"` (same);
3. the Hebrew History note did not declare `dir="auto"` (same);
4. the JSON-contract sentence was missing `kind` and `because`
   (`actual: ['kind', 'because']`, `expected: []`).

Evidence: `evidence/test-run-baseline.txt`, `test-run-red.txt`,
`test-run-targeted.txt`, `test-run-full.txt`, and `check.txt`.

## 6. Security, privacy, and provenance

- No credentials, tokens, cookies, absolute home paths, raw tool output, real
  session text, or private project data are committed; the RTL fixtures are
  synthetic.
- The red log is the only log that contained absolute worktree file URLs. It is
  committed with the repository worktree prefix replaced by `<worktree>/`, and
  with trailing spaces removed on the test runner's two-space formatting lines.
  The raw SHA-256 and both replacement rules are recorded in
  `evidence/run-meta.txt`. Counts, timestamps, and assertion text are unchanged.
- No telemetry, browser storage, file write, or new network path was added.
- `docs/upstream` is unchanged; its byte identity is recorded in
  `evidence/upstream-provenance.txt`.
- No reviewer or paid live model call was made. The U-2.1.290 language row and
  the chat-in-main session row keep their recorded status; the local UI/draft
  adaptation is not reclassified.

## 7. Independent review

An independent DSH review subagent reviewed the branch at b174ff7 on
2026-10-30. It did not edit the branch, commit, push, merge, or call a model.

**Verdict: CHANGES_REQUIRED**, with one medium finding and three low wording
findings. The reviewer found the product code correct.

- **MEDIUM:** the History explanation node had `dir="auto"` but no regression
test. The History fixture now carries the Hebrew explanation, and the test
asserts `dir="auto"` on both the History note and the History explanation.
- **LOW:** the report said "one documented path-prefix sanitization", while the
red-log header and the security scan also record trailing-space removal. This
report and `run-meta.txt` now state both.
- **LOW:** "locked to the parser" overstated the directive test. The test is
anchored to a maximal valid verdict and would not discover a new parser key by
itself; the report now says so.
- **LOW:** in the captured red run the note assertion failed first, so the
Explanation assertions were not exercised red. The report now says they are
green coverage only.

The follow-up review commit applies these test and report changes; the product
code did not change. The reviewer independently reproduced the pre-fix state in a temporary copy:
98 tests, 94 pass, 4 fail, exit 1, with exactly the four claimed failures. It
also ran the full suite (642 pass), `npm run check` (exit 0), and the base-range
whitespace check (exit 0), and confirmed the four `dir="auto"` locations, the
unchanged parser and Explain path, the human-only seam, the version, and the
`docs/upstream` tree hash.

The delta review at 0cebe5e found two remaining evidence and report issues: the
run-meta check entry recorded a raw hash that did not match the normalized
committed body and did not state the hash rule, and the reference sentence said
Latin-first text keeps the host direction rather than staying left-to-right.
The hash block now separates raw and committed-body hashes with an explicit
rule, and the reference sentence is corrected. Product code and test counts did
not change. DSH does not merge; ChatGPT performs the merge review.

## 8. Residual risks and follow-ups

- The card tests assert the DOM contract, not glyph positions; the Chromium
  measurement is the rendering evidence.
- `dir="auto"` chooses the first strong character. A note that begins with a
  Latin code token stays LTR, and a digits-only note keeps the inherited
  direction; both match current behavior.
- The composer draft deliberately keeps its plain bytes. RTL display there is a
  host-composer concern and is not changed in this PR.
- The directive fix removes a prompt contradiction; the model's live output
  under a host language is not exercised offline (paid live model calls are
  out of scope).
- The stored-node test harness proves plugin-level draft behavior only; the
  real host `InputActions.setDraft` implementation is outside this repository.

## 9. Handoff

READY_FOR_CHATGPT_REVIEW. Base
`697765379635e75e0c690db22f53aa1550b90a1f`; product head `9c93017`; PR #27.
ChatGPT reviews and merges. Version stays 0.4.6 until all implementation PRs
are merged; a separate 0.5.0 release task follows.


## 10. Dated correction - actual DSH host visual gate (2026-10-30)

**VISUAL_GATE: REQUIRED.**

This correction responds to the ChatGPT review of PR #27. The review found that
the earlier visual evidence, `evidence/rtl-card-before-after.png`, came from a
standalone Blink page that reproduced the card markup. That page proves the CSS
direction behavior, but it is not target-application evidence. It remains only
supplementary. The sentences in sections 3.2 and 6 that treat the mock as the
rendering evidence are superseded by this section; the original text is kept as
history.

### Actual host

- Target: DeepSeek Harness web host, `dsh 0.2.0-rc.2`.
- Plugin: `dsh-you-should-know 0.4.6`, loaded from this task worktree.
- Product head: `9c93017a8c1d863bc80a0bff809042e825ae493a`.
- Branch head at capture: `8cc2853c39b780edef40797304ea78871da5c47e`.
- `lib/` is identical to the product head; no product file changed after it.
- Capture time: 2026-10-30, 15:09Z-15:18Z.
- Method: a temporary DSH profile created from the shipped web template, with
  the plugin package linked to this worktree, booted with
  `dsh --profile visualstage2 --no-open --port 0`. A local test proxy forwarded
  HTTP and WebSocket traffic to the host and replaced only the
  `/api/dsh-you-should-know/notes` and `/history` responses with synthetic
  fixtures. The shell, plugin bundles, session, composer, and every interaction
  were served by the real host. The launch token is not recorded.
- Fixtures: Hebrew, Arabic, mixed Hebrew/Latin, and a long Hebrew note with a
  long Latin path, plus one resolved Hebrew History entry. No real session
  text, user data, credentials, or tool output is present.

### Acceptance criteria matrix

| ID | Observable outcome | Scope | Evidence/source | Verifier | Status |
| --- | --- | --- | --- | --- | --- |
| V1 | A Hebrew note renders RTL: first character at the right edge, final period at the left, mixed Latin path intact | Actual DSH host, synthetic note payload | `actual-host-notes-1280.png`; DOM Range measurement 577 -> 313 at 700px | DSH capture; ChatGPT pending | PASS |
| V2 | An Arabic note renders with the same RTL base direction | Same | Same screenshot; 582 -> 326 | DSH capture; ChatGPT pending | PASS |
| V3 | Explain expands the cached Hebrew explanation inline, RTL, without a reviewer call | Actual DSH host | `actual-host-explanation-1280.png`; snapshot | DSH capture; ChatGPT pending | PASS |
| V4 | History shows the resolved Hebrew note and its Hebrew explanation, RTL | Actual DSH host | `actual-host-history-1280.png`; snapshot | DSH capture; ChatGPT pending | PASS |
| V5 | Add to chat inserts the exact action text into the composer, keeps composer focus, resolves the card, and does not send | Actual DSH host, real composer | `actual-host-add-to-chat-1280.png`; interaction log in `actual-host-visual-evidence.txt` | DSH capture; ChatGPT pending | PASS |
| V6 | Thanks, Knew it, and Dismiss do not write or send a draft; the draft stays empty or unchanged and send stays disabled or unchanged | Actual DSH host, real composer | Interaction log; three fresh reloads | DSH capture; ChatGPT pending | PASS |
| V7 | At a 700px viewport the long RTL note wraps; cards and composer stay inside the viewport; scrollWidth equals innerWidth | Actual DSH host | `actual-host-narrow-700.png`; scrollWidth 700, card right 677, composer right 673 | DSH capture; ChatGPT pending | PASS |
| V8 | A real reviewer-produced note reaches the card on the desktop app 0.2.1-rc.3 | Delivery path and desktop host | None | DSH | NOT VERIFIED |

### Scope and limitations

The visual gate passes for the UI change on the actual DSH web host and for the
real composer interactions. It does not prove the reviewer model's note
delivery on the desktop app: the fixtures were injected at the notes route, and
paid live model calls are out of scope. The desktop 0.2.1-rc.3 host was not
captured; this evidence uses `dsh 0.2.0-rc.2`. Those two items stay
`NOT VERIFIED`, not `PASS`.

Full evidence: `evidence/actual-host-visual-evidence.txt`, the six actual-host
PNGs, and `evidence/visual-fixture-proxy.mjs`. The earlier mock remains at
`evidence/rtl-card-before-after.png` and `evidence/rtl-card-repro.html` as
supplementary material only.
