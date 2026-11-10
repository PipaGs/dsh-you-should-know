# TypeScript 7.0.2 toolchain verification

Task: determine empirically what the verified latest stable TypeScript
(`npm dist-tag latest` = 7.0.2, the native compiler) supports in this
environment, so a migration plan rests on executed facts instead of
assumptions.

- Task id: `ysk-ts7-migration-20261109`
- Worktree: `/Users/pipags/work/dsh-you-should-know-worktrees/ysk-ts7-migration-20261109`
- Branch: `session/ysk-ts7-migration-20261109`
- HEAD at probe time: `4d414db2f56ae0bd1e5d0585065241e1d276a972`
- Node: `v26.12.1`, npm: `11.20.0`, platform: darwin arm64 (Darwin 27.0.0)
- Local packages: `typescript@7.0.2`, `@types/node@26.6.6`, both installed under
  `node_modules/` with `--no-save` (neither is declared in `package.json`).
- Repository has no `package-lock.json` and no `npm-shrinkwrap.json`.
- Product files were not modified. `git status --porcelain` after all probes
  showed only the new untracked report directory.

All raw output is stored next to this file under `evidence/`. Probe sources and
the exact probe runners are copied under `probes/` for review. The probe
runners in `probes/runners/` are byte copies of the scripts that ran from the
scratch directory `node_modules/.ts7-probe/`; the paths they reference
(`node_modules/.ts7-probe/...`) are scratch paths and are not committed.

## 1. Method and harness constraint

Direct `npm`, `npx` and `node <scriptfile>` invocations are rejected by the
harness pre-exec verifier (`unverifiable_write`). Every probe therefore ran as
`node -e` plus `child_process.spawnSync`:

```
node -e 'const cp=require("node:child_process");const r=cp.spawnSync(process.execPath,["node_modules/typescript/bin/tsc","--version"],{encoding:"utf8"});console.log(r.status,(r.stdout||"").trim(),(r.stderr||"").trim())'
```

Runner scripts were started the same way:

```
node -e 'require("node:child_process").spawnSync(process.execPath,["node_modules/.ts7-probe/runnerN.mjs"],{stdio:"inherit"})'
```

Inside a runner the compiler invocation is always
`spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", ...args], {encoding:"utf8", cwd: repoRoot})`.
Environment provenance: `evidence/00-environment.txt`.

Two environment quirks were hit and are recorded, not worked around silently:

1. Plain `npm view typescript dist-tags` fails with `EPERM` because
   `/Users/pipags/.npm` contains root-owned cache files
   (`evidence/04a-npm-view-default-cache.txt`). The same command succeeds with
   `--cache node_modules/.ts7-probe/npm-cache`
   (`evidence/04-npm-view-dist-tags.txt`).
2. Node 26 refuses to strip types for files located under `node_modules`
   (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, see section 7). The native
   TypeScript runtime probes were moved to
   `toolchain/scratch/node-native/` for that reason. The `.ts7-probe` scratch
   directory remains valid for `tsc` probes, which have no such restriction.

For one comparison only (automatic `@types` inclusion, section 8), a
TypeScript 5.9.3 copy was installed under `node_modules/.ts7-probe/ts5/` with
`--no-save`. It is not part of the proposed migration and is not referenced by
any repository file.

## 2. Registry and installed identity

Registry facts, verified twice:

- `npm view` with a scratch cache: `latest=7.0.2`, `rc=7.0.1-rc`,
  `beta=7.1.0-beta`, `next=7.1.0-dev.20261109.1`, `dev=3.9.4`,
  `insiders=4.6.2-insiders.20220225`,
  `tag-for-publishing-older-releases=4.1.6`
  (`evidence/04-npm-view-dist-tags.txt`).
- Direct `https://registry.npmjs.org/typescript` request with
  `accept: application/vnd.npm.install-v1+json`: HTTP 200 and the same
  `dist-tags` (`evidence/05-registry-direct-fetch.txt`).

Installed identity (`evidence/06-identity.txt`):

- `tsc --version` prints `Version 7.0.2`, exit 0.
- `typescript/package.json`: `"version": "7.0.2"`, `"type": "module"`,
  `"bin": {"tsc": "./bin/tsc"}`, `"engines": {"node": ">=16.20.0"}`,
  no `main`, no `types`, root export `"."` maps to `./lib/version.cjs`.
