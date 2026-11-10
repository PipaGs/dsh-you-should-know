# Design — TypeScript 7 migration

- Repository: `PipaGs/dsh-you-should-know`
- Branch: `session/ysk-ts7-migration-20261109`
- Base HEAD: `4d414db2f56ae0bd1e5d0585065241e1d276a972`
- Final phase date: 2026-11-09
- Raw evidence: [migration/phase1/](migration/phase1/), [migration/phase2/](migration/phase2/), [migration/phase3/](migration/phase3/), [migration/phase4/](migration/phase4/), [migration/review-round1/](migration/review-round1/), [migration/final/](migration/final/)
- Toolchain verification: [../toolchain/verification.md](../toolchain/verification.md)
- Typing rules: [conventions.md](conventions.md)

## 1. Layout

| Path | Role | Final state |
|---|---|---|
| `src/*.ts` | Authored TypeScript sources, 13 modules plus `src/globals.d.ts` | Source of truth; content migrated from the previous shipped JavaScript with no behavior change |
| `lib/*.js` | Committed compiler output, shipped by `files: ["lib"]` | Emitted by `npm run build`; byte-for-byte current with `src/` |
| `test/*.test.js` | Black-box test suite, 34 files, 697 tests | Unchanged; stays JavaScript |
| `scripts/*.mjs` | Dev-only tools; not shipped | Stays JavaScript; `check-build-drift.mjs` and `local-install-smoke.mjs` added |
| `tsconfig.json` | The one compiler project | Final, with `noEmitOnError: true` |
| `package.json` | Build/verify scripts and pinned toolchain | `smoke:local` added and both new dev scripts added to `check:js`; `main`, `exports`, `files`, `dsh`, peer dependency, and `prepare` untouched |

`src/globals.d.ts` declares only the browser members `src/client.ts` reads:
`window.__ModuleLoader__.load({ id, factory(require) })`, the window focus
listeners, `document.visibilityState` and its visibility listener, and
`navigator.clipboard`. It contains no `any` and adds no DOM library.

## 2. Compiler project

`tsconfig.json` is the option set proven in `toolchain/verification.md`:

- `target: "ES2022"` and `lib: ["ES2022"]`. The runtime target and the type
  library agree, and no DOM library is pulled in. The browser half gets its few
  browser members from the narrow local `globals.d.ts` instead of a full DOM
  surface.
- `module: "nodenext"`, `moduleResolution: "nodenext"`, `strict: true`,
  `verbatimModuleSyntax: true`, `erasableSyntaxOnly: true`.
- `types: ["node"]` is explicit because TypeScript 7.0.2 does not auto-include
  installed `@types` packages.
- `rootDir: "src"`, `outDir: "lib"`, `declaration: false`, `sourceMap: false`,
  `skipLibCheck: true`, `forceConsistentCasingInFileNames: true`,
  `include: ["src/**/*.ts"]`.
- `noEmitOnError: true`. This is the final state: the compiler no longer emits a
  partial tree when a type error exists, so `npm run build` can only produce the
  committed build or fail loudly. The build-drift gate treats a diagnostic or a
  non-zero compiler exit as a failure as well, so a broken emit can never be
  compared with `lib/` or shipped.

`moduleDetection: "legacy"` is required, not cosmetic. The repository is
`"type": "module"`, so under `nodenext` TypeScript would treat the import-free
`src/client.ts` as an ES module and append `export {};` to the emitted
`lib/client.js`. That would turn the browser global script into a module and
break the host module table and the `node:vm` client tests. `legacy` keeps the
file a script. TypeScript 7 then adds a `"use strict";` prologue, because TS7
removed the `alwaysStrict` option (`TS5108`) and always emits a strict prologue
for script output. The prologue is harmless here: the client code uses no
sloppy-mode-only construct, and all 697 tests pass on the emitted file.

`declaration` stays `false`. Declaration emit adds `.d.ts` files that no
`exports` condition resolves, and it would also emit a module wrapper for the
script. There is no `types` field and no declaration consumer today.

## 3. Commands

```sh
npm run build          # tsc -p tsconfig.json -> lib/*.js (fails without emitting on a diagnostic)
npm run typecheck      # tsc -p tsconfig.json --noEmit
npm run check:js       # node --check on the 13 lib files and the 6 dev scripts
npm run check:drift    # build into node_modules/.build-check, compare bytes with lib/
npm test               # npm run check:js && node --test test/*.test.js
npm run check          # npm run typecheck && npm run check:drift && npm run check:js
npm run smoke:local    # pack, install into a scratch consumer, check the installed artifact
```

