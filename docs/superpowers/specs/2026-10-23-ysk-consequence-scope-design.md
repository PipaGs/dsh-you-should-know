# Design: material consequences of correct work (YSK quality improvement)

Status: **proposal for owner review, not approved**. No implementation, no commit,
no release is implied by this document. Prepared from the owner's five-stage
improvement plan and the prior planning session; every claim below is tagged with
who decided it.

Observation baseline: repository `PipaGs/dsh-you-should-know`, branch `main` at
`a7b652ed41cd2683bf7e491dccc07c3448d05990` (product version 0.4.5), read on
2026-10-23.

## 0. Provenance

| Tag | Meaning |
| --- | --- |
| `[OWNER]` | Stated directly by the owner |
| `[DELEGATED]` | Delegated planning answer, not final owner approval |
| `[ENGINEER]` | Recommendation of the design author, to be validated by data |
| `[PENDING OWNER]` | Requires a separate owner decision |
| `[UNVERIFIED]` | Not confirmed by reading |

| Decision | Status |
| --- | --- |
| Speak about a material, undisclosed consequence of correct work | `[OWNER]` |
| Disclosed means the agent explicitly named that consequence; borderline cases stay silent | `[OWNER]` |
| Approach B: instruction text plus an additive contract | `[ENGINEER]` accepted for review `[DELEGATED]` |
| `because` must be an exact substring of the excerpt | `[ENGINEER]` |
| A substring proves quotation, not entailment; entailment is judged in offline evaluation | `[DELEGATED]` |
| Offline by default; any live run needs separate authorization | `[OWNER]` + `[DELEGATED]` |
| Numeric release threshold | `[PENDING OWNER]`, after data |
| Paranoid `high` without `action` | Kept as-is for now; kind-specific exception deferred `[DELEGATED]` |
| Visible `kind` label in the UI | `[DELEGATED]`: do not add initially |

## 1. Intent

The reviewer is a quiet observer for the human. It speaks when the human most
likely missed something material: a defect, a real requirement violation, or a
material consequence or tradeoff of the agent's own decision, even when the task
was completed and the checks were green. Otherwise it stays silent, and it never
sends anything to the agent.

The gap this design closes is narrow and specific. The current selection
criterion in `lib/core.js` (`REVIEW_INSTRUCTIONS`, the qualifying-information
list around lines 623-629 and the "what is wrong" note template around line 634)
admits four categories, all of them problem-shaped. The mode profiles in
`lib/review-strictness.js` (lines 57-95) are worded the same way, through
"material problems the agent most likely overlooked". A consequence of work that
is genuinely correct therefore cannot be reported in any mode, no matter how
material it is.

## 2. Goals

1. Admit the class "material consequence of correct work" into the selection
   criterion instead of leaving it outside every mode.
2. Make that class measurable before behavior changes: without a class in the
   reply, it cannot be counted, and a consequence cannot be told apart from a
   defect in any metric.
3. Keep the order "facts first, baseline second, behavior changes third", and
   never present the historical four-case voice run as model accuracy.

## 3. Non-goals

A second model call per turn; new data sources; telemetry; streaming or injection
into the agent; automatic fixes; copying code from extracted or unlicensed Claude
Code artifacts; rewriting repository history; release or installation work.

## 4. Anti-goals

The design fails even if the code works when it: makes noise about cosmetics or
about tradeoffs that are obvious from the agent's own reply; reports a consequence
without a quotable basis; produces a note that reads as praise or as a summary;
introduces a second notification level without evaluation data.

## 5. Invariants

Human-only isolation (`test/invariant.test.js`), no tools for the reviewer, the
bounded excerpt and the 1200-character evidence capsule
(`lib/evidence.js`, `EVIDENCE_LIMITS.maxCapsuleChars`), fail-quiet on any
malformed or non-conforming reply, no network in the standalone evaluator,
English for repository-facing prose.

## 6. When the reviewer speaks

All conditions must hold; any failure means silence.

1. **Material.** It changes observable behavior, data, money, security,
   reversibility, or what the human should decide or do next. An internal detail
   with no observable effect does not qualify.
