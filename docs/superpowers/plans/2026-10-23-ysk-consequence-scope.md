# Consequence Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the human-only reviewer report a material, undisclosed consequence or tradeoff of an agent decision, and make that class measurable offline, without changing what the reviewer can see or whom it talks to.

**Architecture:** Two additive layers on the existing reviewer contract. The instruction text gains the consequence class and the JSON contract gains two optional fields, `kind` and `because`; the engine grounds `because` against the exact excerpt it sent and stores the class on the note without touching dedupe. A separate offline baseline module scores labeled cases per class, so behavior changes later are argued from counts, not from impressions.

**Tech Stack:** Node.js ESM, no runtime dependencies, `node --test`, plain JSON fixtures.

**Spec:** `docs/superpowers/specs/2026-10-23-ysk-consequence-scope-design.md`

## Global Constraints

- Node ESM only; no runtime dependencies; the only non-relative import stays `@deepseek-ai/schemastery` in `lib/index.js`.
- Human-only isolation is absolute: no tools, no writes into the agent context, no network in the standalone evaluator.
- Fail-quiet: any malformed reply is dropped with no note and no throw; silence stays exactly `{"note": null, "importance": null}`.
- The bounded excerpt and the 1200-character evidence capsule (`lib/evidence.js`, `EVIDENCE_LIMITS`) do not grow.
- Diagnostics (`status`) never carry note text, `because`, or prompt text; only the notes and history routes expose a stored note.
- English only for every repository-facing artifact: code comments, docs, tests, commit messages.
- Paranoid keeps its current deterministic gate: a `high` finding without a non-blank `action` is dropped. Do not change it in this plan.
- No numeric noise threshold is introduced; the release stays blocked until the owner sets one from data.
- Commits happen only after the owner authorizes implementation; if they do, one commit per task with an English subject.
- Checks that must pass before any task is called done: `npm test` and `npm run check`.

## Review Focus

1. A legacy reply with no `kind` must still produce a note; a fallback that quietly drops unclassified findings is the main regression risk. Pinned in Task 2 and Task 4.
2. A `because` that almost matches the excerpt (case, whitespace, punctuation) must be dropped, not accepted; substring acceptance is the fabrication guard. Pinned in Task 3.
3. The same sentence under two different `kind` values must stay one note; making `kind` part of the fingerprint would double the feed. Pinned in Task 4.
4. A Paranoid `high` consequence without `action` must still be dropped after this work; the deferred decision must not drift in silently. Pinned in Task 7.
5. Malformed `kind` and `because` (number, null, overlong, control characters) must degrade exactly as specified and never throw. Pinned in Task 2.

---

### Task 1: Parse `kind` and `because`

**Files:**
- Modify: `lib/core.js` (LIMITS around line 68, `parseVerdict` around line 742, new `parseBecause` next to `parseAction`)
- Test: `test/core.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `NOTE_KINDS` (readonly array `['defect','requirement_violation','consequence','tradeoff']`), `UNCLASSIFIED_KIND = 'unclassified'`, `LIMITS.maxBecauseChars = 240`. `parseVerdict(raw)` returns a verdict that may carry `kind: string` and `because: string`.

Rules the implementation must encode:

| Reply | Result |
| --- | --- |
| no `kind` | no `kind` property on the verdict (legacy) |
| `kind` a known string | `kind` copied verbatim |
| `kind` unknown string, number, null, object | `kind: 'unclassified'`, note survives |
| `kind` consequence or tradeoff without `because` | reply dropped (`null`) |
| `because` not a string, blank, over 240 chars, or containing `\u0000-\u001f`/`\u007f` | reply dropped (`null`) |
| silence shape carrying `kind` or `because` | reply dropped (`null`), same as `source`/`action` |

- [x] **Step 1: Write the failing tests**

In `test/core.test.js`, next to the existing `parseVerdict` tests:

```js
test('parseVerdict keeps a known kind and an exact because', () => {
  const v = parseVerdict('{"note":"N","importance":"high","kind":"consequence","because":"chose the in-memory cache"}')
  assert.equal(v.kind, 'consequence')
  assert.equal(v.because, 'chose the in-memory cache')
})

test('parseVerdict leaves a legacy reply unclassified without adding kind', () => {
  const v = parseVerdict('{"note":"N","importance":"high"}')
  assert.equal(Object.prototype.hasOwnProperty.call(v, 'kind'), false)
})

