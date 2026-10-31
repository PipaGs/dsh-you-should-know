# Final report - ysk-version-bump-0.5.2-20261031

**STATUS: READY_FOR_CHATGPT_REVIEW**

## Provenance

- Base commit: c9ce22fb8bff2cba285e486500e4f0a7d7b767dd ("Merge pull request #32 from PipaGs/fix/aud-1-control-char-validation-20261031"). The AUD-1 fix that rejects C0, DEL, and C1 controls in reviewer fields is already merged at this commit as 5b9d99f.
- Product commit: 263577ff1a922b11614ca0af564f64f31d766be4, "chore: raise the version to 0.5.2 for the merged AUD-1 fix"; 8 files, 19 insertions, 19 deletions.
- Branch: task/release-0.5.2-version-20261031. Date: 2026-10-31.
- Toolchain: Node v26.12.1, npm 11.20.0. Local zone MSK (UTC+3); every evidence header carries UTC and local time.
- Evidence: 01, 01b, 02-07, 10-14. Evidence 02, 03, and 04 were captured on the dirty pre-commit tree and that tree was later committed as 263577f. Evidence 11 was captured at 263577f. Evidence 14 is the final handoff-tree verification, captured with this report and the evidence present but uncommitted. Evidence 09-provenance and 08-secret-privacy-scan are generated last, after this report is final.
- The report and the evidence are committed in the separate docs commit that follows the review rounds, so the product commit stays 263577f.

## Scope

Deliberate PATCH bump from 0.5.1 to 0.5.2 over the AUD-1 fix already merged at the base commit. Eight files, with every changed line a version literal or a version assertion:

- package.json:3: version 0.5.2.
- lib/index.js:36: PLUGIN_VERSION 0.5.2. No other library change.
- README.md:11,76,194,195,196,199: status line, install address, three self-check fields, and the update currentVersion literal.
- docs/reference.md:220,221,222,227: the self-check sample literals.
- test/release-consistency.test.js:40,41: CURRENT 0.5.1 -> 0.5.2 and PREVIOUS 0.5.0 -> 0.5.1. The gate logic and its comments are unchanged.
- test/invariant.test.js:189, test/plugin.test.js:399,400,401, test/update-route.test.js:257: current-version assertions.

No feature was added and no behavior changed. No version history and no prospective-tag prose was added to the product docs.

## Version surfaces

| Surface | Value | Evidence |
|---|---|---|
| package.json version | 0.5.2 at line 3 | 07 |
| lib/index.js PLUGIN_VERSION | 0.5.2 at line 36 | 07 |
| README status line | 0.5.2 at line 11 | 07 |
| README install address | github:PipaGs/dsh-you-should-know#v0.5.2 at line 76 | 07 |
| README self-check sample | 0.5.2 in pluginVersion, runtimeVersion, installedVersion, and update.currentVersion, lines 194-196 and 199 | 07 |
| docs/reference.md self-check sample | 0.5.2 in the same four fields, lines 220-222 and 227 | 07 |
| 0.5.2 surface total | 18 matching lines, every one expected | 07 |
| Remaining 0.5.1 literals outside docs/harness-reports | test/release-consistency.test.js:41 (PREVIOUS) only | 07 |
| 0.5.1 in package.json, README.md, docs/reference.md, lib/index.js | 0 hits | 07 |

The historical 0.5.0 and 0.5.1 literals that remain in test fixtures and in docs/harness-reports are listed under Known limitations.

## Release-consistency gate change

The gate keeps one increment rule for the version step: the release must be one patch step (same minor, patch + 1) or one minor step (minor + 1, patch 0) over PREVIOUS. Only the two constants moved, so 0.5.1 -> 0.5.2 satisfies the patch step.

PREVIOUS is hand-maintained. The gate does not use the network, does not read tags, and never asserts that the tag or the GitHub release exists. It pins package.json, PLUGIN_VERSION, the README status line and install address, the self-check samples in README.md and docs/reference.md, and it scans package.json, README.md, docs/reference.md, and lib/index.js for the previous version.

## RED and GREEN

