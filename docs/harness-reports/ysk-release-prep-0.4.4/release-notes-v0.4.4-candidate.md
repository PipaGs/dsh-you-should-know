# Publication candidate metadata — v0.4.4

This file is metadata for the reviewers. It is **not** part of the release body.

## Exact publication body

`release-notes-v0.4.4.md` is the complete, exact body for the GitHub Release
`v0.4.4`. It starts at the `## Highlights` heading on line 1 and has no title,
no "candidate"/"proposed" heading, and no status preamble. Publish the file
verbatim, replacing only the verification numbers in the
`## Verification on the merged commit` section with the values measured on the
merged commit.

## Status

**Candidate text, not published.** DSH prepared this body. DSH did not create
the tag, push the tag, create the GitHub Release, or install anything. The
owner/ChatGPT publishes it only after PR #16 is merged and the merged commit is
verified.

The published-release convention of this repository is the GitHub Release body
(compare the existing `v0.4.3` release: Highlights, Install, Verification on the
merged commit).

## Sources for every status claim in the body

| Claim | Source |
|---|---|
| Historical v1 stays 0 PASS / 2 FAIL / 2 SILENT | `docs/harness-reports/ysk-note-voice-live-20261014/final-report.md`; `evidence/note-voice-eval-live-run.json` |
| v2 retrospective: 1 PASS / 1 FAIL / 1 EXPECTED_SILENCE / 1 SILENT_UNKNOWN on preserved text, not a model run | `docs/harness-reports/ysk-note-voice-semantic-20261014/final-report.md` §3, §6, §11; `evidence/retrospective-recalibration-rev2.json` |
| agent-owned FAIL → PASS (one lexical false positive) | same report §3.1, §6 |
| human-owned FAIL → FAIL (substantive attribution gap) | same report §3.2, §11 |
| joint SILENT → EXPECTED_SILENCE (excluded) | same report §3.3, §6 |
| unclear SILENT → SILENT_UNKNOWN (gate not proven) | same report §3.4, §6, §11 |
| `docs/upstream/ledger.json` was not modified by stage 5; `localStatus: adapted` and `liveVerification.status: run-no-pass` retained | same report §12 |
| historical full raw reply not preserved; no re-run | same report §6, §11 |
| no upstream behavioral parity | same report §11; `docs/upstream/ledger.json` `parityNotes` |

## Guarded by test

`test/release-notes-consistency.test.js` (offline, no network) asserts that the
body starts at `## Highlights`, states the historical and v2 statuses, states
that no generated model pass is claimed, states that the historical full raw
reply is absent, records that the ledger was retained rather than edited by
stage 5, and does not contain the earlier false claims ("proxy false positives",
"legitimate silence", or "PR #15 edited the ledger").
