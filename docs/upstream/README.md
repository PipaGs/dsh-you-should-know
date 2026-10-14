# Upstream baseline: Claude Code "You should know"

This directory tracks the official Claude Code built-in mod **You should know**
and compares it with this plugin's local implementation, so a future upstream
change can be triaged reproducibly instead of guessed at.

- Machine-readable ledger: [ledger.json](./ledger.json)
- Triage and adoption process: [workflow.md](./workflow.md)
- Raw upstream snapshot and hashes: [evidence/claude-code-upstream-20261014.json](./evidence/claude-code-upstream-20261014.json)

## Local baseline

| Fact | Value |
| --- | --- |
| Repository | PipaGs/dsh-you-should-know |
| Product version | 0.4.3 |
| Reference tag | v0.4.3 |
| Baseline head | b6a202d00e80e6069c07b03e65034b4280756f1d |
| Shipped artifact | the v0.4.3 host and browser halves; this change adds documentation and one test only |

## Upstream baseline

Captured 2026-10-14 from official Anthropic sources. The release page is an
immutable GitHub release; the changelog is pinned to a full commit SHA so the
quoted lines stay verifiable.

| Source | Pinned to |
| --- | --- |
| [releases/tag/v2.1.287](https://github.com/anthropics/claude-code/releases/tag/v2.1.287) | tag v2.1.287 (immutable, published 2026-10-01) |
| [CHANGELOG.md at db93774](https://github.com/anthropics/claude-code/blob/db93774d73e8fdbaf315a6f4c175ae99ad3d515a/CHANGELOG.md) | commit db93774d73e8fdbaf315a6f4c175ae99ad3d515a |

The upstream repository reports no detectable license file (the GitHub license
API returned 404 on 2026-10-14), so the baseline quotes only the short official
sentences below and copies no upstream code.

## Seeded parity

| Upstream | Claim | Local status | Disposition |
| --- | --- | --- | --- |
| 2.1.287 | A built-in side agent flags important things you or Claude might miss | adapted | applicable (parity present) |
| 2.1.287 | Gated to first-party sessions with telemetry on | not-applicable | rejected |
| 2.1.288 | Notes name who was responsible: we, the main agent, or you | missing | deferred |
| 2.1.290 | Notes follow the language setting instead of always English | equivalent | applicable (parity present) |

The exact quotes and the named local evidence for every row live in
[ledger.json](./ledger.json). The deferred row names its own testable
acceptance there; this baseline change implements no upstream behavior.

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
