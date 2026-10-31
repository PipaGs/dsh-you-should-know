# dsh-you-should-know

A quiet, **human-only** second-opinion watcher for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A separately configured reviewer model — DeepSeek out of the box, any registered route by config — reads each completed root-agent turn and speaks up only when the human most likely missed something important. A compact **You should know** card sits above the composer: dismissible, with **Add to chat**, **Knew it**, **Thanks**, and **Explain**. Nothing is sent into the conversation, nothing is steered, and nothing enters the primary agent's context. With no active note and no history, the slot stays completely empty — no banner, no label, no reserved space.

The intent mirrors Claude Code's *You Should Know* with one deliberately harder constraint: the note is for the human only. The versioned upstream baseline and read-only adoption workflow live in [docs/upstream/](./docs/upstream/README.md); deep contracts, route schemas, and runtime internals live in [docs/reference.md](./docs/reference.md).

## Status

Version `0.5.1`, MIT. Host and browser halves ship as plain JavaScript, so a `github:` install needs no build. The scope is intentionally small: a composer-adjacent note card with a bounded in-memory history, a Plugins settings card (strictness mode, additional instructions, custom prompt, update controls), a session-header mode and model override, one reviewer call per qualifying turn, and a per-session runtime that retries one transient failure, bounds the queue, and pauses on quota without losing the turn.

## What it does

The host reviews a turn only when **all** of these hold:

1. A reviewer route resolves. Both route keys default to automatic DeepSeek discovery; setting either to an empty string disables the plugin entirely, and a profile that mounts no DeepSeek route stays silent.
2. The event is `turn/end` with reason `completed`. Aborted, blocked, errored, max-tokens, and forked turns are ignored.
3. The session is a **root** agent session — subagent sessions and delegated turns are ignored.
4. The turn is a meaningful episode or clears the text-delta gate. A meaningful episode carries tool activity, a subagent event, or a workflow event; otherwise the turn needs visible assistant text and at least `minDeltaChars` accumulated characters, so a short ordinary Q&A stays ineligible.
5. The turn is outside the effective cooldown: `cooldownTurns` multiplied by the bounded quiet streak.
6. The session is inside its sliding one-hour budget (`maxReviewerCallsPerHour`). A skipped review makes no model call.
7. The session has not used its internal 12-note budget.

When the gates pass, the host sends one `ctx.llm.stream` request:

- a system instruction composed in a fixed order — base policy, strictness profile for the mode, optional human instructions, adaptive profile. The base policy always outranks the rest;
- one user message with a **bounded** excerpt of recent conversation: human user text and assistant reply text only, each message truncated under a total character cap. A meaningful episode appends one bounded evidence capsule with explicit markers (tool names, failure identity, turn reason, presentation paths, subagent provenance — never raw arguments, output, or message content);
- **no tools**, `temperature: 0`, `maxTokens`, and `reasoningEffort: 'off'` only when the model advertises an `off` effort.

The reply must be one JSON object:

```json
{"note": "one or two sentences addressed to the human", "importance": "high", "source": {"path": "src/store.js", "line": 42}, "action": "concrete repair instruction for the coding agent", "kind": "tradeoff", "because": "we kept the cache unbounded"}
```

