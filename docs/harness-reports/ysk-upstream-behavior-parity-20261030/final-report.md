# Final report - ysk-upstream-behavior-parity-20261030

**Status:** READY_FOR_CHATGPT_REVIEW

**Base:** ff220a52a278a4b0b828fefa15a1f5184a9fc943

**Branch:** task/upstream-behavior-parity-20261030

**Product head:** 43a42fe75be9fa6386c9e2a8e49876011397dbc7

**PR:** https://github.com/PipaGs/dsh-you-should-know/pull/26

**Tool:** DeepSeek Harness, Stage 1C. A delegated implementation subagent wrote the
test and ledger core. It stopped mid-task; the parent completed the remaining
policy, documentation, evidence, and report work and will use a separate
independent review subagent. DSH did not merge.

---

## 1. Request and scope

Stage 1C turns the read-only research matrix into a precise documented-behavior
parity ledger. It records source to behavior to local code and test evidence as
a class distinct from the versioned release items, and it adds structural tests
that reject documentation sources as version or publication-date proof.

The task updates the ledger schema to schemaVersion 2, the machine-readable
ledger, the human-readable baseline, the workflow rules, the structural tests,
the task report, and its evidence. It also re-captures the official documentation pages
and updates one stale parity note after re-checking the v0.4.6 code.

Out of scope: product code, UI code, prompts, package.json, scripts, plugin
configuration, functional Stage 2 fixes, and any major persistence, mid-task, or
diagnostics implementation. Product version stays 0.4.6. No tag, release, npm
install or publish, live model call, or merge.

## 2. Preflight facts

| Fact | Value |
| --- | --- |
| Repository | PipaGs/dsh-you-should-know |
| Worktree | .worktrees/task-1c |
| Branch | task/upstream-behavior-parity-20261030 |
| Base commit | ff220a52a278a4b0b828fefa15a1f5184a9fc943 |
| origin/main at preflight | ff220a52a278a4b0b828fefa15a1f5184a9fc943 |
| Product version | 0.4.6 |
| Historical release baseline | 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2, annotated tag v0.4.6 |
| Open PRs at preflight | none |
| Baseline targeted ledger test | 24 pass, 0 fail, exit 0 |
| Baseline full test | 629 pass, 0 fail, exit 0 |
| Baseline check | exit 0 |

The local v0.4.6 release baseline stays the historical tagged head
038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2. Current main is the untagged
ff220a52a278a4b0b828fefa15a1f5184a9fc943. This report does not replace the
historical reference with an artificial untagged head. The main worktree and its
untracked files were not touched.

## 3. Captured documentation

Two official pages were fetched independently in this task. The hashes cover the
exact HTML response bytes for the exact URL without an anchor. The capture time
is the UTC completion time of the fetch.

| Source id | URL | sha256 | fetchedAt | Bytes |
| --- | --- | --- | --- | --- |
| claude-code-docs-interactive-mode-20261030 | https://code.claude.com/docs/en/interactive-mode | 29f014fae4fad479919f23fc3cd9a8b6c58af1199272e42fe1695a7e75ca1452 | 2026-10-30T10:30:14Z | 595268 |
| claude-code-docs-mods-overview-20261030 | https://code.claude.com/docs/en/plugins/mods/overview | 8685126f9b50f63d38333793a896158437191dba296966b4d47c6780ed7005d2 | 2026-10-30T10:30:21Z | 338853 |

Both pages returned HTTP 200. The committed evidence keeps only short official
excerpts and the provenance. It does not commit a full page, a raw response
body, or upstream code.

Short excerpts used by the behavior items include:

- "a side agent rereads the conversation from time to time as Claude works through a longer task"
- "The side agent is a separate request to the same model and has no tools"
- "The conversation part is read from the session's prompt cache on the same terms as Claude's own next request."
- "Type the choice's digit on its own into an empty prompt input."

The docs pages never supply a release version, a publication date, or a
`publishedAt`. A docs item is behavior evidence only.

## 4. Documented behavior matrix