test('parseVerdict degrades an unknown or malformed kind to unclassified', () => {
  for (const kind of ['"mystery"', '7', 'null', '{"a":1}']) {
    const v = parseVerdict('{"note":"N","importance":"high","kind":' + kind + '}')
    assert.equal(v.kind, 'unclassified', kind)
    assert.equal(v.note, 'N')
  }
})

test('parseVerdict drops a consequence without because and a malformed because', () => {
  assert.equal(parseVerdict('{"note":"N","importance":"high","kind":"consequence"}'), null)
  assert.equal(parseVerdict('{"note":"N","importance":"high","kind":"tradeoff"}'), null)
  for (const because of ['5', '""', '"   "', '"' + 'x'.repeat(241) + '"']) {
    assert.equal(parseVerdict('{"note":"N","importance":"high","because":' + because + '}'), null, because.slice(0, 12))
  }
  assert.equal(parseVerdict('{"note":"N","importance":"high","because":"a\u0007b"}'), null)
})

test('parseVerdict rejects silence that carries kind or because', () => {
  assert.equal(parseVerdict('{"note":null,"importance":null,"kind":"defect"}'), null)
  assert.equal(parseVerdict('{"note":null,"importance":null,"because":"x"}'), null)
})
```

- [x] **Step 2: Run the new tests and watch them fail**

Run: `node --test --test-name-pattern="parseVerdict" test/core.test.js`
Expected: FAIL, the `kind`/`because` assertions see `undefined`.

- [x] **Step 3: Implement the parser**

Add near `parseAction`:

```js
function parseBecause(value) {
  if (typeof value !== 'string') return null
  const because = value.trim()
  if (because === '' || because.length > LIMITS.maxBecauseChars) return null
  if (/[\u0000-\u001f\u007f]/.test(because)) return null
  return because
}
```

In `parseVerdict`, after the silence branch rejects `source` and `action`, also reject `kind` and `because`. In the non-silent branch, after `source` handling:

- if `kind` is present: keep it when `typeof kind === 'string'` and `NOTE_KINDS.includes(kind.trim())`, otherwise set `verdict.kind = UNCLASSIFIED_KIND`.
- if `because` is present: `parseBecause` must return a string, otherwise `return null`; assign it.
- if `verdict.kind` is `'consequence'` or `'tradeoff'` and `verdict.because === undefined`, `return null`.

- [x] **Step 4: Run the tests**

Run: `node --test test/core.test.js`
Expected: PASS, including the pre-existing verdict tests.

- [x] **Step 5: Commit**

```bash
git add lib/core.js test/core.test.js
git commit -m "feat: accept optional kind and because in the verdict contract"
```

---

### Task 2: Ground `because` against the sent message

**Files:**
- Modify: `lib/core.js` (`createEngine`, `observe` around line 1321, `makeRuntime` `onNote` around line 1140)
- Test: `test/engine.test.js`

**Interfaces:**
- Consumes: `parseVerdict` output and `NOTE_KINDS` from Task 1.
- Produces: `groundVerdict(verdict, source)` exported from `lib/core.js`; returns the same verdict, or `null` when grounding fails. The engine stores the exact user message it sent (excerpt plus evidence capsule) in `state.reviewMessage` and clears it when the review settles.

Rules: silence passes through untouched; a verdict with `because` not verbatim in that message returns `null`; a consequence or tradeoff without `because` returns `null`; an empty or non-string message returns `null` for any verdict that carries `because`. No case folding, whitespace normalization, or punctuation trimming: exact `String.prototype.includes` only.

- [x] **Step 1: Write the failing engine test**

In `test/engine.test.js`, using the file's existing `engineWith` helper:

```js
test('a because that is not verbatim in the excerpt drops the reply', async () => {
  const quoted = engineWith(['{"note":"N","importance":"high","kind":"consequence","because":"use the cache"}'], { minDeltaChars: 0, cooldownTurns: 1 })
  const ok = await observeAndSettle(quoted.engine, sessionWith('q1', [{ turn: 1, answer: 'We use the cache for speed.' }]))
  assert.equal(ok.status, 'noted')
  assert.equal(quoted.engine.notes('q1').length, 1)

  const invented = engineWith(['{"note":"N","importance":"high","kind":"consequence","because":"use the disk"}'], { minDeltaChars: 0, cooldownTurns: 1 })
  const dropped = await observeAndSettle(invented.engine, sessionWith('q2', [{ turn: 1, answer: 'We use the cache for speed.' }]))
  assert.equal(dropped.status, 'silent')
  assert.equal(invented.engine.notes('q2').length, 0)
})

