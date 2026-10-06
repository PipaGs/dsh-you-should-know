# dsh-you-should-know

A quiet, **human-only** second-opinion watcher for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A separately configured reviewer model — DeepSeek out of the box, any registered route by config — looks at each completed root-agent turn and speaks up only when the human most likely missed something important. When it does, a compact **You should know** card appears above the composer. It is dismissible, offers **Add to chat** without ever sending, is never written into the conversation, and never reaches the primary agent. A successful **Add to chat** resolves the note and removes it from the active stack, and each session keeps a bounded, in-memory **History** of what happened.

The product intent is analogous to Claude Code's *You Should Know*, with one deliberately harder constraint: here the note is for the human only.

## Status

Version `0.3.7`, MIT. Host and browser halves are committed as plain JavaScript, so a `github:` install needs no build step. Scope is intentionally small: a composer-adjacent note card with a bounded notification history, a Plugins settings card with a reviewer strictness mode and optional additional reviewer instructions, and a session-header mode and model override, one reviewer call per qualifying turn, and a per-session runtime that retries one transient failure, bounds the queue and the whole call, and pauses on quota without losing the turn.

## What it does

The host half observes committed session events and reviews a turn only when **all** of these hold:

1. The reviewer route is usable. Both route keys default to automatic adaptive DeepSeek discovery; setting either to an empty string registers nothing and keeps the plugin completely inert, and an automatic row whose build mounts no DeepSeek route resolves to no route and stays quiet.
2. The event is a `turn/end` whose reason is `completed`. Aborted, blocked, errored, max-tokens, and forked turns are ignored.
3. The session is a **root** agent session. Sessions with `header.origin === 'subagent'` or a positive `delegationDepth` are ignored.
4. The turn produced visible assistant text.
5. The turn is outside the per-session cooldown (`cooldownTurns`).
6. The visible conversation text accumulated since the last review is at least `minDeltaChars`.
7. The session has not already used its internal note budget (12 notes per session).

When the gates pass, the host sends one request to the configured reviewer route through `ctx.llm.stream`:

- one system instruction composed in a fixed order: the base reviewer policy, then the strictness profile for the effective mode, then the human's additional reviewer instructions when present, then the adaptive profile section below. The base policy always outranks the profile and the custom text. Alongside it goes one user message containing a **bounded** excerpt of the most recent conversation: at most `maxContextMessages` visible text messages, each truncated, with a total character cap. Only human `user/message` text and assistant reply text enter the excerpt;
- **no tools**;
- `temperature: 0` and `maxTokens`;
- `reasoningEffort: 'off'` **only** when the model's own metadata advertises an `off` effort; otherwise the field is omitted entirely.

The reply must be a single JSON object:

```json
{"note": "one or two sentences addressed to the human", "importance": "high", "source": {"path": "src/store.js", "line": 42}, "action": "concrete repair instruction for the coding agent"}
```

`importance` is `"high"` or `"critical"`, and a nonempty `note` requires one of those two values. `source` is optional: when the finding is tied to a concrete file whose exact path appears verbatim in the untrusted excerpt, it carries that path and, only when the excerpt states it, a positive 1-based `line`. The reviewer is told never to synthesize, normalize, or guess a path, and to omit the source entirely when no exact path appears. A present but malformed source — a non-object, a missing, blank, oversized, or control-character path, a URL such as `http:`, `javascript:`, or `data:`, or a non-positive or non-integer line — drops the whole reply quietly. `action` is optional: when the finding has a concrete repair, it carries one bounded instruction written for the coding agent that says what to change, while `note` remains the human-facing explanation. A present but non-string, blank, or oversized action drops the whole reply quietly, exactly like a malformed source, and a valid finding without an action stays fully supported. Silence is exactly one shape and never carries a source or an action: `{"note": null, "importance": null}`. Both keys must be present and must agree, so a missing field, a `null` note paired with a real importance, an empty or whitespace note, an unknown importance, prose, a fenced object, a non-object, or a truncated object is dropped quietly. Harmless extra keys are ignored. Accepted notes are normalized and deduplicated by their text, so the same advice is never shown twice in one session.

