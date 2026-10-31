# Final report - ysk-version-bump-0.5.1-20261031

**STATUS: READY_FOR_CHATGPT_REVIEW**

## Provenance

- Base commit: b6025cc640990294110796e12eb3df3c24f2d476 ("Merge pull request #30 from PipaGs/fix/v0.5.0-functional-defects-20261030"). Six functional fixes were already merged at this commit.
- Product commit: bd826609e912a104cfa76f92a7fcc24c4fe04dab, "chore: raise the version to 0.5.1 for the merged functional fixes"; 8 files, 19 insertions, 19 deletions. A second commit adds this report and the evidence, and the pull request head is that report commit.
- Branch: task/release-0.5.1-version-20261031. Date: 2026-10-31.
- Toolchain: Node v26.12.1, npm 11.20.0. Local zone MSK (UTC+3); every evidence header carries UTC and local time.
- Evidence: evidence/01 through evidence/13; the SHA256 values for evidence 01-07 and 10-13, for the eight changed files, and for this report are in evidence/09-provenance.txt; evidence/08 is the scan output, it is generated after 09, and 09 therefore does not hash it.

## Scope

Deliberate PATCH bump from 0.5.0 to 0.5.1 over the functional fixes already merged at the base commit. Eight files, with every changed line a version literal or a version assertion:

- package.json:3: version 0.5.1.
- lib/index.js:36: PLUGIN_VERSION 0.5.1. No other library change.
- README.md:11,76,194,195,196,199: status line, install address, three self-check fields, and the update currentVersion literal.
- docs/reference.md:220,221,222,227: the self-check sample literals.
- test/release-consistency.test.js:40,41: CURRENT 0.5.0 -> 0.5.1 and PREVIOUS 0.4.6 -> 0.5.0. The gate logic and its comments are unchanged.
- test/invariant.test.js:189, test/plugin.test.js:399,400,401, test/update-route.test.js:257: current-version assertions.

No feature was added and no behavior changed. No version history and no prospective-tag prose was added to the product docs.

## Version surfaces

| Surface | Value | Evidence |
|---|---|---|
| package.json version | 0.5.1 at line 3 | 07 |
| lib/index.js PLUGIN_VERSION | 0.5.1 at line 36 | 07 |
| README status line | 0.5.1 at line 11 | 07 |
| README install address | github:PipaGs/dsh-you-should-know#v0.5.1 at line 76 | 07 |
| README self-check sample | 0.5.1 in pluginVersion, runtimeVersion, installedVersion, and update.currentVersion, lines 194-196 and 199 | 07 |
| docs/reference.md self-check sample | 0.5.1 in the same four fields, lines 220-222 and 227 | 07 |
| 0.5.1 surface total | 18 matching lines, every one expected | 07 |
| Remaining 0.5.0 literals outside docs/harness-reports | test/client-ui.test.js:2120; test/recent-check-diagnostics.test.js:161-162; test/release-consistency.test.js:41 (PREVIOUS); test/update.test.js:139,336,535,538 | 07 |
| 0.5.0 in package.json, README.md, docs/reference.md, lib/index.js | 0 hits | 07 |

Count correction: the preparation brief said 17 hits for the 0.5.1 surface. evidence/07 enumerates 18 matching lines, and a fresh `git grep -n '0\.5\.1' -- package.json lib README.md docs/reference.md test | wc -l` returns 18. The evidence file wins; the brief undercounts by one.

## Release-consistency gate change

The gate keeps exactly one acceptance rule: the release must be one patch step (same minor, patch + 1) or one minor step (minor + 1, patch 0) over PREVIOUS. Only the two constants moved, so 0.5.0 -> 0.5.1 satisfies the patch step.

PREVIOUS is hand-maintained. The gate does not use the network, does not read tags, and never asserts that the tag or the GitHub release exists. It pins package.json, PLUGIN_VERSION, the README status line and install address, the self-check samples in README.md and docs/reference.md, and it scans package.json, README.md, docs/reference.md, and lib/index.js for the previous version.

