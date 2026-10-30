# Upstream baseline: Claude Code "You should know"

This directory tracks the official Claude Code built-in mod **You should know**
and compares it with this plugin's local implementation, so a future upstream
change can be triaged reproducibly instead of guessed at.

- Machine-readable ledger: [ledger.json](./ledger.json)
- Triage and adoption process: [workflow.md](./workflow.md)
- Source-policy deviation addendum: [addendum-20261030-source-policy-deviation.md](./addendum-20261030-source-policy-deviation.md)
- Raw upstream snapshot and hashes: [evidence/claude-code-upstream-20261014.json](./evidence/claude-code-upstream-20261014.json)
- Committed upstream excerpt for 2.1.288: [../harness-reports/ysk-note-voice-attribution-20261014/evidence/upstream-changelog-20261014.md](../harness-reports/ysk-note-voice-attribution-20261014/evidence/upstream-changelog-20261014.md) (one official sentence; the full retrieved document is observed by hash only and is not committed)

## Local baseline

| Fact | Value |
| --- | --- |
| Repository | PipaGs/dsh-you-should-know |
| Product version | 0.4.6 |
| Reference tag | v0.4.6 |
| Baseline head | 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2 (the main commit this ledger was verified against; it is the v0.4.6 release commit) |
| Release tag | annotated tag v0.4.6 (object 2dd722eb691493281aefa081ebfc722afb7d117f) points at 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2, verified 2026-10-30 with `git for-each-ref`, `git cat-file`, and `git ls-remote --tags`; it points at the baseline head |
| Previous baseline | version 0.4.3, head 746d1caa2101b96c97f85b0a0e387b57e77fc436, annotated tag v0.4.3 (object 7d392bd65e07fdbd42530e56d32698a05edeba52) points at b6a202d00e80e6069c07b03e65034b4280756f1d, not at 746d1caa2101b96c97f85b0a0e387b57e77fc436. The previous ledger recorded the later untagged head 746d1caa (five commits after v0.4.3, contained in v0.4.4); this baseline keeps that distinction explicit |
| Shipped artifact | the v0.4.6 host and browser halves |

## Source policy accepted in Stage 1B

Stage 1B accepted this two-class source policy on 2026-10-30. GitHub tagged
Releases and CHANGELOG.md remain canonical for version and date. Official
Anthropic Claude Code documentation under https://code.claude.com/docs/ is
behavior evidence only.

| Class | Accepted source | Role | May establish version or date |
| --- | --- | --- | --- |
| Release | https://github.com/anthropics/claude-code/releases/tag/<tag> and https://github.com/anthropics/claude-code/blob/<full-40-hex-commit>/CHANGELOG.md | canonical-release-version-date | yes |
| Behavior | https://code.claude.com/docs/ pages | behavior-evidence-only | no |

The exact behavior allowlist is https only, host exactly code.claude.com
(case-insensitive after URL parsing), path starting with /docs/, no userinfo,
no non-default port, no query, no fragment, and no parent path segment
(including encoded %2e%2e). Raw parent segments are rejected before URL
normalization. No other website and no other Anthropic host is accepted.

A docs source record requires id, kind "official-docs-page", url, immutable
false, sha256 (64 lowercase hex of the exact retrieved bytes), and fetchedAt
(ISO UTC). lastModified is optional metadata only; when present the record must
carry lastModifiedIsPublicationProof false, and it never becomes publishedAt or
upstreamDate. A docs record carries no publishedAt.

Re-fetch every cycle and compare sha256 with the previous verified capture. A
changed hash is a new capture with a new fetchedAt. An unchanged hash is not a
new upstream signal. On an unreachable, moved, truncated, rate-limited, or
otherwise unverifiable source, the item and cycle are unknown, never "no
change". The previous verified baseline is retained, and an offline or cached
copy is not a fresh verification.