Qualifying information is deliberately narrow: a contradiction with an explicit user requirement, an overlooked material constraint, a serious correctness/security/safety/data-loss/reliability problem, or an important implication that changes the user's next decision. The reviewer is told to stay silent otherwise and not to summarize, praise, or give style advice.

A review adapts to the conversation through the plugin's review profile. The note is written in the same natural language as the most recent genuine human user message, falling back to the nearest earlier human message when that message is code-only or its language is unclear, and to English when nothing is clear. When the visible conversation reliably shows a programming language through a fenced code tag or a file extension, the instruction also gains a small, bounded set of language-specific correctness skills — at most three, chosen deterministically and never inferred from bare keywords. Each skill is a short plugin-owned checklist of defects that can materially matter: async and promise error flow, listener and resource lifetime, concurrency and races, nullability and type-versus-runtime mismatch, transaction and query semantics, quoting and failure propagation in shell, and similar. They are instruction text only: the reviewer runs no external skill or tool, and the JSON reply contract is unchanged.

### Reviewer strictness modes and additional instructions

Each review runs under exactly one mode. The five modes are `Relaxed`, `Balanced`, `Strict`, `Paranoid`, and `Custom`; the default is `Balanced`. The mode changes both the areas of scrutiny in the reviewer instruction and the notification threshold — the minimum `importance` the engine will actually store as a note:

| Mode | Areas of scrutiny | Notification threshold |
|---|---|---|
| `Relaxed` | Only obvious, material problems: real bugs, violated explicit requirements, security or data-loss risks, clearly wrong behavior. | Stores only `critical`; a `high` finding is dropped. |
| `Balanced` | Material overlooked problems: bugs, requirement violations, invalid states, API contract errors, race conditions, security issues, and important error-handling or test gaps. | Stores `high` and `critical`. |
| `Strict` | `Balanced` plus edge cases, stale state, race conditions, API contracts, exception paths, incorrect or redundant network behavior, material performance problems, and meaningful missing tests. | Stores `high` and `critical`. |
| `Paranoid` | Aggressively searches hidden failure modes and regressions: assumptions, concurrency, stale or unknown state, partial failures, retries, cleanup, lifecycle, boundaries, security, data loss, side effects, and API incompatibility. | Stores `high` and `critical`; a lower-confidence `high` note is stored only when it carries a concrete `action` — the engine drops a `high` note without one. |
| `Custom` | Shaped by the saved Custom reviewer prompt, which replaces the strictness profile, with the additional instructions as an overlay and the `Balanced` materiality floor. | Stores `high` and `critical`. |

No mode ever admits a style, formatting, lint, naming, or preference finding, and no mode can relax the base policy: the exact JSON reply contract, the verbatim-path rule for `source`, the untrusted-excerpt rule, and the no-fabrication rule always win. The threshold is deterministic — the reviewer's own `importance` value is what the engine gates on — so a malformed or non-text reply is dropped exactly as before. The deterministic ladder has two explicit floors: `Relaxed` admits only `critical`, and `Paranoid` requires a concrete `action` on a `high` finding. `Balanced`, `Strict`, and `Custom` share the `high`/`critical` floor because the fixed reply contract has no lower tier; `Strict` and `Paranoid` widen scrutiny through the instruction fragment, and `Custom` replaces that fragment with the saved prompt below.

**Additional reviewer instructions** are an optional bounded string (up to 2000 characters) that the human sets in the settings card or the plugin row. The text is preserved verbatim, never translated or rewritten, and is appended after the strictness profile only when it is non-blank. Blank instructions are allowed in every mode; for `Custom` they keep the `Balanced` materiality floor. A session in `Custom` mode reuses the global additional instructions: there is no separate per-session instruction field, which keeps the session header small.

