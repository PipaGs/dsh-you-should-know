# Phase 4 — packaging and documentation report

- Task: `ysk-ts7-migration-20261109`, phase 4
- Date: 2026-11-09
- Base HEAD: `4d414db2f56ae0bd1e5d0585065241e1d276a972`
- Worktree state: the migration is uncommitted by instruction. `src/`, `lib/`,
  `tsconfig.json`, the new scripts, and the task report directory are present in
  the working tree; no commit, push, checkout, or reset was run.
- Raw evidence: files `01`–`14` in this directory.

## 1. Scope

Phase 4 closes the TypeScript 7 migration at the packaging and documentation
surface:

1. `tsconfig.json` sets `noEmitOnError: true`.
2. `scripts/check-build-drift.mjs` treats a compiler diagnostic or a non-zero
   `tsc` exit as a failure.
3. `scripts/local-install-smoke.mjs` proves the committed-build distribution in a
   workspace-local scratch consumer.
4. `package.json` gains the `smoke:local` script only.
5. `README.md`, `docs/reference.md`, `AGENTS.md`, and `design.md` describe the
   final TypeScript reality.

No runtime dependency was added, and no `prepare`, `install`, or `postinstall`
script exists.

## 2. Changes by file

| File | Change |
|---|---|
| `tsconfig.json` | Added `"noEmitOnError": true`; every other option unchanged |
| `scripts/check-build-drift.mjs` | Removed the `--noEmitOnError false` override; a diagnostic or non-zero compiler exit now returns exit 2 before any comparison; added an optional `--tsconfig` argument used to prove the diagnostic alarm |
| `scripts/local-install-smoke.mjs` | New dev-only script: packs the tree, checks the tarball file list, installs into a scratch consumer, and checks the installed exports, `Config` schema, browser envelope, and absent install hooks; an optional install-spec argument runs the same runtime assertions against that spec |
| `package.json` | Added `"smoke:local": "node scripts/local-install-smoke.mjs"`; `main`, `exports`, `files`, `dsh`, `engines`, `test`, `check`, `check:js`, `check:drift`, `build`, `typecheck`, `smoke:install`, the eval scripts, and `devDependencies` are unchanged |
| `README.md` | Status line, install section, and development section now describe authored TypeScript in `src/`, TypeScript 7.0.2 pinned and verified against the npm `latest` dist-tag, the committed generated `lib/*.js`, and the verify commands |
| `docs/reference.md` | Installation attribution, the restart line, and the test-coverage paragraph now name the generated committed `lib/**/*.js` and the typecheck and build-drift gates |
| `AGENTS.md` | Review checklist extended with the typecheck/build/drift contract, the rebuild-and-commit rule, and the local install smoke; existing rules are unchanged |
| `docs/harness-reports/ysk-ts7-migration-20261109/design.md` | Rewritten to the final reality: the final compiler project, the retained-JavaScript rationale, the four phases, and the verification matrix |

`src/*.ts`, `lib/*.js`, and `test/**` were not edited in this phase. `lib/*.js`
was only rewritten by the final `tsc -p tsconfig.json` run, which produced the
same bytes the drift gate accepts.

## 3. Final gate

The gate ran on the final tree, in this order.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `tsc -p tsconfig.json --noEmit` | exit 0, 0 diagnostics |
| Build | `tsc -p tsconfig.json` | exit 0, 13 files in `lib/` |
| Tests | `node --test test/` | exit 0, 697 pass, 0 fail, 0 skipped |
| Build drift | `npm run check:drift` | exit 0, 13 files byte-identical |
| Syntax | `npm run check:js` | exit 0 |
| Syntax (new scripts) | `node --check scripts/local-install-smoke.mjs`, `node --check scripts/check-build-drift.mjs` | exit 0, exit 0 |
| Local install smoke | `node scripts/local-install-smoke.mjs` | exit 0, 21 checks, 0 failed |
| Whitespace | `git diff --check` | exit 0 |
| Repository language | `node --test test/repository-language.test.js` | exit 0, 6 pass, 0 fail |

Evidence: [07-typecheck-build.txt](07-typecheck-build.txt),
[08-node-test.txt](08-node-test.txt), [09-check-drift.txt](09-check-drift.txt),
[10-check-js.txt](10-check-js.txt), [06-local-install-smoke.txt](06-local-install-smoke.txt),
[11-git-diff-check.txt](11-git-diff-check.txt),
[12-repository-language.txt](12-repository-language.txt).

## 4. tsconfig diff

The only change is the added setting. Evidence:
[01-tsconfig.diff.txt](01-tsconfig.diff.txt), final file
[01-tsconfig-final.json](01-tsconfig-final.json).

```diff
@@ -12,6 +12,7 @@
     "outDir": "lib",
     "declaration": false,
     "sourceMap": false,
+    "noEmitOnError": true,
     "skipLibCheck": true,
```

## 5. Drift gate hardening and proofs

Clean tree: `node scripts/check-build-drift.mjs` exits 0 and reports 13 files
matching the fresh build byte for byte ([02-drift-pass.txt](02-drift-pass.txt)).

