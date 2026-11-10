# Phase 2 strict typing — seven small modules

- Worktree: `/Users/pipags/work/dsh-you-should-know-worktrees/ysk-ts7-migration-20261109`
- Branch: `session/ysk-ts7-migration-20261109`
- Date: 2026-11-09
- Scope: `src/adaptive.ts`, `src/feedback.ts`, `src/explain.ts`, `src/language.ts`,
  `src/review-strictness.ts`, `src/review-profile.ts`, `src/evidence.ts`
- Rules followed: [conventions.md](../../../conventions.md) and [design.md](../../../design.md).
- No commit, push, checkout, or reset was made. `lib/`, `test/`, `scripts/`,
  `package.json`, `tsconfig.json`, `README.md`, and `docs/reference.md` were not edited.
  `npm run build` was not run; the Lead emits the committed output after this phase.

## 1. Result

Every diagnostic attributed to the seven files is fixed at the source. No
suppression (`@ts-ignore`, `@ts-nocheck`, strictness override) and no
non-null assertion was used.

| File | Before | After |
|---|---|---|
| `src/adaptive.ts` | 10 | 0 |
| `src/feedback.ts` | 8 | 0 |
| `src/explain.ts` | 11 | 0 |
| `src/language.ts` | 8 | 0 |
| `src/review-strictness.ts` | 13 | 0 |
| `src/review-profile.ts` | 8 | 0 |
| `src/evidence.ts` | 31 | 0 |
| **Filtered total** | **89** | **0** |

Full-program snapshot: 745 diagnostics before this phase
([01-before.txt](01-before.txt)), 611 after
([02-after-full.txt](02-after-full.txt), 2026-11-09T22:53+03:00). The remaining
diagnostics are all in files owned by other phases (`core` 213, `client` 190,
`update` 85, `runtime` 82, `index` 23, `self-check` 18 at that snapshot). Those
files were being edited concurrently, so the full-program number is a point-in-time
snapshot, not a stable final count.

The task brief listed 94 diagnostics with 15 in `adaptive.ts`; the real baseline
is 89 with 10 in `adaptive.ts`, matching the phase-1 table in `design.md`. The
counts above are from the saved `tsc` output, not from the brief.

## 2. Command and filter

```sh
node -e 'const cp=require("node:child_process");const r=cp.spawnSync(process.execPath,
  ["node_modules/typescript/bin/tsc","-p","tsconfig.json","--noEmit","--pretty","false"],
  {encoding:"utf8"});process.stdout.write(r.stdout||"")'
```

Diagnostics were filtered with the regular expression
`^src/(adaptive|feedback|explain|language|review-strictness|review-profile|evidence)\.ts\(\d+,\d+\): error TS\d+`
over the captured output. The filtered after-log is [03-after-small.txt](03-after-small.txt)
(no matching lines); the filtered before-log is the extra
[03-before-small.txt](03-before-small.txt) (89 lines).

## 3. Types introduced per module

### `src/adaptive.ts` — budget and quiet-streak state

- `AdaptiveState`: the caller-owned `callTimes`, `explainCallTimes`, and
  `quietStreak` fields; `createAdaptiveState` now returns it.
- `AdaptiveWindow`: `'callTimes' | 'explainCallTimes'`, the two counters that
  never share a window.
- `ReviewerBudget`: the `used`, `remaining`, `max` result of `reviewerBudget`.
- `QuietOutcome`: literal union derived from the frozen `QUIET_OUTCOMES` tuple;
  `isQuietOutcome` is a real type predicate over `unknown`.

### `src/feedback.ts` — feedback resolution and fingerprint set

- `FeedbackResolution` and `UsefulResolution`: literal unions derived from the
  frozen resolution tables.
- `FEEDBACK_RESOLUTIONS` and `USEFUL_RESOLUTIONS` are exported as
  `readonly string[]` on purpose: existing call sites in `core.ts` and
  `self-check.ts` call `.includes(value)` with a `string`, so a literal-array
  type would add diagnostics in files this phase must not edit. The exported
  union types are the precise vocabulary and `isFeedbackResolution` is a
  predicate returning `value is FeedbackResolution`.
- `FingerprintSet`: the `add` / `has` / `matches` / `clear` / `size` shape
  returned by `createFingerprintSet`.
- Token and match helpers take `unknown` and narrow with `typeof`, exactly as
  the shipped guards already did.

### `src/explain.ts` — explanation prompt and strict parser

- `ExplanationPromptOptions`, `ExplanationNote`, `ExplanationSource`: the
  bounded inputs of one explanation prompt, with the finding treated as
  untrusted data.
- `ExplanationLanguageOptions`: the host-language seam of the system prompt.
- `parseExplanation(raw: unknown): string | null`; the accepted JSON shape is
  narrowed with a local `isRecord` predicate instead of an `object` cast.
