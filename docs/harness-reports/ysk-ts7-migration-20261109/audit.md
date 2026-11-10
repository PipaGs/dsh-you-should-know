# TS7 migration integration audit — dsh-you-should-know

> **Baseline note (2026-11-09).** This is the pre-migration baseline audit,
> captured before implementation began on 2026-11-09. It records what had to
> stay true, not what the migration later produced. It is superseded by
> [design.md](design.md) and [final-report.md](final-report.md). The historical
> content below is preserved unchanged.

- Repository: `PipaGs/dsh-you-should-know`
- Worktree: `/Users/pipags/work/dsh-you-should-know-worktrees/ysk-ts7-migration-20261109`
- Branch: `session/ysk-ts7-migration-20261109`
- Base HEAD: `4d414db2f56ae0bd1e5d0585065241e1d276a972`
- Audit date: 2026-11-09
- Auditor: read-only repository auditor (no product code was modified)
- Scope: current tree only. Nothing in this report was inferred from a future
  migration plan; every claim below is either read from a file or reproduced by a
  command whose raw output is stored under `evidence/`.

The audit answers one question: what must stay true when the shipped JavaScript
halves become TypeScript sources under strict TS7 typechecking, so that a
`github:` install keeps needing no build step and the runtime behavior and
security guards do not change.

## 1. Environment facts

| Fact | Value | Evidence |
|---|---|---|
| Node.js | `v26.12.1` | `evidence/env-facts.txt` |
| npm | `11.20.0` | `evidence/env-facts.txt` |
| pnpm | `12.6.0` at `/Users/pipags/Library/pnpm/pnpm` | this audit run |
| git | `2.55.0` | this audit run |
| `git rev-parse HEAD` | `4d414db2f56ae0bd1e5d0585065241e1d276a972` | `evidence/env-facts.txt` |
| `git status --porcelain` | only `?? docs/harness-reports/ysk-ts7-migration-20261109/` | `evidence/baseline-git-status.txt` |
| `git diff --check` | exit 0, empty output | `evidence/baseline-git-status.txt` |
| Installed TypeScript | `7.0.2` (`node_modules/typescript`, native platform package `@typescript/typescript-darwin-arm64@7.0.2`) | this audit run |
| `tsc --version` | `Version 7.0.2`, exit 0 (run as `node node_modules/typescript/bin/tsc`) | `evidence/ts-probe/tsc-version.txt` |
| Installed `@types/node` | `26.6.6` | this audit run |
| Installed `@deepseek-ai/schemastery` | `3.19.0`, types at `lib/types/index.d.ts`, default export `Schema` | this audit run |
| Installed `@deepseek-ai/cosmokit` | present (schemastery dependency; provides `Volatile`) | `node_modules` |
| Repository `tsconfig` | none | this audit run |
| Lockfile | none (`package-lock.json` and `pnpm-lock.yaml` absent) | this audit run |
| CI configuration | none (no `.github/`, no workflow YAML) | `git ls-files` |
| `.gitignore` | `node_modules/`, `*.tgz`, `.DS_Store` | `.gitignore` |
| `engines.node` | `>=22.19.0` | `package.json` |
| Test files | **34**, not 35 as stated in the task brief (34 tracked `test/*.test.js`) | `ls test/*.test.js` |
| Tracked tree size | 517 files: 458 under `docs/`, 13 `lib/`, 34 `test/`, 6 `scripts/` | `git ls-files` |

Note: `node_modules` already contains `typescript@7.0.2` and `@types/node`, but
`package.json` does not declare either one. The migration must add them as
`devDependencies` and must not add `dependencies` or `prepare`.

### 1.1 Node 26 TypeScript probes (informative, not the chosen path)

The probe files are synthetic and live only under `evidence/ts-probe/`.