- 01, baseline targeted on the clean worktree at c9ce22f: 6 test files, 86 tests, 86 pass, 0 fail, exit 0. package.json version 0.5.1.
- 01b, baseline full suite on a temporary detached worktree at c9ce22f: 697 tests, 697 pass, 0 fail, exit 0. The temporary worktree needed a node_modules symlink to the main checkout, because the base tree alone cannot resolve @deepseek-ai/schemastery, so the full suite fails on dependency resolution.
- 02, RED on the old gate: the product surfaces carried 0.5.2 while test/release-consistency.test.js still had CURRENT 0.5.1 and PREVIOUS 0.5.0. Result: 4 tests, 2 pass, 2 fail, exit 1. The two failures are "package.json carries the release version" ('0.5.2' !== '0.5.1') at test/release-consistency.test.js:73 and "README.md pluginVersion names the release version" (expected /"pluginVersion": "0\.5\.1"/) at test/release-consistency.test.js:96. This is the required RED proof that the old gate rejects the new surfaces. Edit 5 (the two constants) was applied immediately after this capture.
- 03, GREEN targeted on the modified tree: 6 test files, 86 tests, 86 pass, 0 fail, exit 0. The six files include install-discovery and self-check, which derive from package.json.
- 04, full suite on the modified tree: 697 tests, 697 pass, 0 fail, exit 0, with the npm header "dsh-you-should-know@0.5.2 test".
- 05, npm run check: exit 0. 06, git diff --check for base..worktree and for the worktree: exit 0, exit 0; the diff shape is 8 files, 19 insertions, 19 deletions.
- 13, second RED probe at 263577f with the new gate: PREVIOUS was temporarily set back to 0.5.0 with sed, and the run produced 4 tests, 3 pass, 1 fail, exit 1. The failing assertion reads "the release is exactly one step over the previous release: one patch step (0.5.1) or one minor step (0.6.0), not 0.5.2" at test/release-consistency.test.js:57. The restore is proven afterwards: git status --porcelain --untracked-files=no lists 0 tracked modified files, the before and after captures are separate files (<tmp>/red13-before.patch and <tmp>/red13-after.patch) with the same empty-file SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, and cmp reports them identical. The intermediate reverted state existed only during that run.
- Honesty note on chronology: 02, 03, and 04 were captured before the commit, on the tree that became 263577f. 11 and 13 were captured at 263577f. The baseline full suite in 01b was captured after the product commit, in a separate temporary worktree, because the worktree had to stay on the product tree.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Baseline targeted 6-file suite at c9ce22f | 86 tests, 86 pass, 0 fail, exit 0 | 01 |
| Baseline full suite at c9ce22f (temporary worktree) | 697 tests, 697 pass, 0 fail, exit 0 | 01b |
| RED against the old gate | 4 tests, 2 pass, 2 fail, exit 1 | 02 |
| Targeted 6-file suite on the modified tree | 86 tests, 86 pass, 0 fail, exit 0 | 03 |
| Full npm test on the modified tree | 697 tests, 697 pass, 0 fail, exit 0 | 04 |
| npm run check on the modified tree | exit 0 | 05 |
| git diff --check base and worktree | exit 0, exit 0 | 06 |
| Diff shape on the modified tree | 8 files, 19 insertions, 19 deletions | 06 |
| Targeted 6-file suite at 263577f | 86 tests, 86 pass, 0 fail, exit 0 | 11 |
| Full npm test at 263577f | 697 tests, 697 pass, 0 fail, exit 0 | 11 |
| npm run check at 263577f | exit 0 | 11 |
| git diff --check c9ce22f..HEAD | exit 0 | 11 |
| Diff shape at 263577f | 8 files, 19 insertions, 19 deletions | 11 |
| RED probe at 263577f with restore proof | 4 tests, 3 pass, 1 fail, exit 1, tracked diff empty before and after, cmp reports identical | 13 |
| Version surface scan | 18 expected 0.5.2 lines; only PREVIOUS 0.5.1 remains outside docs/harness-reports; 0 hits for 0.5.1 on the four released surfaces | 07 |
| Publication state | v0.5.1 tag unchanged; no v0.5.2 tag and no v0.5.2 release; latest release v0.4.6 | 10 |
| User environment | desktop profile still pins v0.5.1, nothing installed, upgraded, or removed | 12 |
| Final handoff tree at 263577f with this report and the evidence present | targeted 86 tests, 86 pass, 0 fail; full 697 tests, 697 pass, 0 fail; npm run check exit 0; git diff --check worktree and base..HEAD exit 0, exit 0 | 14 |
| Provenance digests | SHA256 for the 8 changed files at 263577f, evidence 01-07 and 10-14, and this report; evidence 08 and 09 itself are excluded by design | 09 |
| Secret and privacy scan | 0 token hits, 0 host-path or file-URL hits, 0 Cyrillic or CJK hits, and 0 non-ASCII bytes on added code lines; excludes only itself | 08 |

## Preservation