2. **Quoted.** `because` is a verbatim substring of the exact user message
   the reviewer was sent: the excerpt plus the episode-evidence capsule, with no
   case folding, whitespace normalization, or other rewriting. This guards
   against fabrication. It is not proof that the consequence follows.
3. **Entailed.** The note names the step that links the quoted decision to the
   consequence. This is judged only in offline evaluation, against a fixed
   rubric; the runtime does not attempt to prove entailment.
4. **Undisclosed.** The agent's visible reply does not explicitly name that
   consequence. A short but clear phrase inside a long answer counts as
   disclosure; naming only the mechanism without the consequence does not. In a
   borderline case the reviewer stays silent.
5. **Novel.** Not a duplicate, and not in the known set after "Knew it".
6. **No speculation.** No data means no note; bounded uncertainty is allowed,
   an invented consequence is not.

Silence for: style, cosmetics, duplicates, subjective preference, anything the
agent already disclosed, and any consequence without a quotable basis.

## 7. Contract (additive, versioned)

```json
{"note": "...", "importance": "high" | "critical",
 "kind": "defect" | "requirement_violation" | "consequence" | "tradeoff",
 "because": "<exact substring of the excerpt, <= 240 chars>",
 "source": {"path": "...", "line": 42}, "action": "..."}
```

| Situation | Behavior | Reason |
| --- | --- | --- |
| `kind` absent (legacy reply) | kept as `unclassified` | additive compatibility |
| `kind` unknown value | soft fallback to `unclassified`, the note survives | metadata must not reduce recall |
| `kind` is consequence or tradeoff without `because` | dropped quietly | evidence gate, not metadata |
| `because` is not a substring of the excerpt | dropped quietly | fabrication guard |

Dedupe stays text-based: `kind` is not part of the fingerprint, otherwise the
same sentence under two classes would be shown twice. History renders
`unclassified` as an ordinary card without a label. Metrics keep
`unclassified` in its own bucket; it is never attributed to defects or to
consequences.

The note template changes from "what is wrong" to "what the human needs to know
and why it matters". Silence keeps exactly one shape:
`{"note": null, "importance": null}`.

## 8. Modes

| Mode | defect / requirement_violation | consequence / tradeoff |
| --- | --- | --- |
| Relaxed | critical | critical only |
| Balanced / Strict / Custom | high, critical | high, critical |
| Paranoid | high requires `action` | **unchanged for now**: `high` still requires `action` |