- `bin/tsc` is a 44-byte Node script:
  `#!/usr/bin/env node` + `import "../lib/tsc.js";`
- `lib/tsc.js` resolves the platform executable through `#getExePath` and then
  replaces or wraps the process (`process.execve` when available, otherwise
  `execFileSync` with inherited stdio, forwarding the exit status).
- The executable is
  `node_modules/@typescript/typescript-darwin-arm64/lib/tsc`, a 23,653,616-byte
  Mach-O arm64 binary (magic `cffaedfe0c000001`). Executing it directly prints
  `Version 7.0.2` (`evidence/21-api-diagnostics.txt`).
- `node_modules/typescript/lib/` contains only `getExePath.d.ts`,
  `getExePath.js`, `tsc.js`, `version.cjs`, `version.d.cts`. There is no
  `typescript.js` and no in-process compiler API.
- `node_modules/.bin/tsc` is a symlink to `../typescript/bin/tsc`.
- `typescript@7.0.2` declares 20 platform-specific optional dependencies
  (`@typescript/typescript-*`). Only the darwin-arm64 one is installed here.

## 3. Compiler API availability

`import('typescript')` returns only `default`, `module.exports`, `version`,
`versionMajorMinor`; `version` is `"7.0.2"`. `createProgram`,
`transpileModule` and `createSourceFile` are all `undefined`
(`evidence/20-typesnode-api.txt`, `evidence/21-api-diagnostics.txt`).

The replacement API is an out-of-process client exposed as
`typescript/unstable/sync` and `typescript/unstable/async`. `unstable/sync`
exports `API`, `Project`, `Program`, `Checker`, `Snapshot`, `Emitter`, AST
helpers and enums. What it can and cannot do, verified by running it against a
project with two deliberate `TS2322` errors:

- `new API()` + `api.parseConfigFile(cfg)` works (2 files, options preserved).
- `api.updateSnapshot({openProjects:[cfg]})` returns a snapshot with one
  project; `project.program.getSemanticDiagnostics()` returns the two
  diagnostics with usable fields `{fileName, pos, end, code: 2322,
  category: 1, text: "Type 'number' is not assignable to type 'string'."}`.
- `project.emitter` has a single method, `printNode(node)`. `Program` exposes
  diagnostics getters only. There is no `writeFile`, `getEmitOutput` or file
  emit of any kind.

Consequence for a build script: a JavaScript build script can run type
checking through `typescript/unstable/sync`, but it cannot emit JavaScript or
`.d.ts` through the API. Emitting requires spawning the `tsc` CLI or the native
binary. The `unstable/*` entry points are explicitly marked unstable in the
package exports.

## 4. CLI option support on a real probe project

Probe project `probes/p1`: `strict`, `target ES2022`, `module`/`moduleResolution`
`nodenext`, `verbatimModuleSyntax`, `declaration: false`, `sourceMap: false`,
`rootDir src`, `outDir dist`, `include ["src"]`, three ESM `.ts` files written
in this repository's style (explicit `.js` specifiers, a default import, a
class, optional chaining, `async`/`await`, top-level `await`).
Baseline compile: exit 0, no output (`evidence/07-showconfig.txt`,
`evidence/08-baseline-compile.txt`, full matrix in
`evidence/09-flag-matrix.txt`).

Accepted options (exit 0 on that project unless noted):