test('groundVerdict rejects a near-miss quote and passes silence through', () => {
  assert.equal(groundVerdict({ note: 'N', importance: 'high', because: 'Use the Cache' }, 'we use the cache'), null)
  assert.deepEqual(groundVerdict({ note: null, importance: null }, 'we use the cache'), { note: null, importance: null })
})
```

- [x] **Step 2: Run it and watch it fail**

Run: `node --test --test-name-pattern="because" test/engine.test.js`
Expected: FAIL, the invented quote is currently delivered, and `groundVerdict` is not exported.

- [x] **Step 3: Implement grounding and wire it**

Add the export next to `parseVerdict`. In `observe`, `message` is already built as the excerpt plus the optional capsule; set `state.reviewMessage = message` after it is built and before `runtime.enqueue(...)`, and in the promise's `finally` set `state.reviewMessage = ''`. In `makeRuntime` `onNote`:

```js
onNote: (verdict) => {
  const grounded = groundVerdict(verdict, state.reviewMessage)
  if (grounded === null) return 'filtered'
  if (!admitsVerdict(state.reviewMode, grounded)) return 'filtered'
  return deliverNote(state, sessionId, grounded)
}
```

- [x] **Step 4: Run the engine and core suites**

Run: `node --test test/engine.test.js test/core.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib/core.js test/engine.test.js
git commit -m "feat: ground consequence findings in the excerpt that was sent"
```

---

### Task 3: Store and expose the class without touching dedupe

**Files:**
- Modify: `lib/core.js` (`deliverNote` around line 959, `activeView` around line 1407)
- Test: `test/engine.test.js`, `test/plugin.test.js`

**Interfaces:**
- Consumes: grounded verdicts from Task 2.
- Produces: stored notes carry `kind` (always a string, `'unclassified'` when the reply had none) and `because` only when present. The notes and history route views expose `kind` and, when stored, `because`.

Rules: `dedupeKey` stays text-only; the same note text under two classes is one note. A legacy note has `kind: 'unclassified'`. `status` diagnostics keep zero note text and zero class data.

- [x] **Step 1: Write the failing tests**

```js
test('the route exposes kind and an unclassified legacy note', async () => {
  const { engine } = engineWith(['{"note":"Same","importance":"high"}'], { minDeltaChars: 0, cooldownTurns: 1 })
  const settled = await observeAndSettle(engine, sessionWith('k1', [{ turn: 1, answer: 'work' }]))
  assert.equal(settled.note.kind, 'unclassified')
})

test('the same text under two kinds is one note', async () => {
  const { engine } = engineWith([
    '{"note":"Cache is unbounded","importance":"high","kind":"defect"}',
    '{"note":"Cache is unbounded","importance":"high","kind":"tradeoff","because":"use the cache"}',
  ], { minDeltaChars: 0, cooldownTurns: 1 })
  await observeAndSettle(engine, sessionWith('k2', [{ turn: 1, answer: 'use the cache' }]))
  await observeAndSettle(engine, sessionWith('k2', [{ turn: 2, answer: 'use the cache' }]))
  assert.equal(engine.notes('k2').length, 1)
  assert.equal(JSON.stringify(engine.status('k2')).includes('Cache is unbounded'), false)
})
```

- [x] **Step 2: Run them and watch them fail**

Run: `node --test --test-name-pattern="kind" test/engine.test.js`
Expected: FAIL, `kind` is `undefined` on the view.

- [x] **Step 3: Implement**

In `deliverNote`, after the `action` assignment: `note.kind = verdict.kind === undefined ? UNCLASSIFIED_KIND : verdict.kind` and `if (verdict.because !== undefined) note.because = verdict.because`. In `activeView`, add `kind` the same way (never `undefined`) and `because` only when defined. Do not touch `dedupeKey`.

- [x] **Step 4: Run the suites**

Run: `node --test test/engine.test.js test/plugin.test.js test/invariant.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add lib/core.js test/engine.test.js test/plugin.test.js
git commit -m "feat: store the finding class on notes and keep dedupe text-only"
```

---

### Task 4: Admit the class in the instruction text

**Files:**
- Modify: `lib/core.js` (`REVIEW_INSTRUCTIONS` around line 619)
- Modify: `lib/review-strictness.js` (`REVIEW_MODE_PROFILES` around line 52)
- Test: `test/core.test.js`, `test/strictness.test.js`

**Interfaces:**
- Consumes: `kind` and `because` names from Task 1, so the prompt and the parser agree on spelling.
- Produces: instruction text that names the consequence class, the two new fields, and the "what the human needs to know" note template.

Rules: the four existing categories stay word for word; the new category is added after them. The note template no longer says "what is wrong". Every mode profile mentions consequences or tradeoffs in material terms; Relaxed keeps its critical-only floor and says so.

- [x] **Step 1: Write the failing tests**

```js
test('the reviewer instruction admits consequences of correct work', () => {
  const text = REVIEW_INSTRUCTIONS.join(' ')
  assert.match(text, /consequence/i)
  assert.match(text, /even when the (task|work) is (complete|done)/i)
  assert.match(text, /"kind"/)
  assert.match(text, /"because"/)
  assert.match(text, /what the human needs to know/i)
  assert.equal(text.includes('what is wrong and why it matters'), false)
})