| Item | Documented behavior | Local status | Disposition | Local evidence |
| --- | --- | --- | --- | --- |
| B-YSK-side-agent-cadence | Rereads the conversation from time to time during a longer task | partial | deferred to a future mid-task cadence task | turn/end and completed-reason gate; no mid-task scheduler |
| B-YSK-side-agent-isolation | Separate same-model request with no tools; cannot read, run, or change the main agent | adapted | applicable | separate reviewer route; no tool definitions; invariant scan |
| B-YSK-check-context | Sends session context with tool results, mod instructions, and recent notes | adapted | applicable | bounded visible-text excerpt plus evidence capsule; no raw tool results |
| B-YSK-cost-and-prompt-cache | Reuses the session prompt cache; checks count toward usage or cost | not-applicable | rejected | provider cache and billing are outside the plugin seam; local budget and token cap |
| B-YSK-note-surface-and-choices | Short note above the prompt with Learn more, Knew this already, and Dismiss | partial | deferred to a future note-choices task | card with Explain, Knew it, Thanks, Add to chat, Dismiss; no Understood sub-surface |
| B-YSK-keyboard-shortcuts | Digit alone in an empty prompt selects a choice | missing | deferred to a future keyboard-accessibility task | pointer and focus buttons only |
| B-YSK-chat-in-main-session | Quotes the note into the prompt; the main agent sees it only after send | adapted | applicable | action-first draft; with an action present, the finding prose is not inserted; the note moves to History; the draft is never sent |
| B-YSK-note-memory | Recent notes and known topics persist across sessions and are listed to the side agent | partial | deferred to a future persistence task | in-memory per-session state; no file or browser storage |
| B-YSK-debug-check-visibility | A debug variable shows checks as they happen | partial | deferred to a future diagnostics task | bounded status counters and self-check only |
| B-YSK-post-dismiss-turn-off | A transient Turn off suggestions action after Dismiss, clearing after 20 seconds | missing | deferred to a future UI task | Dismiss only resolves the note |

The six allowed statuses are preserved: `equivalent`, `adapted`, `partial`,
`missing`, `not-applicable`, and `unknown`. The ten documented-behavior items
use four of them: `adapted`, `partial`, `missing`, and `not-applicable`.
`equivalent` appears on a release item. `unknown` stays a first-class status
and the open unknowns are recorded separately; it is not used to hide an
unverified claim.

Every `partial` or `missing` item, and every `deferred` item, carries a
testable acceptance and its own future scope. `adapted` and
`not-applicable` items carry a grounded reason. No behavior is forced into the
implementation.

`B-YSK-chat-in-main-session` is an intentional action-first adaptation, not an
exact note quote. Upstream Chat in main session puts the human-readable note
into the prompt input. Local Add to chat prefers the agent-facing
`note.action`, so, when an action is present, the draft omits the finding
prose; the resolved note leaves
the active card and remains in History. A `File:` line is added only when the
action does not already name the source, and only a finding without an action
falls back to an imperative wrapper around the note. The draft is written with
`setDraft`, never sent, and reaches the main agent only if the human submits
it. `test/client-ui.test.js` asserts that the action is the draft, the finding
prose is not inserted, and no message is sent. The adapted status is therefore
justified by a deliberate action-first deviation, not by claiming an exact note
quote.

## 5. Existing item updates

- `U-2.1.287-builtin-side-agent`: the stale "verified on the shipped v0.4.3
  code" parity note is replaced with "re-verified on the shipped v0.4.6 code on
  2026-10-30". The quote, claim, status, disposition, and release date are
  unchanged. `lib/client.js` is added to the named local evidence, and the two
  captured docs pages are linked as supporting behavior sources.
- `U-2.1.287-telemetry-gate`: the parity note gains the documented gate detail
  (direct API connection, feature-flag and telemetry availability, gateways and
  helper-key sessions excluded). The release quote, claim, date, status,
  disposition, and rejection reason are unchanged. The status stays
  `not-applicable` because the local plugin has no telemetry and no first-party
  session concept.
- `U-2.1.288-note-voice` and `U-2.1.290-language-setting` gain only the
  `evidenceClass` field. Their captured quotes, dates, statuses, and long
  parity notes are unchanged.
- The ten behavior items are deduplicated against
  `U-2.1.287-builtin-side-agent`. No behavior item repeats an existing id or
  wording.

## 6. Release coverage boundary

Release coverage remains through v2.1.312 (published 2026-10-27T20:24:20Z; tag
ref 0e1f4789406477380b267a01f3ddd50b0211e5b3). Stage 1C did not check any
release after v2.1.312. It adds documentation behavior coverage only. The
ledger records the two coverage classes separately and sets
`newerReleasesChecked: false`.

## 7. Open unknowns

The ledger adds three unknowns without reverse engineering:

- `upstream-check-cadence`: how often the side agent rereads ("from time to
  time") and what starts or stops a check.
- `upstream-note-storage-privacy`: the note store format, protection, and
  retention beyond the documented `cleanupPeriodDays` behavior.
- `upstream-side-agent-tool-internals`: how the upstream side agent is kept
  tool-free and how its request is isolated.

The two earlier unknowns (selection algorithm and data handling) are preserved.

## 8. Tests

| Check | Baseline | Final | Exit |
| --- | --- | --- | --- |
| node --test test/upstream-ledger.test.js | 24 pass, 0 fail | 30 pass, 0 fail | 0 |
| npm test | 629 pass, 0 fail | 635 pass, 0 fail | 0 |
| node --test test/task-evidence-paths.test.js | 1 pass, 0 fail | 1 pass, 0 fail | 0 |
| npm run check | exit 0 | exit 0 | 0 |
| git diff --check | exit 0 | exit 0 | 0 |

The new tests prove that:

- every new ledger entry is structurally valid and names local evidence that
  exists;
- every docs source has sourceRole `behavior` and complete provenance
  (URL, sha256, fetchedAt, bytes, HTTP 200);
- docs sources cannot carry or establish `publishedAt`, `upstreamVersion`,
  `upstreamDate`, or `version`;
- the historical 2026-10-14 evidence, the addendum, the Stage 1A evidence, and
  the Stage 1B report stay byte-identical to the base;
- the behavior items are deduplicated by `behaviorKey` and by
  `dedupeAgainst`;
- the six allowed statuses and the acceptance rules still hold;
- the docs capture evidence matches the ledger provenance and the item quotes
  are traceable to short captured excerpts;
- the chat handoff parity note records the action-first draft, the finding
  prose that is not inserted, the note moving to History, and the human-only
  send; the cited client test asserts those facts.

Raw output is in the evidence directory.

## 9. Security, privacy, and content

- No `lib/`, `scripts/`, `prompt`, `package.json`, `cordis.patch.yml`, or
  plugin-config change.
- No telemetry, no steering, no injection, no transcript write, and no path to
  the primary agent.
- No private project, session, note, prompt, transcript, credential, or
  repository content was sent to a public page or search.
- Every added or changed file was scanned for absolute home paths, credentials,
  bearer tokens, private keys, plain-HTTP source URLs, and non-English prose.
  The evidence keeps only short official excerpts and no raw page.
- Evidence logs were sanitized before commit.

## 10. Invariants

- Product version stays 0.4.6.
- The historical release baseline stays 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2,
  the annotated v0.4.6 tag target.
- The 2026-10-14 addendum and its raw evidence are byte-identical.
- The previous Stage 1A and Stage 1B task reports are byte-identical.
- No tag, release, npm install or publish, live model call, or merge.
- DSH must not merge this PR. ChatGPT reviews the code and evidence independently.

## 11. Independent review

APPROVE from separate read-only review subagents that did not write the
changes.

The first review of the pre-fix tree found no BLOCKER, HIGH, or MEDIUM issue.
It found six LOW and four NIT issues, all folded into the product commit:

1. the report status count now says the ten behavior items use four statuses;
2. `content-scan.txt` recomputes the evidence byte count;
3. `security-scan.txt` covers the full 18-file PR set;
4. the six-status test reads the ledger and workflow instead of a literal Set;
5. `supportingBehaviorSourceIds` is documented and validated;
6. the Understood excerpt is captured and traceable;
7. normalization names ASCII apostrophe normalization;
8. the duplicate Stage 1A evidence path alias is removed;
9. the schema version is 2 for the additive source-role and behavior-class
   fields;
10. the report placeholders are filled at handoff.

The re-review of the fix commit confirmed nine fixes and found one new LOW: the
new Understood excerpt carried a terminal period that the page does not have.
The period was dropped from both the capture and the item, and the targeted
ledger test stayed green. That satisfies the conditional approval. Residual
risk: quote traceability is anchored to the committed capture, so a fabricated
excerpt plus a matching quote would pass; the independent reviewer verified the
excerpts against the live pages, and the pinned sha256 is the anchor for a
future re-capture.

ChatGPT's independent PR review then returned CHANGES_REQUIRED on head
de37f8e. It found that `B-YSK-chat-in-main-session` omitted a material content
difference: upstream Chat in main session quotes the human-readable note, while
local Add to chat prefers the agent-facing `note.action`. The fix updates the
ledger parity note, the README matrix, and this report to state the action-first
draft, the finding prose that is not inserted when an action is present, the
no-action fallback, the note moving to History, and the human-only send. It adds
a targeted ledger test that rejects the old note-quote wording and requires the
three client assertions. A second DSH review approved the fix after one MEDIUM
finding (an invented "stays on the card" clause) and one LOW finding (a
keyword-only test) were corrected.

## 12. Limitations

- Documentation behavior is described for the interactive-mode page captured on
  2026-10-30. A later page change is a new capture, not a silent update.
- Page text does not disclose the exact check scheduler, note-store format, or
  tool-isolation internals; those stay unknown.
- Provider prompt-cache and billing behavior is not comparable across providers
  and is recorded as not-applicable.
- The local reviewer route is separately configured rather than the same model
  as the main session; that difference is recorded as adapted.
- The release coverage boundary is not extended, and no release after v2.1.312
  is claimed.
- The delegated implementation subagent stopped mid-task; the parent finished
  the remaining work. An independent review subagent reviews the final tree.

## 13. Evidence index

- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/docs-captures-20261030.json
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/baseline-meta.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/test-run-baseline-targeted.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/test-run-baseline-full.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/test-run-red.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/test-run-targeted.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/test-run-full.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/check-baseline.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/check.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/diff-check.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/security-scan.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/content-scan.txt
- docs/harness-reports/ysk-upstream-behavior-parity-20261030/evidence/run-meta.txt
