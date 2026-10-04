# dsh-you-should-know

A quiet, **human-only** second-opinion watcher for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A separately configured reviewer model — DeepSeek out of the box, any registered route by config — looks at each completed root-agent turn and speaks up only when the human most likely missed something important. When it does, a compact **You should know** card appears above the composer. It is dismissible, it is never written into the conversation, and it never reaches the primary agent.

The product intent is analogous to Claude Code's *You Should Know*, with one deliberately harder constraint: here the note is for the human only.

## Status

Version `0.2.0`, MIT. Host and browser halves are committed as plain JavaScript, so a `github:` install needs no build step. Scope is intentionally small: one web surface, one reviewer call per qualifying turn, no settings UI.

## What it does

The host half observes committed session events and reviews a turn only when **all** of these hold:

1. `provider` and `model` are both non-empty. The built-in default is DeepSeek (`deepseek` / `deepseek-chat`); setting either key to an empty string registers nothing and keeps the plugin completely inert.
2. The event is a `turn/end` whose reason is `completed`. Aborted, blocked, errored, max-tokens, and forked turns are ignored.
3. The session is a **root** agent session. Sessions with `header.origin === 'subagent'` or a positive `delegationDepth` are ignored.
4. The turn produced visible assistant text.
5. The turn is outside the per-session cooldown (`cooldownTurns`).
6. The visible conversation text accumulated since the last review is at least `minDeltaChars`.
7. The session has not already used its internal note budget (12 notes per session).

When the gates pass, the host sends one request to the configured reviewer route through `ctx.llm.stream`:

- one user message containing the reviewer instruction and a **bounded** excerpt of the most recent conversation: at most `maxContextMessages` visible text messages, each truncated, with a total character cap. Only human `user/message` text and assistant reply text enter the excerpt;
- **no tools**;
- `temperature: 0` and `maxTokens`;
- `reasoningEffort: 'off'` **only** when the model's own metadata advertises an `off` effort; otherwise the field is omitted entirely.

The reply must be a single JSON object:

```json
{"note": "one or two sentences addressed to the human", "importance": "high"}
```

`importance` is `"high"` or `"critical"`; `{"note": null, "importance": null}` means "nothing to report". Anything else — prose, a non-object, an unknown importance, a missing field, a truncated object — is dropped quietly. Accepted notes are normalized and deduplicated by their text, so the same advice is never shown twice in one session.

Qualifying information is deliberately narrow: a contradiction with an explicit user requirement, an overlooked material constraint, a serious correctness/security/safety/data-loss/reliability problem, or an important implication that changes the user's next decision. The reviewer is told to stay silent otherwise and not to summarize, praise, or give style advice.

## The human-only invariant

This plugin is architecturally incapable of talking to the agent:

- no `agent.steer`, no `agent.inject`, and no `followup`;
- no inbox insertion and no wake-up of the primary driver;
- no append to the session log or the transcript;
- no modification of the primary model context;
- no approval or tool mechanisms.

Notes live in plugin-owned, in-memory, per-session state. The only consumer is the browser: a local HTTP route on the web server (`GET /dsh-you-should-know/notes`, `POST /dsh-you-should-know/dismiss`). The host never hands a note to the model.

A source-level test (`test/invariant.test.js`) scans the shipped files for every delivery shape that could break this invariant and fails if one appears.

## Install from GitHub

Because the built host and browser halves are committed, installation needs no source build:

```sh
dsh plugin --profile <profile> add github:PipaGs/dsh-you-should-know
```

The bundle contributes one row, `you-should-know`, with the DeepSeek reviewer route already set. No further configuration is needed when the profile registers a `deepseek` provider; when it does not, the reviewer call resolves to a terminal provider failure, the plugin shows no note and never touches the agent, and only an unexpected thrown error reaches the host warning log. Restart (or let HMR reload) the profile after changing the profile patch.

### Configure

The built-in default is `provider: deepseek`, `model: deepseek-chat`. DSH resolves those ids against the providers the profile actually registers, and both keys accept **any** configured route: there is no allowlist. Two consequences are worth knowing:

- Current DSH builds register the official DeepSeek route as `deepseek-official` with models such as `deepseek-flash` and `deepseek-v4-pro`, not as `deepseek`. Set those ids explicitly on such a build.
- Any other registered route works the same way, for example a pi-ai-declared `openrouter` route or an `anthropic`/OpenAI-compatible endpoint.

Pin the official DeepSeek route on a current DSH build:

```yaml
- id: you-should-know
  name: dsh-you-should-know
  config:
    provider: deepseek-official
    model: deepseek-flash
    minDeltaChars: 1200
    cooldownTurns: 3
    maxContextMessages: 12
    maxTokens: 700
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
    maxTokens: 700
```

A patch replaces the **whole** config of the row it matches, so restate every key you want to keep. Place one `- id: you-should-know` entry in `$DSH_HOME/profiles/<profile>/cordis.patch.yml` (or a `--patch` overlay); do **not** add a second `insert` for the same id, or the row would be composed twice.

Only the model's *availability in the profile* is required: if the route is missing or the credential is not configured, the reviewer call fails quietly and no note is shown. Declaring a model here does not make it available; it only selects it.