test('every review mode names consequences or tradeoffs', () => {
  for (const mode of REVIEW_MODES) {
    const text = buildStrictnessSection(mode, '', undefined)
    assert.match(text, /consequence|tradeoff/i, mode)
  }
})
```

- [x] **Step 2: Run them and watch them fail**

Run: `node --test --test-name-pattern="consequence" test/core.test.js test/strictness.test.js`
Expected: FAIL on the missing phrases.

- [x] **Step 3: Edit the prompt text**

Add one qualifying bullet to `REVIEW_INSTRUCTIONS`:

```js
'- a material consequence or tradeoff of a decision the agent made, even when the task is complete and the checks pass;',
```

Add one paragraph after the JSON example:

```js
'When the finding is a consequence or a tradeoff, add "kind" with one of "defect", "requirement_violation", "consequence", or "tradeoff", and add "because": the exact sentence from the excerpt that shows the decision. "because" must be copied verbatim; it is dropped unless it appears in the excerpt exactly.',
```

Change the note template line to: `'"note" is written for the human: what the human needs to know and why it matters.'` Keep the example sentence. In each profile, add one clause naming the class, for example Balanced: `'Also report a material consequence or tradeoff of the agent\'s own decision, even when the task itself is complete and its checks pass.'` Relaxed adds the same clause with `critical only`.

- [x] **Step 4: Update the pinned prompt hash and record the comparability break**

`scripts/note-voice-eval.mjs` derives `promptVersion` from `REVIEW_INSTRUCTIONS`, and `test/note-voice-eval-live.test.js` pins that hash. Recompute the hash from the new instructions, update the pinned value, and add one dated paragraph to `docs/reference.md`: the reviewer instruction changed after the historical eval-2 run, eval-2 keeps the hash recorded when it ran, and comparability across the change is not claimed.

- [x] **Step 5: Run the suites and fix the assertions the wording break**

Run: `npm test`
Expected: PASS. Where an existing test asserts the old template or exact instruction strings, update that assertion to the new wording; do not weaken it to a substring that would pass for unrelated text.

- [x] **Step 6: Commit**

```bash
git add lib/core.js lib/review-strictness.js docs/reference.md test/core.test.js test/strictness.test.js test/note-voice-eval-live.test.js
git commit -m "feat: admit material consequences in the reviewer instruction and modes"
```

---

### Task 5: Document the contract

**Files:**
- Modify: `docs/reference.md` ("Verdict contract" and "Modes and prompts" sections)
- Modify: `README.md` only if it lists the reply fields (check first; leave it alone if it does not)
- Test: `test/repository-language.test.js` (already exists, no new test)

**Interfaces:**
- Consumes: the behavior implemented in Tasks 1 to 4.
- Produces: documentation that matches the code exactly: the two optional fields, their validation, the unclassified fallback, the unchanged dedupe and Paranoid gate.

Rules: additive prose only. Do not rewrite the historical sections about the four original categories; extend them.

- [x] **Step 1: Update the verdict contract**

Document `kind` (optional; unknown or malformed becomes `unclassified` and the note survives) and `because` (optional; required for `consequence` and `tradeoff`; must be a verbatim substring of the excerpt; malformed or unmatched drops the whole reply quietly). State that silence never carries either field, that dedupe remains text-only, and that `kind` is not rendered in the UI.

- [x] **Step 2: Update the modes table prose**

State that every mode now admits the consequence class in its areas of scrutiny, that Relaxed still stores only `critical`, and that Paranoid still requires a non-blank `action` on a `high` finding.

- [x] **Step 3: Run the documentation checks**

Run: `node --test test/repository-language.test.js test/release-notes-consistency.test.js`
Expected: PASS; every new paragraph is English.

- [x] **Step 4: Commit**

```bash
git add docs/reference.md README.md
git commit -m "docs: document the finding class and its grounding rule"
```

---

### Task 6: Offline baseline scorer

**Files:**
- Create: `scripts/note-voice-baseline.mjs`
- Create: `scripts/fixtures/note-voice-baseline/cases.json`
- Modify: `package.json` (add `"eval:note-voice:baseline": "node scripts/note-voice-baseline.mjs"`)
- Test: `test/note-voice-baseline.test.js`

**Interfaces:**
- Consumes: nothing at runtime; the fixtures are static JSON.
- Produces: `BASELINE_VERSION = 'note-voice-baseline-1'`, `BASELINE_CLASSES`, `CASE_STATUS`, `ENTAIL_VERDICTS`, `scoreCase(caseDef)`, `summarize(results)`, and a CLI that prints a per-class table and exits non-zero only on `INVALID` cases.

Statuses: `SPEAK_OK`, `SPEAK_UNWARRANTED`, `SILENT_OK`, `SILENT_MISSED`, `INVALID`, `NOT_RUN`. Entailment verdicts `ENTAIL_OK`, `ENTAIL_WEAK`, `ENTAIL_UNSUPPORTED` are an author label stored on the case, never derived from a substring match.

The scorer observes at the **admitted** level. Each case carries a `mode`; `scoreCase` runs the same `admitsVerdict` gate the engine runs, offline, and returns `gated: true` when the gate drops a reply that was otherwise speakable. A gated drop is scored `SILENT_MISSED` for a speak case and `SILENT_OK` for a silence case, and the flag is what makes a Paranoid suppression visible instead of indistinguishable from a correct silence. That flag is the only source of P3 evidence, so the Paranoid cases must carry `mode: 'paranoid'`.

- [x] **Step 1: Write the failing scorer tests**

```js
test('a silent reply never counts as a pass and is never scored as speak', () => {
  assert.equal(scoreCase({ id: 'a', class: 'legitimate_silence', expect: 'silent', reply: null }).status, 'SILENT_OK')
  assert.equal(scoreCase({ id: 'b', class: 'material_defect', expect: 'speak', reply: null }).status, 'SILENT_MISSED')
})

