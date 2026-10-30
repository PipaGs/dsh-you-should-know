# Final report - ysk-v0.5.0-functional-fixes-20261030

**Status:** READY_FOR_CHATGPT_REVIEW

**Base:** 6d5b770b9f595c0bc456c9096c23875dc7a412ec (tag `v0.5.0`)

**Branch:** fix/v0.5.0-functional-defects-20261030

**Product head:** b572dbdb6c728886a0c9c870adf0ffa6aad9a0a5 (product version 0.5.0, unchanged)

**PR:** added in the handoff commit that follows this report

**Tool:** DeepSeek Harness supervised Goal. Two implementation subagents wrote the regression tests and fixes; DSH ran the gates and the actual-host capture; DSH did not merge. ChatGPT independently reviews and merges.

---

## 1. Request and scope

The user's installed v0.5.0 audit reproduced six defects. This task fixes them
with evidence, keeps the product version at 0.5.0, and validates the result on
the actual DSH 0.2.1-rc.5 host with synthetic notes/history fixtures. The scope
is limited to:

1. D1 (high): invented `source.path` accepted without grounding;
2. D2 (medium): evidence-capsule text accepted as a `because` quotation;
3. D3 (medium): hung route discovery or capability lookup leaves a review
   in flight forever;
4. D4 (low): recent-check diagnostics survive a live disable;
5. D5 (low): source-path traversal reaches the client resource URL;
6. D6 (low): Unicode bidi controls can spoof reviewer-authored text.

No version, tag, release, npm publish/install, live paid model call, profile
install, or main merge is in scope. The main worktree, `~/.dsh`, the installed
desktop plugin, credentials, sessions, and release tags were not modified. The
untracked `.rollout-restart-verify.log` in the main worktree is untouched.

## 2. Defect outcomes

| ID | Required outcome | Evidence | Status |
| --- | --- | --- | --- |
| D1 | A source path must appear verbatim as a whole token in the real conversation excerpt; the capsule cannot ground it; an unmarked line is dropped; a fabricated path drops the reply | `test/core.test.js`, `test/engine.test.js`; red on v0.5.0; green on the fix | PASS |
| D2 | A `because` must appear verbatim in the conversation excerpt only; the episode capsule/header never grounds it; valid RTL quotations stay valid | `test/engine.test.js`; red on v0.5.0; green on the fix | PASS |
| D3 | A never-settling discovery or capability lookup settles with a finite bounded outcome, clears `inFlight`, records a terminal outcome, and lets the next turn retry; no cache poisoning; no extra call | `test/route-deadline.test.js`; red on v0.5.0; green on the fix | PASS |
| D4 | Disabling the reviewer hides and clears recent-check records; re-enabling starts empty; notes, dedupe, and known fingerprints survive; records stay `{at,turn,outcome}` | `test/recent-check-disable.test.js`, `test/recent-check-diagnostics.test.js`; red on v0.5.0; green on the fix | PASS |
| D5 | Traversal, absolute POSIX, drive-absolute, UNC, and percent-encoded paths are rejected by the host parser and fail closed in the client; safe relative paths still work | `test/core.test.js`, `test/client-ui.test.js`; red on v0.5.0; actual-host traversal card has no link and its draft never contains the path | PASS |
| D6 | Bidi controls in note, action, `because`, or source path are rejected by the host parser and stripped at render/draft time; natural Hebrew and Arabic stay intact | `test/core.test.js`, `test/client-ui.test.js`; red on v0.5.0; actual-host bidi card and draft contain no control | PASS |

All six defects reproduced on the clean v0.5.0 product tree. No audit finding
was rejected as non-reproducible.

## 3. Reproduction

The final regression files were copied onto a clean archive of tag `v0.5.0`
and run without product changes:

- command: `node --test --test-timeout=5000 test/core.test.js test/engine.test.js test/client-ui.test.js test/route-deadline.test.js test/recent-check-disable.test.js`
- result: exit 1, tests 257, pass 232, fail 25
- failures include invented source grounding, capsule-quoted `because`,
  traversal links, bidi controls, hung discovery, and retained diagnostics

Full names: `evidence/test-run-red.txt`.

## 4. Fix summary

- `lib/core.js`: exact whole-token source grounding against the conversation
  excerpt; excerpt-only `because`/source grounding; `path:42`/`path#L42`
  line retention with line drop otherwise; rejection of traversal, absolute,
  drive, UNC, and percent-encoded paths; bidi-control rejection in note, action,
  `because`, and source path; `ROUTE_DEADLINE_MS = 5000` with an injectable
  `routeDeadlineMs`; `boundedRoute()` settles a hung discovery as
  `unroutable`, clears `inFlight`, and invalidates only the pending discovery;
  disable clears `recentChecks`; the status snapshot and `recordRecentCheck`
  stay quiet while disabled.
- `lib/runtime.js`: `capabilityFor` is bounded by the whole-call deadline and
  by dispose/abort; a hung lookup omits `reasoningEffort`, caches nothing, and
  the stream still starts.
- `lib/client.js`: fails closed on unsafe paths (plain text, no link, no
  resource URL); strips bidi controls from note, action, source label,
  explanation, and draft; natural RTL text is unchanged.
- `README.md`, `docs/reference.md`: the verdict, route-deadline, and
  recent-check contracts now describe the implemented behavior. The reviewer
  instruction hash is `9bf76d199ef8047a6b8b1a1a8586ee628ce9f53c1023646ade4218cd61b71034`.

## 5. Verification

