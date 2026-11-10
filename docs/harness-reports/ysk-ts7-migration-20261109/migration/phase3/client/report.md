# Phase 3 strict typing — `src/client.ts`

- Worktree: `/Users/pipags/work/dsh-you-should-know-worktrees/ysk-ts7-migration-20261109`
- Date: 2026-11-09
- Scope: `src/client.ts` only. Phase 1–2 authored the file and emitted `lib/`;
  this phase removes every strict diagnostic attributed to `src/client.ts`.
- Rules followed: [conventions.md](../../../conventions.md) and
  [design.md](../../../design.md).
- No commit, push, checkout, or reset was made. `lib/`, `test/`, `scripts/`,
  `package.json`, `tsconfig.json`, `README.md`, `docs/reference.md`,
  `src/globals.d.ts`, and every other `src` file were not edited. `npm run
  build` was not run; the Lead emits the committed output.

## 1. Result

| File | Before | After |
|---|---|---|
| `src/client.ts` | 190 | **0** |

Full-program snapshot: 398 diagnostics before ([01-before.txt](01-before.txt)),
0 after ([02-after-full.txt](02-after-full.txt), 2026-11-09T23:14+03:00,
`tsc` exit 0). The after snapshot was taken while the other phase-3 agents
were finishing their own files, so the full-program number is a point-in-time
result; the filtered log for this file is [03-after-client.txt](03-after-client.txt)
(one comment line, zero diagnostics).

## 2. Command and filter

```sh
node -e 'const cp=require("node:child_process");const r=cp.spawnSync(process.execPath,
  ["node_modules/typescript/bin/tsc","-p","tsconfig.json","--noEmit","--pretty","false"],
  {encoding:"utf8"});process.stdout.write(r.stdout||"")'
```

Diagnostics were filtered with `^src/client\.ts\(\d+,\d+\): error TS\d+`.
The before baseline contains 190 such lines; the after filter contains none.

## 3. React seam

`ModuleLoaderEntry.factory` receives the host `require` typed as
`(specifier: string) => unknown`, so `require('react')` is `unknown`. The one
assertion in the file is at that seam:

```ts
const React = require('react') as ReactInterface
```

It is justified by the documented injection contract: the DSH Web runtime
resolves `'react'` to its bundled React, and the client cannot import React
itself (a browser global script with no module syntax). The assertion is
erased at emit, so the shipped call is byte-identical to the phase-1 output.
The interface is deliberately narrow and holds only the members used:

```ts
interface ReactInterface {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  useEffect(effect: () => (() => void) | undefined, deps?: readonly unknown[]): void
  useRef<T>(initial: T): { current: T }
  useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void]
}
```

`createElement` returns `unknown` because the host injects component trees,
not DOM nodes; the client never reads a returned node. Keeping the return
`unknown` avoids inventing a `ReactNode` hierarchy the code does not use.
`createElement` also does not check the props object against the component
props interfaces. Those interfaces (`NoteCardProps`, `HistoryEntryProps`,
`YouShouldKnowDockProps`, `SettingsProps`, `ReviewerSessionActionProps`) still
type the *receiving* component body, which is where the diagnostics were, and
where the values are actually read.

## 4. Wire-payload predicates

Every parsed `Response.json()` body stays `unknown` until a predicate narrows
it. Each predicate reproduces the exact inline check it replaces; no payload
is accepted that the phase-1 code rejected, and none is rejected that it
accepted for values JSON can produce (see section 6 for the non-JSON edge
cases).

| Route | Predicate | Envelope check | Rows validated |
|---|---|---|---|
| notes | `isNotesPayload` | object, `ok === true`, `notes` is an array | `isClientNote` inside `fetchNotes` consumer |
| history | `isHistoryPayload` | object, `ok === true`, `history` is an array | `isClientNote` in `filter` |
| explain | `isExplainPayload` | object (arrays included) | `ok`/`explanation`/`error` by `typeof` |
| config | `isConfigPayload` | object, `ok === true`, `config` is a non-null object | `ConfigView` members by `typeof`/`String` |
| session | `isSessionPayload` | object, `ok === true` | route/counters by `typeof`/comparison |
| config write | `isConfigWriteBody` | object (arrays included) | `ok`/`error` by `typeof` |
| update | `isUpdateResponse` | object (arrays included) | `ok`/`result` by comparison, `update` view |
| self-check | `isSelfCheckPayload` | object, `ok === true` | reported members by `typeof` |
| history count | `isNonNegativeInteger` | number, integer, `>= 0` | value itself |
| catalog | `isProviderCatalog`, `isProviderEntry`, `isNonEmptyString` | object, `providers` array; row `id` non-empty string; models non-empty strings | rows and model names |
| self-check routes | `isUnregisteredRoute` | object, `registered === false`, `name` string | `name` |
| route summary | `isReviewerRoute` | object, string `provider` and `model` | both names |
| change event | `isChangeEvent` | object with a truthy `target` | `target.value` / `target.checked` |
| file navigation | `isFileNavigationService` | object with function `openResource` | the function |

