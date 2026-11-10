# Phase 2 — strict typing of `src/core.ts`

- Task: fix every TypeScript diagnostic attributed to `src/core.ts` at the source.
- Branch: `session/ysk-ts7-migration-20261109`.
- Scope: `src/core.ts` only. `lib/`, `test/`, `scripts/`, `package.json`,
  `tsconfig.json`, `README.md`, `docs/reference.md`, and every other `src` file
  were not edited. Evidence lives in this directory.
- Rules followed: [conventions.md](../../../conventions.md) and
  [design.md](../../../design.md).

## 1. Diagnostics

Command (the harness rejects direct `node`/`npm` invocation, so `tsc` runs through
`node -e` + `spawnSync`):

```sh
node -e 'const cp=require("node:child_process");const r=cp.spawnSync(process.execPath,
["node_modules/typescript/bin/tsc","-p","tsconfig.json","--noEmit","--pretty","false"],
{encoding:"utf8"});console.log(r.stdout);console.error(r.stderr)'
```

- Before: 745 diagnostics — `src/core.ts` 321, other files 424
  ([01-before.txt](01-before.txt)).
- After: 398 diagnostics — `src/core.ts` **0**, other files 398
  ([02-after-full.txt](02-after-full.txt),
  [03-after-core.txt](03-after-core.txt) is the empty filtered log,
  [03b-after-core-summary.txt](03b-after-core-summary.txt)).
- The full output has 410 lines: 398 attributed diagnostics plus 12 wrapped
  continuation lines.
- The other-file delta (424 → 398) comes from the concurrent typing agents, not
  from this phase. Remaining per file: `client.ts` 190, `update.ts` 85,
  `runtime.ts` 82, `index.ts` 23, `self-check.ts` 18.
- No diagnostic was suppressed with `any`, `@ts-ignore`, `@ts-nocheck`, or an
  `as unknown as` chain. The casts that remain are local structural views inside
  type predicates, one nonempty-map key read, and two seam assertions listed in
  section 5.

## 2. Typing approach by area

### Config normalization

- Added `ReviewerConfig` (the normalized config) and `BoundedIntField` (the five
  integer fields with a `LIMITS` bound). `DEFAULT_CONFIG` and `LIMITS` keep their
  literal `Object.freeze` types; `readBoundedInt` and `readBooleanFlag` take the
  exact field key, so `DEFAULT_CONFIG[field]` and `LIMITS[field]` resolve without
  widening the exported tables.
- `snapshotConfig(raw: unknown): unknown` and `normalizeConfig(raw: unknown):
  { config: ReviewerConfig; warnings: string[] }` treat the row as untrusted.
  `isPlainObject` expresses the existing `!== null && typeof === 'object' &&
  !Array.isArray` guard, `isVolatileRef` expresses the existing `{ get() }`
  probe. `readRoute` returns a named `{ value, blank }` shape.
- `readReviewMode` returns `ReviewMode`, the local literal union that mirrors the
  five ids owned by `review-strictness.ts`.

### LLM registry and routes

- `LlmService` declares only the four members this module reads, all optional,
  per conventions section 4. `StreamingLlm` is the narrowed view used where the
  code has already checked `stream`.
- `isStreamingLlm`, `isListingLlm`, `isCatalogEntry`, `catalogIdOf`, and
  `isReviewerImportance` keep the checks and the types together. The repeated
  catalog-row ternary is now one helper used by all three readers.
- `ReviewerRoute` types every resolved pair; `DEEPSEEK_ROUTE_MODELS` is annotated
  `Readonly<Record<string, readonly string[]>>` so the lookup by a dynamic
  provider id type-checks without changing the table.

### Event and message helpers

- `SessionEvent` / `SessionEventData` / `SessionLike` model the envelope members
  the module actually reads; the payload members stay `unknown`.
  `messageText`, `textOfBlocks`, and the exported window helpers accept
  `unknown` and keep their existing runtime guards, which now double as type
  predicates (`isSessionEvent`, `isTextBlock`).
- `ConversationMessage` is the `{ role, text }` entry the reviewer prompt, the
  adaptive profile, and the evidence collector exchange.

### Verdict parsing and grounding

- `ReviewerVerdict` / `ReviewerSource` / `ReviewerImportance` describe the parsed
  reply; `parseVerdict` returns `ReviewerVerdict | null`, and the builder object
  is annotated so the optional `action`, `source`, `kind`, and `because` can be
  assigned after construction.