| Key | Default | Validation | Meaning |
|---|---|---|---|
| `provider` | `deepseek` | string, trimmed | Reviewer provider route. Empty means the plugin is inert. |
| `model` | `deepseek-chat` | string, trimmed | Reviewer model id. Empty means the plugin is inert. |
| `minDeltaChars` | `1200` | integer, 0–200000 | Minimum visible characters accumulated since the last review. |
| `cooldownTurns` | `3` | integer, 1–100 | Minimum number of completed root turns between reviews. |
| `maxContextMessages` | `12` | integer, 1–100 | Maximum recent text messages sent to the reviewer. |
| `maxTokens` | `700` | integer, 32–8000 | Output cap for the reviewer call. |

Invalid values never fail the load: each one falls back to its conservative default and the host logs one warning. A saved patch change is picked up by the profile's live reload, so later reviews use the new route without reinstalling or restarting. Use a reviewer route that is different from the route the primary agent uses if you want a genuinely independent opinion.

## Web UI

The browser half registers into `conversation.input.dock` — the full-width slot directly above the composer card.

- No note: it renders **nothing**.
- At least one note: it renders a compact card titled **You should know**, marked **critical** when the reviewer said so, with a **Dismiss** button.
- Dismissal is session-scoped: the note disappears immediately, is remembered for the life of the page, and is also reported to the host so other reads agree.

Delivery uses conservative polling. While the page is visible the card polls its route every 7 seconds; polling stops while the tab is hidden and refreshes immediately when it becomes visible again. There is no push channel for out-of-tree plugins in the current public API, so polling is the documented mechanism.

## Privacy and cost

- The reviewer receives only the bounded excerpt described above: the human's own user messages and the agent's visible replies. Tool results, tool definitions, the system prompt, project instructions, attachments, and the rest of the session log are never sent.
- Notes are never persisted to the session log and never enter model context. They live in host memory and are lost when the host process exits.
- Each review is exactly one model call with a hard `maxTokens` cap, and the gates keep calls rare: a completed turn must pass the cooldown, the delta gate, and the per-session budget.
- Both HTTP routes are served by the same local web server as the rest of the GUI. They expose only note text for a session id; they do not expose credentials or the transcript, and they reject cross-origin browser traffic (a foreign `Origin`) so a random web page cannot dismiss or read notes.
- The reviewer prompt declares the conversation excerpt untrusted data, so instructions embedded in a user or assistant message are not followed as reviewer instructions.

## Failure model

The plugin fails quiet by construction:

- a blank `provider`/`model` means zero reviewer calls, and the built-in DeepSeek default also makes no visible change when the profile has no such route: the failed request settles as a provider error result inside the plugin and is never surfaced to the agent;
- a reviewer/model/parser/RPC/browser failure is contained and logged at most as a host warning;
- a malformed or empty reply is dropped without a note;
- if the web server is absent (headless profiles) the plugin still evaluates turns but has no delivery path: the notes route and the served browser bundle both live on that server, so nothing is shown;
- if the package is composed twice, the second row is inert, so there is never more than one reviewer fiber;
- the `session/event` listener wraps its own work in a try/catch so a reviewer bug cannot disturb primary work.

## Limitations

- Notes are in-memory only; a host restart forgets them.
- Dismissal is durable for the page and the host process, not across restarts.
- Polling is not a push channel: a note can take up to one poll interval to appear.
- The web card is the only surface; there is no CLI/headless delivery and no settings UI.
- Provider and model ids are not validated against the catalog up front; an unknown route simply fails quietly on the first review.
- The two note routes are unauthenticated, like every other in-tree plugin route: they reject cross-origin browser traffic, but any client that can reach the web server and knows a session id can read that session's notes. Keep the DSH web server on loopback or put your own authentication in front of it.
- The reviewer reads the full committed log once per session through the synchronous `snapshotEvents()` accessor, which DSH marks deprecated. After that seed the plugin follows the `session/event` feed and keeps a bounded recent-event window, so steady-state review never re-reads the log; a future DSH that removes the accessor degrades resumed-session context to feed-only instead of breaking the reviewer.
- The per-session note budget (12) is an internal safety constant, not a config key.
- At most 200 sessions are tracked at once; the oldest session gives up its slot and its notes when the table is full.
- The reviewer is a language model. Treat its note as a prompt to check something, not as a verified fact.
- UI strings are English-only by design.

## Development

```sh
node --check lib/core.js && node --check lib/index.js && node --check lib/client.js
node --test test/*.test.js
```

The suite covers the DeepSeek defaults, arbitrary provider/model overrides, the blank-config gate, live reconfiguration, silent/malformed/valid verdicts, deduplication, cooldown, the delta gate, the bounded event window and gap recovery, session scoping and dismissal, route origin checks, bounded context, the single-reviewer guard, the browser bundle envelope, and the human-only source invariant. There are no runtime dependencies.

## Related work

[omdsh-dev/dsh-advisor](https://github.com/omdsh-dev/dsh-advisor) pairs a second model that passively reviews each turn and **injects its notes into the primary agent**, so the agent sees the advice and can act on it inside the same turn.

This plugin is the deliberate opposite. Its notes are **human-only**: the primary agent is never steered, injected, woken, or written to, and the advice never enters the transcript or the model context. The value here is an independent opinion for the person, not another instruction for the agent.

## License

MIT. See [LICENSE](./LICENSE).
