# Upstream baseline: Claude Code "You should know"

This directory tracks the official Claude Code built-in mod **You should know**
and compares it with this plugin's local implementation, so a future upstream
change can be triaged reproducibly instead of guessed at.

- Machine-readable ledger: [ledger.json](./ledger.json)
- Triage and adoption process: [workflow.md](./workflow.md)
- Raw upstream snapshot and hashes: [evidence/claude-code-upstream-20261014.json](./evidence/claude-code-upstream-20261014.json)
- Committed upstream excerpt for 2.1.288: [../harness-reports/ysk-note-voice-attribution-20261014/evidence/upstream-changelog-20261014.md](../harness-reports/ysk-note-voice-attribution-20261014/evidence/upstream-changelog-20261014.md) (one official sentence; the full retrieved document is observed by hash only and is not committed)

## Local baseline

| Fact | Value |
| --- | --- |
| Repository | PipaGs/dsh-you-should-know |
| Product version | 0.4.3 |
| Reference tag | v0.4.3 |
| Baseline head | 746d1caa2101b96c97f85b0a0e387b57e77fc436 (the head this ledger was generated against, merged main after PR #13) |
| Release tag | annotated tag v0.4.3 (object 7d392bd65e07fdbd42530e56d32698a05edeba52) points at b6a202d00e80e6069c07b03e65034b4280756f1d, verified 2026-10-14 with `git for-each-ref` and `git ls-remote --tags`; it does not point at the baseline head |
| Shipped artifact | the v0.4.3 host and browser halves; the 2.1.288 voice rule adds trusted instruction text and one test only |

## Upstream baseline

Captured 2026-10-14 from official Anthropic sources. The release page is an
immutable GitHub release; the changelog is pinned to a full commit SHA so the
quoted lines stay verifiable.

| Source | Pinned to |
| --- | --- |
| [releases/tag/v2.1.287](https://github.com/anthropics/claude-code/releases/tag/v2.1.287) | tag v2.1.287 (immutable, published 2026-10-01) |
| [CHANGELOG.md at db93774](https://github.com/anthropics/claude-code/blob/db93774d73e8fdbaf315a6f4c175ae99ad3d515a/CHANGELOG.md) | commit db93774d73e8fdbaf315a6f4c175ae99ad3d515a (previous cycle baseline) |
| [changelog.md](https://code.claude.com/docs/en/changelog.md) | served official page, sha256 dfc62da25a39339848ffedb7cf2beadf51f41458d7b681d79d25b22274550d5e, re-read 2026-10-14 for the 2.1.288 voice item |

The upstream repository reports no detectable license file (the GitHub license
API returned 404 on 2026-10-14), so the baseline quotes only the short official
sentences below and copies no upstream code.

## Seeded parity

| Upstream | Claim | Local status | Disposition |
| --- | --- | --- | --- |
| 2.1.287 | A built-in side agent flags important things you or Claude might miss | adapted | applicable (parity present) |
| 2.1.287 | Gated to first-party sessions with telemetry on | not-applicable | rejected |
| 2.1.288 | Notes name who was responsible: we, the main agent, or you | adapted | applicable (instruction-level adaptation; one bounded live smoke run executed, expected attribution in 0 of 4 cases, status stays adapted) |
| 2.1.290 | Notes follow the language setting instead of always English | equivalent | applicable (parity present) |

The exact quotes and the named local evidence for every row live in
[ledger.json](./ledger.json). The 2.1.288 row is an instruction-level adaptation:
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

## Open unknowns

- How the upstream side agent selects, gates, deduplicates, and formats notes.
  The official text does not describe the algorithm.
- How the upstream mod handles session data under its telemetry gate. Assuming
  it matches this plugin's privacy model would be speculation.

## Keeping this current

See [workflow.md](./workflow.md) for the read-only triage pipeline. Every new
official signal is verified against a pinned source, deduplicated against
ledger.json, assessed against named local evidence, and dispositioned. An
unreachable source is recorded as unknown, never as "no change".
