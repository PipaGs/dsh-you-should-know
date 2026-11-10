# Review round 1 (ChatGPT) — P1 fix: `--out` containment in the drift gate

- Date: 2026-11-10
- Worktree: `/Users/pipags/work/dsh-you-should-know-worktrees/ysk-ts7-migration-20261109`
- Branch: `session/ysk-ts7-migration-20261109`
- Scope: `scripts/check-build-drift.mjs`, new `test/build-drift-safety.test.js`,
  and the dated section appended to `final-report.md`. No `src/**`, `lib/**`,
  `package.json`, `tsconfig.json`, existing `test/` file, or other script changed.

## 1. Defect

`parseArgs` accepted any `--out` value through `path.resolve(ROOT, value)`, and
`main` then ran `await rm(options.out, { recursive: true, force: true })` and
passed the same path to `tsc --outDir` before any containment check. A caller
could therefore point the gate at `.`, `lib`, `src`, a home directory, or an
ancestor and have it recursively deleted and then used as compiler output.
Severity P1: destructive, unauthenticated within the local tool contract.

## 2. Containment rule

Destructive output is confined to `ROOT/node_modules/.build-check`, the ignored
scratch root. An `--out` value is accepted only when it equals that root or sits
strictly below it; everything else is rejected with exit code 2 before any `rm`
and before tsc starts. The checks, in order (`unsafeOutReason`, script lines
104-142):

1. Lexical containment: the already-resolved absolute `--out` must be inside
   `SAFE_OUT_ROOT` by path segments (`isInsideOrEqual`, script lines 76-79).
   String-prefix comparison is not used, so sibling lookalikes such as
   `node_modules/.build-check-evil` are rejected.
2. Parent resolution: `realpath(ROOT/node_modules)` must stay inside
   `realpath(ROOT)`, and, when `node_modules/.build-check` exists, its real path
   must stay inside both `realpath(ROOT)` and `realpath(ROOT/node_modules)`. A
   `node_modules` or `.build-check` that resolves outside the repository is
   rejected with a message naming the resolved path.
3. Symlink escape: the deepest existing ancestor of `--out` is resolved with
   `realpath` (`deepestExistingRealpath`, script lines 82-92) and must stay
   inside the scratch root's real path (or `node_modules` when the scratch root
   does not exist yet). `--out node_modules/.build-check/escape-link/nested`,
   where `escape-link` points outside the repository, is rejected even though
   its string form looks safe.

The rejection runs at script lines 199-205 and prints
`build drift check: refusing unsafe --out: <reason>` plus
`destructive output is confined to <SAFE_OUT_ROOT>`, then returns exit code 2.
The default `--out node_modules/.build-check` is unchanged; `--expected`
(default `lib`) and `--tsconfig` (default `tsconfig.json`) remain read-only
inputs with no new validation; `--help` still exits 0 without touching any path.
No compiler flag changed.

`USAGE` and the header comment now document the `--out` restriction.

## 3. Regression test

`test/build-drift-safety.test.js` is plain ESM JavaScript like the rest of the
suite and contains one top-level test,
`test/build drift gate confines destructive output to the scratch root`. It
never passes `.`, `lib`, a home directory, or an ancestor to the real script.
Every rejection target is a disposable fixture under gitignored `node_modules/`:

- an absolute fixture directory outside the scratch root;
- a sibling lookalike `node_modules/.build-check-evil-<pid>`;
- a lexical traversal that resolves outside the scratch root;
- a symlink `node_modules/.build-check/escape-link-<pid>/nested` that points at
  the outside fixture.

Each rejection asserts exit code 2, the `refusing unsafe --out` message, and a
byte-identical sentinel file in the fixture. The test then proves the safe
paths: the default invocation exits 0 and reports `13 file(s)` byte-identical,
and an explicit `node_modules/.build-check/custom-<pid>` also exits 0. Fixtures
and the symlink are removed in a `finally` block; every child process has a
60-second spawn timeout and the whole test ran in about 1.4 seconds.

## 4. Evidence

All paths are relative to
`docs/harness-reports/ysk-ts7-migration-20261109/migration/review-round1-chatgpt/`.

| File | Content |
|---|---|
| `01-node-check.txt` | `node --check scripts/check-build-drift.mjs` and `node --check test/build-drift-safety.test.js`, exit 0 each |
| `02-focused-test.txt` | `node --test test/build-drift-safety.test.js`, exit 0, 1 test, pass 1, fail 0 |
| `03-unsafe-rejections.txt` | Four unsafe `--out` cases with exact command, exit code 2, error message, sentinel sha256 before/after, byte-identical proof |
| `04-default-drift.txt` | `node scripts/check-build-drift.mjs`, exit 0, tsc exit 0 with 0 diagnostics, 13 files byte-identical |
| `05-safe-out-subdir.txt` | `--out node_modules/.build-check/evidence-custom-subdir`, exit 0, 13 files byte-identical |
| `06-full-node-test.txt` | `node --test test/`, exit 0, tests 698, pass 698, fail 0 |
| `07-git-scope.txt` | `git diff --check` exit 0 and the exact changed/untracked file lists |
| `08-final-report-append.txt` | `final-report.md` bytes before/after the append and proof that earlier bytes did not change |
| `09-help.txt` | `--help` output documenting the `--out` restriction, exit 0 |

Result summary:

| Gate | Result | Exit code |
|---|---|---:|
| `node --check` (both files) | pass | 0 |
| Unsafe `--out` (4 cases) | rejected, sentinel intact | 2 |
| Default drift | 13/13 byte-identical | 0 |
| Safe explicit subdirectory | 13/13 byte-identical | 0 |
| `--help` | usage with the `--out` restriction | 0 |
| `node --test test/build-drift-safety.test.js` | 1 test, 1 pass, 0 fail | 0 |
| `node --test test/` | 698 tests, 698 pass, 0 fail | 0 |
| `git diff --check` | clean | 0 |

## 5. Residual risk

- A time-of-check/time-of-use race remains between the `realpath` validation and
  the subsequent `rm`: a local process that can replace `node_modules/.build-check`
  with a symlink in that window could still redirect the deletion. This script is
  a local, unprivileged development gate with no elevation, and the scratch root
  is gitignored; closing the race fully would need descriptor-relative
  operations (`fs.rm` does not offer them in Node 26). The string and realpath
  checks remove every static bypass, including lookalikes and existing symlinks.
- `--expected` and `--tsconfig` stay user-controlled read-only inputs by design.
  They are never deleted or written; a hostile tsconfig can still make the
  compiler read arbitrary files, which is the pre-existing compiler contract and
  outside this P1 fix.
- The deletion still happens before the compiler runs, so an interrupted run can
  leave the scratch tree partially removed. That is intentional and confined to
  the ignored scratch directory.
