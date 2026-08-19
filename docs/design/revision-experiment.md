# Design — Longitudinal revision experiment (E7)

**Status:** Procedure measured locally (2026-08-19). Genuine Track A
revision not yet observed. Not a new engine layer.
**Date:** 2026-08-19
**Depends on:** E5 (`docs/design/evaluation.md`), E6 measured
(`docs/design/current-understanding.md`)

E7 asks one question:

> Can Chronicle preserve a real human revision through time, such
> that a later evaluation changes the current-understanding view
> without overwriting the earlier evaluation, and a later mind can
> reconstruct both why the earlier state was current then and why
> the later state is current now?

It tests **revision provenance**, not biography, profile, automatic
memory, or another model capability.

Do not implement this document as a feature. Do not add code merely
to create a phase.

## Relation to the Revision Provenance Hypothesis

From the 2026-08-19 research capture
(`rosetta_docs/product/research/PRD-0027/thought-evolution-2026-08-19.md`):

> A useful intelligence system should preserve not only the states
> it reaches, but the transitions by which those states were
> produced.

That hypothesis remains **Speculative**. E7 does not prove it. E7
tests only whether this engine can faithfully represent and
reconstruct **one** longitudinal revision.

## Inspected machinery — no new durable artifact

Existing E5/E6 already express the required shape.

| Need | Existing mechanism |
| ---- | ------------------ |
| A later judgment without rewriting the earlier one | Append-only `DerivedEvaluation`. Identity includes `evaluatedAt`, so T2 and T3 are different artifacts |
| Earlier evaluation remains historically valid | Store refuses identity-conflicting rewrite; E6 reduction does not mutate |
| `--as-of T2` vs `--as-of T3` | Same-evaluator latest `evaluatedAt` wins per dimension; `recordedAt` ignored |
| History of both acts | `explanation.evaluationIds` = in-scope historical evals of that record/perspective |
| Current contributors only | Dimension `contributingEvaluationIds` = act(s) at the winning timestamp |
| No “latest value” field | `CurrentUnderstandingView` is computed. Nothing writes a current-state column |
| Equal-time contradiction | `same-evaluator-tie` → current state `conflict`; both equal-time acts are current contributors. This is an **adversarial projection probe**, not a real human revision event |
| Machine record stays itself | `evaluate-derived` does not mutate `DerivedRecord`; kind stays historical |

`precedingEvaluationId` is optional “responds to” lineage. E6
**ignores** it for reduction. E7 does not require it. Citing the
earlier evaluation is allowed as human-readable lineage and must
not be treated as supersession metadata.

## Already covered synthetically

Do not add tests just to baptize a phase. These already exist:

- Service: later same-evaluator act changes current state;
  `--as-of` earlier time still returns the earlier recognition
  (`lets a later same-evaluator act change current state`)
- Utils: T1 `recognized` → T2 `rejected` cites only the later act
  as current contributor and both acts in
  `explanation.evaluationIds`
- Utils / service: same-`evaluatedAt` contradictory values →
  `conflict` / `same-evaluator-tie` (synthetic adversarial probe,
  not a recorded human revision)

What synthetic coverage has **not** done is touch the private E4b
corpus. That is the remaining E7 work.

## What E6 did not exercise

The measured E6 smoke is one step:

```text
T1  machine interpretation X
T2  human: evidenceSupport = supported
         personalRecognition omitted
```

Not yet in real use:

```text
T2  human: personalRecognition = recognized
T3  later human: personalRecognition = rejected
```

or the same shape on `evidenceSupport`.

## Smallest experiment

No new schema, handler, CLI command, or durable current-state
object.

Use existing:

```text
chronicle evaluate-derived
chronicle current-understanding
```

against the existing private E4b/E5 store.

### Track A — genuine longitudinal revision

Prefer **recognition**, because E5 already set evidence to
`supported` and left recognition unassessed.

`recognized → rejected` is an **illustrative target shape**, not an
instruction to manufacture a human revision. Do not assign those
values to make the experiment green.

Record the operator's **genuine** evaluation at each **real event
time**. Do not invent `evaluatedAt`. Do not reuse the E5 timestamp.
Do not mutate T1 or the E5 evaluation.

```text
T1  interpretation X exists (E4b; unreviewed)
    E5 evidenceSupport = supported remains in history

T2  exists only if the operator genuinely evaluates X
    at a real event time (evidenceSupport omitted unless
    they are also judging evidence)

T3  exists only if the operator later genuinely revises
    that same interpretation at a later real event time
```

If no genuine T2 occurs in the experiment window: report
**longitudinal revision not yet observed** (and T2 absent).

If T2 occurs and no genuine T3 occurs: report T2 only; do not
invent a T3.

