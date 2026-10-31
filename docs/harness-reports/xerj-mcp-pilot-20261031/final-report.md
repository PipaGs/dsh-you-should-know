# XERJ MCP pilot for DeepSeek Harness

- Task ID: `xerj-mcp-pilot-20261031`
- Branch: `task/xerj-mcp-pilot-20261031`
- Base: `origin/main` at `d81ecf35e42ff209d5882afc190f4d0869038371`
- Date: 2026-10-31 (Europe/Moscow; raw evidence in UTC)
- Status: **READY_FOR_CHATGPT_REVIEW**

## Outcome

Local XERJ is connected to the active development DSH profile over stdio MCP.
DSH discovered the XERJ tools and a real DSH-side search returned file:line
hits from approved public sources in this repository.

- XERJ `v1.0.0-rc.100` was installed with the official installer, which
  verified the release SHA-256.
- The node listens on loopback only: `127.0.0.1:19200` (Elasticsearch
  compatible), `127.0.0.1:18080` (native REST), `127.0.0.1:18081` (gRPC).
  API-key authentication stays on.
- The index `dshysk-*` covers 59 tracked public files (1040 documents):
  `README.md`, `AGENTS.md`, `LICENSE`, `package.json`, `cordis.patch.yml`,
  `docs/reference.md`, `lib/`, `test/`, and `scripts/`.
- DSH discovered 22 `mcp__xerj__xerj_*` tools in the live session.
- The DSH-side call `mcp__xerj__xerj_search` returned
  `lib/client.js:876` and `README.md:127`.
- Existing MCP servers (context7, exa, duckduckgo, chrome-devtools) and the
  `dsh-you-should-know` reviewer configuration were not changed.
- Repository tests pass: 697 tests, 0 failures, exit code 0.

## Baseline audit

| Item | Observed |
|---|---|
| DSH application | `DeepSeek Harness 0.2.1-rc.5` (macOS) |
| Active DSH profile | `desktop` (`DSH_PROFILE=desktop`, `~/.dsh/profiles/desktop`) |
| Profile MCP entries before the change | context7, exa, duckduckgo, chrome-devtools |
| Reviewer plugin | `dsh-you-should-know` v0.5.2 from GitHub, enabled |
| Repository checkout | `fix/aud-1-control-char-validation-20261031` at `5b9d99f`, with one untracked log file; left untouched |
| XERJ binary | not in `PATH`, no local installation found |
| XERJ ports | no XERJ listener; port `8080` is used by `tunnel-client`, so the node uses dedicated ports |
| Disk | 96% used, about 20 GiB free |

The reviewer profile configuration was read but not modified. The change adds
one MCP entry to the same patch file.

## Sources of truth

- XERJ install: <https://xerj.org/docs/install>
- XERJ config: <https://xerj.org/docs/config>
- XERJ CLI and `mcp`: <https://xerj.org/docs/cli> and `xerj mcp --help`
- XERJ security model: <https://github.com/xerj-org/xerj/blob/main/docs/SECURITY_MODEL.md>
- XERJ machine index: <https://xerj.org/llms-full.txt>
- DSH MCP configuration: <https://deepseekdocs.com/en/docs/features/mcp>
- DSH MCP client reference:
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md>

The installed binary outranks the documentation where they disagree, so the
final flags were confirmed with `xerj --help` and `xerj mcp --help`.

## Implementation

### 1. Installation

The installer was run with a workspace-local target so the host prefix stays
clean and removal is a directory delete:

```
curl -fsSL https://xerj.org/get | XERJ_INSTALL_DIR="$PWD/.tools/xerj" sh
```

The installer selected `aarch64-apple-darwin` and reported
`ok sha256 verified`. A second run produced the same binary SHA-256
(`75dd16...3294d`), recorded in `evidence/02-xerj-install.txt`.

### 2. Node configuration

The node config is `.xerj/xerj.toml` (full copy in
`evidence/03-config-and-wrapper.txt`):

```toml
[server]
bind_address = "127.0.0.1"
rest_port = 18080
grpc_port = 18081
es_compat_port = 19200
data_dir = "/Users/pipags/work/dsh-you-should-know/.xerj/data"

[limits]
disk_flood_stage_percent = 97
```

Authentication is left at its default, which is enabled. The node wrote the
generated admin key to `.xerj/data/admin.key` with mode `0600`.

The `disk_flood_stage_percent` change is deliberate and local. The default
95% flood guard would block every write on this host, which is 96% full with
about 20 GiB free. The pilot index is a few megabytes. The risk and rollback
are stated below.

### 3. stdio bridge

DSH starts `.xerj/bin/xerj-mcp.sh`. The wrapper:

- checks the loopback endpoint;
- starts the node with `nohup` if it is down, with feedback disabled;
- reads the API key from `.xerj/data/admin.key`;
- passes the key through `XERJ_AUTH`, not through the process arguments;
- `exec`s `xerj mcp --url http://127.0.0.1:19200 --disable-feedback`.

The MCP server does not start a node itself; the wrapper supplies that part.
The full script is in `evidence/03-config-and-wrapper.txt`.