- `node --check probe.ts` → exit 0.
- `node --check probe.test.ts` → exit 0.
- `node --test probe.test.ts` → exit 0 (1 pass, 0 fail).
- `import('<probe.ts>')` → exit 0, `loaded answer=42`.
- A file with `enum` passes `node --check` but fails at execution:
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript enum is not supported in
  strip-only mode` (exit 3).

Raw logs: `evidence/ts-probe/ts-support-probe.txt`,
`evidence/ts-probe/enum-support-probe.txt`.

`node --check` parses TypeScript but never type-checks it. It cannot replace a
strict TS7 gate.

## 2. Baseline results

All commands were run through `node -e` + `child_process.spawnSync`, as required
by the harness. Raw stdout+stderr and exit codes are stored as cited.

| # | Command | Exit code | Result | Evidence |
|---|---|---|---|---|
| 1 | `node --test test/` | 0 | tests 697, suites 0, **pass 697, fail 0**, cancelled 0, skipped 0, todo 0, duration ~1199 ms | `evidence/baseline-node-test.txt` |
| 2 | `npm test --silent` (check chain + `node --test test/*.test.js`) | 0 | tests 697, **pass 697, fail 0**, duration ~1231 ms | `evidence/baseline-npm-test.txt`, `evidence/baseline-npm-test.meta.txt` |
| 3 | `npm run check --silent` (all `node --check` targets) | 0 | no stdout, no stderr | `evidence/baseline-npm-check.txt` |
| 4 | `npm pack --dry-run --json` | 0 | 18 entries, `dsh-you-should-know-0.5.2.tgz`, packed 120493 bytes, unpacked 438764 bytes | `evidence/baseline-npm-pack-dry-run.json` |
| 5 | `node scripts/install-smoke.mjs` | 0 | 7 `ok` checks, `install smoke passed`, ~46.6 s | `evidence/baseline-install-smoke.txt` |
| 6 | `git diff --check` | 0 | empty | `evidence/baseline-git-status.txt` |
| 7 | `git status --porcelain` | 0 | only the untracked report directory | `evidence/baseline-git-status.txt` |

A pre-existing `evidence/baseline-test.txt` (created before this run) also shows
697 pass / 0 fail; it is redundant with row 1 and was not authored here.

### 2.1 Install smoke details

`scripts/install-smoke.mjs`:

- reads `package.json` for the package name and pinned version;
- default spec is `github:PipaGs/dsh-you-should-know#v0.5.2` (this tag, not the
  working tree);
- creates two throwaway directories with `mkdtempSync(join(tmpdir(), ...))`,
  therefore under `os.tmpdir()`;
- seeds each directory with a private `package.json`;
- runs `pnpm add <spec>` (or `$DSH_PNPM` through `process.execPath`) in those
  directories, with `--reporter=silent`;
- removes both directories in `finally` (no `dsh-install-smoke-*` leftovers were
  found after the run);
- needs network access: `pnpm add` resolves and clones/downloads the Git
  dependency. The run above took ~46.6 s and exited 0.
- never touches `~/.dsh` or this worktree, and does not install the working tree.

### 2.2 Shipped file set (`files` field + pack)

18 pack entries. `scripts/`, `test/`, `docs/harness-reports/`, and `AGENTS.md`
are not shipped; `LICENSE` is shipped. The shipped set:

```
LICENSE
README.md
cordis.patch.yml
docs/reference.md
lib/adaptive.js
lib/client.js
lib/core.js
lib/evidence.js
lib/explain.js
lib/feedback.js
lib/index.js
lib/language.js
lib/review-profile.js
lib/review-strictness.js
lib/runtime.js
lib/self-check.js
lib/update.js
package.json          (always added by npm)
```

## 3. File inventory

Line counts are physical lines. Byte counts for `README.md` and
`docs/reference.md` are the pack sizes.

### 3.1 `lib/` — 13 tracked files, 8099 lines total

| Path | Lines | Role |
|---|---:|---|
| `lib/index.js` | 370 | Host half entry. Exports `name`, `PLUGIN_VERSION` (`'0.5.2'`), `Config` (schemastery), `apply(ctx, rawConfig)`. Claims a process-global ownership token, wires engine/update checker, registers listeners and 9 Fetch routes through the connection carrier. |
| `lib/core.js` | 3093 | Dependency-free reviewer core: config defaults/limits/normalization, session and event helpers, verdict parse/ground, engine (`createEngine`), legacy node request handlers (`createRequestHandlers`), Fetch handlers (`createFetchHandlers`), provider catalog, config handlers, update route handlers, IPC-free JSON helpers. |
| `lib/client.js` | 1853 | Browser half. One `window.__ModuleLoader__.load({ id, factory })` bundle; `factory(require)` requires only `react`; registers the note dock, settings card, and session-header action; polls the note route; contains no Node builtins and no ESM exports. |
| `lib/runtime.js` | 619 | Per-session scheduler: bounded FIFO queue, one transient retry, whole-call deadline, abort handling, quota/permanent failure classification. Injected timers and stream; no I/O. |
| `lib/update.js` | 578 | Update checking: stable-tag parse/compare, fixed `git ls-remote --tags --refs` command through the injected `ctx.shell` seam, once-per-local-day scheduler, bounded parsers. No install or write path. |
| `lib/review-profile.js` | 354 | Language-specific review skills and response-language directive; imports `./language.js`; pure. |
| `lib/evidence.js` | 324 | Bounded untrusted evidence capsule from allowlisted session-event metadata; pure. |
| `lib/self-check.js` | 278 | Authenticated diagnostics: `ROUTE_CAPABILITIES`, payload builder, `readInstalledVersion`. The **only** shipped module that reads a file (`node:fs/promises` + `../package.json`). Imports `./core.js` for JSON helpers. |
| `lib/review-strictness.js` | 213 | Five strictness mode ids, per-mode instruction fragments and admitted verdict/importance thresholds; pure. |
| `lib/feedback.js` | 114 | Resolution vocabulary and bounded fingerprint sets; pure. |
| `lib/language.js` | 109 | Host-language / excerpt-language / English fallback resolution; pure. |
| `lib/explain.js` | 107 | Explanation prompt, system prompt, strict parser; imports `./language.js`; pure. |
| `lib/adaptive.js` | 87 | Hourly reviewer budget and quiet-streak cooldown; pure. |

### 3.2 `scripts/` — 6 tracked files, not shipped

| Path | Lines | Role | Imports `lib/`? |
|---|---:|---|---|
| `scripts/install-smoke.mjs` | 104 | Manual/live GitHub install attribution smoke; temp dirs under `os.tmpdir()`; needs network and pnpm. | no |
| `scripts/note-voice-eval.mjs` | 672 | Dev-only evaluator core (synthetic cases, scoring). | `../lib/core.js` |
| `scripts/note-voice-eval-deepseek.mjs` | 430 | Dev-only DeepSeek Messages adapter for the live evaluator. | no |
| `scripts/note-voice-eval-live.mjs` | 150 | Dev-only live runner. | imports the evaluator, not `lib/` directly |
| `scripts/note-voice-baseline.mjs` | 278 | Offline deterministic baseline scorer and CLI. | `../lib/core.js`, `../lib/review-strictness.js` |
| `scripts/fixtures/note-voice-baseline/cases.json` | 233 | Hand-authored synthetic fixtures. | n/a |

These are development tools. `files` excludes `scripts/`, so none ship to a
`github:` install. They stay relevant because `npm run check` / `npm test` run
`node --check` on four of them, and four test files import or spawn them.

### 3.3 `test/` — 34 files, 16012 lines total

See the coupling table in section 5.1.

### 3.4 Manifests and docs

| Path | Lines | Role |
|---|---:|---|
| `package.json` | 70 | Main/exports/files/scripts/engines/dsh manifest/peer+dev dependency. |
| `cordis.patch.yml` | 42 | Inserts the `you-should-know` row with `name: dsh-you-should-know` and an automatic reviewer route. |
| `README.md` | 251 (25844 bytes) | Product overview, install, config, Web UI, verification, development. |
| `docs/reference.md` | 340 (53702 bytes) | Deep contracts, route schemas, runtime, update checker, install attribution, test coverage. |
| `AGENTS.md` | 77 | English-only repository rule and review checklist. |
| `LICENSE` | 21 | MIT. |

Other tracked `docs/` material is historical task evidence, the upstream ledger,
and Superpowers plans/specs; it is not a product surface.

## 4. Integration map

### 4.1 Package entry points and exports

`package.json`:

- `"type": "module"`, `"main": "./lib/index.js"`.
- `exports`:
  - `"."` → `./lib/index.js`
  - `"./client"` → `./lib/client.js`
  - `"./core"` → `./lib/core.js`
  - `"./cordis.patch.yml"` → `./cordis.patch.yml`
  - `"./package.json"` → `./package.json`
- `files`: `lib`, `cordis.patch.yml`, `README.md`, `docs/reference.md`,
  `LICENSE`.
- No `dependencies`. One peer+dev dependency: `@deepseek-ai/schemastery`
  `^3.18.4` (installed: 3.19.0).
- `engines.node: >=22.19.0`.
- `dsh` manifest:
  - `manifestVersion: 1`
  - `bundle.patch: "./cordis.patch.yml"`
  - `client.platform: "web"`
  - `client.inject`: `@deepseek-ai/dsh-client-connection`,
    `@deepseek-ai/dsh-client-ui-conversation`,
    `@deepseek-ai/dsh-client-ui-plugin-manager`,
    `@deepseek-ai/dsh-client-ui-renderer`.

Runtime named exports:

- `lib/index.js`: `name`, `PLUGIN_VERSION`, `Config`, `apply`.
- `lib/core.js`: the full surface listed by `grep '^export'` (constants, config
  helpers, event helpers, prompt builders, parser, engine, handlers).
- `lib/client.js`: none. It is a side-effecting browser bundle, not an importable
  module.

### 4.2 `github:` installation and DSH plugin loading

1. `dsh plugin add github:PipaGs/dsh-you-should-know#v0.5.2` runs pnpm against
   the Git tag. Because the built JS halves are committed, pnpm needs no build:
   `package.json` has no `prepare`, no `dependencies`, and `main` points at the
   committed `lib/index.js`.
2. The Desktop plugin manager attributes the install by diffing the profile's
   dependencies before and after pnpm; a ref-pinned address is saved verbatim.
   `test/install-discovery.test.js` reproduces that algorithm.
3. `cordis.patch.yml` inserts one row: `id: you-should-know`,
   `name: dsh-you-should-know`, config without a pinned provider/model.
4. The DSH loader resolves the package name, imports `main`, and calls
   `apply(ctx, rawConfig)`. `apply` reads volatile config references, registers
   `session/event`, `session/disposed`, `loader/volatile-update`, a teardown
   effect, and `ctx.inject(['connection'], ...)`.
5. Inside the connection injection, `lib/index.js` registers every route from
   `ROUTE_CAPABILITIES` with `hostCtx.connection.fetch.register(route)`. The
   connection carrier owns the Host/Origin fence and browser authentication; the
   plugin never registers on the raw web server and never handles cookies or
   tokens.
6. The manifest `dsh.client` block injects the browser half. The host serves or
   bundles `lib/client.js` into the Web client module table, which evaluates
   `window.__ModuleLoader__.load(...)`. The `inject` list names the host modules
   available to that bundle; `require('react')` comes from the host module table.

The repository contains no bundler, build script, or vendored host code, so the
exact host bundling implementation cannot be verified from this tree. The
verifiable contract is the manifest block, the `exports["./client"]` path, the
bundle envelope, and the three client tests that evaluate the raw file.

### 4.3 Host half: `lib/index.js` + `lib/core.js`

- `apply` gates first: an explicitly blank `provider` or `model` returns before
  any registration or model call.
- Ownership is a `Symbol.for('dsh-you-should-know.reviewer-owner')` token on
  `globalThis`, so duplicate composition stays inert.
- `createEngine` receives injected `getLlm`, `getHostLanguage`, `now`, and
  `onError`; it never imports a host API.
- Config edits arrive as volatile `{ get() }` references; `snapshotConfig` and
  `normalizeConfig` re-read them, and `engine.updateConfig` applies a live
  change without remounting.
- Update checking is host-side and read-only. It calls the injected
  `ctx.shell` seam with a fixed literal
  `git ls-remote --tags --refs https://github.com/PipaGs/dsh-you-should-know.git`,
  `GIT_TERMINAL_PROMPT=0`, a timeout, and byte/line bounds. It persists only
  version/date/dismissal metadata through the settings service.
- HTTP serving exists in two shapes:
  - **Runtime path (used):** Fetch `Request` → `Response` handlers returned by
    `createFetchHandlers`, `createConfigHandlers`, `createUpdateHandlers`, and
    `createSelfCheckHandler`, registered on the connection carrier.
  - **Legacy path (exported, not registered by `lib/index.js`):**
    `createRequestHandlers(engine)` uses Node `IncomingMessage`/`ServerResponse`.
    Only `test/core.test.js` calls it. It must remain exported if tests keep it,
    but the plugin does not register it.

### 4.4 Browser half: `lib/client.js`

- Envelope: `window.__ModuleLoader__.load({ id: 'dsh-you-should-know', factory(require) {...} })`.
- Only external module: `react` via the CommonJS `require` argument.
- Three slot registrations, all through `ctx.slots.inject(...)`:
  - `conversation.input.dock`
  - `plugins.bundle.config`
  - `conversation.session.header.actions`
- Route URLs are document-relative, for the Desktop `dsh-app://app/` origin:
  `api/dsh-you-should-know/{notes,history,dismiss,config,session,update,explain,self-check}`.
- Browser globals used: `window`, `document` (visibility and listeners),
  `navigator.clipboard`, global `fetch`, `setInterval`/`clearInterval`.
- No Node builtins, no `process`, no filesystem, no `localStorage`
  (`test/invariant.test.js` asserts the last point).
- Polling is 7 s, notes only, and suspended while the page is hidden.

### 4.5 Registered route table (`ROUTE_CAPABILITIES`)

| Name | Path | Methods | `requestBody` |
|---|---|---|---|
| notes | `/api/dsh-you-should-know/notes` | GET, HEAD | buffered |
| history | `/api/dsh-you-should-know/history` | GET, HEAD | buffered |
| dismiss | `/api/dsh-you-should-know/dismiss` | POST | streaming |
| status | `/api/dsh-you-should-know/status` | GET, HEAD | buffered |
| session | `/api/dsh-you-should-know/session` | GET, HEAD, POST | buffered |
| explain | `/api/dsh-you-should-know/explain` | POST | buffered |
| config | `/api/dsh-you-should-know/config` | GET, HEAD, POST | buffered |
| update | `/api/dsh-you-should-know/update` | GET, HEAD, POST | buffered |
| self-check | `/api/dsh-you-should-know/self-check` | GET, HEAD | buffered |

`lib/index.js` walks this table and registers exactly one handler per entry, so
the self-check cannot describe an unregistered capability.

### 4.6 `@deepseek-ai/schemastery` usage

Only `lib/index.js` imports it (`import z from '@deepseek-ai/schemastery'`).
`Config` is one `z.object({...})` whose fields use:

- `z.string()`, `z.boolean()`, `z.number()`;
- `z.string().max(n)` and `z.number().step(1).min(...).max(...)`;
- `z.union([...].map(id => z.const(id)))` for the closed enums
  `reviewerMode` and `updateBehavior`;
- `.default(...)` on every field;
- `.volatile()` on every field so a loader commit updates live references
  without a remount.

Types are shipped by the package (`lib/types/index.d.ts`, default export
`Schema: Schemastery.Static`, `volatile()` and `step()` declared, and
`Volatile<T>` from `@deepseek-ai/cosmokit`). Under NodeNext resolution the
default-import interop must be preserved; the package is ESM with an `.cjs`
require condition.

No other external import exists anywhere in `lib/` or `test/`.

### 4.7 Inter-module import graph (relative imports only)

```
lib/index.js  → lib/core.js, lib/review-strictness.js, lib/self-check.js, lib/update.js
lib/core.js   → lib/runtime.js, lib/adaptive.js, lib/evidence.js, lib/explain.js,
                lib/feedback.js, lib/review-profile.js, lib/review-strictness.js
lib/explain.js → lib/language.js
lib/review-profile.js → lib/language.js
lib/self-check.js → lib/adaptive.js, lib/core.js, lib/evidence.js,
                    lib/review-strictness.js
lib/client.js → react (host-provided CommonJS)
```

Leaf modules with no imports: `adaptive`, `evidence`, `feedback`, `language`,
`review-strictness`, `runtime`, `update`.
The graph is acyclic (`index → self-check → core`; `core` never imports
`self-check`).

All specifiers use explicit `.js` extensions, which is already compatible with
TypeScript NodeNext output.

### 4.8 Filesystem, environment, process, and network usage

| Module | Usage | Allowed / expected |
|---|---|---|
| `lib/self-check.js` | `readFile(new URL('../package.json', import.meta.url), 'utf8')` in `readInstalledVersion` | Host only, shipped. The relative path is a runtime contract: it assumes `self-check.js` sits exactly one directory below `package.json`. |
| `lib/update.js` | passes `TAG_DISCOVERY_ENV = { GIT_TERMINAL_PROMPT: '0' }` to the injected shell seam; never reads `process.env` | Host only, shipped. |
| `lib/index.js` | `ctx.get('shell')`, `shell.resolve`, `shell.execute`; `ctx.get('settings')`; `ctx.get('llm')` | Host seams only. |
| `lib/client.js` | browser `fetch`, `window`, `document`, `navigator` | Browser only. |
| other `lib/*.js` | none: no `node:` imports, no `process`, no `child_process`, no `writeFile` | Enforced by `test/invariant.test.js`. |
| `scripts/*.mjs` | `node:fs`, `node:child_process`, `node:os`, `node:crypto`, `node:url`, `process.execPath`, `$DSH_PNPM` | Dev-only, not shipped, not loaded by the plugin. |

`test/invariant.test.js` scans every shipped source (comments stripped) for
`process.env`, `writeFile`, `child_process`, `spawn`/`spawnSync`/`execSync`,
`localStorage`, `document.cookie`, `authorization`, `bearer`, `set-cookie`,
`installBundle`, `pluginManager`, `pnpm`/`yarn`, and `npm install|add|update|i`.

## 5. Test suite coupling

### 5.1 Per-file table

`lib import` means a static `import ... from '../lib/*.js'`. `source read` means
the test reads a shipped file as text. `manifest` means the test parses
`package.json` or asserts its fields.

| Test file | Lines | Subject under test | Coupling | Breaks if `lib/*.js` is generated/moved? |
|---|---:|---|---|---|
| `adaptive.test.js` | 130 | Hourly budget, quiet streak, cooldown | imports `../lib/feedback.js`, `../lib/adaptive.js` | yes (path/name) |
| `client-hooks.test.js` | 431 | Client polling, visibility, dismissal memory | reads `../lib/client.js` as text, runs it in `node:vm` with a fake module loader and fake React | yes (envelope/format) |
| `client-ui.test.js` | 2705 | Full client UI behavior and copy | same vm harness; text also regex-scanned by `upstream-ledger.test.js` | yes (envelope/format and external text regexes) |
| `client.test.js` | 119 | Bundle envelope, `inject` list, slot registrations | same vm harness | yes (envelope/format) |
| `config.test.js` | 437 | Config route, live config, provider catalog | imports `../lib/core.js` | yes |
| `core.test.js` | 1337 | Config normalization, event helpers, verdict parsing/grounding, node request handlers | imports `../lib/core.js` (incl. `createRequestHandlers`) | yes |
| `engine.test.js` | 1604 | Engine review lifecycle, gates, dedupe, route discovery | imports `../lib/core.js` | yes |
| `evidence.test.js` | 252 | Evidence capsule bounds and allowlist | imports `../lib/evidence.js`, `../lib/core.js` | yes |
| `explain.test.js` | 208 | Explanation prompt/parser | imports `../lib/explain.js`, `../lib/core.js` | yes |
| `feedback-route.test.js` | 145 | Dismiss/resolve Fetch route | imports `../lib/core.js` | yes |
| `feedback.test.js` | 247 | Feedback semantics and adaptive behavior | imports `../lib/core.js`, `../lib/adaptive.js` | yes |
| `install-discovery.test.js` | 90 | GitHub install attribution and README pin | parses `package.json`; reads `README.md`; no `lib` import | no (unless manifest/prose changes) |
| `invariant.test.js` | 200 | Human-only invariant, auth boundary, no install/self-modify, manifest shape | reads 12 hardcoded `lib/*.js` paths (the list **omits `lib/runtime.js`**) plus `package.json`, `cordis.patch.yml`, `README.md`, `LICENSE`; asserts `manifest.exports['./client']`, `files`, `scripts.prepare === undefined`, `dependencies === undefined` | yes (any missing/renamed path; any new forbidden identifier; any manifest change) |
| `language.test.js` | 191 | Output-language resolution and directive composition | imports `../lib/language.js`, `../lib/core.js`, `../lib/review-profile.js` | yes |
| `note-voice-baseline.test.js` | 354 | Offline baseline scorer and CLI contract | imports and spawns `../scripts/note-voice-baseline.mjs`; imports `../lib/review-strictness.js` | yes for script rename; lib import for path |
| `note-voice-eval-live.test.js` | 523 | Live runner and DeepSeek adapter contracts (offline fakes) | imports `../lib/core.js` and three `../scripts/*.mjs` | yes for script rename; lib import for path |
| `note-voice-eval.test.js` | 514 | Evaluator core contracts | imports `../scripts/note-voice-eval.mjs`, `../lib/core.js`; reads script path | yes for script rename; lib import for path |
| `note-voice-semantic.test.js` | 160 | Semantic adjudicator regressions | imports `../scripts/note-voice-eval.mjs` | yes if script moves |
| `plugin.test.js` | 1086 | `apply(ctx, config)` integration with the host seam: listeners, injection, ownership, Fetch routes, update shell | imports `../lib/index.js`, `../lib/core.js`, `../lib/update.js`; dynamic `import('../lib/index.js?phase2=a')` for the global ownership token | yes (path and ESM named exports) |
| `pr-diff-check.test.js` | 75 | PR patch whitespace | `git diff --check <base 0419b70>`; skips when the base is absent | no (but fails on whitespace introduced anywhere in the diff) |
| `recent-check-diagnostics.test.js` | 527 | Opt-in recent-check diagnostics, `Config`, route capabilities | imports `../lib/core.js` (incl. namespace import), `../lib/index.js`, `../lib/self-check.js` | yes |
| `recent-check-disable.test.js` | 257 | Diagnostics disabled default | imports `../lib/core.js` | yes |
| `release-consistency.test.js` | 107 | Version mirrors | imports `../lib/index.js`, `../lib/update.js`; reads `package.json`, `README.md`, `docs/reference.md`, `lib/index.js` | yes (needs `PLUGIN_VERSION` literal in `lib/index.js`) |
| `release-notes-consistency.test.js` | 97 | Historical v0.4.4 release-notes accuracy | reads historical report/evidence files only | no |
| `repository-language.test.js` | 87 | English-only rule | reads `AGENTS.md`, `README.md`, two historical report paths; `NON_LATIN` scan | no (unless those prose files change) |
| `review-profile.test.js` | 261 | Language detection and review skills | imports `../lib/review-profile.js`, `../lib/core.js` | yes |
| `route-deadline.test.js` | 339 | Fetch route deadlines | imports `../lib/core.js`, `../lib/runtime.js` | yes |
| `runtime.test.js` | 490 | Queue, retry, deadline, classification | imports `../lib/core.js`, `../lib/runtime.js` | yes |
| `self-check.test.js` | 277 | Self-check payload and handler | imports `../lib/self-check.js`; reads `../package.json`; asserts default installed version equals manifest version | yes (runtime `../package.json` path) |
| `strictness.test.js` | 515 | Five modes, thresholds, custom prompt | imports `../lib/review-strictness.js`, `../lib/index.js` (`Config`), `../lib/core.js` | yes |
| `task-evidence-paths.test.js` | 72 | No absolute workstation paths in two historical report dirs and upstream evidence | fixed historical paths | no |
| `update-route.test.js` | 272 | Update route, `Config` update fields, state preservation | imports `../lib/index.js` (`Config`, `PLUGIN_VERSION`), `../lib/core.js`, `../lib/update.js`; reads `../package.json` | yes |
| `update.test.js` | 631 | Tag parsing/comparison, scheduler, bounds, source hygiene | imports `../lib/update.js`; reads `../lib/update.js` as text and asserts absence of `api.github.com`, `releases/latest`, `LATEST_RELEASE_URL`, `latestReleaseTag`, `webFetch`, `web.fetch`, `ctx.web` | yes (text scan) |
| `upstream-ledger.test.js` | 1272 | Upstream ledger structure, historical hashes, git tags | regex-scans `test/client-ui.test.js` for three exact assertions; hashes historical docs; uses `git cat-file`, `git show`, `git rev-parse` against fixed commits/tags | yes indirectly (rewriting/renaming `client-ui.test.js` breaks the regex assertions) |

### 5.2 Answers to the specific coupling questions

- **Direct `../lib/*.js` coupling:** 27 of the 34 test files touch at least one
  shipped source path. 23 files have a static `.js` import: `adaptive`, `config`,
  `core`, `engine`, `evidence`, `explain`, `feedback-route`, `feedback`,
  `language`, `note-voice-baseline`, `note-voice-eval-live`, `note-voice-eval`,
  `plugin`, `recent-check-diagnostics`, `recent-check-disable`,
  `release-consistency`, `review-profile`, `route-deadline`, `runtime`,
  `self-check`, `strictness`, `update-route`, `update`. Three more
  (`client`, `client-hooks`, `client-ui`) read `lib/client.js` as text and run it
  in `node:vm`; `invariant` reads 12 shipped files as text. The remaining 7 test
  files do not touch a shipped path: `install-discovery`,
  `note-voice-semantic`, `pr-diff-check`, `release-notes-consistency`,
  `repository-language`, `task-evidence-paths`, `upstream-ledger`.
- **`package.json`:** `install-discovery`, `invariant`, `release-consistency`,
  `self-check`, `update-route`.
- **Exports / file lists:** `invariant` (`exports['./client']`, `files`), and
  `install-discovery`/`invariant` assert `dsh.bundle.patch` and `dsh.client`.
- **Repository language:** `repository-language.test.js` (fixed four artifacts)
  and `invariant.test.js` (`SHIPPED` + `PUBLIC` non-Latin and unrelated-project
  scan).
- **PR diff rules:** `pr-diff-check.test.js` only.
- **Release consistency:** `release-consistency.test.js`.
- **Line counts:** **none.** No test asserts a source line count or file size.
  The earlier assumption of line-count coupling is not supported by the suite.
- **Hardcoded `lib/` paths:** `invariant.test.js` (12-path `SHIPPED` list,
  `lib/index.js`, `lib/core.js`, `lib/client.js`, `lib/self-check.js`,
  `lib/update.js`), `release-consistency.test.js` (`lib/index.js`),
  `update.test.js` (`lib/update.js`), `client*.test.js`
  (`new URL('../lib/client.js', import.meta.url)`), `plugin.test.js`
  (`../lib/index.js` + query suffix), and every static import listed above.
- **`package.json` scripts:** no test asserts the `check` or `test` script
  bodies. `invariant.test.js` asserts only `scripts.prepare === undefined`. The
  gate still breaks externally if the scripts point at renamed files: `npm test`
  runs the `node --check` chain before `node --test`.

### 5.3 Silent couplings that are easy to miss

1. `upstream-ledger.test.js` (line ~897) reads `test/client-ui.test.js` as text
   and requires three exact assertion substrings. A TS rewrite of that test file
   fails the ledger suite even though the client code is unchanged.
2. `self-check.test.js` asserts that the default reader returns the same version
   as `../package.json`. This exercises the real `import.meta.url`-relative
   `../package.json` read, so an output layout under `dist/` breaks it.
3. `plugin.test.js` imports `../lib/index.js` with `?phase2=a` / `?phase2=b`
   query suffixes to prove the `globalThis` ownership token. Generated output
   must remain an importable ESM file at that exact path.
4. `release-consistency.test.js` scans `lib/index.js` for the `0.5.2` literal
   and the absence of `0.5.1`. `PLUGIN_VERSION` must stay a literal in that
   committed file.
5. `install-smoke` validates the published tag `v0.5.2`, not the working tree,
   so it cannot verify a local migration.
6. `pr-diff-check.test.js` uses fixed base commit
   `0419b70797a8d37db245d55817a7be273b5edcdb`; it skips only when the commit is
   missing, so any whitespace error in a local TS migration diff fails it once
   the base is an ancestor.

## 6. Docs and configuration surfaces that must be updated

| Surface | Location | Current statement |
|---|---|---|
| README status line | `README.md:11` | "Host and browser halves ship as plain JavaScript, so a `github:` install needs no build." |
| README install | `README.md:71-92` | "The built host and browser halves are committed, so installation needs no source build." |
| README development | `README.md:213-238` | `npm test`; offline baseline command. No typecheck command. |
| README verification | `README.md:184-212` | Self-check sample versions; no build/typecheck mention. |
| Reference install attribution | `docs/reference.md:301` | "Because the built halves are committed, installation needs no source build." |
| Reference update/install | `docs/reference.md:289` | "restart DSH Desktop so the new JavaScript generation loads." |
| Reference test coverage | `docs/reference.md:336-345` | Enumerates the suite; must mention the typecheck gate if one is added. |
| `package.json` | scripts, `engines`, `devDependencies`, optional `tsconfig` reference | Must gain a strict TS7 check; must not gain `dependencies` or `prepare`; must keep `main`/`exports`/`files`. |
| `AGENTS.md` review checklist | lines 59-70 | Lists `npm test`, `npm run check`, `git diff --check`; add the typecheck command if the workflow changes. |
| `cordis.patch.yml` | whole file | No migration change expected; keep the reviewer route unpinned. |
| `docs/superpowers/plans|specs` | historical design records | Do not rewrite. They state "Node ESM only; no runtime dependencies" and name `lib/*.js` paths; if architecture changes, add a dated note instead. |

## 7. Prioritized risks for the TS7 migration

Priority 0 — breaks installation or the shipped contract:

1. **Do not stop committing `lib/*.js`.** `files: ["lib"]`, `main`, `exports`,
   `manifest.exports['./client']`, `npm pack`, the GitHub install test, 23 static
   `../lib/*.js` imports, and four source-text readers all assume committed
   JavaScript at those exact paths. An uncommitted or `dist/`-only build makes
   `github:` installs unusable.
2. **Never add `prepare` or any install-time build hook.**
   `test/invariant.test.js` asserts `scripts.prepare === undefined` and
   `dependencies === undefined`; adding either fails the suite and changes the
   Git-install behavior (npm/pnpm would run a build on the user's machine).
3. **Keep `lib/client.js` a single browser CommonJS bundle.** Three test files
   evaluate the raw file in `node:vm` and require the
   `window.__ModuleLoader__.load({ id, factory })` envelope with
   `factory(require)` and `require('react')`. An ESM or differently wrapped
   client output breaks the host module table and these tests.
4. **Keep the output layout exactly `lib/*.js` one level below
   `package.json`.** `lib/self-check.js` reads `../package.json` through
   `import.meta.url`; `self-check.test.js` asserts the version parity. Moving
   output to `dist/lib/` silently degrades `installedVersion` to `null`.
5. **Keep ESM named exports and the schemastery default-import interop.**
   `apply`, `name`, `PLUGIN_VERSION`, `Config`, and every `core` symbol are
   imported by name. `Config` must remain a `z.object` with `.volatile()` on
   every field; the settings live-update path depends on it.
6. **Update the `node --check` path lists atomically with any rename.** Both
   `check` and `test` scripts enumerate 13 `lib/*.js` and 4 `scripts/*.mjs`
   files; a rename makes `npm test` fail before `node --test` runs.

Priority 1 — breaks a gate or the security posture:

7. **Add a real strict TS7 typecheck.** `node --check` only parses; it does not
   type-check. `tsc@7.0.2` is installed but undeclared; add `typescript` and
   `@types/node` as `devDependencies`, add a `typecheck` script
   (`--noEmit --strict`), and update `AGENTS.md`/`docs/reference.md`.
8. **Preserve the invariant source scans.** `test/invariant.test.js` strips
   comments and rejects, in shipped code: `transcript`, `inbox`,
   `systemPrompt`, `process.env`, `writeFile`, `child_process`,
   `spawn`/`spawnSync`/`execSync`, `localStorage`, `document.cookie`,
   `authorization`, `bearer`, `set-cookie`, `installBundle`, `pluginManager`,
   `pnpm`/`yarn`, `npm install|add|update|i`, `.steer(`, `.followup(`,
   `agents.inject(`, `session.append|push`, `conversation.chat.node`,
   `webServer.register(`, `noAuth`, `requireAuth: false`. Type names, type-only
   imports, and generated identifiers can accidentally introduce these words.
   The scan only covers the 12 listed `lib/*.js` files. `lib/runtime.js` is
   shipped but not in the list, and any extra generated file under `lib/` stays
   unscanned. Keeping generated output in `lib/` keeps the existing 12 files
   covered; extend the list if the migration adds shipped modules.
9. **Keep generated output free of non-Latin text.** `invariant.test.js` scans
   the 12 shipped files plus `package.json`, `cordis.patch.yml`, `README.md`,
   `LICENSE` for Cyrillic/Greek/CJK ranges. Any localized comment in generated
   output fails.
10. **Use erasable TypeScript syntax if any `.ts` can execute directly.** Node
    26 runs erasable `.ts`, but rejects `enum` with
    `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; Node's type stripping never
    type-checks. Prefer compiled JS for runtime and set
    `erasableSyntaxOnly`/`verbatimModuleSyntax` in `tsconfig` to keep the source
    honest.
11. **Keep test file names or update the `test` script glob.** The current glob
    is `test/*.test.js`. Node 26 can run `*.test.ts`, but `engines.node` allows
    22.19, so verify that floor before relying on it; renaming test files also
    breaks the fixed `test/client-ui.test.js` regex in `upstream-ledger`.
12. **Keep `PLUGIN_VERSION` a literal in the committed `lib/index.js`.** The
    release-consistency test imports it and also scans the file for the current
    and previous version strings.

Priority 2 — correctness and verification quality:

13. **Do not ship TS sources under `lib/`.** `files: ["lib"]` would then ship
    `.ts`, `.d.ts`, and maps. Keep sources in a non-shipped directory (for
    example `src/`) and emit only the committed `lib/*.js`, or explicitly extend
    `files`/`npmignore`. No test currently checks pack contents, so this is a
    silent regression.
14. **Replace the install smoke's blind spot.** It installs the published
    `#v0.5.2` tag. Add a local check that packs the working tree or imports the
    generated entry points, otherwise a broken generated `lib/` passes the
    smoke.
15. **Keep the JSDoc contracts honest.** The current JSDoc annotations are the
    only type documentation. Migrating them into `.ts` types must not delete the
    English prose that `docs/reference.md` and tests cite.
16. **No new external runtime imports.** The only non-relative import may stay
    `@deepseek-ai/schemastery`. `test/invariant.test.js` and the reference both
    state "no runtime dependencies"; adding a helper library changes the
    install contract.
17. **Route registration stays on the authenticated connection carrier.**
    `test/invariant.test.js` rejects `webServer.register(`, `server.register(`,
    `noAuth`, `requireAuth: false`, `auth: false`, and `skipAuth` in
    `lib/index.js` and `lib/self-check.js`. A TS refactor must not introduce an
    alternate server seam.

## 8. Evidence index

All paths are relative to this report directory.

| File | Contents |
|---|---|
| `evidence/env-facts.txt` | Node, npm, git HEAD/branch/status raw runs |
| `evidence/baseline-node-test.txt` | Full `node --test test/` stdout (697 tests) |
| `evidence/baseline-npm-test.txt` | Full `npm test` stdout |
| `evidence/baseline-npm-test.meta.txt` | `npm test` exit code and summary tail |
| `evidence/baseline-npm-check.txt` | `npm run check` output (empty) |
| `evidence/baseline-npm-pack-dry-run.json` | Full `npm pack --dry-run --json` manifest |
| `evidence/baseline-commands-meta.json` | Machine-readable exit codes and output sizes |
| `evidence/baseline-install-smoke.txt` | Install smoke stdout/stderr, duration, exit code |
| `evidence/baseline-git-status.txt` | `git diff --check`, `git status --porcelain`, tracked counts |
| `evidence/ts-probe/ts-support-probe.txt` | `node --check`/`--test`/import probes on `.ts` |
| `evidence/ts-probe/enum-support-probe.txt` | Enum rejection and erasable-module import |
| `evidence/ts-probe/tsc-version.txt` | `tsc --version` → 7.0.2 |
| `evidence/ts-probe/probe.ts`, `probe.test.ts`, `probe-enum.ts` | Synthetic probe inputs |
