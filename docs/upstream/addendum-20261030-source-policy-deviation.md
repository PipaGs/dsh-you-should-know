# Addendum - source-policy deviation on 2026-10-14

This is an addendum to the upstream records dated 2026-10-14. It does not edit
the original artifacts. It records a process deviation and the corrections made
by task `ysk-upstream-ledger-correction-20261030` (Task 1A).

## Original artifacts

- `docs/upstream/workflow.md`, section "Cadence and inputs", as of 2026-10-14.
- `docs/upstream/ledger.json`, generated at 2026-10-14T13:14:49Z.
- `docs/upstream/evidence/claude-code-upstream-20261014.json`, fetched at
  2026-10-14T09:54:42Z; its bytes have sha256
  `c5fac2b1502d8a221ec4a7e229012c645f84be0d9310791173af84031e809d7a`.
- `test/upstream-ledger.test.js` as of 2026-10-14.

## What the written policy said

`workflow.md` accepted only official Anthropic pages under
`https://github.com/anthropics/claude-code/`: the tagged release notes and
`CHANGELOG.md`. The policy did not list `https://code.claude.com/docs/`.

## What the 2026-10-14 cycle did

The cycle recorded the 2.1.288 voice item from
`https://code.claude.com/docs/en/changelog.md`. That source was fetched at
2026-10-14T09:54:42Z and had sha256
`dfc62da25a39339848ffedb7cf2beadf51f41458d7b681d79d25b22274550d5e`.
The 2.1.290 language item used the pinned `CHANGELOG.md` source
(`claude-code-changelog-main` at commit db93774d73e8fdbaf315a6f4c175ae99ad3d515a),
and the docs page also contained the same line.

The ledger gave both items `upstreamDate: "2026-10-14"`. That was the fetch
day, not the GitHub release date. The immutable GitHub releases were published
on 2026-10-02 and 2026-10-05.

`test/upstream-ledger.test.js` accepted `https://code.claude.com/docs/` as an
official host. That test allowance let the docs-page source pass even though
`workflow.md` did not accept it. The ledger and the test therefore disagreed
with the written policy.

## Deviation

Reading the docs page on 2026-10-14 was a process deviation. The GitHub hosts
were unreachable from that environment, and the served official changelog page
was the reachable fallback. The evidence snapshot records that outage. The
deviation is real, and the original bytes stay as captured.

This addendum does not retroactively authorize the docs page as an accepted
source. It records the deviation so a later policy decision can be made on the
evidence.

## Correction in Task 1A

Task 1A made these changes:

- Added immutable GitHub release sources for v2.1.288 and v2.1.290:
  - `https://github.com/anthropics/claude-code/releases/tag/v2.1.288`,
    published 2026-10-02T20:19:57Z, tag ref
    `1c229fcd1e1e4e452e29a8f116b45fe4cfe2c528`;
  - `https://github.com/anthropics/claude-code/releases/tag/v2.1.290`,
    published 2026-10-05T23:33:17Z, tag ref
    `e8ae451830fb8d1d8edf853c7830ff6c650d3ee3`.
- Corrected `upstreamDate` to the published dates: 2026-10-02 for 2.1.288 and
  2026-10-05 for 2.1.290. The earlier `fetchedAt` value on the historical
  docs-page source stays in place.
- Re-sourced the active items to the immutable GitHub releases. The docs page
  remains as a `historicalOnly` source with a `policyDeviation` marker, and each
  item keeps a `changelogTrace` to its captured line.
- Kept the workflow policy text unchanged and added a "Known source-policy
  deviation" note that points to this addendum.
- Changed the structural test so a `code.claude.com/docs/` source is accepted
  only when it is this recorded historical deviation. A new docs source now
  fails unless a later policy change admits it.
- Recorded the open policy question as `stage-1b-official-docs-source-policy`
  in `ledger.json`, status `deferred-to-stage-1b`.

## What did not change

- The raw evidence file `docs/upstream/evidence/claude-code-upstream-20261014.json`
  is byte-identical to its 2026-10-14 capture. Its sha256 is still
  `c5fac2b1502d8a221ec4a7e229012c645f84be0d9310791173af84031e809d7a`.
- The original docs-page capture hash `dfc62da2...` and its matched lines stay
  in the ledger source entry.
- `workflow.md` still accepts only GitHub tagged release notes and
  `CHANGELOG.md`.
- The product version stays 0.4.6. No product source, prompt, config, or
  `package.json` file changed.

## Stage 1B

The decision whether to accept official `code.claude.com` behavioral
documentation is deferred to Stage 1B. Task 1A does not add a new docs-page
ledger item and does not change the source policy.

## References

- [AGENTS.md](../../AGENTS.md), "Historical artifacts and corrections".
- [workflow.md](./workflow.md), "Cadence and inputs" and "Known source-policy
  deviation".
- [README.md](./README.md), "Source-policy deviation".