Drift alarm: a scratch copy of `lib/` had one byte of `adaptive.js` changed (the
first `/` became `!`). The gate compared the fresh build with the scratch copy,
reported one differing file, and exited 1. The committed `lib/` was not touched;
the scratch copy was removed. Evidence:
[03-drift-fail-lib-byte.txt](03-drift-fail-lib-byte.txt).

Diagnostic alarm: a scratch compiler project extends `tsconfig.json` and
contains one type error. The gate reported `error TS2322`, exited 2, created no
emit directory, and performed no comparison. Evidence:
[04-drift-fail-diagnostic.txt](04-drift-fail-diagnostic.txt).

The script never writes `lib/`, never runs a Git command, and keeps scratch
output under `node_modules/`.

## 6. Distribution facts

`npm pack --json` on the working tree produced
`dsh-you-should-know-0.5.2.tgz` with 18 entries: the 13 committed `lib/*.js`
files, `README.md`, `docs/reference.md`, `cordis.patch.yml`, `package.json`, and
`LICENSE`. The tarball contains no `src/`, TypeScript, declaration, source-map,
`test/`, or `scripts/` entry. Evidence:
[05-npm-pack-file-list.txt](05-npm-pack-file-list.txt).

The local install smoke (default mode) installs that tarball into
`node_modules/.smoke-local/consumer` with `--ignore-scripts` and the workspace
npm cache, then passes 21 checks:

- the tarball file list matches the committed build;
- the installed `package.json` has no `preinstall`, `install`, `postinstall`,
  `prepare`, or `prepack` script;
- `import('dsh-you-should-know')` exposes `name`, `PLUGIN_VERSION`, `apply`, and
  `Config`, where `Config` is a schemastery schema with 16 volatile fields;
- `import('dsh-you-should-know/client')` and `import('dsh-you-should-know/core')`
  resolve to the installed `lib/client.js` and `lib/core.js`;
- the browser half registers the `window.__ModuleLoader__.load({ id, factory(require) })`
  envelope with `id: 'dsh-you-should-know'`, and the installed `lib/client.js`
  text has no top-level `import` or `export`.

Peer dependency handling: npm resolved `@deepseek-ai/schemastery` from the
workspace npm cache and installed it into the scratch consumer. No symlink
fallback was needed. The log line is `peer: @deepseek-ai/schemastery resolved by
npm`. The fallback code exists for a cache miss; it links the already-installed
workspace `@deepseek-ai` directory into the consumer and prints
`peer: symlinked the installed workspace @deepseek-ai copy into the consumer`.

The optional install-spec branch was exercised offline with the freshly packed
tarball path as its argument, which runs the same import, envelope, and manifest
assertions and skips only the tarball file-list checks. It exited 0 with 13
checks. Evidence:
[06b-local-install-smoke-spec-mode.txt](06b-local-install-smoke-spec-mode.txt).
A real `github:` spec was not installed because that mode needs the network; the
code path is identical apart from the npm install target.

## 7. Deviations and limitations

- The worktree is uncommitted by instruction. `git diff --check` therefore
  covers the tracked modifications only; the new untracked files
  (`tsconfig.json`, both new scripts, the updated `design.md`) were scanned
  separately for trailing whitespace and found clean
  ([14-new-file-whitespace.txt](14-new-file-whitespace.txt)).
- `test/` and `scripts/` stay JavaScript. The tests read the exact committed
  `lib/*.js` an install loads, and the dev-only scripts run directly under Node.
  The rationale is recorded in `design.md` section 5.
- The default smoke mode may reach the network only when npm cannot resolve the
  `@deepseek-ai/schemastery` peer from the workspace cache. The caller-spec mode
  always needs the network. This run needed no network.
- The new script is dev-only and not shipped; it is not in `files` and not in the
  `check:js` list. It is checked by `node --check` in the evidence above and by
  the final gate.
- No test was disabled, skipped, or edited. The repository invariants
  (`scripts.prepare === undefined`, `dependencies === undefined`, `files` and
  `exports` unchanged, no shipped `.ts`) are covered by the 697-test run.

## 8. Evidence index

| File | Content |
|---|---|
| `01-tsconfig.diff.txt`, `01-tsconfig-final.json` | tsconfig diff and final file |
| `02-drift-pass.txt` | clean-tree drift gate |
| `03-drift-fail-lib-byte.txt` | one-byte drift alarm, exit 1 |
| `04-drift-fail-diagnostic.txt` | type-error alarm, exit 2, no emit |
| `05-npm-pack-file-list.txt` | raw `npm pack --json` file list |
| `06-local-install-smoke.txt` | default tarball-mode smoke log, 21 checks |
| `06b-local-install-smoke-spec-mode.txt` | caller-spec branch proof, 13 checks |
| `07-typecheck-build.txt` | typecheck, build, emitted file list |
| `08-node-test.txt` | full `node --test test/` log, 697 pass |
| `09-check-drift.txt` | `npm run check:drift` |
| `10-check-js.txt` | `npm run check:js` and the two new-script syntax checks |
| `11-git-diff-check.txt` | `git diff --check` and tree snapshot |
| `12-repository-language.txt` | repository-language test, 6 pass |
| `13-repository-language-scan.txt` | non-Latin scan of the changed repository-facing files |
| `14-new-file-whitespace.txt` | trailing-whitespace scan of new or modified files |
