# Release notes - v0.4.6

## Highlights

This release publishes source version `0.4.6`, the patch increment that follows the merged reviewer work after the `v0.4.4` tag. The version-bump pull requests change version mirrors, documentation, and version literals only.

- **Consequence-scope reviewer findings (PR #21).** The reviewer admits material consequences, grounds each finding in the excerpt that was sent, records the finding class on stored notes while dedupe stays text-only, and separates runtime failures from deliberate silence. A malformed `because` value drops the reply quietly. Semantics that the suite does not measure are marked unverified in the baseline contract instead of being claimed.
- **English-only repository rules (PR #20).** `AGENTS.md` is the authoritative rule for repository-facing prose, and a regression suite pins the rule and its artifacts.
- **Web history panel height fix (PR #18).**
- **Version mirrors (PRs #19 and #22).** `package.json`, `PLUGIN_VERSION`, the README and `docs/reference.md` self-check samples, and the release-consistency gate stay in sync at `0.4.6`.

## Install

```sh
dsh plugin --profile <profile> add github:PipaGs/dsh-you-should-know#v0.4.6
```

The plugin installs from this Git tag. No npm publication is part of this release.

## Scope and gating

- The version-bump pull request itself changes no product behavior.
- Release gating for semantic quality, paid/live inference, noise threshold, the Paranoid exception, and upstream refresh is unchanged and still pending.