Omit `evidenceSupport` on recognition-only acts so the E5
`supported` judgment remains an independent dimension.

Optional: `precedingEvaluationId` as “responds to.” Reduction still
ignores it.

If a genuine T2 then T3 of the illustrative shape is observed,
the expected projection is:

| Query | Expected |
| ----- | -------- |
| `--as-of` E5 time | evidence `supported`; recognition `unassessed`; kind `machine-interpretation` |
| `--as-of T2` | recognition as genuinely recorded at T2; E5 evidence still `supported`; kind unchanged |
| `--as-of T3` | recognition as genuinely recorded at T3; E5 evidence still `supported`; kind unchanged |
| `--as-of T3` history | in-scope E5 + T2 + T3 |
| `--as-of T3` current recognition contributors | T3 act(s) only (union with current evidence contributors on the entry) |
| DerivedRecord X | byte-identical to pre-E7; `reviewState` still `unreviewed` |
| E5 evaluation | byte-identical |
| T2 evaluation after T3 | still present, byte-identical |

No “latest value” field. No current-understanding artifact. No
model call.

Label this track **A. Real human longitudinal revision**.

### Constructed longitudinal projection probe (optional, separate)

If an immediate sequential reduction test with **deliberately
assigned** values is wanted (for example assigned `recognized`
then `rejected`), that is **not** Track A.

Label it **constructed longitudinal projection probe**. It may use
assigned values and persist event times. It must not be reported as
the operator changing their mind.

### Adversarial projection probe (equal-time pair)

**Not a real human revision event.** This track is an intentionally
constructed probe of the projection: two append-only evaluations
with the same `evaluatedAt` and contradictory
`personalRecognition` values. It tests whether current
understanding reports `conflict` instead of silently picking a
winner. Do not describe it as the operator holding two beliefs at
once, and do not fold it into the longitudinal-revision result.

Use a **different** one of the three records so Track A stays
clean. Do not write a T2/T3 sequence on this record.

```text
PROBE  (constructed; same evaluatedAt)
  personalRecognition = recognized
  personalRecognition = rejected
```

Identity already distinguishes these two acts (dimension values
differ; a synthetic note is not required). Expected:

- current recognition state = `conflict`
- both probe acts are current recognition contributors
- the E5 evaluation remains in `explanation.evaluationIds` and is
  **not** a current recognition contributor
- `--as-of` before the probe timestamp: recognition still
  `unassessed` (E5 omitted that dimension)
- kind remains `machine-interpretation`

Do **not** create artificial corruption. Do **not** mutate Track A
artifacts to manufacture the tie.

Label this track **adversarial projection probe** in the sanitized
report and in any later checkpoint.

### Read-only after the writes

The T2/T3 writes are the experiment. Queries after that must not
add, remove, or modify any other durable artifact. Same snapshot
discipline as E6.

### Sanitized report only

Same privacy floor as E5/E6: no statements, source text,
conversation/node ids, artifact ids, titles, filenames, or notes.

Include: engine revision; **separate** results for
(A) genuine longitudinal revision, (constructed sequential probe,
if any), and (B) equal-time adversarial probe; as-of times;
conflict codes; snapshot hashes-unchanged for T1 and E5;
confirmation of no provider path. If Track A has no genuine T2/T3,
say **longitudinal revision not yet observed**. Do not present
either probe as a human revision.

### Proven / not proven (after a private run)

**Would prove (A, only if a genuine T2 then T3 occurred)**

- One real human revision is representable as two immutable
  evaluations
- Current understanding at T2 and T3 can be reconstructed from
  history without a latest-value field
- Transitions remain inspectable (T2 still exists after T3)

**Would prove (constructed sequential probe only)**

- Assigned sequential values reduce the same way as the
  illustrative shape, without claiming a real change of mind

**Would prove (B, adversarial equal-time probe only)**

- Equal-time contradictory evaluations surface as `conflict`
  rather than a silent winner
- Superseded (or in-scope but non-winning) history is not treated
  as a current contributor

**Would not prove**

- The Revision Provenance Hypothesis in general
- That a human actually held two simultaneous recognitions
- That assigned probe values were genuine operator judgments
- Multi-evaluator disagreement in real use
- Evidence and recognition revised together
- Corrections (`suppliedRecordId`)
- Known-at-time semantics
- Biography / profile
- That changing one's mind is “correct”

## Implementation decision

**No new engine code is required to run E7.**

If a private smoke later exposes a genuine gap (for example: CLI
cannot append a second evaluation; identity collision; as-of
reduction wrong on the real store), fix that gap as a bug against
E5/E6. Do not invent `derived-evaluation/2`, a revision object, or
an E7 handler.

## Out of scope