- `buildExplanationSystemPrompt(messages: unknown, options?: ... | null)`.
- The existing runtime guards stay; no new validation was added.

### `src/language.ts` — effective output-language map

- `LanguageSource`: `'host' | 'human-message' | 'fallback'`.
- `OutputLanguageResolution`: `{ source, language }`, where `language` is
  `undefined` for the human-message source because the reviewer resolves it
  itself.
- `LanguageOptions`: `hostLanguage`, `messages`, and `subject` as `unknown`
  seam values. `normalizeHostLanguage(value: unknown): string | undefined`,
  `hasGenuineHumanMessage(messages: unknown): boolean`.
- The invalid legacy `@returns { source, language }` line at the old line 68
  was left untouched because its doc block was not edited.

### `src/review-strictness.ts` — modes and thresholds

- `ReviewMode`: literal union derived from the frozen mode table;
  `isReviewMode` is a predicate and `normalizeReviewMode` returns
  `ReviewMode | undefined`.
- `Importance`: `'high' | 'critical'`, the ranked admission tiers.
- `ReviewModeProfile`: `id`, `label`, `minImportance`, `instruction`;
  `REVIEW_MODE_PROFILES` is `Readonly<Record<ReviewMode, ReviewModeProfile>>`.
- `REVIEW_MODE_LABELS` is `Readonly<Record<ReviewMode, string>>` and
  `IMPORTANCE_RANK` is `Readonly<Record<Importance, number>>`.
- `admitsFinding`, `admitsVerdict`, and `buildStrictnessSection` take the
  untrusted seam values as `unknown`; `admitsVerdict` narrows one parsed
  verdict with an `isRecord` predicate that replaces the existing
  `null`/`typeof`/`Array.isArray` guard with the same truth table.
- `REVIEW_MODES` stays `readonly string[]` for the same `.includes(string)`
  reason as the feedback tables; the precise `ReviewMode` type is exported.

### `src/review-profile.ts` — review profile and language skills

- `ReviewLanguage`: the closed vocabulary of the 17 supported languages.
- `ReviewSkill`: `{ language, checks }`.
- `ReviewProfileOptions`: the `hostLanguage` seam.
- `SUPPORTED_LANGUAGES` is `readonly ReviewLanguage[]`; `LANGUAGE_ALIASES` is
  `ReadonlyMap<string, ReviewLanguage>`; `REVIEW_SKILLS` is
  `ReadonlyMap<ReviewLanguage, readonly string[]>`. `detectReviewLanguages`
  returns `ReviewLanguage[]` and `reviewSkillsFor` returns `ReviewSkill[]`.

### `src/evidence.ts` — evidence capsule allowlist

- `ToolCallEntry`, `TurnReason`, `SubagentEntry`, and `EpisodeEvidence`: the
  bounded record built from the allowlisted event metadata only.
- `isRecord` (non-array object), `isUnknownArray`, and `isInteger` are
  narrowing predicates placed over the checks the code already ran;
  `collectEpisodeEvidence(events: unknown, turn: unknown)` and
  `buildEvidenceCapsule(evidence: unknown)` model both boundaries as
  untrusted.
- `ToolCallEntry` carries the optional `errorCode` that the renderer reads,
  and `SubagentEntry` the optional `runId`, `childId`, `mode`, `phase`,
  `outcome`, `name`, and `stopReason` members the allowlist names.
- `boundedStep` keeps the exact `Number.isInteger(value) && value >= 0` test;
  only the helper call name changed so the value narrows to `number`.

## 4. Cross-file impact

One type-only signature change crosses the module boundary:

- `reviewerBudget` and `recordReviewerCall` now require
  `field: AdaptiveWindow` instead of an untyped parameter. Mid-phase, `core.ts`
  briefly reported two `TS2345` errors at its `field` pass-through while that
  parameter was still `string`. The core phase independently narrowed the same
  seam to a structurally identical local union (`BudgetWindowField`), so those
  two diagnostics cleared without any edit from this phase. `core.ts` also
  declares local `AdaptiveState` and `FingerprintSet` interfaces whose shapes
  match the exported ones; the compiler accepts the returned values through
  structural typing, so no shared import is required. No remaining diagnostic is
  caused by a signature from these modules: the two `core.ts` errors that
  display `AdaptiveState` or `FingerprintSet` in their text are unrelated core
  defects (a missing `runtime` field on the session state and a missing
  `recentChecks` field on a diagnostic snapshot). No runtime signature or value
  changed.

Deliberate non-changes to avoid new diagnostics in files owned elsewhere:

- `FEEDBACK_RESOLUTIONS`, `USEFUL_RESOLUTIONS`, and `REVIEW_MODES` stay
  `readonly string[]`; their precise union types are exported separately.
