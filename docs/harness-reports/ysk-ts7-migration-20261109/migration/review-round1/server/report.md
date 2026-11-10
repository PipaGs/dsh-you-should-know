# Review round 1 — type-honesty fixes, server files

- Scope: `src/update.ts`, `src/runtime.ts`, `src/index.ts` only.
  `src/self-check.ts` needed no change in this round. No other `src` file,
  `lib/`, `test/`, `docs/`, `package.json`, or `tsconfig.json` was edited.
- Rules followed: [conventions.md](../../../conventions.md) and the review-round
  instructions (R3 closed vocabularies, R5 dead type).
- All edits are type-level or erased assertions; emitted JavaScript is
  byte-identical (section 3).

## 1. What changed

### `src/update.ts`

1. `UPDATE_BEHAVIORS` (line 48) is now
   `readonly UpdateBehavior[]` instead of `readonly string[]`. The runtime array
   is the same `Object.freeze(['notify-only', 'ask-before-update', 'automatic'])`
   with the same member order and the same emitted value; only the declaration
   annotation changed.
2. The membership probe in `isUpdateBehavior` (line 189) widens the table to
   `readonly string[]` for `.includes(value)`. The cast direction is sound: every
   `UpdateBehavior` is a `string`, so no value is re-typed as something it is
   not. The emitted call is still `UPDATE_BEHAVIORS.includes(value)`.
3. Audited the behavior-typed fields: `UpdateState.updateBehavior`,
   `UpdateStatePatch.updateBehavior`, and `UpdateStatus.updateBehavior` were
   already `UpdateBehavior`; `DEFAULT_UPDATE_BEHAVIOR` is already the literal
   `'ask-before-update'`. No other field is validated against the table with a
   `string` type, so no further annotation was needed. `src/index.ts` keeps
   `UPDATE_BEHAVIORS.map((id) => z.const(id))`; the narrower element type is
   assignable to `z.const`.

### `src/runtime.ts`

1. `RUNTIME_STATUS` (lines 30-37) is wrapped in `as const`, so its property
   values are literal types instead of `string`. The emitted frozen object is
   unchanged.
2. New exported `RuntimeStatus` (line 40):
   `(typeof RUNTIME_STATUS)[keyof typeof RUNTIME_STATUS]`, the closed union of
   the six terminal/observable states.
3. `RuntimeStatusSnapshot.runtimeStatus` (line 106) and the local
   `runtimeStatus` (line 338) are typed `RuntimeStatus`. Every assignment in
   the runtime is one of `RUNTIME_STATUS`'s members, so no cast or new guard was
   needed and `status()` now reports the closed vocabulary.
4. `RuntimeOutcome.status` (line 85), `RuntimeStatusSnapshot.lastOutcome`
   (line 105), and the internal `ReplyOutcome.status` (line 134) deliberately
   stay `string` / `string | null`. Their value is either a runtime-decided
   label or the terminal label returned by the injected `onNote` delivery
   callback; the runtime only checks that the label is a non-empty string, not
   that it belongs to `RUNTIME_STATUS`. `RUNTIME_STATUS` is therefore not a
   closed table for these fields, and closing them would require either a cast
   or a new validation branch, both forbidden. This is the sanctioned
   "external caller may pass an arbitrary string" seam from the review brief.
   A one-line JSDoc on each of the two public fields records that contract; no
   original comment was changed.

### `src/index.ts`

- Removed the unused `SettingsFormEntry` interface (the R5 dead-type finding).
  Nothing else changed; the three pre-existing unused parameters/locals
  (`props`, `currentEntry`, `resolve`) were left untouched as instructed.

## 2. Diagnostics

- `tsc -p tsconfig.json --noEmit --pretty false` via `node -e` + `spawnSync`:
  **exit 0, 0 diagnostics in the full program** ([01-typecheck-full.txt](01-typecheck-full.txt)).
- Server-file filter (`src/runtime.ts(`, `src/update.ts(`, `src/index.ts(`,
  `src/self-check.ts(`): **0 diagnostics**; the saved log is empty
  ([02-typecheck-server.txt](02-typecheck-server.txt), 0 bytes).
- `--noUnusedLocals` probe ([04-noUnusedLocals.txt](04-noUnusedLocals.txt)):
  the removed interface no longer reports `TS6196`. The single remaining
  `TS6133` is `currentEntry` in `src/runtime.ts`, one of the three pre-existing
  findings the review asked not to fix. The flag is not enabled in
  `tsconfig.json`; the probe is evidence only.

## 3. Emitted JavaScript is unchanged

- Scratch compile A: `node_modules/.servercheck/lib`, emitted from the sources
  before this round.
- Scratch compile B: `node_modules/.servercheck-r1/lib`, emitted from the
  sources after this round (`tsc -p tsconfig.json --outDir ...`; only the output
  directory differs).
- `diff` of every corresponding file is empty and both sides have the same
  SHA-256 for `runtime.js`, `update.js`, `index.js`, and `self-check.js`
  ([03-emitted-js-parity.txt](03-emitted-js-parity.txt)).

That parity is expected: the `UpdateBehavior` table annotation, the
`RUNTIME_STATUS` `as const`, the `RuntimeStatus` alias, the field retypings, the
`includes` widening cast, and the removed interface are all erased at emit
time. No value expression, branch, default, log, or ordering changed.

`lib/` was not rebuilt or edited, and `npm run build` was not run; the Lead owns
emission.

## 4. Risks

- The one added cast, `(UPDATE_BEHAVIORS as readonly string[])`, is a widening
  view used only for the `includes` lookup. It cannot hide a wrong value and it
  keeps the emitted call identical.
- `RuntimeStatus` now follows `RUNTIME_STATUS`: adding or renaming a state
  requires the table change, which is intended.
- Closing the outcome/`lastOutcome` labels would have to happen at the
  `onNote` seam contract (`ReviewerVerdict` delivery labels), not by a local
  runtime check; until then those fields honestly accept any string.