`scripts/check-build-drift.mjs` compiles into an ignored scratch directory
(`node_modules/.build-check`), compares the emitted file set and bytes with
`lib/`, and exits 0 on sync, 1 on drift, and 2 when the compiler reports a
diagnostic, exits non-zero, cannot run, or emits nothing. It never writes
`lib/` and never runs Git. The optional `--expected`, `--out`, and `--tsconfig`
arguments are how the drift alarm and the diagnostic alarm were proven without
mutating `lib/`, `src/`, or the Git index.

`scripts/local-install-smoke.mjs` proves the distribution acceptance without
leaving the workspace. The default mode packs the working tree with
`npm pack --json --pack-destination node_modules/.smoke-local/pack`, installs
the tarball with `--ignore-scripts` and the workspace npm cache into
`node_modules/.smoke-local/consumer`, and checks the tarball file list, the
absent install hooks, the main and subpath exports, the schemastery `Config`
schema, and the browser bundle envelope. An optional argument replaces the
tarball with an exact install spec (for example a `github:` ref) and runs the
same runtime assertions; that mode is the only one that always needs the
network. Every scratch directory it creates is removed on exit.

## 4. Emit parity

The sources are the previous shipped JavaScript, migrated module by module, and
compiled. Parity was checked four ways:

- 697 of 697 tests pass against the emitted `lib/*.js`;
- all 13 emitted files and the dev scripts pass `node --check`;
- the sorted export names of the 12 importable modules are identical to HEAD
  (`migration/phase1/12-export-surface-parity.txt`);
- `git diff --check` is clean and the drift gate reports the committed bytes
  (`migration/phase4/02-drift-pass.txt`).

The emitted bytes differ from HEAD because TypeScript reprints the source: four
spaces of indentation, semicolons, collapsed single-line functions, and the
client prologue. Exposed export names, string literals, and every HEAD comment
text are unchanged. Local identifiers were renamed by typing (for example
`streamed` instead of `iterable` in `lib/core.js`, `started`/`inFlight` instead
of `pending` in `lib/update.js`, `onOpenFile` in `lib/client.js`, and
`resolveDeadline` in `lib/runtime.js`), and the typing phases added type-guard
and contract comments (net +74 comment lines in emitted `lib/` versus HEAD).
Two HEAD comments moved to the previous line in `src/client.ts` and
`src/core.ts` to avoid the emitter's trailing-space artifact in list positions
(details in conventions section 5); their text is unchanged. Behavior is
unchanged; the test suite and the export surface prove it.

### 4.1 Round-1 type-honesty changes

Independent review round 1 found no P0 or P1 issues. Its five code-changing P2
findings are closed:

- **Closed vocabularies (R3).** `IMPORTANCE`, `RECENT_CHECK_OUTCOMES`,
  `NOTE_KINDS`, `UPDATE_BEHAVIORS`, and `RUNTIME_STATUS` are the single source
  of the literal unions. `ReviewerVerdict.kind`, `StoredNote.kind`,
  `NoteView.kind`, `RecentCheckRecord.outcome`,
  `UpdateState.updateBehavior`, and `RuntimeStatusSnapshot.runtimeStatus` use
  those unions. Three small predicates (`isNoteKind`, `isRecentCheckOutcome`,
  `isRuntimeStatus`) keep narrowing at the validation boundary and are
  set-equivalent to the expressions they replace. `RuntimeOutcome.status` and
  the snapshot `lastOutcome` deliberately stay `string`: they carry the
  arbitrary non-empty delivery label returned by the injected `onNote`
  callback, and the JSDoc records that contract.
- **Removed cast (R2).** `makeRuntime` returns `createRuntime({ ... })`
  directly; the `as SessionRuntime` assertion and the false "placeholder type"
  comment are gone.
- **Oldest-key guard (R4).** `oldestKey` returns `K | undefined` and documents
  the non-empty precondition; its three call sites guard the empty case inside
  the existing size checks. The eviction tests cover the behavior.