`importance` is `high` or `critical`, and a nonempty note requires one of them. `source` is optional: it must be the exact relative path that appears verbatim as a whole token in the conversation excerpt, with a line only when the excerpt marks that path as `path:42` or `path#L42`. A path that traverses (`..`), is absolute (POSIX, Windows drive, or UNC), carries a percent sign, or appears only in the evidence capsule drops the whole reply. `action` is optional and, when present, is the agent-facing repair instruction used by **Add to chat**. A malformed source or action drops the whole reply quietly. `kind` is optional and names `defect`, `requirement_violation`, `consequence`, or `tradeoff`; an unknown or malformed `kind` becomes `unclassified` and the note is kept. `because` is required for `consequence` and `tradeoff` and must be a verbatim quotation of the conversation excerpt; the evidence capsule never grounds it, and a malformed or unmatched value drops the whole reply quietly. A C0 control (U+0000..U+001F), DEL (U+007F), a C1 control (U+0080..U+009F), or a bidi formatting control in the note, action, `because`, or source path drops the whole reply (the note is deliberately single-line; LF, CR, and TAB are rejected by design); each is checked on the raw value before trimming, so a leading or trailing control is never trimmed away. Ordinary space padding still trims, and natural Hebrew and Arabic text stays valid. Silence has exactly one shape, `{"note": null, "importance": null}`, and never carries either field; anything else that does not match the contract is dropped quietly. Accepted notes are normalized and deduplicated by text only, so the class never affects dedupe. Full validation rules: [verdict contract](./docs/reference.md#verdict-contract).

The **note voice** follows responsibility, using only what the excerpt supports: `we` for joint decisions, `the main agent` for the agent's actions, `you` when the decision or the consequence is the human's. When responsibility is unclear the note stays neutral and never invents blame.

Qualifying information is deliberately narrow: a contradiction with an explicit requirement, an overlooked material constraint, a serious correctness/security/safety/data-loss/reliability problem, an implication that changes the next decision, or a material consequence or tradeoff of the agent's own decision even when the task is complete and its checks pass. Otherwise the reviewer stays silent — no summaries, praise, or style advice.

Notes are written in the language of the latest genuine human message, falling back to English; a stored host language preference wins. When the excerpt reliably shows a programming language through a fenced tag or file extension, at most three bounded language-specific correctness checklists are added to the instruction.

### Reviewer strictness modes

Each review runs under exactly one mode. The mode changes both the areas of scrutiny and the notification threshold:

| Mode | Areas of scrutiny | Notification threshold |
|---|---|---|
| `Relaxed` | Only obvious, material problems: real bugs, violated explicit requirements, security or data-loss risks, clearly wrong behavior. Also a material consequence or tradeoff of the agent's own decision. | Stores `critical` only; a `high` finding is dropped. |
| `Balanced` (default) | Material overlooked problems: bugs, requirement violations, invalid states, API contract errors, races, security issues, error-handling and test gaps. Also a material consequence or tradeoff of the agent's own decision, even when the task is complete and its checks pass. | Stores `high` and `critical`. |
| `Strict` | `Balanced` plus edge cases, stale state, race conditions, exception paths, network behavior, performance problems, missing tests. Also a material consequence or tradeoff of the agent's own decision. | Stores `high` and `critical`. |
| `Paranoid` | Aggressively searches hidden failure modes and regressions: assumptions, concurrency, partial failures, retries, cleanup, lifecycle, boundaries, security, data loss, side effects, API incompatibility. Also a material consequence or tradeoff of the agent's own decision. | Stores `high` and `critical`; a `high` note needs a concrete `action`. |
| `Custom` | Shaped by the saved Custom reviewer prompt, which replaces the strictness profile, with additional instructions as an overlay and the `Balanced` materiality floor. Also a material consequence or tradeoff of the agent's own decision. | Stores `high` and `critical`. |

Every mode admits a material consequence or tradeoff of the agent's own decision, even when the task is complete and its checks pass; the class widens the areas of scrutiny, never the threshold. `Relaxed` therefore stores only a `critical` consequence, and `Paranoid` still requires a non-blank `action` on a `high` finding, whatever its class.

No mode admits style, formatting, lint, naming, or preference findings, and no mode can relax the base policy: the JSON contract, the verbatim-path rule, the untrusted-excerpt rule, and the no-fabrication rule always win. **Additional reviewer instructions** (up to 2000 characters) are appended verbatim in every mode. **The Custom reviewer prompt** (up to 4000 characters) replaces only the strictness-profile portion and never the base policy. Both are preserved exactly, never translated or rewritten. Mode details: [modes and prompts](./docs/reference.md#modes-and-prompts).

## The human-only invariant

The plugin is architecturally incapable of talking to the agent:

- no `agent.steer`, `agent.inject`, or `followup`;
- no inbox insertion, no wake-up, no append to the session log or transcript;
- no modification of the primary model context, no approval or tool mechanisms.

Notes live in plugin-owned, in-memory, per-session state. The only consumer is the browser, over authenticated Fetch routes under `/api/dsh-you-should-know/*`: notes, history, dismiss, status, session override, config, self-check, and explain. A source-level test (`test/invariant.test.js`) scans the shipped files for every delivery shape that could break this invariant.

## Install from GitHub

The built host and browser halves are committed, so installation needs no source build. Install an immutable release ref:

```sh
dsh plugin --profile <profile> add github:PipaGs/dsh-you-should-know#v0.5.1
```

A bare `github:PipaGs/dsh-you-should-know` address is saved as the same value on every run, so a second install cannot be told from the dependency change; a ref-pinned address is saved verbatim, so each install and upgrade is attributed to `dsh-you-should-know`. Enter the same pinned address in the Desktop **Add plugin** dialog. To move to a later release, install its tag; to reinstall the exact version already present, remove the plugin first.

The bundle contributes one row, `you-should-know`, with the reviewer route left automatic. At the first qualifying turn the plugin asks the live LLM registry for a DeepSeek route and picks a stable, inexpensive chat/flash model from that route's own catalog: the documented `deepseek`/`deepseek-chat` pair where it exists, otherwise `deepseek-official`/`deepseek-flash` on a current build. No DeepSeek route means no note, zero model calls, and no effect on the agent. Restart or let HMR reload the profile after changing the patch.

### Configure

Both `provider` and `model` are optional and default to **automatic**. Discovery keeps the DeepSeek family (`deepseek`, `deepseek-official`, `deepseek-account`, then any other `deepseek*` route), prefers the exact `deepseek`/`deepseek-chat` pair where it resolves, and otherwise chooses the cheapest stable chat/flash model from the route's own catalog, avoiding reasoning and pro models. A missing catalog falls back to the conventional pair for a known DeepSeek route; no resolvable route means silence.

Setting **both** keys is an exact override for any registered route — no allowlist, no fallback. Setting **one** pins that half and resolves the other automatically. Setting **either** to an empty string disables the reviewer entirely.

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
    maxReviewerCallsPerHour: 12
    recentCheckDiagnostics: false
```

A patch replaces the **whole** config of the row it matches, so restate every key you want to keep. Put one `- id: you-should-know` entry in `$DSH_HOME/profiles/<profile>/cordis.patch.yml` (or a `--patch` overlay); do not add a second `insert` for the same id. Only availability in the profile matters: a missing route or unconfigured credential fails quietly, and declaring a model does not make it available.

| Key | Default | Validation | Meaning |
|---|---|---|---|
| `provider` | automatic | string, trimmed | Reviewer provider route. Empty means inert. |
| `model` | automatic | string, trimmed | Reviewer model id. Empty means inert. |
| `minDeltaChars` | `1200` | integer, 0-200000 | Minimum visible characters since the last review. |
| `cooldownTurns` | `3` | integer, 1-100 | Minimum completed root turns between reviews. |
| `maxContextMessages` | `12` | integer, 1-100 | Maximum recent text messages sent to the reviewer. |
| `maxTokens` | `768` | integer, 128-16384 | Output cap for the reviewer call. |
| `maxReviewerCallsPerHour` | `12` | integer, 1-60 | Sliding hourly cap per session. A skipped review makes no model call. |
| `reviewerMode` | `balanced` | `relaxed`, `balanced`, `strict`, `paranoid`, `custom` | Strictness mode; also sets the notification threshold. |
| `additionalInstructions` | empty | string, at most 2000 characters | Extra reviewer instructions for every mode, appended after the strictness profile. |
| `customReviewerPrompt` | empty | string, at most 4000 characters | Custom-mode profile; blank falls back to Balanced. |
| `recentCheckDiagnostics` | `false` | boolean | Opt-in bounded in-memory recent-check history on the status route. |

Invalid values never fail the load: each falls back to its conservative default and the host logs one warning. Every field is volatile, so a patch edit or a settings save applies to the running fiber immediately.

`recentCheckDiagnostics` is off by default. While it is off, the status route has no `recentChecks` field at all. When it is on, each session keeps at most 12 terminal reviewer-check records in memory, newest first, recorded when a review settles while the opt-in is on; each record has exactly `at`, `turn`, and `outcome`, and the outcome is always one of the documented names. Turning it off clears the retained history, and re-enabling starts empty. The history is per-session and in-memory only: forgetting, disposing, or evicting a session drops it, a restart drops it, and nothing is persisted. The records never carry note, prompt, event, or conversation text.

## Web UI

The browser half registers three surfaces.

**Note card** (`conversation.input.dock`, above the composer):

- No note and no history: the dock renders nothing — no label, border, or gap.
- Unresolved notes render as a bounded, oldest-first stack (12 per session), newest nearest the composer; each card is titled **You should know** and marked **critical** when the reviewer said so.
- **Add to chat** composes a draft through `inputActions.setDraft` — the finding's `action` when present, otherwise `Fix this reviewer finding: <note>` plus `File: path:line` — and never sends, steers, or appends to the transcript. Add to chat writes no draft when the note, the action, or the source path carries a control character. The note resolves only after the draft write succeeds.
- **Dismiss** resolves the note; **Knew it** suppresses the fingerprint and near-duplicates for the session; **Thanks** and a successful **Add to chat** reset adaptive backoff; **Explain** fetches one cached, bounded explanation inline.
- **History** lists every stored note, newest first, with importance, text, timestamp, source, state, and any explanation. It reads once when opened and never polls while closed.
- An exact source path is copyable; with the right-Sidebar navigation service mounted, **Open file** opens it at the stated line.

**Settings card** (`plugins.bundle.config`): provider and model selects from the live registry (**Automatic** or **Pinned**), reviewer mode with a one-line description, a `Custom reviewer prompt` textarea shown only in `Custom` mode, **Additional reviewer instructions**, the numeric gates, and an **Updates** group with the current and latest version, the pinned address, automatic-check and update-behavior controls. Save is disabled with an explanation when the host mounts no writable settings service.

**Session header action** (`conversation.session.header.actions`): effective route and its source (session, global pin, or discovery), runtime status, pending-note count, a session-only model override, a session-only mode, and **resume** after a quota pause.

Delivery uses conservative polling: the note card polls every 7 seconds while the page is visible, stops while the tab is hidden, and refreshes on return. Settings surfaces refresh on mount, focus, and connection reset. There is no push channel for out-of-tree plugins.

### Feedback, Explain, and adaptive cadence

The resolve route accepts exactly `dismissed`, `added_to_chat`, `knew_it`, and `thanks`. `knew_it` records the finding fingerprint in a bounded per-session set (32 entries) and suppresses exact or near-duplicate findings before delivery. `thanks` and a successful **Add to chat** mark the finding useful and reset the quiet streak.

Each session keeps two bounded in-memory counters: a sliding one-hour reviewer budget (default 12) checked before any provider work, and a quiet streak that grows on every silent, duplicate, or suppressed verdict and multiplies the cooldown up to 4x. **Explain** is a separate one-shot bounded call with its own hourly counter, cached per note; a failure stays quiet and retryable. Full rules: [adaptive cadence](./docs/reference.md#adaptive-cadence).

## Update checking

The plugin **checks** for newer releases; it never installs. A host-side, read-only check runs at most once per local calendar day (on startup, or from a timer at local midnight) and can be triggered manually from the settings card. It runs one fixed `git ls-remote --tags --refs` against the public repository, accepts only stable `vX.Y.Z` tags, and sends no user data. When a newer release exists, the card shows `current -> latest` plus the exact pinned install address.

| Behavior | What happens on current DSH |
|---|---|
| **Notify only** | Fully supported; shows the notice and the pinned address. |
| **Ask before update** | Degrades to a notice: this DSH exposes no plugin update API, so nothing is installed. |
| **Automatic** | Stored preference only; nothing is installed on this DSH. |

The preference survives restarts in the plugin row. Installing a found release and restarting DSH Desktop stay manual. Internals: [update checker](./docs/reference.md#update-checker).

## Privacy and cost

- The reviewer receives only the bounded excerpt and, for a meaningful episode, one bounded evidence capsule. Tool definitions, the system prompt, project instructions, attachments, and the rest of the session log are never sent.
- Notes are never persisted to the session log and never enter model context; they live in host memory and are lost when the process exits.
- Each review is exactly one model call with a hard `maxTokens` cap, and the gates keep calls rare. **Explain** is one bounded call, only when the human presses the button.
- Plugin routes expose note text, an optional source path, an optional action, and bounded counters — never credentials, prompt text, conversation text, or the transcript. Cross-origin traffic is rejected; the browser session is the access boundary.
- The conversation excerpt is declared untrusted data, so instructions inside it are not followed as reviewer instructions.

## Failure model

The plugin fails quiet by construction: a missing route, credential, transport, or parser error produces no note and at most one host warning. Each session owns a bounded FIFO queue (32 reviews), retries one transient failure, aborts the whole call on a deadline, pauses on quota with the turn retained for **resume**, halts on a permanent credential or unknown-model failure, and flushes the backlog after three consecutive transport drops. Headless profiles evaluate turns but have no delivery path; a duplicate row is inert. Internals: [runtime and failures](./docs/reference.md#runtime-and-failures).

## Limitations

- Notes and dismissals are in-memory and do not survive a host restart.
- Polling is not a push channel: a note can take up to one interval to appear.
- There is no CLI or headless delivery; the GUI's web server is required.
- A route written directly into a profile patch is not validated against live metadata; an unknown route fails quietly on the first review.
- Any client with the GUI's session cookie and a session id can read that session's notes and counters. Keep the server on loopback.
- The reviewer is a language model: treat a note as a prompt to check something, not as a verified fact.
- UI strings and all public text are English-only by design.

The complete edge-case list, including the 200-session cap, override retention, and event-window limits, is in [reference limitations](./docs/reference.md#limitations).

## Operational verification

The supported check is **Run self-check** in **Settings -> Plugins -> You Should Know -> Diagnostics**. It calls the read-only `GET`/`HEAD /api/dsh-you-should-know/self-check` route over the same authenticated connection as every other plugin route and reports versions, runtime status, mode, registered routes, capabilities, and the bounded update state. Abridged sample:

```json
{
  "ok": true,
  "authTransport": "host-authenticated-connection",
  "healthy": true,
  "configured": true,
  "pluginVersion": "0.5.1",
  "runtimeVersion": "0.5.1",
  "installedVersion": "0.5.1",
  "runtimeStatus": "idle",
  "reviewerMode": "balanced",
  "update": { "currentVersion": "0.5.1", "updateAvailable": false, "automaticSupported": false }
}
```

A healthy result shows the running and installed versions and the enabled capabilities. When the installed package version differs from the running module version, the card shows **Restart required**. When either version cannot be read, it says the comparison is unavailable instead of guessing.

A bare `curl` to any `/api/*` route returns `401` before the plugin handler is reached: the connection's Host/Origin fence and browser-session authentication run first. That is expected host behavior, not a plugin failure, and it is why external verification needs the authenticated page. Do not bypass authentication or paste a session cookie into a command. For the same reason, read the read-only status route from the page's console:

```js
await (await fetch('api/dsh-you-should-know/status?sessionId=<session-id>')).json()
```

Field-by-field schemas for both routes: [status and self-check](./docs/reference.md#status-and-self-check-routes).

## Development

```sh
npm test
```

The suite covers route discovery and recovery, the verdict contract and silence handling, every gate, dedupe, strictness thresholds, language detection, the human-only invariant, the note card and history, runtime queue, retry, and resume, live config, persistence, the update checker, and release consistency. Full coverage list: [test coverage](./docs/reference.md#test-coverage).

### Offline note voice baseline

```sh
npm run eval:note-voice:baseline
```

The command scores the hand-authored fixtures in `scripts/fixtures/note-voice-baseline/cases.json` with the same parse, mode gate, and verbatim grounding checks the runtime applies. It is offline and deterministic: it never calls a model, opens a network connection, or reads an environment variable. Each case receives one status:

- `SPEAK_OK`: a note was admitted for a case that expects one;
- `SPEAK_UNWARRANTED`: a note was admitted for a case that expects silence;
- `SILENT_OK`: no admitted note for a case that expects silence, whether the reply was absent, silent, or dropped by grounding;
- `SILENT_MISSED`: no note was admitted for a case that expects one;
- `RUNTIME_ERROR`: the reviewer call failed; never counted as silence in either direction;
- `INVALID`: a structurally broken or contradictory case;
- `NOT_RUN`: reserved for a future live runner.

The output is a per-class count table, the `gated`, `invalid`, and `runtime errors` totals, and a NOT VERIFIED statement about semantic quality. The `summarize` helper also returns the `semantics.notVerified` count for programmatic use. The baseline measures structural admission only. Semantic quality (entailment, voice attribution) is NOT VERIFIED: an `entail` label is the fixture author's label, voice attribution is not checked, and no accuracy or precision is computed. The baseline stays unvalidated until the owner sets a threshold.

## Repository rules

Repository-facing prose follows the project's [repository rules](./AGENTS.md), including the English-only requirement for new pull request descriptions, commit messages, review comments, reports, and documentation. Human chat language is separate.

## Related work

[omdsh-dev/dsh-advisor](https://github.com/omdsh-dev/dsh-advisor) pairs a second model that passively reviews each turn and **injects its notes into the primary agent**, so the agent sees the advice and can act on it inside the same turn.

This plugin is the deliberate opposite. Its notes are **human-only**: the primary agent is never steered, injected, woken, or written to, and the advice never enters the transcript or the model context. The value here is an independent opinion for the person, not another instruction for the agent.

## License

MIT. See [LICENSE](./LICENSE).