Security: never send a private project, session, note, prompt, transcript,
credential, or repository content to a public page or search. Never copy
private Claude internals or closed-source code. Use short official excerpts
only.

Stage 1B added no interactive-mode behavior findings. Stage 1C records those
findings in the section below, using the same behavior-only source class.

## Upstream baseline

Captured 2026-10-14 from official Anthropic sources and re-verified 2026-10-30
for release dates and tag identities. The release pages are immutable GitHub
releases; the changelog is pinned to a full commit SHA so the quoted lines stay
verifiable. The 2026-10-14 cycle also read the served changelog page at
code.claude.com, which is outside the written source policy. That deviation is
recorded in the addendum and is not retroactively authorized.

| Source | Pinned to |
| --- | --- |
| [releases/tag/v2.1.287](https://github.com/anthropics/claude-code/releases/tag/v2.1.287) | immutable release, published 2026-10-01T18:00:22Z; tag ref `816ec211a648f17a411f63a45cfd44ddf8db00d9` |
| [releases/tag/v2.1.288](https://github.com/anthropics/claude-code/releases/tag/v2.1.288) | immutable release, published 2026-10-02T20:19:57Z; tag ref `1c229fcd1e1e4e452e29a8f116b45fe4cfe2c528` |
| [releases/tag/v2.1.290](https://github.com/anthropics/claude-code/releases/tag/v2.1.290) | immutable release, published 2026-10-05T23:33:17Z; tag ref `e8ae451830fb8d1d8edf853c7830ff6c650d3ee3` |
| [releases/tag/v2.1.312](https://github.com/anthropics/claude-code/releases/tag/v2.1.312) | coverage boundary, immutable release, published 2026-10-27T20:24:20Z; tag ref `0e1f4789406477380b267a01f3ddd50b0211e5b3` |
| [CHANGELOG.md at db93774](https://github.com/anthropics/claude-code/blob/db93774d73e8fdbaf315a6f4c175ae99ad3d515a/CHANGELOG.md) | commit db93774d73e8fdbaf315a6f4c175ae99ad3d515a (previous cycle baseline; commit date 2026-10-14T02:49:24Z) |
| [changelog.md](https://code.claude.com/docs/en/changelog.md) | served official page, sha256 dfc62da25a39339848ffedb7cf2beadf51f41458d7b681d79d25b22274550d5e, re-read 2026-10-14 for the 2.1.288 voice item; historical source-policy deviation, see the addendum |

The upstream repository reports no detectable license file (the GitHub license
API returned 404 on 2026-10-14), so the baseline quotes only the short official
sentences below and copies no upstream code.

## Seeded parity

| Upstream | Claim | Local status | Disposition |
| --- | --- | --- | --- |
| 2.1.287 (2026-10-01) | A built-in side agent flags important things you or Claude might miss | adapted | applicable (parity present) |
| 2.1.287 (2026-10-01) | Gated to first-party sessions with telemetry on | not-applicable | rejected |
| 2.1.288 (2026-10-02) | Notes name who was responsible: we, the main agent, or you | adapted | applicable (instruction-level adaptation; one bounded live smoke run executed, expected attribution in 0 of 4 cases, status stays adapted) |
| 2.1.290 (2026-10-05) | Notes follow the language setting instead of always English | equivalent | applicable (parity present) |

The exact quotes and the named local evidence for every row live in
[ledger.json](./ledger.json). Every source record also carries an explicit
`sourceRole`: `release` for the canonical version and date sources,
`behavior` for documentation pages, and `historical` for the one preserved
2026-10-14 docs capture. The 2.1.288 row is an instruction-level adaptation:
the trusted base reviewer policy carries the responsibility-attribution rule, but
the reviewer model's live output is nondeterministic and is not asserted to match
upstream behavior. Its scoped acceptance (prompt composition) is recorded and
completed there.

The 2.1.288 row also carries a follow-up evaluation: an opt-in, fail-closed
evaluator with four synthetic responsibility scenarios and deterministic
adjudication ([note-voice-eval.mjs](../../scripts/note-voice-eval.mjs),
[note-voice-eval.test.js](../../test/note-voice-eval.test.js)) plus a manual,
double-gated live runner that injects the configured official DeepSeek route
([note-voice-eval-live.mjs](../../scripts/note-voice-eval-live.mjs),
[note-voice-eval-deepseek.mjs](../../scripts/note-voice-eval-deepseek.mjs)).
The evaluator still opens no provider connection on its own. The runner was
executed once with an explicit owner authorization and four bounded calls: every
call closed, there were no retries, and the observed replies matched the
deterministic expectation in none of the four cases (two attribution mismatches,
two silent). That smoke result is recorded under
[ysk-note-voice-live-20261014](../harness-reports/ysk-note-voice-live-20261014/final-report.md);
it is not parity and the status stays adapted.

The stage-5 semantic review of those four replies
([ysk-note-voice-semantic-20261014](../harness-reports/ysk-note-voice-semantic-20261014/final-report.md))
separates the lexical scores from the semantic reading of the preserved text:
the agent-owned reply is correctly voiced and its historic FAIL is a proxy false
positive, the joint scenario sits outside the policy's selection gate, and the
unclear gate stays unproven. That review changed the offline adjudicator only;
the historic run, its denominators, and this status are unchanged.

## Documented behavior parity (Stage 1C)

Stage 1C captured two official documentation pages on 2026-10-30 and added ten
documented-behavior items. These items are a different class from the versioned
release rows above: each one carries `evidenceClass: "documented-behavior"`, a
`behaviorKey`, and `dedupeAgainst`, and none of them carries
`upstreamVersion`, `upstreamDate`, `publishedAt`, or `changelogTrace`.
A documentation page is behavior evidence only; it never establishes a version
or a publication date.

| Item | Documented behavior | Local status | Disposition |
| --- | --- | --- | --- |
| B-YSK-side-agent-cadence | A side agent rereads the conversation from time to time during a longer task | partial | deferred (turn-end only; mid-task cadence is a future task) |
| B-YSK-side-agent-isolation | A separate same-model request with no tools cannot read files, run commands, or change the main agent | adapted | applicable (separate configured reviewer route; no tools) |
| B-YSK-check-context | A check sends session context with tool results, the mod instructions, and recent notes | adapted | applicable (bounded visible-text excerpt and evidence capsule; no raw tool results) |
| B-YSK-cost-and-prompt-cache | Checks reuse the session prompt cache and count toward usage or cost | not-applicable | rejected (provider cache and billing are outside the plugin seam) |
| B-YSK-note-surface-and-choices | A short note above the prompt offers Learn more with Understood, Knew this already, and Dismiss | partial | deferred (Explain, Knew it, Thanks, Add to chat, Dismiss; no Understood sub-surface) |
| B-YSK-keyboard-shortcuts | A choice is selected by typing its digit alone into an empty prompt | missing | deferred (pointer and focus controls only) |
| B-YSK-chat-in-main-session | Chat in main session quotes the note into the prompt; the main agent sees it only after send | adapted | applicable (Add to chat writes an action draft and never sends) |
| B-YSK-note-memory | Recent notes and known topics persist across sessions and are listed to the side agent | partial | deferred (in-memory per-session state; no file or browser storage) |
| B-YSK-debug-check-visibility | A debug environment variable shows checks as they happen | partial | deferred (bounded status counters and self-check only) |
| B-YSK-post-dismiss-turn-off | A transient Turn off suggestions action appears after Dismiss and clears after 20 seconds | missing | deferred (Dismiss only resolves the note) |

| Documentation source | Capture |
| --- | --- |
| [interactive-mode](https://code.claude.com/docs/en/interactive-mode) | sha256 `29f014fae4fad479919f23fc3cd9a8b6c58af1199272e42fe1695a7e75ca1452`, fetchedAt 2026-10-30T10:30:14Z, 595268 bytes |
| [plugins/mods/overview](https://code.claude.com/docs/en/plugins/mods/overview) | sha256 `8685126f9b50f63d38333793a896158437191dba296966b4d47c6780ed7005d2`, fetchedAt 2026-10-30T10:30:21Z, 338853 bytes |

The hashes cover the exact HTML response bytes for the URL without an anchor.
The committed evidence keeps only short official excerpts and the provenance;
it does not commit a full page. The item-level quotes, local evidence, unknowns,
and testable acceptance live in [ledger.json](./ledger.json). The task report is
[ysk-upstream-behavior-parity-20261030](../harness-reports/ysk-upstream-behavior-parity-20261030/final-report.md).

Release coverage is separate: it remains through v2.1.312. Stage 1C did not check
any release after v2.1.312 and does not extend that boundary.

## Coverage through v2.1.312

The 2026-10-30 check read the published GitHub release bodies for 20 releases
after v2.1.290, from v2.1.291 through v2.1.312 (published 2026-10-27T20:24:20Z;
tag ref 0e1f4789406477380b267a01f3ddd50b0211e5b3). No release body in that range
contains a direct "You should know" line. The tag numbers v2.1.297 and v2.1.298
have no tag or release.

This records only the absence of direct release notes. It does not claim that
upstream behavior did not change: behavior can change without a named release
note, and this check reads release bodies only. The sanitized extract is
[github-releases-2.1.287-2.1.312.json](../harness-reports/ysk-upstream-ledger-correction-20261030/evidence/github-releases-2.1.287-2.1.312.json).

Stage 1C did not check any release after v2.1.312. Its documentation behavior
coverage is recorded separately above and does not extend this release boundary.

## Source-policy deviation

On 2026-10-14 the ledger recorded the 2.1.288 voice item from the served
changelog page at code.claude.com, while [workflow.md](./workflow.md) accepted
only GitHub tagged release notes and CHANGELOG.md. The 2.1.290 item used the
pinned CHANGELOG.md source, and the docs page contained the same line. The page
was used because the GitHub hosts were unreachable that day. This was a process
deviation. The dated English addendum
[addendum-20261030-source-policy-deviation.md](./addendum-20261030-source-policy-deviation.md)
records it. Task 1A re-sourced the active items to immutable GitHub releases and
kept the changelog page as a historical trace.

Stage 1B accepted official code.claude.com documentation as a behavior source
on 2026-10-30, but the 2026-10-14 capture remains a recorded deviation and is
not retroactively authorized. The addendum is preserved unchanged. The
historical docs source is not an active item source, and its fetchedAt is not a
publication date.

## Open unknowns

- How the upstream side agent selects, gates, deduplicates, and formats notes.
  The official text does not describe the algorithm.
- How the upstream mod handles session data under its telemetry gate. Assuming
  it matches this plugin's privacy model would be speculation.
- How often the side agent rereads the conversation ("from time to time") and
  what starts or stops a check. The page gives no interval or scheduler.
- How the note store file is formatted, protected, and retained beyond the
  documented `cleanupPeriodDays` behavior.
- How the upstream side agent is prevented from using tools and how its request
  is isolated. The page states the boundary; the implementation is closed.

## Keeping this current

See [workflow.md](./workflow.md) for the read-only triage pipeline. Every new
official signal is verified against a pinned source, deduplicated against
ledger.json, assessed against named local evidence, and dispositioned. Release
signals stay canonical for version and date. Docs pages are re-fetched every
cycle and serve as behavior evidence only; a changed sha256 is a new capture and
an unchanged hash is not a new signal. Every source record names its
`sourceRole`, and a documented-behavior item names its `behaviorKey`, its
`dedupeAgainst` items, and a testable acceptance when it is a gap. An
unreachable source is recorded as unknown, never as "no change", and the
previous verified baseline stays in place.