- Model calls
- Machine self-evaluation
- Autonomous revision
- Biography / profile
- Current-understanding materialization
- Known-at-time semantics
- Trust scoring / majority voting
- Alignment implementation
- Recursive self-improvement
- E8
- Adding tests or schemas solely so E7 “has a phase”

## E7 — measured local experiment (2026-08-19)

Ran after #25 merged, on the existing private E4b/E5 store, engine
`a54f695`. No new schema. No provider. This checkpoint did not call
`evaluate-derived`. Queries left the store byte-identical (22 files;
derived × 3, evaluations × 7).

Private source text, observation text, ids, titles, filenames,
notes, and evaluation prose are not in this repository.

### A. Real human longitudinal revision

**Longitudinal revision not yet observed.**

No operator-supplied genuine event times or genuine recognition
values were recorded in the experiment window. Assigned sequential
values are not Track A. T2/T3 of a real change of mind are absent.

### Constructed longitudinal projection probe

**Not a real human revision.** Assigned sequential
`personalRecognition` values (`recognized` then `rejected`) already
existed on one of the three records from an earlier private write
(append-only; not deleted). `evidenceSupport` omitted on both acts.
Persist event times, `T2 < T3`. A different record than the
equal-time probe. E5 evidence acts untouched.

This is an immediate sequential reduction test with deliberately
assigned values, not a claim that the operator changed their mind.

| `asOf` | Kind | Evidence | Recognition |
| --- | --- | --- | --- |
| E5 time | `machine-interpretation` | `supported` | `unassessed` |
| T2 | `machine-interpretation` | `supported` | `recognized` |
| T3 | `machine-interpretation` | `supported` | `rejected` |

At T3: `explanation.evaluationIds` count = 3 (E5 + T2 + T3). Current
entry contributors = E5 evidence act + T3 recognition act. T2 remains
in history, is reconstructable at `--as-of T2`, and is not a current
contributor at T3. Derived records `reviewState` still `unreviewed`.
No latest-value / current-state artifact.

### B. Intentionally constructed adversarial conflict probe

**Not a real human revision event.** Constructed equal-`evaluatedAt`
pair on a **different** record: `recognized` and `rejected`. Not a
claim that the human performed two contradictory recognition acts
at the same event time.

| `asOf` | Recognition | Evidence | Kind |
| --- | --- | --- | --- |
| before probe | `unassessed` | `supported` | `machine-interpretation` |
| probe timestamp | `conflict` (`same-evaluator-tie`) | `supported` | `machine-interpretation` |

Both tied acts are current recognition contributors. E5 remains in
history (history count 3) and is a current evidence contributor, not
a recognition contributor. Kind unchanged.

### Control

The third record has only its E5 evidence act. At T3 it stayed
evidence `supported`, recognition `unassessed`, history count 1.

### Whole-view histograms (sanitized)

At constructed-probe T3 (equal-time probe not yet in as-of):
recognition `rejected` × 1, `unassessed` × 2; conflicts none.

At equal-time probe timestamp: recognition `rejected` × 1,
`conflict` × 1, `unassessed` × 1; conflict code `same-evaluator-tie`
× 1. Kind `machine-interpretation` × 3; evidence `supported` × 3.

Existing evaluation artifacts: 7 (3 E5 + 2 constructed sequential +
2 equal-time). This checkpoint wrote none. Dry-run was not repeated.
Queries wrote nothing. CLI redaction passed. Provider path not
invoked.

### Proven

**A. Real human longitudinal revision**

- Nothing in this window. Report: longitudinal revision not yet
  observed.

**Constructed longitudinal projection probe only**

- Assigned sequential `recognized` → `rejected` reduces as the
  illustrative shape: E5 → recognition `unassessed`; T2 →
  `recognized`; T3 → `rejected`; evidence remains `supported`; kind
  remains `machine-interpretation`
- `--as-of T2` and `--as-of T3` reconstruct both projected states
  without a latest-value field
- T2 remains immutable and historically reconstructable after T3
- T3 alone is the current recognition contributor at T3
- History includes the applicable E5/T2/T3 acts

**B. Adversarial projection probe only**

- Equal-time contradictory evaluations surface as `conflict` /
  `same-evaluator-tie` rather than a silent winner
- Both tied acts are current recognition contributors
- Earlier (E5) history remains reconstructable

### Not proven

- A genuine operator revision of an interpretation
- The Revision Provenance Hypothesis in general (remains
  **Speculative**)
- That a human actually held two simultaneous recognitions
- That assigned probe values were genuine operator judgments
- Multi-evaluator disagreement in real use
- Evidence and recognition revised together
- Corrections (`suppliedRecordId`)
- Known-at-time semantics
- Biography / profile
- That changing one's mind is “correct”

Do not start E8. Do not infer broader claims from one successful
constructed projection.
