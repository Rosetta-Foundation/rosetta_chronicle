# Design — Longitudinal revision experiment (E7)

**Status:** Procedure measured locally (2026-08-19). Not a new engine layer.
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

### Primary shape (one dimension)

Prefer **recognition**, because E5 already set evidence to
`supported` and left recognition unassessed. Revising recognition
does not require retracting the E5 evidence acts.

Pick **one** of the three existing machine interpretations. Do not
revise all three unless the first case is green.

```text
T1  interpretation X exists (E4b; unreviewed)
    E5 evidenceSupport = supported remains in history

T2  new DerivedEvaluation (same evaluator, later evaluatedAt):
    personalRecognition = recognized
    (evidenceSupport omitted)

T3  another DerivedEvaluation (still later evaluatedAt):
    personalRecognition = rejected
    (evidenceSupport omitted)
```

Use real event times of the human judgments. Do not invent
`evaluatedAt`. Do not reuse the E5 timestamp. Do not mutate T1 or
the E5 evaluation.

Optional: set `precedingEvaluationId` from T3 → T2 (or T2 → E5)
as “responds to.” Reduction must still ignore it.

### Required observations (sanitized)

Snapshot derived and evaluation stores before T2, after T2, after
T3.

| Query | Expected |
| ----- | -------- |
| `--as-of` E5 time | evidence `supported`; recognition `unassessed`; kind `machine-interpretation` |
| `--as-of T2` | recognition `recognized`; E5 evidence still `supported`; kind unchanged |
| `--as-of T3` | recognition `rejected`; E5 evidence still `supported`; kind unchanged |
| `--as-of T3` history | `explanation.evaluationIds` includes E5 + T2 + T3 (in-scope acts for that record/perspective) |
| `--as-of T3` current recognition contributors | T3 only |
| `--as-of T2` current recognition contributors | T2 only |
| DerivedRecord X | byte-identical to pre-E7; `reviewState` still `unreviewed` |
| E5 evaluation | byte-identical |
| T2 evaluation after T3 | still present, byte-identical |

No “latest value” written anywhere. No current-understanding
artifact. No model call.

Label this track **longitudinal revision** in the sanitized report
and in any later checkpoint. It is the E7 revision-provenance
experiment.

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

Include: engine revision; **separate** histograms and
contributor/history splits for (1) longitudinal revision and
(2) adversarial projection probe; as-of times; conflict codes;
snapshot hashes-unchanged for T1 and E5; confirmation of no
provider path. Do not present the probe as a human revision.

### Proven / not proven (after a green private run)

**Would prove (longitudinal revision)**

- One experimental human revision is representable as two immutable
  evaluations
- Current understanding at T2 and T3 can be reconstructed from
  history without a latest-value field
- Transitions remain inspectable (T2 still exists after T3)

**Would prove (adversarial projection probe only)**

- Equal-time contradictory evaluations surface as `conflict`
  rather than a silent winner
- Superseded (or in-scope but non-winning) history is not treated
  as a current contributor

**Would not prove**

- The Revision Provenance Hypothesis in general
- That a human actually held two simultaneous recognitions
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
`a54f695`. No new schema. No provider. Two tracks, labeled separately.

Private source text, observation text, ids, titles, filenames, and
notes are not in this repository.

### Track A — longitudinal revision

One of the three machine interpretations. Two new append-only
evaluations by `operator` on `personalRecognition` only, at persist
event time (`T2 < T3`; not backdated). E5 evidence acts untouched.

| `asOf` | Kind | Evidence | Recognition |
| --- | --- | --- | --- |
| E5 time | `machine-interpretation` | `supported` | `unassessed` |
| T2 | `machine-interpretation` | `supported` | `recognized` |
| T3 | `machine-interpretation` | `supported` | `rejected` |

At T3: `explanation.evaluationIds` count = 3 (E5 + T2 + T3). Current
entry contributors = E5 evidence act + T3 recognition act. T2 remains
in history and is not a current contributor. Derived record
byte-identical, `reviewState` still `unreviewed`. E5 evaluation files
byte-identical.

### Track B — adversarial projection probe

**Not a real human revision event.** Constructed equal-`evaluatedAt`
pair on a **different** record: `recognized` and `rejected`.

| `asOf` | Recognition | Evidence | Kind |
| --- | --- | --- | --- |
| before probe | `unassessed` | `supported` | `machine-interpretation` |
| probe timestamp | `conflict` (`same-evaluator-tie`) | `supported` | `machine-interpretation` |

Both probe acts are current recognition contributors. E5 remains in
history and is not the sole current contributor.

### Control

The third record was not given T2/T3 or a probe. At T3 it stayed
evidence `supported`, recognition `unassessed`, history count 1.

### Whole-view histograms (sanitized)

At T3 (Track A visible, probe not yet in as-of): recognition
`rejected` × 1, `unassessed` × 2; conflicts none.

At probe time: recognition `rejected` × 1, `conflict` × 1,
`unassessed` × 1; conflict code `same-evaluator-tie` × 1.

New evaluation artifacts: 4 (T2, T3, probe recognized, probe
rejected). Dry-run wrote nothing. Queries wrote nothing. CLI
redaction passed. Kind `machine-interpretation` × 3 throughout.

### Proven

**Longitudinal revision**

- One experimental human revision is representable as two immutable
  evaluations
- `--as-of T2` and `--as-of T3` reconstruct both states without a
  latest-value field
- T2 still exists after T3

**Adversarial projection probe only**

- Equal-time contradictory evaluations surface as `conflict`
- Non-winning history is not treated as a current recognition
  contributor

### Not proven

- The Revision Provenance Hypothesis in general
- That a human actually held two simultaneous recognitions
- Multi-evaluator disagreement in real use
- Evidence and recognition revised together
- Corrections (`suppliedRecordId`)
- Known-at-time semantics
- Biography / profile
- That changing one's mind is “correct”

Do not start E8.