- Historical artifacts: no file under docs/harness-reports/ other than the new task directory was modified. `git diff --stat c9ce22f..HEAD -- docs/harness-reports` prints 0 lines (11). docs/upstream keeps the 0.4.6 baseline (docs/upstream/README.md:18-19, docs/upstream/ledger.json:147,557 in 11).
- v0.5.1 tag: unchanged, annotated object af8c7f87d5ed723384055d00fd4d66fd6ae0020f peeling to c1b14fe0e9f01cb2c712ebcdc183c00ae7124470; local and remote refs agree (10).
- main: local main stays at 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2, and origin/main stays at the base commit c9ce22f (11). The task branch is based on that commit and is ahead by one product commit; the push and the pull request are created after this report.
- The temporary baseline worktree was removed; `git worktree list --porcelain | grep -c 'ysk-base$'` returns 0 (11). A pre-existing detached worktree at <tmp>/ysk-base-ff220a5 belongs to another session and was not created by this task.
- User environment: evidence 12 records the desktop profile lock pinning github:PipaGs/dsh-you-should-know#v0.5.1 and resolving to c1b14fe0e9f01cb2c712ebcdc183c00ae7124470. The two profile file mtimes are 2026-10-31T08:01:09+0300 and 2026-10-31T08:44:05+0300, both before the earliest captured command of this task at 08:45:56+0300. Nothing was installed, upgraded, or removed.

## Publication status

- The v0.5.1 tag exists and is untouched: annotated tag object af8c7f87d5ed723384055d00fd4d66fd6ae0020f at commit c1b14fe0e9f01cb2c712ebcdc183c00ae7124470 (10).
- No v0.5.2 tag exists: `git rev-parse v0.5.2` fails as an unknown revision, and `git ls-remote --tags origin 'v0.5.2*'` prints nothing (10).
- No GitHub release exists for v0.5.2: `gh release view v0.5.2` returns "release not found". No release exists for v0.5.1 either, and the latest release is v0.4.6 (10).
- No npm publish was attempted, and the npm registry state is NOT verified here.
- No install, upgrade, or removal was performed (12).
- At report time nothing was pushed, merged, or tagged by this task. The orchestrator pushes the branch and opens the pull request after this commit.
- The pinned install address github:PipaGs/dsh-you-should-know#v0.5.2 does not resolve until the publication step creates the tag.

## Known limitations

- PREVIOUS is hand-maintained, so the gate cannot detect a dishonest PREVIOUS, and it never asserts that the tag or the GitHub release exists.
- The RED probe in 13 depended on a temporary one-line revert. The restore is proven by 0 tracked modified files after the restore and by the identical empty-diff SHA256 of the two captures, but the intermediate state existed only during that one run.
- Four test files keep older versions by design, as fixtures and as PREVIOUS: test/client-ui.test.js:2232; test/recent-check-diagnostics.test.js:161-162; test/update.test.js:139,336,535,538 carry 0.5.0, and test/release-consistency.test.js:41 carries 0.5.1 as PREVIOUS (07). Historical reports under docs/harness-reports keep their own 0.5.1 prose by design. A future bump must advance PREVIOUS and the current-version assertions honestly.
- docs/upstream keeps the 0.4.6 baseline, so the tree names several product versions by design: 0.4.6 as the upstream baseline, 0.5.0 and 0.5.1 in historical reports and fixtures, and 0.5.2 as the current version.
- The baseline full suite in 01b was captured after the product commit, in a temporary detached worktree, not on the pristine worktree before the edit. That worktree needed a node_modules symlink to the main checkout; without that symlink the base tree cannot resolve @deepseek-ai/schemastery, so the full suite fails on dependency resolution.
- evidence 02, 03, and 04 were captured on the dirty pre-commit tree. The tree was committed later as 263577f without changes, and evidence 11 re-runs the same checks at that commit.
- Evidence 08 is generated last, after evidence 09 and this report are final. Evidence 09 does not hash evidence 08, because evidence 08 is produced after evidence 09; evidence 08 excludes only itself and therefore scans evidence 09 and this report.
- The npm registry state for 0.5.2 is out of scope and NOT verified.

## Independent review

Two independent DSH review rounds inspected this change on 2026-10-31. Each round used a reviewer that did not write the change; round 2 was a closure pass by the same reviewer.

- Round 1 returned APPROVE with no blockers and five findings (two minor and three nit), all confined to the report and the evidence. It independently reproduced the targeted six-file suite at 86 tests, 86 pass, 0 fail, exit 0; the full suite at 697 tests, 697 pass, 0 fail, exit 0; npm run check exit 0; git diff --check exit 0; the RED result on the old gate and the GREEN result on the new gate; the v0.5.1 tag identity; the absence of any v0.5.2 tag or release; and the unchanged desktop profile. All five findings were fixed before round 2. No reviewer found a defect in the product commit.
- Round 2 returned APPROVE with all five findings closed. It left two optional nits, both fixed in this revision: the count parenthetical in evidence 07 and the worktree-list command in evidence 11 and in this report. No reviewer found a defect in the product commit.