**The Custom reviewer prompt** is a second bounded string (up to 4000 characters), edited in a `Custom reviewer prompt` textarea that appears only when the mode is `Custom`. It replaces only the strictness-profile portion of the composition: `BASE REVIEWER PROMPT + SAVED CUSTOM REVIEWER PROMPT + OPTIONAL ADDITIONAL REVIEWER INSTRUCTIONS`. The base policy, the JSON and silence contract, the verbatim-path rule, the no-fabrication rule, and human-only isolation always come first and can never be replaced or exposed. The saved prompt is preserved verbatim, and a blank one falls back to the `Balanced` profile and threshold rather than disabling review. A session in `Custom` mode reuses the persisted global prompt; there is no per-session prompt field. The settings read returns the prompt so the textarea can render it, while the read-only status diagnostics and logs never carry it.

The reviewer's **response language** is still inferred from the latest genuine human message, independently of the mode, and the mode names are always rendered in English.

## The human-only invariant

This plugin is architecturally incapable of talking to the agent:

- no `agent.steer`, no `agent.inject`, and no `followup`;
- no inbox insertion and no wake-up of the primary driver;
- no append to the session log or the transcript;
- no modification of the primary model context;
- no approval or tool mechanisms.

Notes live in plugin-owned, in-memory, per-session state. The only consumer is the browser: exact Fetch routes on the host connection, reached under the absolute `/api` transport (`GET`/`HEAD /api/dsh-you-should-know/notes` for the active list plus a bounded history count, `GET`/`HEAD /api/dsh-you-should-know/history` for the bounded, newest-first per-session history, `POST /api/dsh-you-should-know/dismiss` to apply exactly one resolution action, the read-only `GET`/`HEAD /api/dsh-you-should-know/status`, the `GET`/`HEAD`/`POST /api/dsh-you-should-know/session` model override, and the `GET`/`HEAD`/`POST /api/dsh-you-should-know/config` settings route). The resolve route accepts exactly `dismissed` or `added_to_chat`; an absent action is the legacy manual dismissal. The config route writes through the host settings service into the same plugin row and reports itself read-only when that service is absent. The connection owns the Host/Origin fence and browser-session authentication, and the Desktop app origin proxies `/api` to the host. The host never hands a note to the model.

A source-level test (`test/invariant.test.js`) scans the shipped files for every delivery shape that could break this invariant and fails if one appears.

## Install from GitHub

Because the built host and browser halves are committed, installation needs no source build. Install an **immutable release ref**, not the default branch:

```sh
dsh plugin --profile <profile> add github:PipaGs/dsh-you-should-know#v0.3.7
```

A bare `github:PipaGs/dsh-you-should-know` address is resolved by pnpm and saved as that same value every time. The Desktop plugin manager learns which package an install produced by diffing the profile's dependencies before and after pnpm runs, and falls back to matching the typed address against a package name. A bare default-branch address changes nothing on the second run, and that fallback does not understand a Git address, so the manager reports that the installed package could not be told from the dependency change. A ref-pinned address is saved verbatim, so each install and upgrade is attributed to `dsh-you-should-know`. In the Desktop **Add plugin** dialog, enter the same pinned address. To move to a later release, install its tag; to install the exact version already present, remove the plugin first.

The bundle contributes one row, `you-should-know`, with the reviewer route left automatic. At the first qualifying turn the plugin asks the live LLM registry which DeepSeek route this build mounts and prefers a stable inexpensive chat/flash model from that route's own catalog: the documented `deepseek`/`deepseek-chat` pair where it exists, otherwise `deepseek-official`/`deepseek-flash` on a current build. When the profile mounts no DeepSeek route the plugin shows no note, makes zero model calls, and never touches the agent. Restart (or let HMR reload) the profile after changing the profile patch.

### Configure

Both `provider` and `model` are optional and default to **automatic**. The plugin resolves the automatic route from the live registry without making a model call:

1. It lists the registered provider routes and keeps the DeepSeek family (`deepseek`, `deepseek-official`, `deepseek-account`, then any other `deepseek*` route).
2. It reads each route's own model catalog and ranks the candidates by cost: the exact `deepseek`/`deepseek-chat` pair wins where it resolves, otherwise the cheapest stable chat/flash model any DeepSeek route advertises (`deepseek-chat`, then `deepseek-flash`, avoiding reasoning/pro models), with the provider order above only breaking ties.
3. If a route's catalog is unavailable it falls back to the conventional pair for a known DeepSeek route (`deepseek`/`deepseek-chat`, `deepseek-official`/`deepseek-flash`, `deepseek-account`/`deepseek-flash`) resolved through model metadata.
4. If no DeepSeek route resolves, the reviewer stays silent and makes zero model calls.

Setting **both** `provider` and `model` to nonblank strings is an exact override: the pair is used verbatim for any registered route, with no allowlist and no fallback. Setting **only one** of the two pins that half and resolves the other automatically. Setting **either** to an empty string disables the reviewer entirely.

Pin an exact route (this also disables discovery):

```yaml
- id: you-should-know
  name: dsh-you-should-know
  config:
    provider: deepseek-official
    model: deepseek-flash
    minDeltaChars: 1200
    cooldownTurns: 3
    maxContextMessages: 12
    maxTokens: 768
```

Or select any other route the profile registers:

```yaml
- id: you-should-know
  name: dsh-you-should-know
  config:
    provider: openrouter
    model: anthropic/claude-sonnet-4
    minDeltaChars: 1200
    cooldownTurns: 3
    maxContextMessages: 12
    maxTokens: 768
```

The bundled row pins no route, so this example is only a template. A patch replaces the **whole** config of the row it matches, so restate every key you want to keep. Place one `- id: you-should-know` entry in `$DSH_HOME/profiles/<profile>/cordis.patch.yml` (or a `--patch` overlay); do **not** add a second `insert` for the same id, or the row would be composed twice.

Only the model's *availability in the profile* is required: if the route is missing or the credential is not configured, the reviewer call fails quietly and no note is shown. Declaring a model here does not make it available; it only selects it.

| Key | Default | Validation | Meaning |
|---|---|---|---|
| `provider` | automatic | string, trimmed | Reviewer provider route. Empty means the plugin is inert. |
| `model` | automatic | string, trimmed | Reviewer model id. Empty means the plugin is inert. |
| `minDeltaChars` | `1200` | integer, 0–200000 | Minimum visible characters accumulated since the last review. |
| `cooldownTurns` | `3` | integer, 1–100 | Minimum number of completed root turns between reviews. |
| `maxContextMessages` | `12` | integer, 1–100 | Maximum recent text messages sent to the reviewer. |
| `maxTokens` | `768` | integer, 128–16384 | Output cap for the reviewer call. |
| `reviewerMode` | `balanced` | one of `relaxed`, `balanced`, `strict`, `paranoid`, `custom` | Reviewer strictness mode; it also sets the notification threshold. |
| `additionalInstructions` | empty | string, at most 2000 characters | Extra reviewer instructions for every mode, appended after the strictness profile and preserved verbatim. It never replaces or exposes the base policy. |
| `customReviewerPrompt` | empty | string, at most 4000 characters | Custom-mode strictness profile, preserved verbatim and used only when the mode is `custom`; blank falls back to Balanced. |

Invalid values never fail the load: each one falls back to its conservative default and the host logs one warning. Every field is declared volatile in the plugin's `Config` schema, so a profile-patch edit is committed into the running fiber in place and reported as `loader/volatile-update`: later reviews use the new route, gates, and token budget without reinstalling or restarting. A save through the settings card or the config route persists to the same plugin row through the host settings service — automatic mode resets the live fields so a stored pin is really cleared, while a pinned route merges both route keys — and applies to the live engine immediately. Use a reviewer route that is different from the route the primary agent uses if you want a genuinely independent opinion.

## Web UI

The browser half registers three surfaces.

**Note card** (`conversation.input.dock`, the full-width slot above the composer):

