# Review round 1 fixes — `src/core.ts`

- Task: close the three type-honesty findings from independent review (R3, R2, R4).
- Scope: `src/core.ts` only. `lib/`, `test/`, `scripts/`, `package.json`,
  `tsconfig.json`, `README.md`, `docs/reference.md`, and every other `src` file
  were not edited. Verification is read-only: `tsc --noEmit` via `node -e` +
  `spawnSync`; `npm run build` was not run, and the Lead still owns emission.
- Evidence lives in this directory.

## 1. What changed

### R3 — closed vocabularies instead of plain `string`

The frozen tables stay the single source of truth, and the literal element types
are derived from them:

- `IMPORTANCE` gains `as const`, and
  `type ReviewerImportance = (typeof IMPORTANCE)[number]`.
- `RECENT_CHECK_OUTCOMES` gains `as const`, and
  `type RecentCheckOutcome = (typeof RECENT_CHECK_OUTCOMES)[number]`.
- `NOTE_KINDS` gains `as const`, and
  `type NoteKind = (typeof NOTE_KINDS)[number] | typeof UNCLASSIFIED_KIND`.
- `type RuntimeStatus = (typeof RUNTIME_STATUS)[keyof typeof RUNTIME_STATUS]`
  derives from the `as const` table `runtime.ts` exports; it is not a new table.
- `NoteKind` now types `ReviewerVerdict.kind`, `StoredNote.kind`, and
  `NoteView.kind`.
- `RecentCheckOutcome` now types `RecentCheckRecord.outcome`, and
  `recentCheckOutcome()` returns it.
- `RuntimeStatus` now types `RuntimeStatusSnapshot.runtimeStatus`,
  `SessionSnapshot.runtimeStatus`, and the `aggregateRuntimeStatus()` result.

Narrowing stays in named predicates whose parameter is `unknown`, and the
fallback behavior is unchanged:

- `isReviewerImportance(value: unknown)` keeps its name and parameter; its body
  now uses `IMPORTANCE.some((known) => known === value)`.
- New `isNoteKind(value: unknown): value is NoteKind` checks the declared kinds
  plus `UNCLASSIFIED_KIND`. `parseVerdict` keeps the same
  `UNCLASSIFIED_KIND` fallback, so an unknown, padded, or non-string kind still
  becomes `unclassified`.
- New `isRecentCheckOutcome(value: unknown)` keeps the `other` fallback.
- New `isRuntimeStatus(value: unknown)` uses the existing severity table, so
  unknown runtime strings are still ignored rather than guessed.

No runtime table value, order, or freeze state changed; `as const` is erased and
the emitted table lines are byte-identical to the phase-2 build.

### R2 — unnecessary cast and false comment

`makeRuntime` is back to `return createRuntime({ ... })`. The
`const runtime = createRuntime(...)` local, the
`return runtime as SessionRuntime` cast, and the comment claiming that the
inferred type is a placeholder are all removed. `runtime.ts` is now typed, its
`enqueue` / `status` / `RuntimeStatusSnapshot` / `RuntimeOutcome` shapes satisfy
the local `SessionRuntime` interface structurally, and `tsc` accepts the return
without any assertion. Behavior is unchanged.

### R4 — unsafe generic cast in `oldestKey`

`oldestKey` no longer returns `K` through an `as K` assertion:

```ts
/**
 * The oldest inserted key of a map, or undefined when the map is empty. Every
 * caller below enters only after its own size check proves nonempty.
 */
function oldestKey<K, V>(map: Map<K, V>): K | undefined {
  return map.keys().next().value
}
```

The three call sites handle the documented empty case explicitly. Each guard is
equivalent to the previous assumption, because the surrounding size check
already proves the map is nonempty:

- `setOverride` / `setSessionModeOverride`: inside the existing
  `while (size >= LIMITS.maxSessionOverrides)` loop, `if (oldest === undefined)
  break` then `delete(oldest)`. Only a nonempty map can reach the loop.
- `stateOf`: inside the existing `sessions.size >= LIMITS.maxTrackedSessions`
  block, the eviction steps run under `if (oldest !== undefined)`. Only a
  nonempty map can reach the block.

The eviction behavior is covered by `test/engine.test.js` ("the tracked-session
table is bounded and evicts the oldest session", "the per-session override table
is bounded by its limit and evicts the oldest") and by the recent-check
diagnostics eviction test.

## 2. Verification

`tsc -p tsconfig.json --noEmit --pretty false` (via `node -e` + `spawnSync`):

- Before the fixes: exit 0, no output — 0 diagnostics for `src/core.ts` and 0 for
  the whole program. This round restores type honesty; it does not change the
  diagnostic count.
- After the fixes: exit 0, no output — `src/core.ts` 0 diagnostics, full program
  0 diagnostics. The captured filtered logs are empty by construction:
  [01-tsc-after-full.txt](01-tsc-after-full.txt) and
  [02-tsc-after-core.txt](02-tsc-after-core.txt); counts and the exact command are
  recorded in [03-summary.txt](03-summary.txt).

Scratch-build behavior check (no `lib/` write, no `npm run build`): compiled
`src/` into `node_modules/.corecheck` and ran the shipped tests against the
emitted artifacts in a temp copy. 436 tests pass, 0 fail
([05-tests.txt](05-tests.txt)).

[06-changed-files.txt](06-changed-files.txt): `git diff --stat -- src/core.ts` is
empty because `src/` is an untracked phase-1 addition; the supplementary
`git status --short src/core.ts` and line count are recorded there instead.

## 3. Emitted-JavaScript expectation

[04-emit-diff-vs-lib.patch](04-emit-diff-vs-lib.patch) is the exact emitted delta
of this round: 147 lines, 13 hunks, against the current `lib/core.js` (the
phase-2 build, mtime 23:21). It contains only:

1. the visible-comment change on `oldestKey` plus the required `K | undefined`
   return (the function body is unchanged);
2. `isReviewerImportance` switching from `includes` to `some`;
3. the two new predicate helpers `isRecentCheckOutcome` and `isNoteKind`, and the
   new `isRuntimeStatus` helper;
4. `parseVerdict` and `recentCheckOutcome` calling the new predicates;
5. `makeRuntime` returning `createRuntime(...)` directly (the R2 cast/local/
   comment removal — this hunk restores the exact phase-1 emitted shape);
6. the R4 `oldest === undefined` guards in the two override loops and around the
   tracked-session eviction;
7. the `aggregateRuntimeStatus` unknown-status predicate line.

Every predicate source check is set-equivalent to the expression it replaces
(`includes(x)` versus `some((known) => known === x)` over the same string table;
`hasOwnProperty` over the unchanged severity table), so no runtime behavior or
response content changes. No vocabulary table, fallback value, key order,
logging, or side-effect order changes.

## 4. Exported surface note

No export was added or removed. Two exported constants (`NOTE_KINDS` and
`RECENT_CHECK_OUTCOMES`) keep their runtime values and frozen state but gain
`as const` narrowing, so their TypeScript element type is now a literal union
instead of `string`. No other module consumed those constants by value in a way
that this affects; `tsc` is clean across the full program, and the tests that
spread and freeze `RECENT_CHECK_OUTCOMES` still pass.

## 5. Blockers

None. `src/core.ts` and the whole program typecheck with zero diagnostics, and
the emitted delta is limited to the items above.