test('an unexpected note is unwarranted and a matching one is ok', () => {
  assert.equal(scoreCase({ id: 'c', class: 'material_defect', expect: 'speak', reply: { note: 'N', importance: 'high' } }).status, 'SPEAK_OK')
  assert.equal(scoreCase({ id: 'd', class: 'legitimate_silence', expect: 'silent', reply: { note: 'N', importance: 'high' } }).status, 'SPEAK_UNWARRANTED')
})

test('entailment is never derived from a substring', () => {
  const result = scoreCase({
    id: 'e', class: 'consequence_of_correct_work', expect: 'speak', entail: 'unsupported',
    message: 'we use the cache',
    reply: { note: 'N', importance: 'high', kind: 'consequence', because: 'we use the cache' },
  })
  assert.equal(result.entail, 'ENTAIL_UNSUPPORTED')
  assert.equal(result.becauseGrounded, true)
})

test('a mode gate that drops a finding is a gated miss, not silence', () => {
  const result = scoreCase({
    id: 'g', class: 'consequence_of_correct_work', expect: 'speak', mode: 'paranoid',
    reply: { note: 'N', importance: 'high', kind: 'consequence', because: 'x' },
  })
  assert.equal(result.gated, true)
  assert.equal(result.status, 'SILENT_MISSED')
  assert.equal(scoreCase({
    id: 'h', class: 'consequence_of_correct_work', expect: 'speak', mode: 'balanced',
    reply: { note: 'N', importance: 'high', kind: 'consequence', because: 'x' },
  }).gated, false)
})