## RED and GREEN

- 01, baseline before the edit (tree restored to origin/main content): 4 test files, 61 tests, 61 pass, 0 fail, exit 0.
- 02, RED: CURRENT=0.5.1 with PREVIOUS temporarily back at 0.4.6. 4 tests, 3 pass, 1 fail. The failing assertion reads "the release is exactly one step over the previous release: one patch step (0.4.7) or one minor step (0.5.0), not 0.5.1" at test/release-consistency.test.js:57. The exit code and the restore proof are in 13.
- Honesty note on the RED probes: each probe required a temporary revert of PREVIOUS with sed. evidence/13 re-runs the probe at 2026-10-31T04:37:43Z on bd82660 and records the restore proof: after the restore, git status --porcelain --untracked-files=no lists 0 tracked modified files, the before and after captures are separate files (<tmp>/red13-before.patch and <tmp>/red13-after.patch) with the same empty-file SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, and cmp reports them identical. evidence/13 records exit code 1. Both probes carry a first-line redaction note: 02 replaced absolute repository paths with <repo>, and 13 replaced repository paths with <repo> and temporary paths with <tmp>. The intermediate reverted state existed only during each run.
- 03, GREEN targeted on the modified tree: 6 test files, 86 tests, 86 pass, 0 fail, exit 0. The six files include install-discovery and self-check, which derive from package.json.
- 04, full suite on the modified tree: 687 tests, 687 pass, 0 fail, exit 0, with the npm header "dsh-you-should-know@0.5.1 test".
- 05, npm run check: exit 0. 06, git diff --check for base..worktree and for the worktree: exit 0.
- 11, committed-tree verification at bd82660: targeted 86/86 exit 0, full 687/687 exit 0, check exit 0, git diff --check base..HEAD exit 0.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Targeted 6-file suite on the modified tree | 86 tests, 86 pass, 0 fail, exit 0 | 03 |
| Full npm test on the modified tree | 687 tests, 687 pass, 0 fail, exit 0 | 04 |
| npm run check on the modified tree | exit 0 | 05 |
| git diff --check base..worktree and worktree | exit 0, exit 0 | 06 |
| Diff shape on the modified tree | 8 files, 19 insertions, 19 deletions | 06 |
| Targeted 6-file suite at bd82660 | 86 tests, 86 pass, 0 fail, exit 0 | 11 |
| Full npm test at bd82660 | 687 tests, 687 pass, 0 fail, exit 0 | 11 |
| npm run check at bd82660 | exit 0 | 11 |
| git diff --check base..HEAD | exit 0 | 11 |
| Diff shape at bd82660 | 8 files, 19 insertions, 19 deletions | 11 |
| RED probe on bd82660 | 4 tests, 3 pass, 1 fail, exit code 1, tracked diff empty before and after, cmp reports identical | 13 |
| Version surface scan | 18 expected 0.5.1 lines; 0 hits for 0.5.0 on the four released surfaces | 07 |
| Secret and privacy scan | 0 token hits, 0 host-path hits, and 0 Cyrillic or CJK hits on added lines and in new files, plus no non-ASCII byte on any added code line, over the changed product files, evidence 01-13, and this report, with evidence/08 excluded as the scan output itself; unchanged pre-existing lines are out of scope, for example the non-Latin fixture at test/invariant.test.js:163; 09 records the digest commands whose checkout paths are redacted to <repo> | 08 |
| Publication state | no v0.5.1 tag, no v0.5.1 release, latest release v0.4.6 | 10 |
| User environment | profile still pins v0.5.0, nothing installed, upgraded, or removed | 12 |

## Preservation

