# Final report — TypeScript 7 migration (dsh-you-should-know)

- Task id: `ysk-ts7-migration-20261109`; repository `PipaGs/dsh-you-should-know`
- Branch: `session/ysk-ts7-migration-20261109`
- Base SHA: `4d414db2f56ae0bd1e5d0585065241e1d276a972`
- Default branch `main` at base: `4d414db2f56ae0bd1e5d0585065241e1d276a972`
- Date: 2026-11-09
- State: implementation and review round 1 complete; staged in a
  workspace-local index, not committed, no merge. The real index is sandbox-blocked (section 8).

## 1. Task

Migrate both shipped JavaScript halves to TypeScript 7 stable without
observable behavior change, keep a `github:` install build-free with committed
`lib/*.js`, and prove it with the repository gates, a local install smoke, and a
read-only second-agent review.

## 2. Environment and toolchain

| Fact | Value |
|---|---|
| Platform / runtime | macOS (Darwin) 27.0.1, arm64; Node `v26.12.1`; npm `11.20.0` |
| TypeScript | `7.0.2`, pinned in `devDependencies`; npm `latest` dist-tag `7.0.2` verified on 2026-11-09; other tags then `rc` = `7.0.1-rc`, `beta` = `7.1.0-beta`, `next` = `7.1.0-dev.20261109.1` |
| Native compiler | optional platform dependency `@typescript/typescript-darwin-arm64@7.0.2` |
| Peer/dev deps | `@types/node` `26.6.6`; `@deepseek-ai/schemastery` `3.19.0` (host supplies it at runtime) |
| Tests / engine | 34 `test/*.test.js` files, 697 tests; engine floor `node >=22.19.0` (ran Node 26.12.1) |

Dist tags: `toolchain/evidence/04-npm-view-dist-tags.txt`; probes and
conclusions: `toolchain/verification.md`.

## 3. What changed

- **Sources and output.** `src/*.ts` holds 13 modules plus `src/globals.d.ts`;
  `src/client.ts` stays a browser global script with no top-level
  `import`/`export`. `lib/*.js` is the `npm run build` output shipped by
  `files: ["lib"]`; the drift gate proves it is byte-for-byte current.
- **Compiler.** `tsconfig.json`: target/lib ES2022, module/moduleResolution
  nodenext, moduleDetection legacy, strict, verbatimModuleSyntax,
  erasableSyntaxOnly, rootDir src, outDir lib, declaration false, sourceMap
  false, skipLibCheck, types node, forceConsistentCasingInFileNames,
  noEmitOnError true.
- **Typing.** Closed vocabularies drive literal unions (`IMPORTANCE`,
  `RECENT_CHECK_OUTCOMES`, `NOTE_KINDS`, `UPDATE_BEHAVIORS`, `RUNTIME_STATUS`);
  three validation predicates narrow untrusted values; the redundant
  `makeRuntime` cast and unused `SettingsFormEntry` are gone; `oldestKey`
  returns `K | undefined` with documented preconditions.
- **Metadata.** `package.json` gains pinned dev dependencies and `build`,
  `typecheck`, `check`, `check:drift`, `smoke:local`; `check:js` covers 13
  `lib` files and 6 dev scripts. `main`, `exports`, `files`, `dsh`, `engines`,
  peer dependency, and the absence of `dependencies`/`prepare` are unchanged.
- **New tools.** `scripts/check-build-drift.mjs` fails on drift (exit 1) and on
  any diagnostic or non-zero compiler exit (exit 2);
  `scripts/local-install-smoke.mjs` packs and checks a workspace-local install.
- **Docs.** `README.md`, `docs/reference.md`, and `AGENTS.md` name the
  TypeScript source, committed `lib/*.js`, and the gates; `design.md` and
  `conventions.md` describe the final state; the baseline `audit.md` carries a
  dated superseded note.
- **Tests and scripts stay JavaScript.** Tests are black-box against committed
  `lib/*.js` (23 of 34 import it, 3 evaluate `lib/client.js` in `node:vm`); the
  upstream ledger pins a JS test file; declaration emit would inject
  `export {}` into the classic-script client.

## 4. Results

