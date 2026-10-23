# Final report - ysk-version-bump-0.4.6-20261023

**STATUS: READY_FOR_CHATGPT_REVIEW**

**Product (code) head:** `5516c6033865998b9b2cec3f3d258525b0a06b17` ("chore: raise the version to 0.4.6 after PR #21").
**Evidence/report commit:** the final PR head. This file cannot contain its own SHA; the final head is recorded in the PR body and is not invented here.
**Base:** `origin/main` `87ae0a956b30c7cf0c471deefee33e5a9a41e15f` (merge of PR #21).
**Branch:** `chore/ysk-version-bump-0.4.6`.
**Worktree:** `.worktrees/ysk-version-bump-0.4.6`.
**Date:** 2026-10-23. **Runtime:** Node `v26.9.0`, npm `11.19.1`.

---

## 1. Request and scope

The task was a patch bump from `0.4.5` to `0.4.6` after PR #21: update every version mirror, run a targeted RED/GREEN check, run the full repository suite, and commit task-owned raw evidence plus this report on an isolated branch. Tags, GitHub Releases, npm publication, pushes, PR creation, and merges were explicitly out of scope.

The tracked write set is eight files:

| File | Change |
|---|---|
| `package.json` | `"version"`: `0.4.5` -> `0.4.6` |
| `lib/index.js` | `PLUGIN_VERSION`: `0.4.5` -> `0.4.6` |
| `README.md` | Status line, pinned install address, self-check sample, and the prospective-tag paragraph |
| `docs/reference.md` | Self-check sample version fields |
| `test/invariant.test.js` | Manifest version assertion -> `0.4.6` |
| `test/plugin.test.js` | `pluginVersion` / `runtimeVersion` / `installedVersion` -> `0.4.6` |
| `test/update-route.test.js` | Manifest version assertion -> `0.4.6` |
| `test/release-consistency.test.js` | `CURRENT = '0.4.6'`, `PREVIOUS = '0.4.5'` |

The task-owned directory `docs/harness-reports/ysk-version-bump-0.4.6-20261023/` contains this report and the raw evidence. It is not part of the product commit.

The README paragraph placed immediately after the install `sh` block is exactly:

> The `v0.4.6` tag is prospective: it is created when this release is published and does not exist before that. The newest tag published so far is `v0.4.4`.

Not touched: `lib/client.js`, `cordis.patch.yml`, `test/client-ui.test.js`, reviewer behavior, dependencies, `package-lock.json`, `docs/upstream`, historical reports, release notes for v0.4.4, and any managed Desktop profile.

## 2. Audit of actual main

| Fact | Value |
|---|---|
| Base commit | `87ae0a956b30c7cf0c471deefee33e5a9a41e15f` (merge PR #21) |
| `package.json` before bump | `0.4.5` |
| `PLUGIN_VERSION` before bump | `0.4.5` |
| README before bump | Status `0.4.5`, install `#v0.4.5`, self-check sample `0.4.5` |
| `docs/reference.md` before bump | self-check sample `0.4.5` |
| Latest remote tag | `v0.4.4` |
| `v0.4.5` remote tag | absent |
| `v0.4.6` remote tag | absent |
| Lockfile | no `package-lock.json` |
| Baseline full suite | `611` tests, `611` pass, `0` fail, exit `0` |

The earlier patch-bump pattern is commit `eb326ec5eaec3c3d25fcf4c6d4971ed57a4f7827` (merged as `5929bb3547ba7c8f9f91e711a30880b9d201ea94`, PR #19). That commit changed the same eight tracked files, `19` insertions and `19` deletions.

The local and remote tag listing ends at `v0.4.4`. The previous release bump produced version `0.4.5` but no tag; this is why the README labels `v0.4.6` as prospective rather than describing it as already published.

## 3. RED

The four specified test files were changed first, before any source file was bumped. Two RED runs are preserved.

### 3.1 Literal command from the task

```text
node --test test/invariant.test.js test/plugin.test.js test/update-route.test.js test/release-consistency.test.js
```

Result: `tests 61`, `pass 36`, `fail 25`, exit `1` (`evidence/02-red-version.txt`).

The literal command executes every test in those four files, not only the seven version-related tests. The 25 failures split as:

- `6` version-related assertions:
  - `the manifest declares the bundle, the client half, and no build step`
  - `the authenticated self-check route reports only the bounded running plugin state`
  - `package.json, PLUGIN_VERSION, and the README install address agree`
  - `every README self-check sample version is the released version`
  - `no released artifact still documents the previous version`
  - `the exported plugin version mirrors package.json`
- `19` cascading failures in later `test/plugin.test.js` cases.

The cascade has a concrete mechanism in the test and product code. `lib/index.js:178-182` claims a process-global ownership token and returns before registering anything when the token is already active. `lib/index.js:248-259` releases that token only through the teardown effect. The self-check test fails at `test/plugin.test.js:399`, before its `harness.disposeAll()` call at line 446. Later mounts in the same file therefore observe `already composed in this process; this duplicate row stays inert` and register no routes or listeners. This is the observed cascade; the subsequent full GREEN run proves it is not a product regression.

### 3.2 Filtered seven-test command

```text
node --test --test-name-pattern='release version is a patch increment|package.json, PLUGIN_VERSION|every README self-check|no released artifact|exported plugin version|manifest declares the bundle|authenticated self-check route' test/invariant.test.js test/plugin.test.js test/update-route.test.js test/release-consistency.test.js
```

Result: `tests 7`, `pass 1`, `fail 6`, exit `1` (`evidence/02b-red-version-filtered.txt`). The only pass is `the release version is a patch increment over the previous release`.

The filtered run isolates the intended version assertions; the literal run is retained as the honest raw RED, including the cascade. It is not rewritten to match a smaller count.

## 4. GREEN

After updating `package.json`, `lib/index.js`, `README.md`, and `docs/reference.md`:

- Full four-file set: `tests 61`, `pass 61`, `fail 0`, exit `0` (`evidence/03-green-version.txt`).
- Filtered seven-test set: `tests 7`, `pass 7`, `fail 0`, exit `0` (`evidence/03b-green-version-filtered.txt`).

The full 61/61 run shows that the 19 cascade failures disappear once the self-check assertion passes and the test reaches `harness.disposeAll()`. No product behavior was changed to make the count pass.

## 5. Verification

| Check | Result | Evidence |
|---|---|---|
| Baseline full `npm test` at `87ae0a9` | `611/611` pass, exit `0`, clean tree at start | `01-baseline-npm-test.txt` |
| Full `npm test` on dirty pre-commit tree | `611/611` pass, exit `0`; later committed as `5516c60` | `04-npm-test-full.txt` |
| Full `npm test` on committed product head `5516c60` | `611/611` pass, exit `0` | `04b-npm-test-full-committed.txt` |
| `npm run check` | exit `0` | `05-npm-check.txt` |
| `git diff --check` | exit `0` | `06-diff-check.txt` |
| Version scan | no in-scope `0.4.5`; all shipped mirrors report `0.4.6` | `07-version-scan.txt` |
| Diff and security sanity | 8 files, `21` insertions, `19` deletions; no secret or URL matches | `08-diff-sanity.txt` |
| Remote tags | `v0.4.5` and `v0.4.6` absent; latest is `v0.4.4` | `07-version-scan.txt` |

Two RED logs retained Node's blank assertion lines with two trailing spaces. Before commit, 26 whitespace-only blank lines were normalized to empty lines: 16 in `02-red-version.txt` and 10 in `02b-red-version-filtered.txt`. No nonblank content, test count, pass count, fail count, or exit code changed. SHA256 before and after: `76c4552f...` -> `99bddd52...` and `226e6aec...` -> `cc9113be...`.

The scan found `0.4.5` only in historical or intentionally previous-release locations:

- `test/release-consistency.test.js` as `PREVIOUS`;
- `AGENTS.md` and `test/repository-language.test.js` as the PR #19 report path;
- `docs/superpowers/specs/2026-10-23-ysk-consequence-scope-design.md`, which records the observed baseline `0.4.5` at `a7b652e` and an unverified tag reference.

No `0.4.5` remains in `package.json`, `lib/index.js`, `README.md`, or `docs/reference.md`.

## 6. Acceptance matrix

| AC | Requirement | Status | Evidence |
|---|---|---|---|
| AC1 | All version mirrors and test literals updated to `0.4.6`; `CURRENT` / `PREVIOUS` updated | **PASS** | `07-version-scan.txt`; `03b-green-version-filtered.txt` |
| AC2 | Post-PR #21 behavior preserved: full suite, `npm run check`, `git diff --check`; invariant, privacy, and fail-quiet tests untouched; no reviewer logic change | **PASS** | `04b-npm-test-full-committed.txt` 611/611; `05` exit 0; `06` exit 0; diff contains only version mirrors |
| AC3 | Isolated branch and worktree, task-owned report, raw evidence, AC matrix | **PASS** | branch `chore/ysk-version-bump-0.4.6`; worktree `.worktrees/ysk-version-bump-0.4.6`; this file; `evidence/` |
| AC4 | Single-PR readiness, no tag/release/npm/merge | **PASS** | status `READY_FOR_CHATGPT_REVIEW`; only local commits; no network publication |
| Gate | DIFF_SANITY | **PASS** | `08-diff-sanity.txt`: 8 files, expected mirrors only; `lib/client.js`, `cordis.patch.yml`, `test/client-ui.test.js` unchanged |
| Gate | SECURITY_SANITY | **PASS** | secret-pattern and external-URL scans in the product diff returned no matches |
| Gate | VISUAL_GATE | **NOT REQUIRED** | no DOM, CSS, client, or route behavior changed |

## 7. Rulings

- **`docs/reference.md` is a required mirror.** It documents the live self-check payload, so leaving its version fields at `0.4.5` would document the wrong running build even though the release-consistency gate does not read that file.
- **Residual `0.4.5` literals are historical or previous-release data.** `PREVIOUS` must name the previous release. The PR #19 paths and the dated consequence-scope design record the state observed at `a7b652e`. The v0.4.4 release-notes gate still pins `0.4.4`; it does not contain a current-version mirror.
- **The install address is `#v0.4.6`.** The tag does not exist yet. `v0.4.5` was also never tagged: the remote tag list ends at `v0.4.4`. The README therefore labels `v0.4.6` explicitly as prospective. This avoids claiming that an unpublished tag already exists.
- **The task expectation of 7/1/6 applies to the filtered run, not to the literal four-file command.** The literal command exposed 61 tests and a 19-test cascade. Both runs are preserved; the report does not present the filtered count as the only RED.

## 8. Limitations

- No tag was created.
- No GitHub Release was created.
- No npm publication was performed.
- No merge was performed and no push was made.
- The managed Desktop profile was not updated.
- Older reports and historical records were not modified.
- No live or paid model calls were made.
- Release gating is unchanged; publication remains with the owner and reviewer.

## 9. Evidence files

| File | Contents |
|---|---|
| `01-baseline-npm-test.txt` | Baseline `npm test`: 611/611 pass, exit 0; command, date, HEAD, clean status |
| `02-red-version.txt` | Literal four-file RED: 61 tests, 36 pass, 25 fail, exit 1 |
| `02b-red-version-filtered.txt` | Filtered seven version tests RED: 7 tests, 1 pass, 6 fail, exit 1 |
| `03-green-version.txt` | Literal four-file GREEN: 61 tests, 61 pass, 0 fail, exit 0 |
| `03b-green-version-filtered.txt` | Filtered seven version tests GREEN: 7 tests, 7 pass, 0 fail, exit 0 |
| `04-npm-test-full.txt` | Full `npm test` on dirty pre-commit tree: 611/611, exit 0 |
| `04b-npm-test-full-committed.txt` | Full `npm test` on committed product head `5516c60`: 611/611, exit 0 |
| `05-npm-check.txt` | `npm run check`: exit 0 |
| `06-diff-check.txt` | `git diff --check`, status, and numstat |
| `07-version-scan.txt` | `git grep` for `0.4.5` / `0.4.6`, explicit mirror values, remote tag absence |
| `08-diff-sanity.txt` | Diff stat/numstat against `87ae0a9`, unchanged-file checks, secret and external-URL scans |
| `09-provenance.txt` | Branch, worktree, base, commit SHAs, runtime, date, final status |