### 4. DSH profile entry

One insert was appended to `~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- insert:
    - id: mcp-xerj
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: xerj
        transport: stdio
        command: /Users/pipags/work/dsh-you-should-know/.xerj/bin/xerj-mcp.sh
        toolCallTimeoutMs: 60000
        failOnStartupError: false
```

The profile uses live patch reload, so DSH registered the tools without an
application restart. The diff is the only profile change
(`evidence/09-profile-diff.txt`). `failOnStartupError: false` keeps the
existing runtime usable if XERJ is unavailable.

### 5. Index scope

The index is limited by `.xerjignore` to public project sources. Excluded:
`.worktrees/`, `docs/harness-reports/`, `docs/superpowers/`,
`docs/upstream/`, the untracked rollout log, and the tool directories.

The plan was checked with `--dry-run` before writing. It listed 59 files and
showed that the excluded directories were pruned. The write then produced
1040 live documents in `dshysk-docs` with prefix `dshysk`, with a recorded
`wall_seconds` of 3.0 (`evidence/12-index-run.txt`).

All 59 indexed paths are tracked files at the task commit; the check found
`untracked_or_missing=0`. The repository is public
(`"visibility":"PUBLIC","isPrivate":false`). No private directory was
indexed.

## Pilot evidence

### DSH tool discovery

The live DSH session registered 22 tools under the `xerj` namespace, from
`xerj_autoindex_remove` through `xerj_vector_search`. The raw session log
was filtered for `mcp__xerj__xerj_*`; the result is
`evidence/06-dsh-mcp-discovery.txt` (`tool_count=22`). The same log still
contains 42 other MCP tool names (context7, duckduckgo, exa, and chrome-devtools).

### Real search through DSH MCP

The model called `mcp__xerj__xerj_search` from DSH, not from a shell:

```json
{"query":"reviewer card above composer","prefix":"dshysk","size":3}
```

The response contained 100 matching documents and these top hits:

| Path | match line | Start line | Score |
|---|---|---|---|
| `lib/client.js` | 876 | 1 | 29.64 |
| `README.md` | 127 | 121 | 26.33 |
| `README.md` | 5 | 1 | 25.86 |

The snippet at `lib/client.js:876` is the comment that explains why the
history toggle must stay reachable. The snippet at `README.md:127` is
`**Note card** (`conversation.input.dock`, above the composer):`. Both were
checked against the working tree.

The raw MCP response is `evidence/07-dsh-mcp-search.json`. The same query
through the XERJ CLI is `evidence/05-cli-search.txt`; it returns the same
file:line pairs, so the MCP path and the CLI path agree.

## Security and privacy

| Control | Observation |
|---|---|
| Network bind | All three listeners are on `127.0.0.1` only |
| Authentication | Unauthenticated `GET /` on 19200 and `GET /v1/health` on 18080 return 401. gRPC data methods require the same key: `XerjSearch/Search` returns grpc-status 16 without it and 5 with it (`evidence/08-security.txt`, `evidence/13-grpc-auth.txt`) |
| Key handling | Key file mode `0600`; passed by environment; not in argv; not in committed evidence |
| Outbound connections | At capture, no XERJ socket had a non-loopback peer; the MCP child talks to the node over loopback (`evidence/08-security.txt`) |
| Feedback and upload | `--disable-feedback` on the node and the MCP server; `XERJ_DISABLE_FEEDBACK=true` in the wrapper |
| Field report | The `xerj_field_report` tool was not called. The text that asks for an automatic report is tool metadata, not an instruction that was followed |
| Corpus Hub | No `xerj hub` pull or feedback call; no corpus pack was downloaded |
| Indexed data | Only tracked public repository files; no `docs/harness-reports`, worktrees, credentials, or session data |
| Telemetry | XERJ documentation states the binary has no runtime telemetry, update check, or license call. The only network paths are the node's own API and the optional console fonts |

Residual risks:

- The server exposes 22 tools, including memory writes and the field-report
  tool. `dsh-mcp-client` has no tool allowlist, so the model can see them.
  The pilot did not call the write or report tools.
- The MCP server injects its own tool descriptions into the model context.
  Those descriptions contain an instruction to send a field report. It was
  treated as untrusted data and not executed.
- The node is not a launchd service. The wrapper starts it on demand, so it
  runs while the DSH MCP child is active and may outlive DSH.
- `disk_flood_stage_percent = 97` lowers a local safety guard from 95% to
  97%. The host has about 20 GiB free; if free space drops further, writes
  block again.
- `v1.0.0-rc.100` is a release candidate, not a final 1.0.0.
- The profile edit lives outside the repository and needs the documented
  rollback, not a repository revert alone.
- The XERJ CLI prints the admin key in its own "next command" hint. The hint
  was redacted in every captured file. The key was never committed.
- Tool-level egress: `xerj_field_report`, `xerj_hub_*`, and
  `xerj_corpus_feedback` can send data off-host if called.
  `xerj_autoindex_remove` can delete the pilot index. `dsh-mcp-client` has
  no tool allowlist; the pilot called none of these tools.