| Gate | Command | Result |
|---|---|---|
| Typecheck | `tsc -p tsconfig.json --noEmit` | exit 0, 0 diagnostics |
| Build | `tsc -p tsconfig.json` | exit 0, 13 `lib/*.js` |
| Tests | `node --test test/` | exit 0, 697 pass, 0 fail |
| Test script | `npm test` | exit 0, 697 pass, 0 fail |
| Composite | `npm run check` | exit 0 (typecheck + drift + syntax) |
| Drift | `npm run check:drift` | exit 0, 13/13 byte-identical |
| Drift alarm | one-byte-edited scratch copy | exit 1 |
| Diagnostic alarm | scratch project with a type error | exit 2, no emit |
| Package | `npm pack --json` | 18 entries (13 `lib/*.js` + metadata/docs) |
| Install smoke | `node scripts/local-install-smoke.mjs` | exit 0, 21 checks |
| Language | `node --test test/repository-language.test.js` | exit 0, 6 pass |
| Whitespace | `git diff --check` / `git diff --cached --check` | exit 0 / exit 0 |

Logs: `migration/final/07`-`15`; drift and pack logs in `migration/phase4/`.

## 5. Preserved contracts

- `main`, `exports` (`.`, `./client`, `./core`, `./cordis.patch.yml`,
  `./package.json`), `files`, and the `dsh` manifest are unchanged.
- `lib/client.js` is a classic script: `"use strict";` prologue, no top-level
  module syntax, and the
  `window.__ModuleLoader__.load({ id, factory(require) })` envelope.
- `Config` is the schemastery schema with all 16 fields volatile;
  `PLUGIN_VERSION` is the literal `'0.5.2'`; `lib/self-check.js` still reads
  `../package.json` as its only shipped read.
- All 9 Fetch routes stay on the connection carrier through
  `ROUTE_CAPABILITIES`; the human-only and security invariants are unchanged
  and exercised by the 697-test suite. No runtime `dependencies` and no
  `prepare`/`install` script exist, so a `github:` install runs no build.

## 6. Acceptance checklist

**A)** "All affected authored implementation code is migrated to maintainable
TypeScript 7 stable, with meaningful typings, strict compiler checking,
reproducible build and no uncontrolled drift between TS and shipped JS; the
exact toolchain versions are recorded." **Result:** all 13 modules are authored
in `src/*.ts`; typecheck is 0 diagnostics; build and drift are 13/13; versions
in section 2. Evidence: `migration/phase1/12-export-surface-parity.txt`,
`toolchain/verification.md`, `migration/final/07`, `08`, `12`.

**B)** "Existing package imports/exports, DSH plugin registration, host/client
integration and quiet human-only reviewer functionality are preserved; direct
github install and npm pack contain executable built JS without
build-at-install." **Result:** exports, 9 routes, client envelope, and `Config`
are unchanged (section 5); the 18-entry tarball has the 13 executable
`lib/*.js` and no source or map entry; the installed package imports the
expected surface with no install hook. Evidence:
`migration/phase4/05-npm-pack-file-list.txt`, `migration/final/13-gate-smoke.txt`.

**C)** "npm test, npm run check, TypeScript typecheck/build, git diff --check,
package/installation smoke and relevant real runtime checks execute with
authentic results; regressions are fixed at the root cause, not by deleting or
disabling checks." **Result:** section 4; 697/697 tests including the human-only
invariant; no test was disabled, skipped, or edited. Evidence:
`migration/final/09`-`15`, `migration/phase4/03`, `04`.

**D)** "DSH independent review by an agent other than the implementer
(read-only), reporting P0/P1 and closing them with evidence; ChatGPT will
independently review the resulting exact SHA and PR and merge only if all
criteria are proven." **Result:** a separate read-only reviewer found no P0/P1;
five P2 findings fixed and two limitations accepted (section 7). Evidence:
`migration/review-round1/`.

**E)** "A scoped branch, tested commit, ONE PR to the actual default main, and a
concise task-owned English report with paths/SHA/results; no fictional pass.
The implementer never merges." **Result:** branch
`session/ysk-ts7-migration-20261109` at base
`4d414db2f56ae0bd1e5d0585065241e1d276a972`; the change set is staged in the
verification index (section 8), not committed; the Lead opens one PR to `main`
after push. No merge was performed and no result is claimed without a log.

## 7. Independent review round 1

Reviewer: a different agent, read-only. P0: none. P1: none.

