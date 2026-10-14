# Proposed release notes — v0.4.4

Status: **candidate text, not published.** DSH prepared this body; it did not
create the tag, push the tag, create the GitHub Release, or install anything.
The owner/ChatGPT publishes it only after this PR is merged and the merged
commit is verified.

The published release convention of this repository is the GitHub Release body
(compare the existing `v0.4.3` release: Highlights, Install, Verification on the
merged commit). The text below follows that shape.

---

## Highlights

This release publishes source version `0.4.4`, the patch increment that follows
the merged note-voice work in PRs #12–#15.

- **Note voice by responsibility (PR #12).** The trusted base reviewer policy
  now carries one responsibility-attribution rule for the human-facing note: it
  says `we` when the human and the agent decided together, `the main agent` when
  the action or choice is the agent's, and `you` when the decision or the
  consequence is the human's or when the note addresses the human directly.
  When the excerpt does not show who was responsible, the note states only what
  happened and stays neutral; the rule never invents blame. It is instruction
  text only and adds no field to the JSON reply contract.
- **Bounded note-voice evaluation harness (PRs #13–#15).** The repository now
  ships an offline, deterministic evaluator
  (`scripts/note-voice-eval.mjs`, `npm run eval:note-voice`) plus an opt-in
  live runner (`scripts/note-voice-eval-live.mjs`, `npm run eval:note-voice:live`)
  that is double-gated behind `--live --confirm-spend` and a
  `DEEPSEEK_API_KEY` present only in the runner environment. The key is read
  from the environment, never logged, and never written to an emitted report.
  Neither script runs during `npm test`, and neither opens a network connection
  unless a human explicitly invokes the live runner.
- **Semantic recalibration of the ledger item (PR #15).** The upstream ledger
  item for the 2.1.288 note-voice rule is recorded as `adapted` with an explicit
  scoped acceptance; the earlier `equivalent` label was corrected forward as
  part of that semantic review. No historical evaluation record was rewritten,
  and no retroactive re-scoring was applied.

The published historical DeepSeek live run remains, as recorded, **0 PASS /
2 FAIL / 2 SILENT** on the lexical adjudicator. The semantic review found the
two FAIL verdicts to be proxy false positives (the notes themselves were
evidence-based) and the two SILENT cases to be legitimate silence for the fixed
synthetic excerpts; that is a review of the adjudicator, not a claim about
model behavior. No upstream behavioral parity is asserted: the voice rule is an
instruction-level adaptation and live model output is not proven equivalent to
Claude Code's `You should know`.

Version mirrors are synchronized to `0.4.4` (`package.json` `version`,
`PLUGIN_VERSION` in `lib/index.js`, the README status line, the README
tag-pinned install address, and the README self-check sample). Beyond the note
voice rule and the evaluation harness, this release carries no runtime behavior
changes. The human-only invariant is unchanged: no steering, injection, wake-up,
transcript write, or any other path to the primary agent.

## Install

```sh
dsh plugin --profile <profile> add github:PipaGs/dsh-you-should-know#v0.4.4
```

The address is a tag-pinned GitHub install; the released host and browser halves
are committed, so no build step runs. Restart DSH Desktop after installation so
the new JavaScript generation loads.

## Verification on the merged commit

Planned verification (fill in the exact numbers on the merged commit before
publishing, as the previous releases did):

- `npm test` -> 555/555 pass on the release-prep tree.
- `npm run check` -> exit 0.
- `git diff --check` -> clean.
- Human-only invariant (`test/invariant.test.js`) -> 11/11 pass.
- Release consistency gate (`test/release-consistency.test.js`) -> 4/4 pass.

## Limitations

- Live reviewer output is nondeterministic and is not asserted; only the
  composed reviewer instruction is verified.
- The evaluation harness is a lexical, deterministic proxy with known
  false-positive shapes; it is documented as such in
  `test/note-voice-semantic.test.js` and the task reports.
- This release publishes no telemetry and makes no provider call on behalf of
  the user beyond the single configured reviewer request.
