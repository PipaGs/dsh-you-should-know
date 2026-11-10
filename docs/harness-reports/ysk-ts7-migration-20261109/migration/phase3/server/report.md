# Phase 3 — strict typing of the server-side modules

- Task: fix every TypeScript diagnostic attributed to `src/runtime.ts`,
  `src/update.ts`, `src/index.ts`, and `src/self-check.ts` at the source.
- Scope: those four files only. `lib/`, `test/`, `scripts/`, `package.json`,
  `tsconfig.json`, `README.md`, `docs/reference.md`, `src/globals.d.ts`,
  `src/client.ts`, and every other `src` file were not edited. Evidence lives in
  this directory.
- Rules followed: [conventions.md](../../../conventions.md) and
  [design.md](../../../design.md).
- Baseline: `src/runtime.ts` 82 diagnostics, `src/update.ts` 85,
  `src/index.ts` 23, `src/self-check.ts` 18 — 208 of 398 in the full program
  ([01-before.txt](01-before.txt)).

## 1. Diagnostics

Command (the harness rejects direct `node`/`npm` invocation, so `tsc` runs
through `node -e` + `spawnSync`), exactly as the phase brief specifies:

```sh
node -e 'const fs=require("node:fs"),cp=require("node:child_process");const r=cp.spawnSync(process.execPath,
["node_modules/typescript/bin/tsc","-p","tsconfig.json","--noEmit","--pretty","false"],{encoding:"utf8"});
fs.writeFileSync(".../02-after-full.txt","exit="+r.status+"\n"+(r.stdout||"")+(r.stderr||""))'
```

- Before: 398 diagnostics — `runtime.ts` 82, `update.ts` 85, `index.ts` 23,
  `self-check.ts` 18, `client.ts` 190 ([01-before.txt](01-before.txt)).
- After: **0 diagnostics in the full program**, so all four files are at
  **0** ([02-after-full.txt](02-after-full.txt) is `exit=0` with an empty
  compiler body; [03-after-server.txt](03-after-server.txt) is the 0-byte
  filtered log; [03b-after-server-summary.txt](03b-after-server-summary.txt)).
- The full-program drop from 398 to 0 also reflects the concurrent client
  typing agent finishing; no file outside this phase's scope was edited here.
- No diagnostic was suppressed with `any`, `@ts-ignore`, `@ts-nocheck`,
  `@ts-expect-error`, an `as unknown as` chain, or a non-null assertion.
  The casts that remain are listed in section 5.

## 2. Exported types and signatures

Type-only exports are erased by the emitter, so every emitted `lib/*.js` export
list is byte-for-byte identical to the phase-1 artifact
([08-export-surface.txt](08-export-surface.txt)). `src/index.ts` adds no export:
`name`, `PLUGIN_VERSION` (still the literal `'0.5.2'` in the emitted
`lib/index.js`), `Config` (unchanged `z.object`, every field `.volatile()`,
same defaults), and `apply`.

### `src/runtime.ts`

New exported types:

- `FailureClassification` — `'transient' | 'quota' | 'permanent' | 'aborted' | 'unknown'`.
- `Failure` — `{ message: string; code: string; status?: unknown }`.
- `RuntimeVerdict` — `{ note: string | null; importance: 'high' | 'critical' | null }`;
  the parsed-reply members the runtime reads and hands to delivery.
- `StreamCallOptions` — the exact `buildOptions` result shape.
- `StreamFunction` — `(options: StreamCallOptions) => unknown`.
- `ReviewJob` — `{ provider, model, system, message, maxTokens }`.
- `RuntimeOutcome` — `{ status: string; failure?: Failure }`.
- `RuntimeStatusSnapshot` — the full `status()` counter block.
- `RuntimeOptions` — every injectable seam plus the four budget overrides.

Changed signatures (previously implicit `any`):

- `classifyFailure(code: unknown): FailureClassification`.
- `createRuntime(options: RuntimeOptions = {}): { enqueue, resume, dispose, status, whenIdle }`
  where `enqueue(job: ReviewJob): Promise<RuntimeOutcome>` and
  `status(): RuntimeStatusSnapshot`.
- `closeIterator`, `failureOf`, `buildOptions`, `capabilityFor`, `withDeadline`,
  `attemptOnce`, `classifyReply`, `flushBacklog`, `runEntry`, `runDrain`,
  `drain`, `enqueue`, `resume`, `dispose`, `whenIdle`, `status` are typed
  module-locally against the exported seam types.

Value exports are unchanged: `RUNTIME_LIMITS`, `RUNTIME_STATUS`,
`classifyFailure`, `createRuntime`.

### `src/update.ts`

New exported types:

- `UpdateBehavior` — `'notify-only' | 'ask-before-update' | 'automatic'`.
- `UpdateResult` — `'failed' | 'update-available' | 'up-to-date'`.
- `StableTag` — `{ tag: string; major: number; minor: number; patch: number }`.
- `UpdateState` — the normalized persisted state.
- `UpdateStatePatch` — the bounded patch the checker may persist.
- `UpdateStatus` — the bounded status the settings card and self-check forward.
- `ShellExecRequest`, `ShellExec` — the fixed discovery request and the injectable
  shell seam.
- `RemoteTagLimits` — the two test-only listing bounds.
- `UpdateCheckerOptions` — the checker option set.

Changed signatures:

- `parseStableTag(value: unknown): StableTag | null`.
- `compareVersions(left: unknown, right: unknown): -1 | 0 | 1 | null`.
- `parseRemoteTags(value: unknown, limits: RemoteTagLimits = {}): StableTag | null`.
- `installSpec(tag: unknown): string`.
- `localDateKey(ms: number): string`;
  `nextLocalMidnight(ms: number): number`;
  `millisUntilNextLocalMidnight(ms: number): number`.
- `normalizeUpdateState(raw: unknown): UpdateState`;
  `mergeUpdateState(current: unknown, raw: unknown): UpdateState`.
- `createUpdateChecker(options: UpdateCheckerOptions = {})` with a typed
  `start`, `stop`, `refresh`, `status`, `checkNow`, `setPreferences`, `dismiss`,
  `whenIdle` surface. `whenIdle` now declares `Promise<unknown>` because the
  two branches resolve `undefined` vs `undefined[]`; no caller reads the type.

Value exports are unchanged (all 18 of them).

### `src/self-check.ts`

New exported types:

- `RuntimeState` — the six reportable runtime states.
- `SelfCheckEngine` — `{ diagnostics: () => unknown }`.
- `SelfCheckUpdateChecker` — `{ status: () => unknown }`.
- `SelfCheckInput` — the bounded payload input.
- `SelfCheckHandlerOptions` — the handler option set.
- `RouteCapabilityView` — `{ name, methods, registered }`.

Changed signatures:

- `normalizeVersion(value: unknown): string | null`.
- `routeCapabilityView(handlers: unknown): RouteCapabilityView[]`.
- `buildCapabilities(handlers: unknown, diagnostics?: unknown)` (the second
  parameter stays optional because the shipped test calls it with one argument).
- `updateSummary(status: unknown): Record<string, unknown>`.
- `buildSelfCheckPayload(input: SelfCheckInput)`.
- `readInstalledVersion(onError?: (error: unknown) => void): Promise<string | null>`.
- `createSelfCheckHandler(options: SelfCheckHandlerOptions): { selfCheck }` where
  `selfCheck(request: Request | null | undefined): Promise<Response>`.

Value exports are unchanged (all 9 of them). `RUNTIME_STATES` is annotated
`readonly string[]`; the emitted array is unchanged.

### `src/index.ts`

No new export. `apply(ctx: HostContext, rawConfig: unknown): void`; every host
type is module-local.

## 3. Host seam modeling

- **Runtime seams.** `RuntimeOptions` declares only the injected members:
  `getStream` (resolves the model-stream function or `undefined`),
  `resolveModelInfo` (capability lookup; its result is `unknown` and narrowed by
  the existing `isObject`/`Array.isArray` guards), `parseReply` (returns a
  `RuntimeVerdict` or nothing), `onNote` (delivery; the returned string names the
  outcome), `onError`, `now`, `setTimer`/`clearTimer` (`NodeJS.Timeout`), and the
  four numeric budget overrides. No host package import; no `any`.
- **Update shell seam.** `ShellExec = (request: ShellExecRequest, signal?: AbortSignal) => unknown`.
  The settled projection is `unknown` and `tagListingText` narrows it with the
  same exit/signal/timeout/stdout/truncation checks that already existed.
  `persist` takes an `UpdateStatePatch` and resolves to `unknown`; `getState`
  returns the normalized state. No web/fetch/API seam is introduced.
- **Plugin context seam (`src/index.ts`).** `HostContext` declares only the
  members `apply` calls: `get` overloaded for `'settings' | 'llm' | 'shell'`,
  the legacy `settings`/`llm`/`shell` fallbacks, `effect`, `on` (three event
  overloads), and `inject`. The injected connection context exposes `effect` and
  `connection.fetch.register(route)` only, so the auth boundary stays on the
  connection Fetch carrier; no raw web-server route is typed. `llm`, `settings`,
  and `shell` are narrow structural interfaces for exactly the members read.
  The settings form projection is `unknown` and narrowed with the existing
  null/array/typeof guards.