Dismiss posts (`resolveOnHost`) and session posts (`postSession`) parse no
fields, so they need no payload predicate: the phase-1 code only tests the
transport result, and that test is unchanged.

Where the renderer consumed a payload member with a non-predicate guard
(`typeof x === 'string'`, `=== true`, `String(x)`, template interpolation), the
member is declared as an optional `unknown` and the original guard stays in
place. Where a member is consumed as a string by a typed API, the payload view
declares it as `string` and the original `typeof` guard is kept as well; this
applies to `ReviewerRouteView.provider`/`model` and
`UpdateStatusView.installSpec` (the copy action passes it to
`clipboard.writeText`). The predicates validate envelopes and rows; the
per-member declarations are the client's usage contract, not a second
validator, and no scalar value skips its existing guard.

## 5. Types introduced

- `ReactInterface`, `ReactChangeEvent`, `ReactMouseEvent`, `FieldValue`
  (`string | ReactChangeEvent`; the legacy targetless branch returns the event
  itself, so the form field type has to admit it).
- Payload envelopes and views: `ClientNote`, `NoteSource`, `NotesPayload`,
  `HistoryPayload`, `ExplainPayload`/`ExplainResult`, `ConfigPayload`,
  `ConfigView`, `ConfigWriteBody`, `ConfigWritePayload`, `SessionPayload`,
  `SessionStateView`, `ReviewerRouteView`, `UpdateStatusView`,
  `UpdateResponse`, `SelfCheckPayload`, `ProviderCatalog`,
  `ProviderCatalogEntry`.
- Request bodies: `ResolutionAction`, `SessionAction`, `UpdateAction`,
  `UpdatePreferencesPatch`, `SettingsForm`.
- UI state and faces: `ReviewerOption`, `ChannelStore` shape (inferred from
  `createChannelStore`), `NoteCardProps`, `HistoryEntryProps`, `DockView`,
  `DockHistoryView`, `DockExplainView`, `ExplainEntry`, `ExplainPhase`,
  `ResolutionTag`, `InputActionsFace`, `ComposerInput`, `SessionDetail`,
  `SessionSelection`, `RestartState`.
- Host seams: `HostContext`, `ConnectionService`, `SlotsService`,
  `SlotRegistration`, `FileNavigationService`.
- Predicates listed in section 4, plus `isClientNote`, `isChangeEvent`,
  `isNonNegativeInteger`, `isReviewerRoute`, `isFileNavigationService`.

No enums, namespaces, parameter properties, decorators, or `import x =
require()` were used. There is no `any`, no non-null assertion, and no
suppression comment (07-static-checks.txt). `useState` calls that hold a
nullable or object state carry an explicit type argument; that argument is
erased at emit.

## 6. Behavior neutrality

The verification gate is emitted-JS equality: the project compiles to
`node_modules/.clientcheck` and the emitted `client.js` is diffed against the
committed `lib/client.js` ([05-emit-diff-vs-lib.patch](05-emit-diff-vs-lib.patch),
165 changed lines: 26 removed, 137 added). Every removed line is one of the
expression substitutions below; no line of the original runtime logic
disappears silently.

Equivalent-expression substitutions (the complete removed inventory):

1. Envelope guards → predicates: `isNotesPayload`, `isHistoryPayload`,
   `isExplainPayload`, `isConfigPayload`, `isSessionPayload`,
   `isSelfCheckPayload`, `isConfigWriteBody`, `isUpdateResponse`. The bodies
   are the same `null`/`typeof`/`Array.isArray`/`ok === true` tests in
   predicate form.
2. Row filters → predicates: `history.filter(isClientNote)`,
   `providers.filter(isProviderEntry)`, `models.filter(isNonEmptyString)`,
   `routes.filter(isUnregisteredRoute)`, and the poll filter
   `filter((note): note is ClientNote => isClientNote(note) && !resolved.has(note.id))`.
   The poll annotation adds no runtime test; the boolean conjunction is the
   phase-1 condition in predicate form.
3. Count clamp: `Number.isInteger(x) && x >= 0` → `isNonNegativeInteger(x)`;
   `typeof x === 'number'` is implied by `Number.isInteger` for every value,
   so the ternary selects the same branch for every input.
4. `fieldValue` / `checkedValue`: `event && event.target` →
   `isChangeEvent(event)`; for objects the predicate is
   `typeof event === 'object' && 'target' in event && Boolean(event.target)`,
   which selects the same branch as the truthiness test.
5. `routeSummary`: the three-part guard → `isReviewerRoute`.
6. `catalogProviders`: `!catalog || !Array.isArray(...)` → `isProviderCatalog`.
7. `postConfig`: `{ ok, body }` → `{ ok, body: isConfigWriteBody(body) ? body : null }`.
   Both read sites only test `result.body` truthiness, then `result.body.ok`
   and `result.body.error`; a primitive body produced the same `false`/`error`
   outcomes before (property access on a primitive yields `undefined`), so the
   observable result is unchanged.