- No active note and no history: it renders **nothing**.
- An active note or any history: it renders all unresolved notes for the current session as a bounded, oldest-first stack — newest nearest the composer, capped at the same 12-note per-session budget the host enforces — each a compact card titled **You should know**, marked **critical** when the reviewer said so. Every card carries **Add to chat** and **Dismiss**, and the same column offers a compact **History** action.
- A card whose finding names an exact file shows that path as copyable text. When the client's right-Sidebar navigation service is mounted, an **Open file** action opens it at the stated line through the public `dsh-resource://file/session/<sessionId>/<path>` resource address; it runs no shell command and never accepts an arbitrary URL. With no navigation service the card shows the copyable path and no link.
- **Add to chat** writes a short draft into the current composer through the public programmatic draft action (`inputActions.setDraft`). When the finding carries an `action`, that agent-facing repair instruction is the draft and the human note stays on the card; the source is appended as a separate `File: path:line` line only when the action does not already name the exact path. A finding with no action (an older note) falls back to an imperative wrapper around the note: `Fix this reviewer finding: <note>`, plus `File: path:line` when a source is present. It never sends, steers, or appends to the transcript, and it appends after a blank line when the composer already holds a draft. The button keeps the draft focused, so pressing Enter afterwards submits the draft instead of re-activating the button and inserting the finding again. Only when the draft write succeeds does the note resolve with `added_to_chat` and leave the stack; a failed draft write leaves the card exactly as it was, with no host transition.
- **Dismiss** resolves the note with `dismissed` and removes it from the stack. Resolution is session-scoped, immediate, remembered for the life of the page (bounded to the 200 most recent sessions), and reported to the host so every read agrees. Switching to another session stops rendering the previous session's notes in the same frame, before the new poll resolves, so a stale note is never shown or resolved against the wrong session.
- **History** opens a lightweight, read-only panel for the current session: every stored note, newest first, with its importance, the human note text (never the agent-facing action), a deterministic UTC timestamp, its optional source path/line, and its state — **Active**, **Dismissed**, or **Added to chat**. Active entries keep **Add to chat** and **Dismiss**; resolved entries keep only their copyable source and **Open file**, so a resolved note can never be resolved again. The panel reads once when opened and refreshes after a resolve or a reconnect; it never polls while closed. History is in-memory and per-session, bounded by the same 12-note cap, and clears when the session is disposed or the host restarts.