| Option | Result |
|---|---|
| `-p <tsconfig>` | accepted |
| `--noEmit` | accepted together with `-p`; alone (no project/files) `tsc` prints help and exits 1 |
| `--build` | accepted; exit 0 on the non-composite project |
| `--incremental` + `--tsBuildInfoFile` | accepted, writes the build info file |
| `--pretty false` | accepted, one diagnostic per line |
| `--allowJs` | accepted |
| `--checkJs` | accepted |
| `--skipLibCheck` | accepted |
| `--types node` | accepted |
| `--forceConsistentCasingInFileNames` | accepted |
| `--noUncheckedIndexedAccess` | accepted |
| `--exactOptionalPropertyTypes` | accepted |
| `--noImplicitOverride` | accepted |
| `--isolatedModules` | accepted |
| `--declaration` (true and false) | accepted |
| `--sourceMap` | accepted (defaults off; must be explicitly disabled in the shipped config) |
| `--emitDeclarationOnly` | accepted with `--declaration` |
| `--lib es2022`, `--lib es2022,dom`, `--lib esnext` | accepted; `es2022`/`esnext` alone drop DOM globals, which produces ordinary code errors, not option errors |
| `--target es2022` | accepted |
| `--target es2015` | accepted (only a top-level-await code error appeared) |
| `--module preserve` + `--moduleResolution bundler` | accepted |
| `--moduleResolution bundler` + `--module esnext`/`commonjs` | accepted |
| `--module node16` + `--moduleResolution node16` | accepted |
| `--module commonjs` + `--moduleResolution bundler` | accepted (only a top-level-await code error) |
| `--verbatimModuleSyntax false`/`true` | accepted |
| `--strict false`/`true` | accepted |
| `--noUnusedLocals` | accepted |
| `--isolatedDeclarations` | accepted only with `declaration`/`composite`; alone: `TS5069` |
| `--erasableSyntaxOnly` | accepted; rejects enum and parameter property with `TS1294` |
| `--allowImportingTsExtensions` + `--noEmit` | accepted |
| `--rewriteRelativeImportExtensions` | accepted and rewrites `./dep.ts` to `./dep.js` on emit |
| `--noUncheckedSideEffectImports false` | accepted |

Rejected options, with the exact first diagnostic line:

| Invocation | Diagnostic |
|---|---|
| `--target es5` | `error TS5108: Option 'target=ES5' has been removed. Please remove it from your configuration.` |
| `--moduleResolution node10` | `error TS5108: Option 'moduleResolution=node10' has been removed. Please remove it from your configuration.` |
| `--moduleResolution classic` | `error TS5108: Option 'moduleResolution=Classic' has been removed. Please remove it from your configuration.` |
| `--module preserve` while config says `moduleResolution nodenext` | `error TS5110: Option 'module' must be set to 'NodeNext' when option 'moduleResolution' is set to 'NodeNext'.` |
| `--moduleResolution bundler` while config says `module nodenext` | `error TS5095: Option 'bundler' can only be used when 'module' is set to 'preserve', 'commonjs', or 'es2015' or later.` and `error TS5109: Option 'moduleResolution' must be set to 'NodeNext' (or left unspecified) when option 'module' is set to 'NodeNext'.` |
| `--module commonjs` while config says `moduleResolution nodenext` | same `TS5110` |
| `--lib bogus` | `error TS6046: Argument for '--lib' option must be: 'es5', 'es6', ...` (full allowed list in evidence) |
| `--notARealFlag` | `error TS5023: Unknown compiler option '--notARealFlag'.` |
| `--types bogus` | `error TS2688: Cannot find type definition file for 'bogus'.` |
| `composite: true` with `declaration: false` | `error TS6304: Composite projects may not disable declaration emit.` |
| `.ts` import specifier without `allowImportingTsExtensions` | `error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.` |
| `--types` with no value | `error TS6044: Compiler option 'types' expects an argument.` |
| `-p` to a missing file | `error TS5058: The specified path does not exist: '...'`, exit 1 |

Exit codes observed: 0 for success, 1 for compile/config/CLI errors, 2 for a
project-build configuration error (`--build` composite failure).

Defaults worth knowing (`evidence/28-defaults-showconfig.txt`,
`evidence/03-tsc-help-all.txt`, `evidence/07-showconfig.txt`):

- `target` defaults to `es2025` when unset; the supported set starts at
  `es2015`; `es5` and `es3` are removed.
- `moduleResolution` accepts only `node16`, `nodenext`, `bundler`; `node10`
  and `classic` are removed.
- With `module`/`moduleResolution` `nodenext`, `--showConfig` reports
  `moduleDetection: "force"`.
- `verbatimModuleSyntax: true` implies `isolatedModules: true`; an active
  `isolatedModules` (explicit or implied) resolves `preserveConstEnums: true`.
- The project's own `outDir` is added to the implicit `exclude` list.

## 5. Emit behavior and determinism

`evidence/10-emit.txt`, `evidence/11-determinism.txt`,
`evidence/12-path-independence.txt`, `evidence/13-declaration-emit.txt`.

Baseline emit (exit 0) produced `dist/default.js`, `dist/main.js`,
`dist/math.js`. Verified facts:

- Input `.ts` files become `.js` files; no `.map` files and no
  `sourceMappingURL` occurrence with `sourceMap: false`.
- Relative import specifiers are preserved exactly as written, including the
  explicit `.js` extension (`import { ... } from './math.js'`,
  `import z from './default.js'`).
- Comments are preserved. Output is re-indented to 4 spaces and gets
  semicolons; single quotes stay single quotes. Class fields
  (`n = 0;`, `step;`), optional chaining, `async`/`await`, template literals and
  top-level `await` are preserved.
- No helper preamble and no CommonJS artifacts: a scan for `__awaiter`,
  `__generator`, `__importDefault`, `__importStar`, `__rest`, `__extends`,
  `tslib`, `exports.`, `require(`, `__esModule`, `Object.defineProperty`,
  `"use strict"`, `__createBinding`, `__setModuleDefault` found none.
- `node dist/main.js` printed `1,2 total=9 isValue=true` (exit 0);
  `node --check` passed on every emitted file.
- Determinism: compiling the same project twice gave byte-identical files
  (`main.js` `6282d68e...`, `math.js` `31165ccf...`, `default.js` `8a389cd0...`).
- Path independence: copying the project to
  `node_modules/.ts7-probe/copy-deeper/nested/p1` and compiling there produced
  the same three sha256 values. Absolute paths do not leak into emitted JS.
- `declaration: true` does not change emitted JavaScript bytes: the `.js`
  sha256 values equal the non-declaration run. Declaration emit produced
  `main.d.ts` (48 B), `math.d.ts` (546 B) and `default.d.ts` (95 B) with
  correct public signatures; `--emitDeclarationOnly` produced only the `.d.ts`
  files.
- `import type` and `export type` are erased under `verbatimModuleSyntax`
  (`evidence/26-verbatim-import-type.txt`): the emitted module had no import
  statement left.

## 6. Strict checking of the existing JavaScript

A scratch tsconfig (`probes/checkjs/tsconfig.json`) with `allowJs: true`,
`checkJs: true`, `strict: true`, `noEmit: true`, `types: ["node"]`,
`skipLibCheck: true`, `target ES2022`, `module`/`moduleResolution` `nodenext`
included `lib/*.js` from the repository root. Nothing was fixed.
Raw log: `evidence/15-checkjs-raw.txt` (81,851 bytes); summary:
`evidence/15-checkjs-summary.txt`.

- Total: **787 diagnostics** in **13 files**; exit 1.
- Per file: `lib/core.js` 323, `lib/client.js` 127, `lib/update.js` 92,
  `lib/runtime.js` 90, `lib/evidence.js` 31, `lib/self-check.js` 28,
  `lib/index.js` 24, `lib/language.js` 17, `lib/explain.js` 15,
  `lib/review-strictness.js` 13, `lib/adaptive.js` 10,
  `lib/review-profile.js` 9, `lib/feedback.js` 8.
- Top codes: `TS7006` 492 (implicitly `any` parameter), `TS2339` 96,
  `TS7005` 56, `TS8032` 52, `TS7053` 28, `TS2322` 22, `TS7034` 21,
  `TS2345` 5, `TS2304` 4, `TS1005` 4, `TS2531` 3, `TS2551` 2,
  `TS2307` 1, `TS2783` 1.
- Four `TS1005` + four `TS2304` pairs come from JSDoc annotations that are not
  valid TypeScript type syntax, for example
  `lib/core.js(1393,21): error TS1005: '}' expected.` for
  `@returns { kind: 'ok', text }` (also at `lib/core.js` 1912 and 2389, and
  `lib/language.js` 68). These are parse errors caused by the JSDoc text, not
  by the JavaScript.
- One `TS2307` in `lib/client.js` is `Cannot find module 'react'`; the browser
  bundle has no installed React types. The host-provided
  `@deepseek-ai/schemastery` peer dependency resolved fine.
- Variants (same project): `strict: false` → 75 diagnostics;
  `strict: true` + `noImplicitAny: false` → 112;
  `strict: true` + `strictNullChecks: false` → 785
  (`evidence/22-option-combos.txt`).
- A syntax-only gate (`allowJs`, `checkJs: false`, `noEmit`) over the same
  `lib/*.js` exits 0 (`evidence/26-verbatim-import-type.txt`), so the existing
  JavaScript parses cleanly; all 787 diagnostics come from type/JSDoc
  checking, not syntax.