- **Session seam.** `HostSession` carries only `id` and `header.id`; the
  `session/event` listener passes the same value to `engine.observe`, and the
  `session/disposed` listener accepts `HostSession | string` because the plugin
  already accepted a bare id.
- **Self-check seams.** `SelfCheckEngine` and `SelfCheckUpdateChecker` are the
  two one-method views the handler calls. The manifest read keeps
  `new URL('../package.json', import.meta.url)` exactly, returns `unknown` from
  `JSON.parse`, and narrows the row before reading `version`; a missing or
  malformed manifest still degrades to `null` and never throws.
- **Browser globals.** `src/globals.d.ts` was not touched; no DOM lib was added.

## 4. Behavior neutrality

The rule was: types, narrowing, and type predicates only. No new validation,
log, error path, default, or reordering of observable effects was added.
[05-emit-diff-vs-lib.patch](05-emit-diff-vs-lib.patch) is the complete emitted-JS
diff against the phase-1 `lib/*.js`. Every hunk was reviewed; no comment is
removed or reworded ([07-comments-preserved.txt](07-comments-preserved.txt):
491 original comment lines, 0 missing).

Equivalent-expression edits:

1. Budget guards moved into predicates (`isPositiveInteger`,
   `isPositiveFinite`, `isNonNegativeFinite` in runtime; `isPositiveInteger` in
   update). Each predicate returns exactly the previous condition, so the same
   fallback is chosen for every value.
2. `isStreamSource` replaces the inline symbol-method probe. For truthy
   objects/functions/strings it reads the same two symbol members in the same
   order; for other truthy primitives (number, boolean, symbol, bigint) the old
   code found no callable member and the new predicate returns false before
   probing. The result is identical, and the value is still reported as
   "stream returned a non-iterable".
3. `closeIterator` splits `!iterator || !isClosable(iterator)` from the
   `typeof iterator.return` check. `isClosable` accepts exactly objects and
   functions; the old code also probed `return` on truthy strings, which have no
   such member. `isCatchable(result)` mirrors `result && typeof result.catch ===
   'function'` for every value class.
4. `queue.shift()` became a `dequeue()` helper using `splice(0, 1)[0]`. It
   removes the same element with the same mutation; the callers' `length > 0`
   checks are the documented reason the entry exists, and the empty-queue
   failure mode is unchanged (undefined, then a throw on `.resolve`).
5. `enqueue` pushes the entry inside the Promise executor. The resolver and the
   queue entry were already created before `drain()` in the old order, and the
   executor runs synchronously, so queue order and drain timing are unchanged.
6. `withDeadline` captures the resolver, then arms the timer as a `const`.
   The timer is still armed synchronously before the race, the clear is still
   unconditional after the race, and the timeout flag is set in the same
   callback.
7. `releaseDispose` gets a seed function only for definite assignment; the
   Promise executor overwrites it synchronously before any caller can observe
   it. `whenIdle` pushes `() => resolve()` (same settlement, same list).
8. `runCheck`/`runAutomatic` read the in-flight promise into a local before
   returning it; the same Promise object is returned and `finally` still clears
   the slot in the same order.
9. `normalizeUpdateState` reads `updateBehavior` once into a local (the old
   code read the property twice); `tagListingText` reads `stdout.text` once into
   a local on the success path (the old code read it three times). Both inputs
   are documented plain row/projection objects, so the observed values and
   bounds are unchanged.
10. `compareVersions` still returns exactly `-1 | 0 | 1 | null`; the three call
    sites test `=== 1`, which is equal to the previous `> 0` over that domain.
11. `requestWithTimeout` receives the shell function as a parameter instead of
    closing over the option. `fetchLatest` still calls it at the same point,
    after the same "no public shell service" check.
12. `disposedSessionId` returns `undefined` directly for an empty string;
    `sessionIdOf('')` also returned `undefined` (its `!session` guard), so the
    only changed path is that call itself.
13. Self-check predicates (`isRecord`, `isRuntimeState`) replace the identical
    inline guards. `RUNTIME_STATES.includes` was already false for non-strings;
    the predicate adds the `typeof value === 'string'` check that makes the
    index lookup well-typed.
14. `index.ts` keeps the ownership token on the same `globalThis` object via a
    typed alias; `claimOwnership`/`releaseOwnership` assignment and delete are
    unchanged.

Seam assertions (all listed for review):

1. `isPositiveInteger` / `isPositiveFinite` / `isNonNegativeFinite` cast the
   already-`Number.is*`-checked value to `number` inside the predicate.
2. `isStreamSource` casts to `Partial<StreamSource>` only after the
   object/function/string class check; it then probes the same two symbol
   members the old code probed.
3. `isClosable` / `isCatchable` cast to a local structural view after the same
   object/function class check; `isVersion` casts to a structural view after the
   null/object guard.