test('summarize counts per class and keeps unclassified separate', () => {
  const counts = summarize([
    { class: 'material_defect', status: 'SPEAK_OK' },
    { class: 'material_defect', status: 'SPEAK_UNWARRANTED' },
    { class: 'unclassified', status: 'SPEAK_OK' },
  ])
  assert.equal(counts.byClass.material_defect.SPEAK_OK, 1)
  assert.equal(counts.byClass.material_defect.SPEAK_UNWARRANTED, 1)
  assert.equal(counts.byClass.unclassified.SPEAK_OK, 1)
})
```

- [x] **Step 2: Run them and watch them fail**

Run: `node --test test/note-voice-baseline.test.js`
Expected: FAIL, the module does not exist.

- [x] **Step 3: Implement the module**

`scoreCase` parses `caseDef.reply` (already an object or `null`), applies `admitsVerdict(caseDef.mode, reply)` when the reply is non-silent, and returns `{ id, class, status, gated, entail?, becauseGrounded? }`. `becauseGrounded` is a literal `String.prototype.includes` check against `caseDef.message` and is reported, never promoted to `ENTAIL_OK`. `summarize` returns `{ total, byClass, gated, invalid }`, with each class holding a status counter and `unclassified` as its own class. The CLI reads the fixture file, refuses any case with a missing `id`, `class`, `mode`, `expect`, `message`, or `reply` key, prints one row per class, and prints `baseline is unvalidated until the owner sets a threshold`.

- [x] **Step 4: Write the fixture set**

Twenty cases, two per class: `material_defect`, `requirement_violation`, `consequence_of_correct_work`, `hidden_tradeoff`, `unsupported_success`, `duplicate_known`, `legitimate_silence`, `ambiguous_evidence`, `model_runtime_error`, `voice_attribution`. Each case is synthetic, English, carries no real session data, and records its `mode`; at least two cases run in `paranoid` so the gate evidence exists. Each consequence and tradeoff case carries an author `entail` label. The replies are static and hand-authored: no live model output is stored as an expected answer, because that would freeze one run into the ground truth. A live runner that fills reply fields is future work behind P2.

- [x] **Step 5: Run the scorer test and the suite**

Run: `npm test`
Expected: PASS; the new module is covered by `node --test`.

- [x] **Step 6: Commit**

```bash
git add scripts/note-voice-baseline.mjs scripts/fixtures/note-voice-baseline/cases.json package.json test/note-voice-baseline.test.js
git commit -m "test: add an offline per-class baseline scorer"
```

---

### Task 7: Pin the deferred Paranoid decision

**Files:**
- Test: `test/strictness.test.js`, `test/engine.test.js`
- Modify: none

**Interfaces:**
- Consumes: `admitsVerdict` and the stored note behavior from Tasks 1 to 3.
- Produces: a regression test that fails immediately if someone exempts consequences from the Paranoid `action` requirement without the owner decision P3.

- [x] **Step 1: Write the guard test**

```js
test('Paranoid still drops a high consequence without an action', () => {
  assert.equal(admitsVerdict('paranoid', { note: 'N', importance: 'high', kind: 'consequence', because: 'x' }), false)
  assert.equal(admitsVerdict('paranoid', { note: 'N', importance: 'critical', kind: 'consequence', because: 'x' }), true)
  assert.equal(admitsVerdict('balanced', { note: 'N', importance: 'high', kind: 'consequence', because: 'x' }), true)
})
```

- [x] **Step 2: Run it**

Run: `node --test --test-name-pattern="Paranoid still drops" test/strictness.test.js`
Expected: PASS without any production change. If it fails, the Paranoid gate was altered in an earlier task; revert that alteration instead of changing this test.

- [x] **Step 3: Commit**

```bash
git add test/strictness.test.js
git commit -m "test: pin the Paranoid action gate for consequence findings"
```

---

### Task 8: Refresh upstream provenance (blocked on network authorization)

**Files:**
- Modify: `docs/upstream/ledger.json` (append one dated entry)
- Modify: `docs/upstream/README.md` only if the ledger describes the head there
- Test: `test/upstream-ledger.test.js`

**Interfaces:**
- Consumes: nothing from the earlier tasks.
- Produces: a new ledger entry with the observation time, the source URLs, the upstream version and head that were actually seen, and the base commit `a7b652e`.

**Do not run this task without an explicit network authorization from the owner.** It is listed so the plan covers the spec, not because it belongs to the code change.

- [ ] **Step 1: Confirm authorization**

Ask the owner for explicit authorization that names the scope of the fetch. Without it, stop and leave the task unchecked.

- [ ] **Step 2: Observe and record**

Read the official changelog and the current upstream head, then append one entry to `docs/upstream/ledger.json` with the real observation timestamp, the real URLs, and the real version strings. Never rewrite an existing entry; never record a value that was not observed.

- [ ] **Step 3: Run the ledger test**

Run: `node --test test/upstream-ledger.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/upstream/ledger.json docs/upstream/README.md
git commit -m "docs: record a fresh upstream observation"
```