The Paranoid row is an honest conflict, not a solved question. `action` is, by
contract, a repair instruction for the coding agent (`docs/reference.md`,
"Verdict contract"), and a consequence of correct work has nothing to repair.
Changing that meaning would also change what "Add to chat" does. Current behavior
is pinned by `test/strictness.test.js` ("Paranoid admits a high finding only with
a concrete action" and "the engine applies the Paranoid action requirement
deterministically"). The baseline therefore keeps the existing gate and must
include Paranoid cases, otherwise there will never be evidence of whether the
gate causes material misses.

`kind` changes no admission decision in this iteration. The table above restates
the gates that already exist: Relaxed stores only `critical`, Balanced, Strict,
and Custom store `high` and `critical`, and Paranoid additionally requires a
non-blank `action` on `high`. No kind-dependent threshold is introduced, because
there is no data yet that would justify one.

The importance a consequence should carry is a text decision, not a code one:
`high` unless the consequence is a definite serious failure (data loss,
security exposure, an irreversible action), which is `critical`. In Relaxed this
means only critical consequences surface, which is the intended cost of that
mode. `action` stays optional for consequence and tradeoff.

## 9. Evidence and privacy

No new data. `because` lives inside the note object as internal evaluation
metadata: it is stored, exposed by the notes and history routes like `kind`, and
never rendered in the card, never added to the Explain prompt, and never sent to
status diagnostics or logs. The capsule still only confirms what the conversation
already shows.

## 10. UX

`lib/client.js` renders "You should know" / "You should know · critical". No
second notification level is introduced before evaluation data exists. Explain,
History, "Knew it", "Thanks", and "Add to chat" do not change. `kind` is not
rendered initially.

## 11. Evaluation baseline

A separate module, `scripts/note-voice-baseline.mjs`, with
`BASELINE_VERSION = 'note-voice-baseline-1'` `[ENGINEER]`. The existing
`scripts/note-voice-eval.mjs` (`EVAL_VERSION = 'note-voice-eval-2'`, four voice
cases) is not modified. Its `promptVersion` is a hash of `REVIEW_INSTRUCTIONS`,
so the instruction change in this design necessarily changes that hash: the
historical eval-2 run stays a historical artifact under the hash recorded when it
ran, and the reference documents the change date. Comparability across the
instruction change is not claimed.

Classes: material defect or requirement omission; requirement violation;
consequence of correct work; hidden tradeoff; unsupported success;
duplicate or known; legitimate silence; ambiguous evidence; model or runtime
error; voice attribution.

Per-case statuses: `SPEAK_OK`, `SPEAK_UNWARRANTED`, `SILENT_OK`,
`SILENT_MISSED`, `INVALID`, `NOT_RUN`. For consequences and tradeoffs, an
additional entailment verdict: `ENTAIL_OK`, `ENTAIL_WEAK`,
`ENTAIL_UNSUPPORTED`.

The baseline observes at the **admitted** level, not at the raw or parsed level.
Each case carries a review mode, and the scorer applies the same
`admitsVerdict` gate the engine applies, offline and deterministically. A reply
that a gate would drop is reported with `gated: true` and the status it would
otherwise have had, so a Paranoid suppression is visible as a gated miss rather
than disappearing into silence. That flag is the only source of P3 evidence.

The replies under test are static, author-authored fixtures kept in the
repository. No live model output is stored as an expected answer, because a
stored live reply would freeze one model's behavior into the ground truth. A live
runner that fills reply fields is future work and stays behind P2. The labels
(`expect`, `entail`) are authored by the case writer; the scorer checks
consistency and never infers `ENTAIL_OK` from a substring.

The entailment rubric asks three questions of a stored reply: does it name the
decision, does it name the linking mechanism, and does the consequence follow
under the assumptions visible in the excerpt. A raw substring match never yields
`ENTAIL_OK`. There is no runtime entailment check: it would need a second call
or a fragile heuristic.

No aggregate accuracy across classes. The report is counts per class. Voice is a
sub-test over stored replies, and `SILENT` is never counted as `PASS`.

Numbers below are proposals, not facts `[ENGINEER, unvalidated]`: at least two
cases per class, `because` at most 240 characters, offline checks allowed in CI,
live runs manual and gated.

Observed baseline version: 0.4.5 at `a7b652e`. Proposed-version number: next
patch, not chosen here `[ENGINEER]`.

## 12. Work order

1. **Upstream and provenance.** Refresh official Anthropic signals after
   2026-10-14, verify tag `v0.4.5` and the installed plugin version. The ledger
   gains a new dated entry; existing bytes are never rewritten.
2. **Baseline.** Implement the offline baseline module and fixture set.
3. **Behavior changes.** Only from failing, labeled cases; thresholds move only
   with a stated reason.
4. **UX.** A second notification level only if evaluation shows a real
   difference in error cost.
5. **Decomposition.** Tasks with acceptance criteria, evidence, and
   security/privacy/invariant gates.

## 13. Release gates

Release stays blocked while the owner-approved threshold and actual checks do not
exist. No numeric `SPEAK_UNWARRANTED` limit is invented here. Offline runs may go
to CI; live runs are manual, with an explicit authorization that names scope and
budget. The mere existence of `YSK_EVAL_COST_ATTESTATION` is not authorization.

## 14. Pending owner decisions

- **P1. Noise threshold and release gate.** Applies after at least two offline
  runs with a per-class table. The required number of runs is itself a proposal.
- **P2. Live spend.** Scope, budget, and route for any live run.
- **P3. Paranoid exception.** Only if data shows material misses caused by the
  `high requires action` gate; changing the runtime contract needs separate
  approval plus a regression test.
- **P4. Visible `kind` label.** Default: not shown.

## 15. Left to the builder

Where exactly `kind` is surfaced, if ever; how fixtures are authored beyond the
minimum per class; whether the baseline ships in CI on day one.

## 16. Not verified

`[UNVERIFIED]` existence of tag `v0.4.5` on GitHub (local tags stop at v0.4.3),
the installed plugin version, and official Anthropic changes after 2026-10-14.
These belong to work-order step 1.