- `isReviewerImportance` and `isEvidenceKind` carry the two allowlist checks that
  already existed. `parseSource` returns `ReviewerSource | null`, so the optional
  `line` is a real optional property instead of a late assignment that the
  compiler could not see. `groundVerdict` keeps the parsed object type through
  its narrowing and returns the same value or a fresh copy with the line dropped.

### Engine

- `EngineOptions`, `RuntimeSeams`, `ObserveOutcome`, `ObserveResult`, `ExplainResult`,
  `ExplanationOutcome`, `ReviewJob`, `RuntimeOutcome`, `RuntimeStatusSnapshot`,
  `SessionRuntime`, `ChunkStep`, `ChunkIterator`, `ChunkSource`,
  `SessionState`, `ActiveSessionState`, `StoredNote`, `NoteView`, `HistoryView`,
  `RecentCheckRecord`, `AdaptiveState`, `FingerprintSet`, `SessionSnapshot`,
  `BudgetWindowField`, and `ValidateResult` type the engine.
- The session table, override tables, mode table, and turn-text table are typed
  maps (`Map<string, ActiveSessionState>`, `Map<string, ReviewerRoute>`,
  `Map<string, ReviewMode>`, `Map<unknown, string>`).
- Timer handles are `NodeJS.Timeout | undefined`; every promise executor is
  parameterized with its documented result union.
- `state.adaptive`, `state.knownFingerprints`, and the runtime are structural
  interfaces, so the engine does not depend on the still-untyped module
  internals beyond the members it calls.

### Node and Fetch handlers

- `NodeRequest` / `NodeResponse` describe the raw Node members the request
  handlers read and write; the payloads stay `unknown`.
- Fetch handlers use the global `Request` and `Response` types that
  `@types/node` provides; `readFetchJsonBody` returns
  `Promise<Record<string, unknown> | undefined>`.
- `Engine` is `ReturnType<typeof createEngine>`; handler factories take it
  explicitly. `ConfigHandlerOptions`, `SettingsService`, `WritableSettings`,
  `ConfigView`, `UpdateChecker`, and `UpdateHandlerOptions` type the config and
  update routes. `isWritableSettings` expresses the existing two-method probe.

## 3. Exported types introduced

None. No new export was added; the module's export list is unchanged. Every type
above is module-local, so the phase's export-surface parity requirement holds.
The only exported signature surface that changed is the parameter and return
typing of existing exports (section 4).

## 4. Exported signatures that changed (implicit `any` to real types)

These had implicit-`any` parameters or returns before this phase:

`snapshotConfig`, `normalizeConfig`, `isConfigured`, `resolveReviewerRoute`,
`sessionIdOf`, `isChildSession`, `eventsOf`, `textOfBlocks`, `messageText`,
`lastSeq`, `turnOutputText`, `accumulatedDelta`, `collectContext`,
`buildReviewPrompt`, `buildReviewerSystemPrompt`, `parseVerdict`, `groundVerdict`,
`dedupeKey`, `createEngine`, `aggregateRuntimeStatus`, `readJsonBody`,
`createRequestHandlers`, `jsonResponse`, `methodNotAllowed`,
`createFetchHandlers`, `buildProviderCatalog`, `createConfigHandlers`,
`createUpdateHandlers`.

No exported const value changed. All consumers of these exports are still
implicitly typed (`src/index.ts`), so no caller broke; one incidental effect is
that `createEngine`'s typed `onError` option resolved one implicit-`any`
parameter in `src/index.ts` (24 → 23 diagnostics there, none added).

## 5. Behavior neutrality

The rule was: types, narrowing, and type predicates only; no new branch,
validation, guard, default, log, error path, or reordering of side effects.
[05-emit-diff-vs-lib.patch](05-emit-diff-vs-lib.patch) is the complete emitted-JS
diff against the phase-1 `lib/core.js` (192 changed lines). Every hunk was
reviewed; no comment line is removed and no comment text changes.

Equivalent-expression edits:

- Guard predicates replace the identical inline conditions: `isPlainObject`
  (four call sites that already excluded null, non-objects, and arrays),
  `isVolatileRef`, `isSessionEvent`, `isTextBlock`, `isReviewerImportance`,
  `isEvidenceKind`, `isTextDeltaChunk`, `isFinishChunk`, `isChunkSource`,
  `isNoteVerdict`, `isWritableSettings`, `isResolution`.