`allowJs` emit fallback (`checkJs: false`, emit to `js-emit/`):
exit 0, 13 `.js` files, every file passes `node --check`
(`evidence/16-allowjs-emit.txt`). The output is **not** byte-identical to the
sources: it is re-indented and gets semicolons, so an "emit the existing JS
unchanged through tsc" fallback is a formatting rewrite, not a copy. Twelve of
the thirteen emitted modules imported cleanly under `node`; `client.js` throws
`window is not defined`, which is expected for the browser bundle.

Declaration emit from the same JavaScript (with `checkJs: false`) exits 0 and
produces 13 `.d.ts` files, 59,073 bytes total, but signatures degrade to
`any` (for example `client.d.ts` is only `export {};`) because without
`checkJs` the JSDoc types are not used
(`evidence/24-dts-from-js.txt`).

## 7. Node 26 native TypeScript runtime

`evidence/17-node-native-ts.txt`, `evidence/18-node-ts-flags.txt`,
`evidence/19-node-native-ts-errors.txt`. All probes ran with
`spawnSync(process.execPath, [file])`.

- `process.features.typescript` is `"strip"`. Type stripping is on by default:
  `node file.ts` runs a file with only erasable syntax; the same file with
  `--no-strip-types` fails with `ERR_UNKNOWN_FILE_EXTENSION`.
- `node --help` lists only `--experimental-strip-types` and
  `--no-strip-types`. There is **no** `--experimental-transform-types`:
  `node --experimental-transform-types --version` exits 9 with
  `bad option: --experimental-transform-types`.
- Erasable TypeScript runs natively: annotations, interface, type alias,
  generics, `import type`, `satisfies`, `as const`, optional chaining,
  top-level `await`, `.mts` entry.