- Historical artifacts: no file under docs/harness-reports/ other than the new task directory was modified. docs/upstream keeps the 0.4.6 baseline (docs/upstream/README.md:18-21, docs/upstream/ledger.json:557). The change modifies no historical artifact; it adds only a new report directory under docs/harness-reports/.
- v0.5.0 tag: unchanged, annotated object 4f65cff661dc7b79ae0b1dc9929e82b5febadc8f peeling to 6d5b770b9f595c0bc456c9096c23875dc7a412ec; local and remote refs agree (10).
- main: local main stays at 038dcdac90c4dbb32e18d21a21bfa56d83bbc6c2, and origin/main stays at the base commit b6025cc. The task branch is based on that commit and carries the product commit plus one report commit. The branch and the pull request are created after this report is committed, as the publication step that follows this commit, and the final pull request head is recorded in the pull request body.
- User environment: evidence 12 records the desktop profile lock still pinning github:PipaGs/dsh-you-should-know#v0.5.0 and resolving to 6d5b770b9f595c0bc456c9096c23875dc7a412ec. Both profile files were last modified 2026-10-30, before this task. Nothing was installed, upgraded, or removed.
- The untracked file .rollout-restart-verify.log predates this task (mtime 2026-10-24T17:54:32+0300) and is not part of the change (08).

## Publication status

- No v0.5.1 tag exists. `git rev-parse v0.5.1` fails as an unknown revision, and `gh release view v0.5.1` returns "release not found" (10).
- No GitHub release exists for 0.5.1; the latest release is v0.4.6 (10).
- No npm publish was attempted, and the npm registry state is not verified here.
- No install, upgrade, or removal was performed (12).
- No merge was performed.
- The pinned install address github:PipaGs/dsh-you-should-know#v0.5.1 does not resolve until the publication step creates the tag.

## Known limitations

- PREVIOUS is hand-maintained, so the gate cannot detect a dishonest PREVIOUS, and it never asserts that the tag or the GitHub release exists.
- evidence/02 captured no exit code. evidence/13 is the probe that records exit code 1 together with the empty tracked diff before and after and the cmp identity.
- The RED probe depended on a temporary one-line revert. The restore is proven by 0 tracked modified files after the restore and by the identical empty-diff SHA256 of the two captures, but the intermediate state exists only during that one run.
- Four test files keep 0.5.0 by design, as fixtures and as PREVIOUS: test/client-ui.test.js:2120; test/recent-check-diagnostics.test.js:161-162; test/release-consistency.test.js:41 (PREVIOUS); test/update.test.js:139,336,535,538 (07). A future bump must advance them honestly.
- docs/upstream keeps the 0.4.6 baseline, so the tree names three product versions by design: 0.4.6 as the upstream baseline, 0.5.0 in historical reports and fixtures, and 0.5.1 as the current version.
- evidence/08 is captured last, after this report and evidence/09 are final. It excludes only itself, so it scans the changed product files, evidence 01-13, and this report. No file hashes evidence/08, and evidence/09 does not hash it because evidence/08 is generated after evidence/09.
- The npm registry state for 0.5.1 is out of scope and NOT verified.
- The preparation brief said 17 hits for the 0.5.1 surface; evidence/07 and a fresh git grep both count 18.

## Independent review

Three independent DSH review rounds inspected this change on 2026-10-31. Each round used a fresh reviewer that did not write the change, and no reviewer found a defect in the product commit.

- Round 1 returned CHANGES_REQUIRED with one major, two minor, and two nit findings. Every finding was in the report or in the evidence.
- Round 2 confirmed that every round 1 finding was resolved and returned CHANGES_REQUIRED with two minor and three nit findings, again confined to the report and the evidence.
- Round 3 returned APPROVE. It reproduced the six-file targeted suite at 86 tests, 86 pass, 0 fail, exit 0; the full suite at 687 tests, 687 pass, 0 fail, exit 0; npm run check exit 0; git diff --check for the worktree and for base..bd82660 exit 0; all 20 SHA256 values in evidence/09; the evidence/08 token and host-path scans; the product diff of 8 files, 19 insertions, and 19 deletions; the v0.5.0 tag identity together with the absence of a v0.5.1 tag and release; and the unchanged v0.5.0 profile pin.

Round 3 raised one optional nit about the wording of the Cyrillic/CJK row, and this revision fixes it. No reviewer could verify the npm registry state for 0.5.1, which this report already marks NOT verified.