- `configView` no longer writes `mode` twice (`TS2783`). `mode` moved out of the
  local base object and is set first in both branches, which keeps the exact
  previous key order in the JSON response: `mode` first, `provider`/`model`
  second and third for a pinned route.
- `consumeExplanation` stores the stream, then reads the async iterator method
  once and calls it with `.call(iterable)`. The explicit receiver is required
  because capturing the method without it loses `this`; the explain tests caught
  that and it is fixed. The chunk guards are the same checks in predicate form.
- `stateOf` builds the state literal, attaches the runtime to that same object,
  then stores it. Object identity and call order are unchanged.
- `oldestKey(map)` replaces `map.keys().next().value` at the three eviction
  sites where the surrounding `size`/while condition already proves the map is
  nonempty; the cast inside the helper records that invariant.
- `validateRoute` (engine and config route) reads `resolveModelInfo` once before
  the promise chain so the narrowing survives into the closure. The chain still
  calls that method at the same point in the sequence.
- `buildProviderCatalog` uses an optional model-list lookup, so a missing
  `listModels` still yields a provider with an empty model list (previously the
  call threw inside the `try` and was swallowed); the only remaining difference
  is that no deadline timer is scheduled in that unreachable-for-valid-hosts
  case.
- `onNote` filters a silent verdict before delivery. `parseVerdict` cannot
  produce a non-null-importance verdict with a null note, so the branch is
  unreachable from production data, and the outcome would in any case be
  `filtered`, which is what the existing `admitsVerdict` check returns.

Seam assertions (listed for review):

1. `return runtime as SessionRuntime` in `makeRuntime`. `createRuntime` is still
   untyped, so its inferred `enqueue` returns `Promise<unknown>`; the runtime's
   own documentation says it resolves to a terminal outcome with a status name,
   which `RuntimeOutcome` models. The assertion disappears as a compile need once
   `src/runtime.ts` is typed, and it cannot create a runtime difference.
2. `state = created as ActiveSessionState` in `stateOf`. `ActiveSessionState` is
   `SessionState & { runtime: SessionRuntime }`; the runtime is assigned one line
   earlier, and no other code path stores a session state.

Behavioral bounds worth knowing, all outside the documented host contracts:

- `isSessionEvent` also requires a string `type`; the original `messageText`
  guard accepted any object and then compared `type`, which produced the same
  `null`. A callable object with a `type` property would behave differently, but
  session events are plain objects.
- `isChunkSource` requires an object or function before probing the iterator
  symbols; a bare primitive that happens to be iterable (for example a plain
  string returned where a stream is expected) is reported unparsable instead of
  being walked character by character. Both paths end in a bounded failure.

## 6. Verification

- Typecheck: `src/core.ts` 0 diagnostics (section 1; saved filtered log is
  empty by construction).
- Scratch emission and behavior check (no `lib/` write, no `npm run build`):
  compiled `src/` into `node_modules/.corecheck`, then ran the shipped test tree
  against the emitted artifacts in a temp copy. 436 tests pass, 0 fail
  ([06-scratch-tests.txt](06-scratch-tests.txt)).
- Emitted-JS diff against `lib/core.js` reviewed:
  [05-emit-diff-vs-lib.patch](05-emit-diff-vs-lib.patch).
- [04-changed-files.txt](04-changed-files.txt): `git diff --stat -- src/core.ts`
  is empty because `src/` is still an untracked phase-1 addition; the
  supplementary `git status --short src/core.ts` and line count are recorded
  there instead.
- No trailing whitespace or tab characters were introduced in `src/core.ts`.
- `lib/` was not rebuilt or edited in this phase; the Lead owns emission.

## 7. Risks and open seams

- The other `src` files are being typed concurrently. `src/core.ts` compiles
  against the current inferred shapes of `createRuntime`, `createAdaptiveState`,
  `createFingerprintSet`, `reviewerBudget`, `collectEpisodeEvidence`,
  `buildEvidenceCapsule`, `admitsVerdict`, and the explain/profile helpers. If a
  later typing phase narrows one of those seams (for example `enqueue`'s job type
  or `collectEpisodeEvidence`'s event type), the corresponding local interface
  here may need a matching edit.
- `snapshotConfig` now returns `unknown`, which `src/index.ts` passes on to
  `mergeUpdateState` in the still-untyped `src/update.ts`. That is correct for an
  untrusted row, but if `update.ts` later requires a concrete object type,
  `index.ts` (not this file) is where the value must be narrowed.
- No blocker remains for `src/core.ts`.