- `collectEpisodeEvidence` and the profile/language functions accept `unknown`
  at their seams, so any currently-untyped caller stays assignable.

No import was added or removed. `src/explain.ts` and `src/review-profile.ts`
still import only `./language.js`; no external import was introduced.

## 5. Behaviour neutrality

Almost all edits are type positions (parameter/return/local annotations,
interfaces, type aliases). The following lines were re-expressed for the
compiler; each has the same truth table and the same result for every input as
the shipped code:

1. `QUIET_OUTCOMES.includes(value)` / `FEEDBACK_RESOLUTIONS.includes(value)` /
   `REVIEW_MODES.includes(value)` became `.some((x) => x === value)` on the same
   frozen string tables. Strict equality and `includes` (SameValueZero) agree
   for strings.
2. The three frozen literal tables that are consumed with `.includes(string)`
   are declared as a private `as const` tuple and exported as a widened
   `readonly string[]` binding to the same frozen array. The emitted file keeps
   `Object.freeze` exactly once and exports the same array instance.
3. In `evidence.ts`, `isInteger()` is a type predicate whose body is exactly
   `Number.isInteger(...)`; `isUnknownArray()` is exactly `Array.isArray(...)`.
   They add no check that was not already run, they only make the result narrow
   in TypeScript. `boundedStep` therefore keeps the same condition.
4. Guards replaced by predicates have the same truth table:
   `note !== null && typeof note === 'object'` (which accepted arrays) becomes
   `isRecord(note)` for reads that only ever used property lookups, and the
   three-part verdict/parser guards (`null`, `typeof`, `Array.isArray`) become
   `isRecord(...)` because both reject the same values. `isRecord` in
   `evidence.ts` is the original function with only its predicate signature
   added.
5. The bounded-fingerprint eviction loop now checks the iterator value for
   `undefined` before `Set.delete`. The loop runs only while
   `keys.size > cap >= 1`, so the iterator always has a value; the check never
   changes the evicted key or the loop count.
6. Option object parameters are typed as interfaces; the existing
   `options !== null && typeof options === 'object'` guard still performs the
   same narrowing at runtime, and no new default, branch, log, or error path was
   introduced.

Evidence for neutrality:

- [06-emit-delta-vs-lib.txt](06-emit-delta-vs-lib.txt) is the full diff between
  the committed `lib/*.js` and a fresh emit of the seven sources. Every hunk is
  one of the re-expressions above; the interfaces and type aliases emit nothing.
- [07-check-js-and-export-surface.txt](07-check-js-and-export-surface.txt) shows
  `node --check` passing on all seven emitted files and the sorted runtime
  export names identical to `lib/*.js` for all seven.
- [05-runtime-tests.txt](05-runtime-tests.txt): the seven module test files
  (`adaptive`, `feedback`, `explain`, `language`, `strictness`,
  `review-profile`, `evidence`) were run against a scratch tree under
  `node_modules/` (committed `lib/*.js` copied, the seven files overwritten with
  the fresh emit, `node --test` via `spawnSync`): **98 tests, 98 pass, 0 fail,
  exit 0**. The scratch tree was deleted afterwards; `lib/` and `test/` were not
  touched.

## 6. Evidence index

| File | Content |
|---|---|
| [01-before.txt](01-before.txt) | Raw full-project `tsc --noEmit` output before this phase (745 diagnostics) |
| [02-after-full.txt](02-after-full.txt) | Raw full-project output after this phase (611 diagnostics at snapshot) |
| [03-after-small.txt](03-after-small.txt) | Filtered after output for the seven files (0 diagnostics) |
| [03-before-small.txt](03-before-small.txt) | Extra: filtered before output for the seven files (89 diagnostics) |
| [04-changed-files.txt](04-changed-files.txt) | The seven edited files, raw `git status --short`, clean `git diff --check` |
| [05-runtime-tests.txt](05-runtime-tests.txt) | Scratch-emit run of the seven module test files (98/98 pass) |
| [06-emit-delta-vs-lib.txt](06-emit-delta-vs-lib.txt) | Diff of the fresh emit against committed `lib/*.js` |
| [07-check-js-and-export-surface.txt](07-check-js-and-export-surface.txt) | `node --check` on the seven emitted files and runtime export parity |

## 7. Caveats

- The full-program diagnostic count moved during this phase because other
  phases were editing their files concurrently; only the filtered count for the
  seven files is stable at 0.
- `npm run build`, `npm test`, and `npm run check:drift` remain the Lead's gates
  after the emit; this phase could not run them against the committed output.
  The scratch-emit test run and the emit diff are the substitute evidence.
- No blocker remains for these seven files.