8. `onOpenFile` in `NoteCard` and `HistoryEntry` is read into a local before
   the `canOpen` test, and the click callback uses that local. Runtime: the
   same property of the same props object is read once per render instead of
   once per render plus once per click; React props do not carry getters, and
   a missing handler still renders no button.
9. `sidebar` in `apply`: `sidebar && typeof sidebar.openResource === 'function'`
   → `isFileNavigationService(sidebar)`; both reject `null`/`undefined` and
   both accept the plain host service object.

The only added runtime branch is the capped-session eviction:

```ts
const oldest = resolvedBySession.keys().next().value
if (oldest !== undefined) resolvedBySession.delete(oldest)
```

`MapIterator.value` is typed `K | undefined`. The map was just written, so
`size > MAX_RESOLVED_SESSIONS >= 0` proves it is nonempty; the guard can never
take the false path. This mirrors the accepted phase-2 precedent in
`src/feedback.ts` (`const oldest = keys.keys().next().value; if (oldest !==
undefined) keys.delete(oldest)`).

Edge cases where a predicate is narrower than the original truth check: a
callable object (function) that carries the probed members would have passed
the phase-1 checks and is now rejected, and a truthy non-object `event`/route
row was already rejected in practice because property access on a primitive
yields `undefined`. JSON responses cannot contain functions, and React hands
plain objects, so these cases are outside the contracts the code reads. All
downstream behavior on such a value is the same bounded failure the phase-1
code produced.

Comments: all 161 comment blocks of the phase-1 `lib/client.js` are present,
verbatim, in `src/client.ts` ([08-comment-preservation.txt](08-comment-preservation.txt));
the emitted diff removes no comment line. New comments explain the React
assertion, the eviction invariant, and each predicate's untrusted input; they
appear as additions in the emitted file.

Behavior evidence: the four client test files (`test/client.test.js`,
`test/client-hooks.test.js`, `test/client-ui.test.js`,
`test/invariant.test.js`) run against the emitted `client.js` in a staged tree
under `node_modules/.clientverify` (the committed `lib/` was copied, then only
`lib/client.js` was replaced by the scratch emit). Result: 125 tests, 125 pass,
0 fail ([06-client-tests-vs-emitted.txt](06-client-tests-vs-emitted.txt)).

## 7. Browser globals

No browser member had to be worked around and `src/globals.d.ts` was not
touched. The file reads only what that file or `@types/node` declares:
`window.__ModuleLoader__`, `window` focus listeners, `document.visibilityState`
and visibility listeners, `navigator.clipboard.writeText`, plus `fetch`,
`setInterval`/`clearInterval`, `Date`, `JSON`, and `encodeURIComponent`.
One typing consequence: `setInterval` is the Node declaration
(`NodeJS.Timeout`), because `@types/node` is the only timer declaration the
project loads and the conventions forbid adding the DOM lib; the runtime value
in the browser is a number, and the handle is only passed back to
`clearInterval`. The timer local is annotated `NodeJS.Timeout | null`.

## 8. Verification and evidence

```sh
node -e '<tsc --noEmit, filter ^src/client\.ts\('         # 0 diagnostics
node -e '<tsc --outDir node_modules/.clientcheck>'        # scratch emit, no lib/ write
diff -u lib/client.js node_modules/.clientcheck/client.js # 165 lines, reviewed
node -e '<run the four client test files against the emit>'  # 125 pass, 0 fail
```

Evidence files:

- [01-before.txt](01-before.txt) — full-program `tsc`, 398 diagnostics, 190 in `src/client.ts`
- [02-after-full.txt](02-after-full.txt) — full-program `tsc` exit 0, no diagnostics
- [03-after-client.txt](03-after-client.txt) — filtered client log, zero diagnostics
- [04-changed-files.txt](04-changed-files.txt) — scope record (`src/` is untracked)
- [05-emit-diff-vs-lib.patch](05-emit-diff-vs-lib.patch) — emitted-JS diff against `lib/client.js`
- [06-client-tests-vs-emitted.txt](06-client-tests-vs-emitted.txt) — 125 pass, 0 fail
- [07-static-checks.txt](07-static-checks.txt) — no `any`, suppression, assertion, enum, module syntax, trailing space, or tab
- [08-comment-preservation.txt](08-comment-preservation.txt) — 161/161 original comment blocks present

## 9. Risks and open seams

- The member declarations in the payload views describe how the renderer uses
  a value, not what the host is guaranteed to send. Every scalar still goes
  through its phase-1 `typeof`/equality guard, so a malformed member degrades
  exactly as before; `ReviewerRouteView.provider`/`model` and
  `UpdateStatusView.installSpec` are the three members consumed as strings and
  are the declarations most worth a second look.
- The full-program after count (0) is a point-in-time snapshot of concurrent
  phase-3 work; only the filtered `src/client.ts` log is this task's claim.
- The Lead still owns emission and the phase gate: `npm run build`,
  `npm test`, `npm run check:drift`, and `git diff --check` were not run here
  by design.