| Check | Result |
| --- | --- |
| `npm test` on the fixed tree | 680 tests, 680 pass, 0 fail, exit 0 |
| `npm run check` | exit 0 |
| `git diff --check` | exit 0 |
| Product version | 0.5.0, unchanged |
| New regression tests | 24 (14 for D1/D2/D5/D6, 10 for D3/D4) |

Raw summaries: `evidence/test-run-full.txt`, `evidence/check.txt`.

## 6. Actual DSH host validation

**Target:** DeepSeek Harness desktop app `0.2.1-rc.5` (same version from
`Info.plist` and `dsh --version`), web host booted from a temporary isolated
`DSH_HOME` created from the shipped web template. The plugin package in that
profile is a symlink to the task worktree at product head `b572dbd`; its
`package.json` version is 0.5.0. No user profile, credential, installed package,
or session was read or changed.

**Method:** the host served the real shell, plugin bundles, session, composer,
cards, and interactions. A local proxy forwarded HTTP and WebSocket traffic and
replaced only the plugin notes/history responses with synthetic fixtures. Two
fixtures are hostile: a traversal path and a note with U+202E/U+202C. No API key
or provider credential was configured, so no reviewer or primary model stream
ran. The launch token is not recorded. Authenticated self-check/status/config
reads went through the real host and reported
`authTransport=host-authenticated-connection`, `healthy=true`,
`pluginVersion=runtimeVersion=installedVersion=0.5.0`, and nine registered
routes.

**Acceptance matrix**

| ID | Observable outcome | Evidence | Status |
| --- | --- | --- | --- |
| V1 | Five note cards render on the actual host; Hebrew and Arabic notes read RTL (first character right of the last); the long mixed note wraps and shows the exact path | `actual-host-notes-1280.png`; range 1032 -> 629, 1037 -> 781, 1032 -> 750 | PASS |
| V2 | Explain opens the cached Hebrew explanation inline in RTL with zero explain requests | `actual-host-explanation-1280.png`; `actual-host-actions.json` (explainRequests 0) | PASS |
| V3 | History shows the resolved Hebrew entry, its state, and its Hebrew explanation | `actual-host-history-1280.png` | PASS |
| V4 | Add to chat writes the exact action into the real composer, keeps focus, brings the active count from 5 to 4, enables send, and never sends | `actual-host-add-to-chat-1280.png`; `actual-host-actions.json` (draft exact, transcript 0) | PASS |
| V5 | Thanks, Knew it, and Dismiss each reduce the active count from 5 to 4 with an empty draft, disabled send, and no transcript entry | `actual-host-thanks-1280.png`, `actual-host-knew-it-1280.png`, `actual-host-dismiss-1280.png`; `actual-host-actions.json` | PASS |
| V6 | The traversal card shows the path as plain text, has no Open file link, and Add to chat drafts the action only, never the unsafe path | `actual-host-notes-1280.png`; `actual-host-actions.json` | PASS |
| V7 | The bidi fixture renders without U+202E/U+202C and its draft carries no control; natural RTL notes remain intact | `actual-host-notes-1280.png`; `actual-host-actions.json` | PASS |
| V8 | At 700px the long note wraps, cards and composer stay inside the viewport, and `scrollWidth == innerWidth == 700` | `actual-host-narrow-700.png`; card right 677, composer right 673 | PASS |
| V9 | Authenticated self-check/status/config work through the real host; the recent-check opt-in toggles false -> true -> false and the capability follows | `actual-host-status.json`; `evidence/host-provenance.txt` | PASS |
| V10 | The per-session `status.session.recentChecks` field and session cleanup on the host | None in the host run: no tracked review session exists without a model/credential or a completed agent turn | NOT VERIFIED (unit tests cover it) |
| V11 | A note produced by a real reviewer model reaches the card | Fixtures are injected at the notes route; no live model call ran | NOT VERIFIED |
| V12 | The native desktop window | Only the desktop CLI-served web host was automated | NOT VERIFIED |

Screenshot SHA-256 values and the structured interaction states are in
`evidence/actual-host-actions.json`; the fixture proxy is
`evidence/visual-fixture-proxy.mjs`.

## 7. Not verified and limitations

- D1 and D2 are grounded by deterministic offline tests. The host capture uses
  synthetic notes, so it cannot re-exercise the host parser; it does show that
  safe grounded paths still render and link.
- The per-session recent-check field and session cleanup are covered by
  deterministic unit tests, not by the host run, because the isolated host has
  no tracked review session (no credentials and no completed turn). This is
  reported as NOT VERIFIED at the host level, not as PASS.
- No live reviewer or paid model call was made. Live note delivery and the
  native desktop window remain NOT VERIFIED.
- The report describes the web UI served by the 0.2.1-rc.5 desktop CLI, not a
  native-window capture.

## 8. Security and isolation

- A temporary `DSH_HOME` under a private temp directory, a profile from the
  shipped template, and a plugin symlink to the task worktree.
- No real profile, session, credential, cookie, or installed package was read
  or copied. The ephemeral host token is not in the evidence.
- Fixtures contain no real session text, user data, credentials, or tool output.
- No telemetry, storage, or new network path was added. The only external
  traffic was the host's own update-checker `git ls-remote` against the
  documented public repository; no model provider was contacted.

## 9. Process notes

- Two implementation subagents worked in one isolated worktree; a third
  replacement subagent finished D3/D4 after the first stalled. DSH ran the
  final gates and the host capture.
- All repository-facing prose is English. The product version and release
  artifacts are unchanged.
- The original audit remains the historical record. This report adds the
  functional-fix outcome; it does not rewrite the audit.