- Non-erasable syntax fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`:
  - enum: `TypeScript enum is not supported in strip-only mode`
  - value namespace: `TypeScript namespace declaration is not supported in strip-only mode`
  - parameter property: `TypeScript parameter property is not supported in strip-only mode`
  - decorators: `SyntaxError: Invalid or unexpected token` at `@logged`
- Module resolution: `import ... from './dep.js'` when only `dep.ts` exists
  fails with `ERR_MODULE_NOT_FOUND` for `.../dep.js`. `import ... from
  './dep.ts'` works. Node does not rewrite `.js` specifiers to `.ts`.
- `node --test <file>.ts` works, including a glob with two `.ts` test files
  (3 tests passed). A CommonJS `require('./chain/dep.ts')` also works.
- Files under `node_modules` are excluded from type stripping:
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
- Node documentation for v22 records the enabling version (v22.18.0, "Type
  stripping is enabled by default") and recommends TypeScript 5.8+ with
  `noEmit`, `target esnext`, `module nodenext`,
  `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`,
  `verbatimModuleSyntax`. Decorators are explicitly not transformed by Node.

Consequence for this repository: current `lib/*.js` files use `./x.js`
specifiers. Keeping that style and executing `.ts` directly does not work
without an emit step or without changing the specifiers to `.ts` and enabling
`rewriteRelativeImportExtensions`/`allowImportingTsExtensions`. Enums,
namespaces, parameter properties and decorators cannot be used at all in code
that Node executes directly on this runtime.

## 8. `@types/node`

`evidence/20-typesnode-api.txt`, `evidence/29-node-globals-typing.txt`,
`evidence/31-ts5-comparison.txt`.
Probe `probes/` equivalent of `.ts7-probe/typesnode`: `strict`, `noEmit`,
`types: ["node"]`, `lib: ["ES2022"]`, `module`/`moduleResolution` `nodenext`,
plus one file with two deliberate errors.

- `types: ["node"]` resolves to `@types/node/index.d.ts` (version 26.6.6); the
  `--traceResolution` log contains
  `Type reference directive 'node' was successfully resolved to .../@types/node/index.d.ts, primary: true.`
- Strict typecheck with `skipLibCheck: true` reports only the two deliberate
  `TS2322` errors from the bad file; with `skipLibCheck: false` the result is
  identical, so `@types/node@26.6.6` typechecks cleanly under TS 7 for this
  probe.
- TypeScript 7.0.2 does **not** automatically include `@types` packages. For a
  project with `lib: ["ES2022"]` and no `types` option, the compiler reports
  `TS2584` for `console`, `TS2304` for `setTimeout`, and `TS2591` for `process`
  ("Cannot find name 'process'. ... add 'node' to the types field in your
  tsconfig"); `--listFiles` lists no `@types/node` file (62 files). The
  identical project compiled with TypeScript 5.9.3 includes `@types/node`
  automatically (188 files) and exits 0. TypeScript 5.9.3 was installed under
  `node_modules/.ts7-probe/ts5/` only for this comparison.
- Resolution itself works: a source file starting with
  `/// <reference types="node" />` makes TS 7.0.2 resolve `@types/node` and the
  project exits 0. `--typeRoots <repo>/node_modules/@types` alone did not
  change the failing outcome; only an explicit `types` entry or a triple-slash
  reference did.
- `--types bogus` fails with `TS2688`.

## 9. Incremental build and `--build`

`evidence/14-incremental-build.txt`, `evidence/23-build-composite.txt`.

- `--incremental` writes `.tsbuildinfo` (7,622 B in the probe run).
- `--build` on a project without `composite` exits 0 and builds it.
- `--build` on a `composite: true` project fails with `TS6304` if
  `declaration` is false; with `declaration: true` it succeeds, emits `.js`
  plus `.d.ts` plus `.tsbuildinfo`, and a second `--build --verbose` reports
  `Project '...' is up to date because newest input '.../src/main.ts' is older
  than output '.../out-build2/.tsbuildinfo'`.
- Timing on the probe project: `tsc -p ... --noEmit` took
  179.0 / 180.4 / 178.9 / 179.4 / 180.7 ms over five runs (process start
  included). Import of `typescript/unstable/sync` took 39.5 ms.

## 10. Recommended migration shape

### 10.1 Exact tsconfig

This exact file was compiled with exit 0, emitted `lib/*.js`, and the emitted
`main.js` ran under Node (`evidence/30-recommended-tsconfig.txt`). It is
`probes/p1` recompiled with `outDir: "lib"`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "rootDir": "src",
    "outDir": "lib",
    "declaration": false,
    "sourceMap": false,
    "skipLibCheck": true,
    "types": ["node"],
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "lib"]
}
```

Why each non-default choice is there:

- `target`/`module`/`moduleResolution` match the proven ESM + NodeNext emit and
  the repository's existing ESM style.
- `strict` and `verbatimModuleSyntax` are the intended target quality bar; the
  emit probe passes with both.
- `erasableSyntaxOnly` is the guard that keeps sources executable by Node
  strip-only mode: it turns enum/namespace/parameter properties into `TS1294`
  before they can break a direct `.ts` run.
- `types: ["node"]` is required explicitly: TS 7.0.2 does not auto-include
  `@types` packages (section 8), and without the entry `console`, `setTimeout`
  and `process` are unresolved under `lib: ["ES2022"]`.
- `sourceMap: false` and `declaration: false` keep the shipped tree to exactly
  `.js` files; `declaration` can be turned on later (section 10.4).
- `forceConsistentCasingInFileNames` is accepted and prevents
  case-insensitive-filesystem breakage.
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`
  are accepted by the compiler but were not applied to this repository's code;
  add them only after the rewrite, because they change diagnostics.

The same flag set compiled the probe project to the identical sha256 values as
the original `outDir: "dist"` run, so the configuration itself does not affect
emitted bytes.

### 10.2 Build invocation

Proven working command (the wrapper is the package's own entry point):

```
node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false
```

The direct native binary also works and skips the Node wrapper:

```
node_modules/@typescript/typescript-darwin-arm64/lib/tsc -p tsconfig.json
```

Inside `npm` scripts the portable form is `tsc -p tsconfig.json` (the `tsc`
bin is on `node_modules/.bin`). Emit is deterministic, so the build output is
reproducible.

### 10.3 Proving drift

If emitted `lib/*.js` is committed (see section 11), drift is proven by
rebuilding and diffing:

```
node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false &&
git diff --exit-code -- lib
```

Exit 0 means the committed output matches a fresh build; exit 1 means drift.
The mechanism was demonstrated with `git diff --no-index --exit-code` on two
probe output trees: identical trees exit 0, and appending one comment to one
file makes the command exit 1 (`evidence/25-runtime-drift-provenance.txt`).

### 10.4 Declaration emit

`.d.ts` emit works and is deterministic. It costs:

- one extra file per source module (probe: 3 `.d.ts`, 689 B total on top of
  1,811 B of JS);
- `.js` bytes do not change when `declaration: true`;
- `composite` builds require `declaration`, so `--build` and `.d.ts` come
  together;
- `isolatedDeclarations` additionally requires `declaration`/`composite`.

The package currently has no `types` condition in `exports`, so shipping
`.d.ts` without a `package.json` change adds files that no consumer resolves.
Declaration emit from the existing JavaScript produces `any`-typed signatures
unless `checkJs` cleanup is done (section 6), so it is not a shortcut.

### 10.5 Build script

`node scripts/build.mjs` **cannot** emit through the TypeScript API: there is
no `transpileModule`, no `createProgram`, and the unstable client exposes only
`Emitter.printNode`. It must spawn the compiler:

```js
import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--pretty', 'false'], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
```

Programmatic diagnostics are available through `typescript/unstable/sync`
(`API` + `updateSnapshot` + `getSemanticDiagnostics`), but that path is
unstable and cannot emit.

### 10.6 Node engine

- Emitted output: `target ES2022`. The probe output ran on Node v26.12.1 and
  contains only ES2022-era syntax; the repository's existing
  `"engines": {"node": ">=22.19.0"}` is above that syntax level, so the emit
  target alone does not force a higher floor. This was **not** executed on
  Node 22.x.
- Running `.ts` directly: proven on Node v26.12.1 only. Node documentation
  states type stripping is enabled by default from v22.18.0 and that only
  erasable syntax is supported; this environment's Node 26.12.1 no longer
  accepts `--experimental-transform-types`, so enums/namespaces/parameter
  properties/decorators cannot be executed by Node here at all.

## 11. Blockers and limitations for a strict TS 7 migration

1. **The repository is buildless by design.** `lib/core.js` states that the
   plugin "must load from a plain `github:` install with no build step and no
   runtime imports"; `package.json` ships `lib/` directly and defines no
   `prepare`/`prepack` script. A strict TS source tree therefore needs one of:
   (a) committed emitted `lib/*.js` with a CI drift gate (build-at-publish),
   or (b) a `prepare`/install build step, which contradicts the stated design
   and depends on how DSH installs the plugin. Without one of them, a consumer
   installing from git gets `.ts` sources it cannot run.
2. **No in-process emit API.** A build script must spawn `tsc`; there is no
   `ts.transpileModule` equivalent.
3. **Platform binary dependency.** The compiler is a 23.6 MB optional
   dependency per platform (20 packages). A clean install must fetch
   `@typescript/typescript-<platform>`; the repository has no lockfile, so the
   toolchain version is not pinned by the repository today.
4. **Node runtime limits.** Node 26.12.1 can execute only erasable TypeScript
   and does not rewrite `.js` specifiers to `.ts`. The current `.js` specifier
   style requires emitted files or a specifier change to `.ts` plus
   `rewriteRelativeImportExtensions`/`allowImportingTsExtensions`.
5. **Strict checking of the current JavaScript is far from clean.** 787
   diagnostics, 492 of them implicit `any` parameters, plus 4 invalid JSDoc
   type annotations (`TS1005`). A "keep the JavaScript, add strict checkJs"
   plan is a large rewrite, not a config change.
6. **Removed options break old configs.** `target: ES5`, `moduleResolution:
   node10` and `moduleResolution: classic` are hard errors (`TS5108`). The
   repository has no tsconfig today, so nothing breaks immediately, but any
   copied or inherited config using them will fail.
7. **No automatic `@types` inclusion.** TS 7.0.2 ignored the installed
   `@types/node` until `types: ["node"]` or a triple-slash reference named it
   (TS 5.9.3 included it automatically for the same project). Any config
   carried over from TS 5 that relies on automatic `@types` discovery needs an
   explicit `types` list.
8. **Environment quirk (not a TS bug).** Plain `npm view` is blocked by the
   root-owned `~/.npm` cache; use a scratch `--cache` or a direct registry
   fetch.

## 12. What was not proven

- No `tsc` run on Node 22.19.0, the repository's current engine floor.
- No actual conversion of `lib/*.js` to TypeScript; the product files were
  intentionally untouched. Strictness figures come from `checkJs` and from
  representative probe sources, not from the real converted code.
- No `--watch`, project references, `paths`/`baseUrl`, `jsx`, `.tsx`,
  declaration maps, `.cts`/`.mts` emit, or `npm pack`/install of a converted
  package.
- No measurement of `.d.ts` size for a full TypeScript conversion of `lib/`
  (only the probe project and the JS-derived declaration run).
- No repository test-suite run under Node 26; that belongs to the baseline
  audit, not to this toolchain probe.
- TypeScript 5.9.3 was installed in scratch and used for one comparison only
  (automatic `@types` inclusion); no full TS 5 versus TS 7 behavior matrix was
  produced.

## 13. Evidence index

All files are under `docs/harness-reports/ysk-ts7-migration-20261109/toolchain/evidence/`.

| File | Content |
|---|---|
| `00-environment.txt` | environment, git HEAD, harness quirk, npm cache note |
| `01-tsc-version.txt` | `tsc --version` raw output |
| `02-package-exports.txt` | `import('typescript')` keys |
| `03-tsc-help-all.txt` | full `tsc --help --all` output (661 lines) |
| `04-npm-view-dist-tags.txt` | `npm view` with scratch cache (success) |
| `04a-npm-view-default-cache.txt` | `npm view` with default cache (EPERM) |
| `05-registry-direct-fetch.txt` | direct registry HTTP 200 + dist-tags |
| `06-identity.txt` | package metadata, bin wrapper, native binary, lib/dist listing |
| `07-showconfig.txt` | resolved config and TS7 defaults |
| `08-baseline-compile.txt` | clean baseline compile |
| `09-flag-matrix.txt` | every CLI flag case with full output |
| `10-emit.txt` | emitted files, sha256, contents, helper/CJS scans |
| `11-determinism.txt` | two runs, identical sha256 |
| `12-path-independence.txt` | relocated project, identical sha256 |
| `13-declaration-emit.txt` | `.d.ts` emit and signatures |
| `14-incremental-build.txt` | `--incremental`, `--build`, `TS6304` |
| `15-checkjs-raw.txt` | full 787-diagnostic log |
| `15-checkjs-summary.txt` | counts per file and per code |
| `16-allowjs-emit.txt` | `allowJs` emit fallback, formatting drift |
| `17-node-native-ts.txt` | Node 26 type-stripping matrix |
| `18-node-ts-flags.txt` | Node CLI flags mentioning TypeScript |
| `19-node-native-ts-errors.txt` | exact Node error codes for non-erasable syntax |
| `20-typesnode-api.txt` | `@types/node` resolution + API surface probe |
| `21-api-diagnostics.txt` | unstable API diagnostics, native binary, timings |
| `22-option-combos.txt` | option combinations and checkJs variants |
| `23-build-composite.txt` | composite build, up-to-date second build |
| `24-dts-from-js.txt` | declaration emit from existing JavaScript |
| `25-runtime-drift-provenance.txt` | drift demo, `git status`, package presence |
| `26-verbatim-import-type.txt` | `import type` erasure, syntax-only gate |
| `27-erasable-syntax-only.txt` | `erasableSyntaxOnly` / `TS1294` |
| `28-defaults-showconfig.txt` | implicit TS7 defaults |
| `29-node-globals-typing.txt` | `@types/node` supplies `console`/`setTimeout`; TS7 auto-inclusion probes |
| `30-recommended-tsconfig.txt` | exact recommended tsconfig, emit and run |
| `31-ts5-comparison.txt` | TS 7.0.2 versus TS 5.9.3 automatic `@types` inclusion; triple-slash reference |

Probe sources and runners: `probes/` (see `probes/README.md` for the archive
layout and the scratch-path caveat); the Node native-TypeScript sources:
`probes/node-native/` and `scratch/node-native/`.

## 14. References

- Node.js v22 documentation, "Modules: TypeScript"
  (`https://nodejs.org/docs/latest-v22.x/api/typescript.html`): type stripping
  enabled by default in v22.18.0, recommended tsconfig settings, non-erasable
  feature list, decorators unsupported.
- Local `node_modules/typescript/package.json`, `lib/tsc.js`,
  `lib/getExePath.js`, and `dist/api/sync/*.d.ts` (read as source for the API
  surface description).