**Settings card** (`plugins.bundle.config`, the bundle's card in the Plugins settings page):

- It reads the live config and the registered provider/model catalog from the config route and writes back to the same plugin row, so there is no second config store.
- Provider and model selects list only ids the live registry reports; choosing a provider reloads the model list for it. **Automatic** leaves the route to adaptive discovery, while **Pinned** sends the exact pair.
- **Reviewer mode** selects one of the five modes and shows a one-line description of the selected mode. A `Custom reviewer prompt` textarea appears only in `Custom` mode; it replaces the strictness profile and is preserved exactly. **Additional reviewer instructions** is a separate optional bounded textarea for every mode. None of these controls can edit or reveal the base reviewer policy.
- The numeric gates (`minDeltaChars`, `cooldownTurns`, `maxContextMessages`, `maxTokens`) are editable and validated against the same bounds as the row.
- Save is disabled, and every control explains why, when the host mounts no writable settings service. A pinned route that resolves to nothing is rejected before anything is persisted, with a bounded message.
- The card refreshes once on mount, on window focus, and on a connection reset; a stale response from an older request generation never overwrites a newer one.

**Session header action** (`conversation.session.header.actions`, scoped to one session):

- It shows the effective reviewer route, whether it comes from the session, the global pin, or adaptive discovery, the runtime status, and the pending-note count.
- It can pin an exact provider/model for this session only, choose a session-only reviewer mode (**Default** plus the five modes) that never mutates the global setting, reset the model back to the global default, and resume a runtime paused by a quota failure; a non-quota runtime never offers resume. A session in `Custom` mode reuses the global custom reviewer prompt, and the header never edits it.
- It never renders the transcript and never posts to the primary agent.

Delivery uses conservative polling. While the page is visible the note card polls its route every 7 seconds; polling stops while the tab is hidden and refreshes immediately when it becomes visible again. The two settings surfaces have no interval: they refresh on mount, focus, and connection reset. There is no push channel for out-of-tree plugins in the current public API, so polling is the documented mechanism.

## Operational verification

The host exposes a read-only `GET`/`HEAD /api/dsh-you-should-know/status?sessionId=<id>` route on the connection transport so you can prove the reviewer is working without reading any conversation text. Because it sits behind the same browser-session authentication as the rest of `/api`, a bare `curl` gets `401`; read it from the page the GUI already authenticated, for example from the browser console:

```js
await (await fetch('api/dsh-you-should-know/status?sessionId=<session-id>')).json()
```

It returns bounded JSON:

```json
{
  "ok": true,
  "configured": true,
  "reviewerMode": "balanced",
  "effectiveMode": "balanced",
  "route": { "provider": "deepseek-account", "model": "deepseek-flash" },
  "routeResolutions": 1,
  "effectiveRoute": { "provider": "deepseek-account", "model": "deepseek-flash" },
  "effectiveRouteSource": "automatic",
  "session": {
    "reviewStarts": 2,
    "lastReviewAt": 1700000000000,
    "lastOutcome": "noted",
    "inFlight": false,
    "noteCount": 1,
    "runtimeStatus": "idle",
    "runtime": {
      "pendingReviews": 0,
      "completedReviews": 2,
      "emptyReplies": 0,
      "unparsedReplies": 0,
      "transportDrops": 0,
      "queueDrops": 0,
      "backlogFlushes": 0,
      "lastReviewAt": 1700000000000,
      "lastOutcome": "noted",
      "runtimeStatus": "idle"
    }
  }
}
```

How to read each value:

| Field | Meaning |
|---|---|
| `configured` | `false` only when an explicit blank `provider`/`model` disabled the reviewer; that row registers no routes at all. |
| `reviewerMode` | The global strictness mode id. |
| `effectiveMode` | The mode the given session would use right now: its session override, else the global mode. |
| `route` | The resolved reviewer route, or `null` when none has resolved yet or the profile mounts no DeepSeek route. |
| `routeResolutions` | How many times the engine attempted route discovery. It exceeds `1` only when an earlier attempt resolved to no route (or failed transiently) and a later qualifying turn retried. A steady `1` next to a non-null `route` means discovery succeeded once and is cached. |
| `effectiveRoute` | The route the given session would actually use right now: its per-session override, else the global pin, else the cached automatic discovery. `null` until discovery has run. |
| `effectiveRouteSource` | `session`, `global`, `automatic`, or `null` when the reviewer is disabled. |
| `session.reviewStarts` | Qualifying turns that entered the review pipeline, including attempts that ended `unroutable`. |
| `session.lastReviewAt` | Host timestamp in milliseconds when the last review attempt started, or `null`. |
| `session.lastOutcome` | Terminal outcome of the last review: `unroutable` (no route), `silent` (reviewer said nothing, or the call failed quietly), `noted` (a note was stored), `duplicate` (the same advice was already stored), `budget` (the per-session note ceiling was reached), or `error` (the pipeline threw unexpectedly). |
| `session.inFlight` | `true` while one reviewer call is in progress for that session. |
| `session.noteCount` | Unresolved notes the human can still act on for the session. |
| `session.historyCount` | Notes stored for the session, resolved or not; bounded by the same 12-note per-session cap. |
| `session.runtimeStatus` | The per-session scheduler state: `idle`, `reviewing`, `quota_exhausted`, `halted`, `degraded`, or `disposed`. |
| `session.runtime` | The runtime's bounded counters: pending queue, completed reviews, empty and unparsed replies, transport drops, queue drops, backlog flushes, and the last outcome/timestamp. No conversation, prompt, note, credential, or tool text is ever included. |

An unknown or missing `sessionId` returns `"session": null` with the global route state only. `HEAD` returns the same status line with no body, and a non-`GET`/`HEAD` request is rejected with `405`. The route is read-only, applies the same session-id bound as `/notes` and `/dismiss`, relies on the connection's Host/Origin fence and browser authentication, and never includes conversation text, prompt text, note text, source paths, credentials, or tool data.

Typical readings:

- `configured: false`, or a missing `status` route: an explicit blank route half disabled the reviewer.
- `route: null` with a growing `routeResolutions`: the first qualifying turn ran before the profile mounted a usable DeepSeek route. Since `0.2.2` the engine retries discovery at each later qualifying turn, so the route can appear without a host restart; the next noted review shows the resolved pair.
- `route` present but `session.reviewStarts: 0`: no turn has passed the output, cooldown, and delta gates for that session yet.
- `lastOutcome: "noted"` with `noteCount >= 1`: the reviewer produced at least one note for this session.

## Privacy and cost

- The reviewer receives only the bounded excerpt described above: the human's own user messages and the agent's visible replies. Tool results, tool definitions, the system prompt, project instructions, attachments, and the rest of the session log are never sent.
- Notes are never persisted to the session log and never enter model context. They live in host memory and are lost when the host process exits.
- Each review is exactly one model call with a hard `maxTokens` cap, and the gates keep calls rare: a completed turn must pass the cooldown, the delta gate, and the per-session budget.
- The routes are Fetch handlers on the connection carrier, mounted under the same `/api` transport as the rest of the GUI. They expose only the note text, its optional source path, and its optional agent-facing repair action for a session id plus the bounded status counters; they do not expose credentials, prompt text, conversation text, or the transcript. The connection rejects cross-origin browser traffic (a foreign `Host`/`Origin`, or a request without a valid browser session) so a random web page cannot dismiss notes or read diagnostics.
- The reviewer prompt declares the conversation excerpt untrusted data, so instructions embedded in a user or assistant message are not followed as reviewer instructions.

## Failure model

The plugin fails quiet by construction:

- a blank `provider`/`model` means zero reviewer calls, and the automatic DeepSeek route makes no visible change when the profile mounts no such route: discovery resolves to "no route" before any model call is attempted, and a later qualifying turn retries discovery, so a route that appears after a transient startup race is picked up without a restart;
- a reviewer/model/parser/RPC/browser failure is contained and logged at most as a host warning;
- a malformed or empty reply is dropped without a note;
- each session owns a bounded FIFO reviewer queue drained one call at a time: at most 32 reviews wait (the newest overflow is dropped), a transient transport/server/timeout failure is retried once after a short delay, and a whole-call deadline also aborts an iterator that ignores its `AbortSignal`;
- a quota or rate-limit failure pauses the runtime with the current turn retained at the front of the queue, so `resume` from the session header action or the session route replays it in place; a permanent credential, adapter, or unknown-model failure halts further calls for that session; three consecutive transport drops flush the queued backlog so a dead provider cannot build an unbounded retry wall;
- a live config change that alters the route or the token budget rebuilds every tracked runtime, and disabling disposes them while preserving notes, dedupe, and context, so re-enabling works;
- if no web server is present (headless profiles) the plugin still evaluates turns but has no delivery path: the connection mounts its `/api` transport only when a web server exists, and the served browser bundle lives there too, so nothing is shown;
- if the package is composed twice, the second row is inert, so there is never more than one reviewer fiber;
- the `session/event`, `session/disposed`, and `loader/volatile-update` listeners each wrap their own work in a try/catch so a reviewer bug — including a throwing volatile config reference — cannot disturb primary work or escape into the host.

## Limitations

- Notes are in-memory only; a host restart forgets them.
- Dismissal is durable for the page and the host process, not across restarts.
- Polling is not a push channel: a note can take up to one poll interval to appear.
- There is no CLI or headless delivery: the note card, the Plugins settings card, and the session header action are the only surfaces, and all three need the GUI's web server.
- A route saved through the settings card or the session action is validated against live model metadata before it is persisted; a route written directly into a profile patch is not, and an unknown route simply fails quietly on the first review. The automatic route always consults the live registry and model catalog before it calls anything.
- The routes require the connection's browser session: they reject cross-origin browser traffic and unauthenticated requests, but any client that holds the GUI's session cookie and knows a session id can read that session's notes and status counters. Keep the DSH web server on loopback and treat the browser session as the access boundary.
- While no route resolves, the engine re-reads the live registry at each qualifying turn until discovery succeeds. Discovery never opens a generation stream, and the cooldown and delta gates bound how often it runs.
- The reviewer reads the full committed log once per session through the synchronous `snapshotEvents()` accessor, which DSH marks deprecated. After that seed the plugin follows the `session/event` feed and keeps a bounded recent-event window, so steady-state review never re-reads the log; a future DSH that removes the accessor degrades resumed-session context to feed-only instead of breaking the reviewer. Alongside the raw window it keeps a bounded side buffer of the most recent visible messages and per-turn assistant text, so a long noisy turn — a visible answer followed by thousands of tool events — cannot erase the current answer from the reviewer excerpt or the output gate.
- Notes accumulate per session up to an internal budget of 12; the budget is a safety constant, not a config key. Resolved notes stay inside it, so the active stack and the history are both bounded and the history never grows without bound.
- At most 200 sessions are tracked at once; the oldest session gives up its slot, its notes, and its model override when the table is full.
- At most 200 per-session model and mode overrides are retained, and a `session/disposed` event forgets the session's notes, dedupe, overrides, and runtime together.
- A session in `Custom` mode reuses the global additional reviewer instructions; there is no per-session instruction field in the session header.
- The reviewer is a language model. Treat its note as a prompt to check something, not as a verified fact.
- UI strings and all shipped or public text are English-only by design; a source-level test rejects CJK, Cyrillic, Greek, and Hangul ranges in addition to unrelated project references.

## Development

```sh
node --check lib/core.js && node --check lib/runtime.js && node --check lib/review-profile.js && node --check lib/review-strictness.js && node --check lib/index.js && node --check lib/client.js
node --test test/*.test.js
```

The suite covers adaptive DeepSeek route discovery, the documented and installed-style route variants, arbitrary exact overrides, partial pins, the blank-config gate, no-route fail-quiet and route recovery, live reconfiguration, the strict verdict shape, silent/malformed/non-text verdicts, deduplication, cooldown, the delta gate, the bounded event window and gap recovery, tool-event flood retention, session scoping and dismissal, the optional note source schema and its exact-path-only prompt invariant, the per-note source storage and dismissal, the bounded multi-note stack and its deliberate order, the copyable-source and Open file navigation seams, the Add to chat draft write with its one-click-one-insertion and Enter-submits-only lifecycle and its never-send guarantee, the connection bridge route shape for the combined GET/HEAD/POST routes, the status pending-note count after dismissal, the bounded client resolution memory, the resolve API with its exact `dismissed` and `added_to_chat` actions, the bounded and session-isolated notification history and its UI, the read-only status diagnostics, connection Fetch route registration with Request/Response semantics and bodyless HEAD responses, the document-relative browser URLs, bounded context, the adaptive response-language directive, deterministic language-skill detection with a three-skill cap and no keyword guessing, the single-reviewer guard, the browser bundle envelope, and the human-only source invariant. It also covers the per-session runtime queue and counters, transient retry and permanent/quota classification, the whole-call deadline, backlog flushing, and resume; the volatile config live-update path; the settings persistence split (reset for automatic, merge for pinned); the config and session routes; the settings card and session-header model override; the adaptive review profile, the reviewer strictness modes with their deterministic threshold gating, verbatim additional-instruction composition, diagnostics non-leak, and per-session mode override isolation, and the editable Custom reviewer prompt with its verbatim replacement composition and host-row persistence. The package declares no runtime dependencies of its own: its only non-relative import is the host-provided `@deepseek-ai/schemastery` Config schema, and there is no build step.

## Related work

[omdsh-dev/dsh-advisor](https://github.com/omdsh-dev/dsh-advisor) pairs a second model that passively reviews each turn and **injects its notes into the primary agent**, so the agent sees the advice and can act on it inside the same turn.

This plugin is the deliberate opposite. Its notes are **human-only**: the primary agent is never steered, injected, woken, or written to, and the advice never enters the transcript or the model context. The value here is an independent opinion for the person, not another instruction for the agent.

## License

MIT. See [LICENSE](./LICENSE).