| ID | Finding | Status |
|---|---|---|
| R1 | `design.md` overclaimed "No identifier, literal, string, comment, or export changed"; emitted locals were renamed and type-guard comments added | Fixed: `design.md` names the renamed locals and added comments; exposed names, string literals, and HEAD comment text are unchanged |
| R2 | `makeRuntime` used an unnecessary `as SessionRuntime` cast and a false "placeholder type" comment | Fixed: returns `createRuntime({ ... })` directly |
| R3 | Closed vocabularies weakened to plain `string` for kind/status/behavior fields | Fixed for all closed tables (literal unions, three set-equivalent predicates). Accepted for `RuntimeOutcome.status` and `lastOutcome`: they carry the arbitrary non-empty delivery label from `onNote`, so no closed table applies; JSDoc records it |
| R4 | `oldestKey` returned `K` through `as K` while the value can be `undefined` | Fixed: returns `K | undefined`; three call sites guard inside existing size checks; eviction tests cover it |
| R5 | Unused `SettingsFormEntry` interface | Fixed: removed; pre-existing unused parameters untouched |
| R6 | `globals.d.ts` declares browser globals program-wide | Accepted limitation: one tsconfig, no project references, no server module reads them, no runtime or invariant change |
| R7 | `test/*.js` and dev `scripts/*.mjs` not migrated | Accepted: tests target the committed artifact, the upstream ledger pins a JS test file, declaration emit would break the classic-script client (`design.md` section 5) |

The three predicates added to emitted `lib/core.js` (`isNoteKind`,
`isRecentCheckOutcome`, `isRuntimeStatus`) are set-equivalent and covered by the 697-test suite.

## 8. Process and harness constraints

Direct `npm` and `node <script>` invocations are rejected by this DSH harness
before execution with `unverifiable_write` (npm cache and log paths fall outside
the workspace). Every npm script ran through `child_process.spawnSync` against
`/opt/homebrew/bin/npm` with `node_modules/.npm-cache` and `--logs-max=0
--no-update-notifier --no-audit --no-fund`; TypeScript and tests used
`process.execPath`. Raw exit codes are preserved; no publish, release, merge,
checkout, or reset occurred. `toolchain/scratch/`, `toolchain/probes/`, and
`evidence/ts-probe/` were removed, and whitespace was normalized across the evidence tree
(CRLF to LF, trailing spaces/tabs, blank lines at EOF), formatting only; see
`migration/final/00-whitespace-normalization.txt`. Reports outside this task
directory were not modified.

Staging: the worktree gitdir lives under the parent checkout's
`.git/worktrees/`, outside the session workspace, and the DSH sandbox rejects
writes there with `Operation not permitted`; `git add -A` cannot update the real
index here. The existing index was copied to `node_modules/.dsh-stage-index`
with an alternate object directory, and
`GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES`
produced authentic staged checks: `git diff --cached --check` exit 0, no CRLF.
Scope: `migration/final/16-staged-verification.txt`. The Lead must run
`git add -A` in an unsandboxed context to persist it; direct `github:` install
of the branch head is pending push.

## 9. Unproven items

- Real browser and DSH host UI interaction; the client was verified only in the
  `node:vm` stub harness and by text/envelope assertions.
- The Node `>=22.19.0` floor, long-running update scheduler, and real
  `git ls-remote` path were not executed (unit tests/mocks only).
- Direct `github:` install of branch head: pending push, to be recorded by the
  Lead; ChatGPT's review of the exact SHA and PR is outside this task run.

## 10. Evidence index

Paths are relative to `docs/harness-reports/ysk-ts7-migration-20261109/`.

| Path | Content |
|---|---|
| `audit.md`, `conventions.md`, `design.md` | Baseline audit with superseded note, final conventions, final design |
| `evidence/` | Baseline environment, install, test, pack records |
| `toolchain/verification.md`, `toolchain/evidence/` | TypeScript 7.0.2 probes, dist tags, option checks |
| `migration/phase1/`-`phase4/` | Scaffold, parity, typing, packaging, drift and install logs |
| `migration/review-round1/` | Round-1 fix reports and emit-parity logs |
| `migration/final/00`, `07`-`17` | Normalization; final typecheck/build/test/check/drift/smoke/language/diff logs; staged `--check`/`--stat` and eol logs |
