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

The task was a patch bump from `0.4.5` to `0.4.6` after PR #21: update every version mirror, run a targeted RED/GREEN check, run the full repository suite, and commit task-owned raw evidence plus this report on an isolated branch. Tags, GitHub Releases, npm publication, and merges were explicitly out of scope. The branch and this report are delivered as one pull request for independent review.

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
| Baseline full `npm test` at `87ae0a9` | `611/611` pass, exit `0`, no tracked changes at start (the task report directory was still untracked) | `01-baseline-npm-test.txt` |
| Full `npm test` on dirty pre-commit tree | `611/611` pass, exit `0`; later committed as `5516c60` | `04-npm-test-full.txt` |
| Full `npm test` on committed product head `5516c60` | `611/611` pass, exit `0` | `04b-npm-test-full-committed.txt` |
| `npm run check` | exit `0` | `05-npm-check.txt` |
| `git diff --check` | exit `0` | `06-diff-check.txt` |
| Version scan | no in-scope `0.4.5`; all shipped mirrors report `0.4.6` | `07-version-scan.txt` |
| Diff and security sanity | 8 files, `21` insertions, `19` deletions; no secret or URL matches | `08-diff-sanity.txt` |
| Remote tags | `v0.4.5` and `v0.4.6` absent; latest is `v0.4.4` | `07-version-scan.txt` |

Two RED logs retained Node's blank assertion lines with two trailing spaces. Before commit, 26 whitespace-only blank lines were normalized to empty lines: 16 in `02-red-version.txt` and 10 in `02b-red-version-filtered.txt`. No nonblank content, test count, pass count, fail count, or exit code changed. SHA256 before and after: `76c4552f...` -> `99bddd52...` and `226e6aec...` -> `cc9113be...`.

Provenance limitation: the two RED logs were normalized before their only commit, so the pre-normalization bytes are not retained in any commit. The before-normalization SHA256 values in `evidence/09-provenance.txt` were captured from the working files and cannot be re-verified from git history; the transformation itself is therefore self-attested. The committed counts (61/36/25 and 7/1/6) and nonblank content are unchanged. An independent review on 2026-10-23 reproduced the counts, confirmed that Node 26.9.0 emits exactly two-space blank lines at those positions, and found no evidence of a content change, but the pre-image is not recoverable. This deviates from the PR #19 pattern, where the raw pre-image stayed reachable in an earlier commit.

The scan found `0.4.5` only in historical or intentionally previous-release locations:

- `test/release-consistency.test.js` as `PREVIOUS`;
- `AGENTS.md` and `test/repository-language.test.js` as the PR #19 report path;
- `docs/superpowers/specs/2026-10-23-ysk-consequence-scope-design.md`, which records the observed baseline `0.4.5` at `a7b652e` and an unverified tag reference.

No `0.4.5` remains in `package.json`, `lib/index.js`, `README.md`, or `docs/reference.md`.

## 6. Acceptance matrix

| AC | Requirement | Status | Evidence |
|---|---|---|---|
| AC1 | All version mirrors and test literals updated to `0.4.6`; `CURRENT` / `PREVIOUS` updated | **PASS** | `07-version-scan.txt`; `03b-green-version-filtered.txt` |
| AC2 | Post-PR #21 behavior preserved: full suite, `npm run check`, `git diff --check`; no invariant, privacy, or fail-quiet assertion changed (only the manifest version literal in `test/invariant.test.js` changed); no reviewer logic change | **PASS** | `04b-npm-test-full-committed.txt` 611/611; `05` exit 0; `06` exit 0; diff contains only version mirrors |
| AC3 | Isolated branch and worktree, task-owned report, raw evidence, AC matrix | **PASS** | branch `chore/ysk-version-bump-0.4.6`; worktree `.worktrees/ysk-version-bump-0.4.6`; this file; `evidence/` |
| AC4 | Single-PR readiness, no tag/release/npm/merge | **PASS** | status `READY_FOR_CHATGPT_REVIEW`; commit set only; no tag, release, npm publication, or merge |
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
- No merge was performed; the branch and this report are delivered as a single pull request for independent review, and tags, releases, and npm publication remain with the owner.
- The managed Desktop profile was not updated.
- Older reports and historical records were not modified.
- The pre-normalization bytes of the two RED logs are not retained in any commit (see §5).
- When `v0.4.6` is tagged, the prospective-tag paragraph in the README must be updated or removed; that publication step is not part of this change.
- `test/release-consistency.test.js` does not scan `docs/reference.md`; that pre-existing gate gap is recorded here and deliberately left unchanged to keep this change a version bump.
- The absolute host path remains visible in commits `33a25a2` and `e8ead72` until the owner decides whether to rewrite history.
- No live or paid model calls were made.
- Release gating is unchanged; publication remains with the owner and reviewer.

