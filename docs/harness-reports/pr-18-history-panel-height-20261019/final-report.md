# Final report — pr-18-history-panel-height-20261019

**Status:** READY_FOR_CHATGPT_REVIEW. No merge, tag, release, publish or install was performed.
**TASK_ID:** none was supplied by the owner and no historical TASK_ID exists for this work. Task identity is PR [#18](https://github.com/PipaGs/dsh-you-should-know/pull/18), branch `fix/web-history-panel-height`, and review comment `6264556857`. No TASK_ID was invented.
**PR base:** `82ad0a98b8f70a29b96f562da424c01b501884eb` (`main`, unchanged during this round).
**Reviewed head:** `af71dc1c7bc87c2fe620ea8b61cfbd7db72a87db` — the head ChatGPT reviewed with `CHANGES_REQUIRED`.
**Final source commit:** `af71dc1c7bc87c2fe620ea8b61cfbd7db72a87db`. The product source is unchanged since review; this round adds only this report and its evidence.
**Report commit:** the commit that adds this file and `evidence/`. Its exact SHA is the PR head after the push and is stated in the handoff, because the file is part of that commit.
**Tool:** DeepSeek Harness, supervised goal `goal-session-0c9a907b-df46-4896-a271-9680c9a265f3`, revision 1, mode strict.

---

## 1. What the review asked for

ChatGPT returned `CHANGES_REQUIRED` for head `af71dc1` (comment `6264556857`, 2026-10-19T09:56:55Z) with three blockers and no code-defect claim:

1. **`REPORT_NOT_REVIEWABLE`** — the PR changes only `lib/client.js` and `test/client-ui.test.js`; the task-owned `final-report.md` with the acceptance matrix, root-cause/debugging evidence, exact test provenance, `DIFF_SANITY`, `SECURITY_SANITY` and `VISUAL_GATE` is absent.
2. **`VISUAL_NOT_PROVEN`** — this is a UI change and the PR admitted no live GUI verification. The unit test proves style props, not the real sticky-composer geometry or the user action. Native target-app evidence is required on the exact reviewed source: an overlong history with `Hide history` reachable, plus runtime interaction evidence that the control actually closes the panel.
3. **Fresh verification evidence for the exact head** — re-run the relevant regression and full tests on the final tree and record raw command/result/exit status and source identity, preserving red/green evidence.

This report answers all three. The reviewer explicitly asserted no additional code defect, and the re-check below found none, so the product code was not churned.

## 2. Scope / write set

| File | Change in this round |
|---|---|
| `lib/client.js` | Already in the reviewed commit `af71dc1`; **not touched in this round**. sha256 `bc7abd92eb076148f327a83e4a815743a9ae5adfc52425dcc30236a4dfddfcfa`. |
| `test/client-ui.test.js` | Already in `af71dc1`; **not touched in this round**. sha256 `f0e1e73541db476bd5b7ad674e00cedcf8570281bbc219d342f2abc0b6b71da2`. |
| `docs/harness-reports/pr-18-history-panel-height-20261019/final-report.md` | This report (report commit). |
| `docs/harness-reports/pr-18-history-panel-height-20261019/evidence/*` | Raw test logs, native capture script, capture JSON and screenshots (report commit). |

Not touched: `main`, version files, `cordis.patch.yml`, other worktrees, other `docs/harness-reports/ysk-*` reports. No force-push, no merge, no replacement PR, no new task branch.

## 3. Root cause and debugging protocol

**Symptom (reported by the owner, reproduced natively in §6):** after opening the notification history, the panel could not be closed — the `Hide history` toggle was not visible anywhere and no scroll position revealed it.

**Cause, established from the host's own CSS and then measured in the running app:**

- The composer area is `[data-composer-seat]` with class `ST7X_W_composerSeat`; in an active conversation the host styles it `position: sticky; bottom: 0; flex: none` inside the scrolling `[data-conversation-scroll]` body.
- The plugin's dock (`conversation.input.dock`) is the first child of the composer stack inside that seat, so the dock's top row — the `Hide history` / `History` toggle — is the topmost content of a bottom-anchored sticky footer.
- A bottom-sticky element taller than its scrollport cannot reveal its top edge: the scroll range ends at the element's bottom, so no `scrollTop` brings the element's first rows into the viewport.
- The history list had no height bound (12 entries at this fixture size measured 1045 px), which made the seat 1310 px tall in a 900 px viewport. The toggle measured `top: -93` — permanently outside the viewport — and a real pointer click timed out after 8 s.

**Fix (already in the reviewed commit):** the open list is capped to `maxHeight: min(45vh, 420px)` and scrolls inside that box (`overflowY: auto`, `overscrollBehavior: contain`, `scrollbarGutter: stable`). The toggle stays above the list and outside the scroll box, so the seat never exceeds the viewport and the control is always reachable.

**No alternative hypothesis was adopted as cause.** The docking geometry was read from the host bundle shipped with DeepSeek Harness 0.2.1-rc.2 (`ConversationRoot.module.css`: `composerSeat`/`scrollBody`) and then confirmed by the measurements in `evidence/red-unbounded.json` — the same numbers the fix moves (`groupStyle.maxHeight`, `composerSeat.height`, `toggle.top`).

## 4. Acceptance matrix

| AC | Requirement | Status | Evidence |
|---|---|---|---|
| AC1 | Same branch and PR, no merge, no replacement | **PASS** | branch `fix/web-history-panel-height`, PR #18, base `82ad0a9` unchanged |
| AC2 | No product-code churn without a proven defect | **PASS** | product diff `82ad0a9..af71dc1` = `lib/client.js`, `test/client-ui.test.js` only; the report commit adds docs only; `lib/client.js` sha256 unchanged since review |
| AC3 | Report present in the PR with matrix, root cause, test provenance, DIFF/SECURITY/VISUAL gates | **PASS** | this file + `evidence/*` |
| AC4 | Overlong history with `Hide history` reachable on the exact head source | **PASS** | `evidence/green-fixed.json`: 12 entries, `toggleInViewport: true`, `toggle.top: 227`, `maxHeight: 405px`, seat 670 px < 900 px; screenshot `green-fixed-1-after-open.png` |
| AC5 | Runtime interaction proves the control closes the panel | **PASS** | `evidence/green-fixed.json`: real pointer click `ok: true` in 28 ms, `panelClosed: true`, toggle label flips to `Show notification history` |
| AC6 | Pre-fix behaviour reproduced (red evidence) | **PASS** | `evidence/red-unbounded.json`: `toggle.top: -93`, `seatHeightExceedsViewport: true`, click timed out 8010 ms, `panelClosed: false`; screenshot `red-unbounded-1-after-open.png` |
| AC7 | Targeted regression re-run on the final tree | **PASS** | `test-client-ui-final.txt`: 83/83, 0 fail, exit 0 |
| AC8 | Full suite re-run on the final tree | **PASS** | `test-full-final.txt`: 563/563, 0 fail, exit 0 |
| AC9 | Red regression evidence for the new test | **PASS** | `test-red-prefix-final.txt`: 1 test, 1 fail, exit 1, `actual: undefined` vs `expected: 'min(45vh, 420px)'` |
| AC10 | Diff sanity | **PASS** | product diff 2 files, +59/−8; full branch diff check exit 0; per-file sha256 recorded |
| AC11 | Security sanity | **PASS** | no secret-like or host-specific material added; capture JSON redacts the session token; the capture script carries no machine path |
| AC12 | Remote branch/PR parity after push | **PASS (post-push)** | `git ls-remote` and `gh pr view 18` recorded in the handoff; no merge |

## 5. Fresh verification on the final tree

Commands were run from the repository root at `af71dc1` with no modified tracked files; the only untracked path present at that moment was this round's `evidence/` directory, which no test reads. Raw output is preserved verbatim in `evidence/`.

| Command | Result | Exit | Log |
|---|---|---|---|
| `npm test` | 563 tests, 563 pass, 0 fail | 0 | `evidence/test-full-final.txt` |
| `node --test test/client-ui.test.js` | 83 tests, 83 pass, 0 fail | 0 | `evidence/test-client-ui-final.txt` |
| `node --test --test-name-pattern 'stays inside the viewport' test/client-ui.test.js` on the pre-fix source tree | 1 test, 0 pass, **1 fail** | 1 | `evidence/test-red-prefix-final.txt` |

The red run uses the reviewed base tree (`git archive 82ad0a9`, `lib/client.js` sha256 `4151fae8…`) with the new test file copied in, which is the smallest reproducible red/green pair. `npm test` runs `node --check` on every `lib/*` file before the suite, so the logs also prove the final files parse.

## 6. VISUAL_GATE — native target-app evidence

**Method.** An isolated DeepSeek Harness home (`DSH_HOME` in a temp dir, profile created with `--from-default-profile web`) ran the shipped app on a dedicated port and loaded `dsh-you-should-know` through a `node_modules` symlink. The plugin tree was the exact source under review. The owner's desktop profile and worktrees were not modified. Playwright drove headless Chromium against the real Web GUI; only the plugin's own HTTP routes (`notes`, `history`) were answered with a 12-entry fixture, so the conversation shell, the sticky composer seat, the module loader and the dock were the host's own code and layout.

**Environment.** DeepSeek Harness CLI `0.2.1-rc.2` (same shipped app), Node `v26.9.0`, Playwright `1.63.0`, `chromium-headless-shell-1243`, viewport 1280×900 at deviceScaleFactor 2 (screenshots 2560×1800).

**Green run — exact head source (`lib/client.js` sha256 `bc7abd92…`), 2026-10-19T10:03:22Z:**

- 12 history entries; list computed `max-height: 405px`, `overflow-y: auto`, `scrollHeight 1061 > clientHeight 405` — the list scrolls internally.
- Toggle `top: 227, bottom: 240`, fully inside the 900 px viewport; composer seat 670 px, below the viewport height.
- Real pointer click on `Hide history`: succeeded in 28 ms; the `[role="group"][aria-label="Notification history"]` node is gone; the toggle's label became `Show notification history`.
- Screenshots: `green-fixed-1-after-open.png` (panel open, toggle visible, sha256 `e0a0d3c3…`), `green-fixed-3-after-click.png` (panel closed, sha256 `b478d07f…`).

**Red run — reviewed base source (`lib/client.js` sha256 `4151fae8…`), 2026-10-19T10:03:54Z:**

- Same fixture and viewport. List `max-height: none`, `overflow-y: visible`, height 1045 px; composer seat 1310 px, taller than the viewport.
- Toggle `top: -93` — above the viewport, and unchanged after scrolling the conversation to its top (`scrollTop 0`).
- Real pointer click: timed out after 8010 ms (`locator.click: Timeout 8000ms exceeded`); the panel stayed open.
- Screenshot: `red-unbounded-1-after-open.png` (sha256 `05fe86ae…`) shows the panel filling the window with no `Hide history` control — the reported bug.
- The red and green sets differ only in the plugin tree served; the script, fixture, viewport and host build are identical.

**Limits of this gate.** The captures ran headless Chromium through Playwright, not the owner's visible desktop window; the same app build, host layout and renderer were used. Manual clicking in the desktop window was not performed and is not claimed. The gate proves the geometry and the click path, not a human's subjective reading experience.

**Determinism.** The fixture payload carries fixed timestamps and ids, so the rendered rows are reproducible. The open-state screenshot and its scrolled-to-top twin are byte-identical (sha256 `e0a0d3c3…`) because nothing needed to scroll once the panel fit: the conversation's `scrollTop` was 0 both before and after the script set it.

## 7. DIFF_SANITY

Product diff `git diff 82ad0a9..af71dc1` — 2 files, +59/−8:

```
 lib/client.js          | 31 +++++++++++++++++++++++--------
 test/client-ui.test.js | 36 ++++++++++++++++++++++++++++++++++++
 2 files changed, 59 insertions(+), 8 deletions(-)
```

- The product diff is one named style object (`HISTORY_GROUP_STYLE`) plus its use; no behaviour, route, or stored state changes.
- This round adds only `docs/harness-reports/pr-18-history-panel-height-20261019/`; it does not touch `lib/`, `test/`, `package.json` or `cordis.patch.yml`.
- `git diff --check` exits 0 over the product diff and 0 over the staged code-plus-report tree. The check deliberately excludes `evidence/`: the raw TAP logs are stored verbatim and not whitespace-normalized, and node's reporter emits lines that end in spaces. Raw output, file list and per-file sha256: `evidence/diff-sanity.txt`.

## 8. SECURITY_SANITY

- No credentials, tokens, session ids, API keys or private keys were added to tracked files; the added lines were grepped for secret-like patterns and found none (`evidence/security-sanity.txt`).
- The native capture JSON stores `http://127.0.0.1:<port>/?token=<redacted>`; the live token appears in no tracked file.
- `evidence/capture-history.cjs` resolves the plugin tree from its own location and reads `PLAYWRIGHT_MODULE` / `PLAYWRIGHT_BROWSERS_PATH` from the environment; it bakes in no machine path.
- The report contains no user home paths. Fixture finding text is synthetic.
- No new network egress was introduced by the change: the client still polls the same host routes.

## 9. Provenance

```
collected_at_utc  = 2026-10-19T10:02:36Z
repo head         = af71dc1c7bc87c2fe620ea8b61cfbd7db72a87db
base              = 82ad0a98b8f70a29b96f562da424c01b501884eb
branch            = fix/web-history-panel-height
remote head       = af71dc1c… (before this round's push)
node              = v26.9.0
npm               = 11.19.1
dsh cli           = 0.2.1-rc.2
playwright        = 1.63.0
chromium          = chromium_headless_shell-1243
client.js sha256  = bc7abd92eb076148f327a83e4a815743a9ae5adfc52425dcc30236a4dfddfcfa
pre-fix sha256    = 4151fae8011f5842d18c47c0f8eb5141562e8ecd343c1f436740286f17b8e6b5
```

Full environment record, worktree list and remote refs: `evidence/provenance.txt`.

## 10. Evidence index

| File | Contents | Key result |
|---|---|---|
| `evidence/test-full-final.txt` | `npm test` raw output | 563/563, exit 0 |
| `evidence/test-client-ui-final.txt` | `node --test test/client-ui.test.js` | 83/83, exit 0 |
| `evidence/test-red-prefix-final.txt` | New test against pre-fix source | 1 fail, exit 1 |
| `evidence/capture-history.cjs` | Reproducible native capture script | No machine path, env-driven |
| `evidence/green-fixed.json` | Green geometry, click, hashes | Toggle visible, click ok, panel closed |
| `evidence/red-unbounded.json` | Red geometry, click, hashes | Toggle at `top: -93`, click timeout |
| `evidence/green-fixed-1-after-open.png` | Panel open on fixed source | `Hide history` visible at top-right |
| `evidence/green-fixed-3-after-click.png` | Panel closed | Entry list gone, toggle back to `Show` |
| `evidence/red-unbounded-1-after-open.png` | Panel open on pre-fix source | Panel overflows the window, no toggle |
| `evidence/diff-sanity.txt` | Diff stat, `--check`, hashes | 2 files, exit 0 |
| `evidence/security-sanity.txt` | Secret/path grep | No matches |
| `evidence/provenance.txt` | Commits, versions, remote refs, worktrees | Recorded at collection time |

## 11. Known limits and open items

- The captures ran against a headless Chromium instance of the same app build; no human manual check in the visible desktop window is claimed.
- The active-note stack (up to 12 cards) still has no height bound and can, with an extreme note count on a short window, push the composer seat above the viewport the same way. It is a separate symptom, not this PR's defect, and was not changed. It remains open for a follow-up.
- The reviewed commit's message is in Russian, written before the owner's English-only instruction for this project. It was not rewritten (that would need a force-push, which is forbidden here); commits from this round onward are in English.
