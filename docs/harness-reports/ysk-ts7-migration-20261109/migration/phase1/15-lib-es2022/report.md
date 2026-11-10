# Phase 1 follow-up — `lib: ["ES2022"]` in `tsconfig.json`

- Date: 2026-11-09
- Worktree: `/Users/pipags/work/dsh-you-should-know-worktrees/ysk-ts7-migration-20261109`
- Branch: `session/ysk-ts7-migration-20261109`
- Base HEAD: `4d414db2f56ae0bd1e5d0585065241e1d276a972`
- Scope of this change: `tsconfig.json` (one option) and `conventions.md` section 4.
  No `src/*.ts`, no `lib/*.js`, no test, no Git state.

## 1. Problem and change

The project did not set `compilerOptions.lib`, so TypeScript 7 used its default
target library set, which includes the DOM library. The DOM `Window`,
`Document`, and `Navigator` types were therefore in scope. The symptom was
`src/client.ts(10,8): error TS2339: Property '__ModuleLoader__' does not exist
on type 'Window & typeof globalThis'`: the real DOM `Window` won over the
`window` declaration in `src/globals.d.ts`.

The fix adds one line to `tsconfig.json`:

```json
"lib": ["ES2022"]
```

Everything else is unchanged: `target ES2022`, `module nodenext`,
`moduleResolution nodenext`, `moduleDetection legacy`, `strict`,
`verbatimModuleSyntax`, `erasableSyntaxOnly`, `rootDir src`, `outDir lib`,
`declaration false`, `sourceMap false`, `skipLibCheck`, `types ["node"]`,
`forceConsistentCasingInFileNames`, `include ["src/**/*.ts"]`, and an absent
`noEmitOnError`.

## 2. Diagnostics delta

Raw logs: `01-typecheck-before.txt` (old config), `02-typecheck-after.txt`
(new config). Both are `tsc -p tsconfig.json --noEmit --pretty false`.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Total diagnostics | 745 | 809 | +64 |
| `src/client.ts` | 126 | 190 | +64 |
| Other 12 sources | 619 | 619 | 0 |

Per code: `TS2339` 102 → 166 (+64), `TS7006` 492 → 491 (-1),
`TS18046` 7 → 8 (+1); every other code count is unchanged. Per file, only
`src/client.ts` moved; `core`, `runtime`, `update`, `index`, `self-check`,
`evidence`, `review-strictness`, `explain`, `adaptive`, `feedback`, `language`,
and `review-profile` have identical counts.

Removed diagnostics (2):

- `src/client.ts(10,8) TS2339: Property '__ModuleLoader__' does not exist on
  type 'Window & typeof globalThis'` — gone; `window` now resolves to
  `ClientWindow` from `src/globals.d.ts`.
- `src/client.ts(12,11) TS7006: Parameter 'require' implicitly has an 'any'
  type` — gone; the `factory(require)` parameter is now contextually typed by
  the `ModuleLoaderEntry` contract.

Added diagnostics (66) are all real, stricter typing of the same code, not DOM
noise:

- 4 from React: `require('react')` now returns `unknown` instead of `any`
  (one `TS18046` plus three `TS2339` member accesses).
- 62 from Fetch response bodies: `@types/node` types `Response.json()` as
  `Promise<unknown>`, so `.ok`, `.notes`, `.config`, `.explanation`, and similar
  reads on a parsed body are errors. The default DOM library had typed them as
  `any` and hid this. These are the phase-2 work, not a regression.

No remaining diagnostic mentions `Window`, `Document`, `Navigator`,
`globalThis`, `HTMLElement`, or a DOM type. `src/globals.d.ts` reports 0
diagnostics. There is no `TS2304` (cannot find name) and no `TS2591` (missing
Node types) anywhere in the after log, so host code still resolves
`fetch`/`Request`/`Response`/`setTimeout`/`console` through `@types/node`.

## 3. Emit verification

Raw log: `03-scratch-emit.txt`. A build ran with
`--outDir node_modules/.lib-es2022-check`, so `lib/` was not touched.

- `lib/client.js` scratch output starts with `"use strict";`.
- The scratch `client.js` contains no top-level `import` or `export`.
- The envelope `window.__ModuleLoader__.load({ id, factory(require) })` is intact.
- All 13 scratch-emitted files are byte-identical to the committed `lib/*.js`.

The `lib` option changes type checking only, never emit. Because the emitted
bytes did not change, `lib/*.js` was not rebuilt and no behavior could change.

## 4. Gates

Raw logs: `04-drift-check.txt`, `05-npm-test.txt`, `06-node-test.txt`.

| Gate | Result | Exit code |
|---|---|---:|
| `node scripts/check-build-drift.mjs` | 13 files match the fresh build byte for byte | 0 |
| `npm test --silent` (`check:js` + `node --test test/*.test.js`) | tests 697, pass 697, fail 0 | 0 |
| `node --test test/` | tests 697, pass 697, fail 0 | 0 |

`src/*.ts` and `lib/*.js` hashes were captured before and after the before/after
typecheck runs and did not change; the manifest is `00-src-lib-hashes.txt`.
Parallel implementer edits did not contaminate the delta.

## 5. Documentation correction

`conventions.md` section 4 now states the truth: the project loads
`lib: ["ES2022"]` only; `@types/node` is the only source of Node globals;
`src/globals.d.ts` is the only source of browser globals; do not add `"dom"` or
any other lib. It also records that host code sees the Node `fetch` /
`Response.json(): Promise<unknown>` contract and that parsed bodies must be
validated, which explains the +62 client diagnostics.

## 6. Follow-up note

`design.md` section 2 still lists the compiler options without `lib`. This
follow-up was limited to `tsconfig.json` and `conventions.md`, so `design.md`
was left untouched; its option list should gain
`lib: ["ES2022"]` in the next documentation pass.