4. No cast exists in `src/index.ts` or `src/self-check.ts`; the ownership alias
   is a plain annotation.

## 5. Cross-file compatibility with `core.ts`

- `core.ts` is untouched and still type-checks. Its `createRuntime({...})` call
  supplies `getStream`, `resolveModelInfo`, `parseReply` (`parseVerdict`),
  `onNote`, `onError`, `now`, and the spread `runtimeOptions`
  (`setTimer`/`clearTimer` as `NodeJS.Timeout` plus numeric budgets); every one
  is assignable to the new `RuntimeOptions`.
- `RuntimeVerdict` is deliberately the minimal mutual view of `core.ts`'s local
  `ReviewerVerdict`: the core `onNote` parameter accepts it (all remaining
  members there are optional), and `parseVerdict`'s `ReviewerVerdict | null`
  return narrows into it. No verdict field was dropped from the runtime's
  behavior: the runtime still passes the whole parsed object to `onNote`.
- `ReviewJob` and `RuntimeOutcome` structurally match core's local
  `ReviewJob`/`RuntimeOutcome`, so `runtime as SessionRuntime` in
  `makeRuntime` remains a valid (now redundant) assertion. Core's comment at
  `src/core.ts:2011-2012` still calls the inferred type a placeholder; that
  comment is outside this phase's file scope and can be cleaned up later.
- `snapshotConfig` returns `unknown` (core), which `index.ts` feeds to
  `normalizeUpdateState`/`mergeUpdateState` (both accept `unknown`) and to
  `engine.updateConfig` (accepts `unknown`). No cast was added at that seam.
- The update checker's `status`, `checkNow`, `setPreferences`, and `dismiss`
  satisfy core's local `UpdateChecker` interface structurally, which is why
  `createUpdateHandlers` type-checks without a cast.
- The self-check handler `(request: Request | null | undefined) => Promise<Response>`
  is assignable to the registration table's `(request: Request) => Promise<Response>`.
- No blocker or incompatibility remains.

## 6. Verification

- Typecheck: `tsc -p tsconfig.json --noEmit --pretty false` exits 0 with no
  diagnostics at all; the server-file filter is empty
  ([02](02-after-full.txt), [03](03-after-server.txt)).
- Scratch emission and behavior check (no `lib/` write, no `npm run build`):
  compiled `src/` into `node_modules/.servercheck/lib`, copied `package.json`
  and `test/` beside it, and ran the shipped tests against those artifacts.
  167 tests pass, 0 fail across `runtime`, `update`, `self-check`,
  `update-route`, `route-deadline`, `recent-check-diagnostics`, `plugin`, and
  `config` ([06-scratch-tests.txt](06-scratch-tests.txt)).
- Emitted-JS diff against the phase-1 `lib/*.js` reviewed:
  [05-emit-diff-vs-lib.patch](05-emit-diff-vs-lib.patch). No comment line is
  removed; the `compareVersions` JSDoc is still emitted above the function.
- Comment preservation: 491 original comment lines, 0 missing
  ([07-comments-preserved.txt](07-comments-preserved.txt)).
- Export-surface parity for all four emitted files
  ([08-export-surface.txt](08-export-surface.txt)).
- The four forbidden discovery literals are absent from both source and the
  scratch-emitted `update.js` ([09-forbidden-strings.txt](09-forbidden-strings.txt)).
- No trailing whitespace, no tab characters, no `any`, no suppressions, no
  non-null assertions, no enums/namespaces/parameter properties, and no new
  runtime imports (only the type-only `ShellExecRequest` import was added, and
  it is erased). `lib/` was not rebuilt or edited in this phase; the Lead owns
  emission.

## 7. Risks and open seams

- The predicates encode the host contract at the seam. If a host seam passes a
  primitive where the code documents an object, the narrowed type is optimistic,
  but the runtime guard that produced the narrowing is the same guard the
  phase-1 code used, so no behavior moved.
- Property read counts changed at three plain-row/plain-projection readers
  (`updateBehavior`, `stdout.text`, `disposedSessionId`'s empty string). This is
  not observable for the documented plain objects, but it would be for an
  accessor-based object; those seams are documented as plain rows.
- `compareVersions` `=== 1` call sites rely on the return domain staying
  `-1 | 0 | 1 | null`; a future change to that domain must revisit them.
- `whenIdle` is typed `Promise<unknown>` because its two branches differ; no
  caller reads the element type.
- `src/client.ts` was typed by a concurrent agent; the full program read 0 at
  evidence capture, and this phase did not touch it.
- Repo-wide `npm run check:drift` will pass only after the Lead rebuilds `lib/`
  from these sources. This phase intentionally ran no build.