- **Dead type (R5).** The unused `SettingsFormEntry` interface is removed.
- **Accepted limitations.** `src/globals.d.ts` declares the browser globals for
  the whole program (R6): one tsconfig without project references, no server
  module reads them today, and no runtime or invariant change. `test/` and
  `scripts/` stay JavaScript (R7) for the reasons in section 5.

## 5. Test and scripts stay JavaScript

`test/` stays `.test.js` and `scripts/` stays `.mjs`. The reasons are specific to
this repository, not a preference:

1. The tests are black-box against the shipped artifacts. 23 of the 34 test files
   statically import `../lib/*.js`; three read `lib/client.js` as text and
   evaluate it in `node:vm`; `test/invariant.test.js` reads 12 shipped files as
   text and scans their code. A TypeScript test tree would need its own build and
   would then exercise a test build, not the exact committed files an install
   loads.
2. The upstream-ledger invariant pins JS test files and historical docs.
   `test/upstream-ledger.test.js` reads `test/client-ui.test.js` as text and
   requires three exact assertion substrings, and it hashes historical documents
   at fixed commits and tags. Renaming or rewriting those files fails the ledger
   even when product code is unchanged.
3. A TypeScript client test would re-open the module-wrapper problem. The client
   is a global script; the wrapper behavior above shows how easily a test build
   diverges from the shipped file.
4. `scripts/*.mjs` are dev-only Node tools, excluded from `files`, run directly
   by Node, and imported by four test files. Converting them adds a build path
   and toolchain surface with no product gain.

## 6. Phase list

1. **Phase 1: scaffold and parity.** Add `src/`, the compiler project, the build
   and drift gates, and prove that the emitted tree reproduces the shipped
   JavaScript behavior. Evidence: `migration/phase1/`.
2. **Phase 2: typed core.** Remove the strict diagnostics module by module in
   descending count order, starting with `core`, `client`, `update`, and
   `runtime`, then the smaller modules. No behavior change is allowed to pay for
   a type. Evidence: `migration/phase2/`.
3. **Phase 3: remaining modules and the built client.** Finish the strict typing
   of the remaining modules and the browser half, keep the suite at 697 passing,
   and prove the emitted `lib/*.js` still matches the tested files. Evidence:
   `migration/phase3/`.
4. **Phase 4: packaging and documentation.** Set `noEmitOnError: true`, harden
   the drift gate so a diagnostic fails it, add the local install smoke, update
   `README.md`, `docs/reference.md`, `AGENTS.md`, and this design, and run the
   full gate. Evidence: `migration/phase4/`.
5. **Review round 1 (final).** Apply the independent reviewer's type-honesty
   fixes in `src/`, rebuild the affected `lib/*.js`, and record the accepted
   limitations. Evidence: `migration/review-round1/`.

## 7. Verification matrix

| Gate | Command | Result |
|---|---|---|
| Typecheck | `tsc -p tsconfig.json --noEmit` | Exit 0, 0 diagnostics |
| Build | `tsc -p tsconfig.json` | Exit 0, 13 files in `lib/` |
| Build drift | `node scripts/check-build-drift.mjs` | Exit 0, 13 files byte-identical |
| Drift alarm | drift gate against a one-byte-edited scratch copy | Exit 1 |
| Diagnostic alarm | drift gate against a scratch project with a type error | Exit 2, no emit |
| Syntax | `npm run check:js` | Exit 0, 13 lib files and 6 dev scripts |
| Tests | `node --test test/` | 697 of 697 pass |
| Test script | `npm test` | Exit 0, 697 of 697 pass |
| Composite check | `npm run check` | Exit 0 (typecheck, drift, syntax) |
| Local install smoke | `node scripts/local-install-smoke.mjs` | Exit 0, 21 checks |
| Whitespace | `git diff --check` | Clean |
| Repository language | `node --test test/repository-language.test.js` | Pass |

Observed distribution facts: the `npm pack` tarball has 18 entries, including
the 13 committed `lib/*.js` files, `README.md`, `docs/reference.md`,
`cordis.patch.yml`, `package.json`, and `LICENSE`, and no `src/`, TypeScript,
declaration, map, `test/`, or `scripts/` entry. The installed package has no
`preinstall`, `install`, `postinstall`, `prepare`, or `prepack` script. The
workspace declares no runtime `dependencies` and no `prepare` script, so a
`github:` install runs no build.