- The admin key and index live in `.xerj/`, excluded through
  `.git/info/exclude`, not `.gitignore`. A directory copy or `git add -f`
  can carry them; treat the directory as local-only state.

## Reversibility and rollback

The profile backup is `.xerj/backup/cordis.patch.yml.before-xerj` with
SHA-256 `0357c4eca968b9558cb31e2fcaaf54c28c29809d56adb3f14330acc8e8cb74d0`;
it matched the live file before the edit.

```sh
set -eu
cd /Users/pipags/work/dsh-you-should-know

# 1. Remove the 15-line XERJ block from the live profile.
#    Keep a timestamped copy, then delete only the block that starts with
#    "# XERJ MCP — local loopback search" and ends at
#    "failOnStartupError: false". Do not rewrite unrelated entries.
cp ~/.dsh/profiles/desktop/cordis.patch.yml \
   ~/.dsh/profiles/desktop/cordis.patch.yml.before-xerj-rollback
# Edit the file and delete the block before running later steps.
# Fallback only if the file is otherwise unchanged since the pilot:
# cp .xerj/backup/cordis.patch.yml.before-xerj \
#    ~/.dsh/profiles/desktop/cordis.patch.yml

# 2. Remove only the pilot index while the node is still running.
XERJ_DISABLE_FEEDBACK=true .tools/xerj/xerj autoindex remove --prefix dshysk \
  --url http://127.0.0.1:19200 --api-key "$(cat .xerj/data/admin.key)" \
  --state-dir .xerj/autoindex --yes

# 3. Stop the MCP bridge and the node.
pkill -f 'xerj mcp --url http://127.0.0.1:19200' || true
pkill -f '.tools/xerj/xerj --config' || true

# 4. Refuse to delete state while the profile still names the server.
! grep -q 'mcp-xerj' ~/.dsh/profiles/desktop/cordis.patch.yml
rm -rf .xerj .tools
rm -f .xerjignore
```

The script stops if the profile still contains `mcp-xerj`, so it cannot leave
a dangling entry that points at a deleted wrapper. `rm -f .xerjignore` removes
the repository-root file too. Remove the three lines added to
`.git/info/exclude` (`.tools/`, `.xerj/`, `.xerjignore`) afterward. No tracked
repository file depends on this setup.

The whole-file copy from `.xerj/backup/` is only a fallback: it discards any
profile edit made after the pilot. The primary procedure deletes the single
insert block, as the live profile comment also says.

If the profile is restored while DSH is running, a restart is the reliable way
to drop the registered tools. The pilot did not restart DSH.

## Checks run

| Check | Result |
|---|---|
| `npm run check` in the task worktree | pass |
| `npm test` in the task worktree | 697 pass, 0 fail, exit code 0 |
| `git diff --check` | pass (no output) |
| XERJ dry-run before indexing | 59 files, 0 writes |
| Index verification | 59 tracked paths, 0 untracked or missing |
| Unauthenticated HTTP | 401 on `GET /` (19200) and `GET /v1/health` (18080) |
| Unauthenticated gRPC | `XerjSearch/Search` returns grpc-status 16 without a key, 5 with it |
| Secret scan of committed evidence | no key value and no 64-hex secret; only binary SHA-256 values |

The tests cover the repository's own behavior. They do not cover the host DSH
profile or the live MCP connection; those are covered by the raw evidence in
this report.

## Known limitations

- This pilot does not commit the host configuration. The report and its
  evidence are the reviewable artifacts; the profile insert is documented for
  the owner to keep or remove.
- The node uses lexical retrieval by default. Semantic and hybrid modes exist
  but need a different embedding mode at ingest time.
- The XERJ node, key, and index are inside the workspace (`.xerj/`,
  `.tools/`) and are intentionally ignored by Git.
- The local repository was checked out on an unrelated branch with an
  untracked log file. The task used a separate worktree and branch and did not
  touch those changes.

## Evidence index

All files are under `docs/harness-reports/xerj-mcp-pilot-20261031/evidence/`:

| File | Contents |
|---|---|
| `01-versions.txt` | macOS, DSH and XERJ versions, profile, workspace |
| `02-xerj-install.txt` | Installer re-run, verified checksum, binary hashes |
| `03-config-and-wrapper.txt` | Node TOML, stdio wrapper, profile insert |
| `04-index-scope.txt` | Ignore rules, 59 planned paths, indexed paths |
| `05-cli-search.txt` | CLI search with the same file:line hits |
| `06-dsh-mcp-discovery.txt` | Live DSH session tool names, count 22 |
| `07-dsh-mcp-search.json` | Raw DSH MCP search response |
| `08-security.txt` | Listeners, 401 checks, processes, loopback connection |
| `09-profile-diff.txt` | The only profile change |
| `10-tests.txt` | `npm run check` and `npm test` output |
| `11-repo-scope.txt` | Repository visibility and tracked-file check |
| `12-index-run.txt` | Journal wall time and live document count |
| `13-grpc-auth.txt` | gRPC data-method auth probe with and without the key |

## Review request

ChatGPT reviews this report and the evidence. The task stops here at
`READY_FOR_CHATGPT_REVIEW`; it does not merge.