## 9. Visual gate

**NOT REQUIRED.** Only version metadata, report text, and evidence changed. No DOM, CSS, client code, or route behavior changed; `lib/client.js` and `test/client-ui.test.js` are unchanged.

## 10. Security gate and path redaction

The earlier scans in `08-diff-sanity.txt` and `10-review-followups.txt` covered only the product diff. The task-owned reports and evidence were not scanned, so the gate below closes that gap by scanning all 22 files changed against `87ae0a9` at commit 3 (`e8ead72`), not only product files.

Finding: 33 occurrences of an absolute host worktree path in three task-owned files. The path contained the local OS account name:

- `evidence/02-red-version.txt`: 26 occurrences;
- `evidence/02b-red-version-filtered.txt`: 6 occurrences;
- `evidence/09-provenance.txt`: 1 occurrence.

Action: the exact worktree prefix in 02 and 02b was replaced with `<worktree>` (26 and 6 replacements). The `WORKTREE` line in 09 was replaced with the project-relative path and a redaction note (1 replacement). No account-bearing absolute path remains in the task-owned tree.

Evidence parity: for 02 and 02b, the only content change is the path-token substitution; all counts, exit codes, nonblank lines, and other bytes are unchanged. For 09, the path line was redacted and the requested DATE labels and commit NOTE were updated; that file contains no test count or exit code. Pre-sanitization bytes are reachable at `33a25a2` (02, 02b) and `e8ead72` (09), so parity is checkable with the commit 4 diff. Per-file SHA256:

| File | SHA256 before | SHA256 after |
|---|---|---|
| `evidence/02-red-version.txt` | `99bddd52173006387c6340b249a8e7ff5c022986fb31d32d49ac1cdd6f0bd37f` | `3b7aa36a47a4e60b3fb83f60668a06888b91c5417ac80ae9208feb7cda11f93a` |
| `evidence/02b-red-version-filtered.txt` | `cc9113be03d9754e2ee27754384fb8d0df05eb40901ba3ffe5158dbf4d786bfe` | `4fb84e74a3f0c9ad92fe999819929b6814e36cc4e6c4690b9db398d05e41b39b` |
| `evidence/09-provenance.txt` | `49ee54fa7cf50ac026cd6d44bf6ff70d6deb58d98205e64528ae65d807ce6afc` | `9c70ae04fc3fd2215f68f9a3008a0c5b213c8e884f2b9aa83cc81b5f99f33baf` |

Post-sanitization full-PR scan: 0 matches for account-bearing home paths, 0 secret matches, and 0 email/IPv4 matches in the task-owned files. Raw output and exit codes are in `evidence/11-security-scan.txt`.

Final-head full-tree scan: PASS 1 covered 23 files changed against `87ae0a9` at commit 4 (`9ad7c43`); PASS 2 re-ran the same scans after `evidence/12` was written and covered 24 files, including the artifact itself. Both passes returned 0 matches for account-bearing home paths, secrets, and email/IPv4; raw output and exit codes are in `evidence/12-final-security-scan.txt`. `evidence/11` used the commit-3 file scope (22 files) while reading content from the post-sanitization working tree. The secret patterns match token-shaped values, so the scanner's own command lines do not self-match and no lines or files were excluded from either pass.

Disclosure: the pre-sanitization bytes remain in the already-submitted commits `33a25a2` and `e8ead72` and in the branch history. No rewrite of published history was performed; the local amends 3f101f0 -> e8ead72 and 426ea7c -> 9dfb1f8 happened before those commits were pushed. The path segment is the local OS account name, which is also present in public git commit metadata and the remote URL. The decision to rewrite history belongs to the owner.

## 11. Evidence files

| File | Contents |
|---|---|
| `01-baseline-npm-test.txt` | Baseline `npm test`: 611/611 pass, exit 0; command, date, HEAD, and no tracked changes at start (report directory untracked) |
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
| `09-provenance.txt` | Branch, project-relative worktree, base, commit 1, commit 2, actual commit 3 and commit 4 SHAs, LATER_COMMITS note, runtime, DATE labels, and final-status note |
| `10-review-followups.txt` | Independent-review follow-up: full remote tag listing and product-diff-only secret/URL and `/Users/` scans; raw output and exit codes |
| `11-security-scan.txt` | Full 22-file security scan: account-bearing home paths, secrets, email/IPv4; pre/post redaction counts and per-file SHA256 |
| `12-final-security-scan.txt` | Two-pass final-head scan: 23 files in PASS 1, 24 files including this artifact in PASS 2; raw output, exit codes, and counts |
