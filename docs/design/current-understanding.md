# Design — Current understanding (E6)

**Status:** Implemented read-only computed view. Not a memory object.
**Date:** 2026-08-18
**Measured:** private E6 smoke, 2026-08-19 (`05ef7ba`)

Current understanding is a present-tense **projection** over
immutable interpretation and evaluation history.

```text
SOURCE                 what existed
    ↓
INTERPRETATION         what someone made of it
    ↓
EVALUATION             what someone later thought about that interpretation
    ↓
CURRENT UNDERSTANDING  effective view over that history
                       (recomputable; not a fourth historical event)
```

History is immutable. Views are recomputable.

Chronicle is an **epistemic temporal system**: historical acts
accrue; the present is computed; the past is not rewritten to look
cleaner.

See `docs/design/temporal-evaluation-rationale.md` for why a later
judgment does not overwrite an earlier understanding.

## What it answers

For a named perspective and an as-of event time: the reduced
`evidenceSupport` and `personalRecognition` of each
`DerivedRecord`, independently, plus unresolved and conflict
surfaces.

It does not answer what is true, what Chronicle believes, or who
someone is.

`--as-of T` means: **what the history we possess now implies about
event-time T.** It does not mean what Chronicle knew at T. A
reconstructed older `evaluatedAt` appears even if `recordedAt` is
later. A future known-at-T query would be a separate policy.

## Locked semantics

- Computed only. No durable current-understanding artifact.
- No model / provider call. No Activity / Daily Chronicle / promotion.
- Perspective required: `--evaluator-name` or `--perspective all`.
  `all` is every evaluator **represented in available evaluation
  history**, not all humans who exist.
- Event-time reduction: `evaluatedAt <= asOf`. `recordedAt` ignored.
- Same-evaluator latest event time supersedes that evaluator's
  earlier value on that dimension. Not global latest-wins.
- `precedingEvaluationId` ignored for reduction.
- `reviewState` ignored.
- Correction (`suppliedRecordId`) is a candidate successor, not
  promotion.
- No inferred competition from shared source refs.
- Interpretation **kind** is historical and stable:
  `machine-interpretation` | `human-interpretation` |
  `insufficient-evidence` | `unclassified`. Recognition cannot
  change kind.
- Insufficient-evidence is a declined attempt, not a negative fact.
- `all` keeps per-evaluator reduced state. Top-level `conflict` is
  a summary, not a winner. No voting.
- `ok` only when both store inventories are structurally clean.
- Service does not read directories. It uses `listResolved`.
- Core view keeps exact `sourceRefs`. Default CLI redacts
  conversation/node ids and prose.
- `explanation.evaluationIds` is all in-scope historical evaluations
  of that record/perspective. Dimension `contributingEvaluationIds`
  are only the act(s) at the winning/latest `evaluatedAt`. Entry
  contributors are the union of current evidence and current
  recognition contributors. A same-evaluator tie cites only the
  equal-time acts that produce the tie. Cross-evaluator
  disagreement cites the current contributors to that dimension,
  not superseded history.

Policy: `current-understanding` version `1`.

## Integrity

`list()` on derived and evaluation stores returns only files that
parse. An unreferenced corrupt sibling is invisible to `list()`.

E6 uses `listResolved`, which returns `{ present, records, failures }`.
Any inventory failure, missing cite, or unclassified
`candidate-observation` body yields `partial`. Missing directories
are `not-found`. Bad args are `invalid`.

## CLI

```
chronicle current-understanding \
  --output <derived-dir> \
  --evaluations <evaluation-dir> \
  (--evaluator-name <name> | --perspective all) \
  [--as-of <iso>]
```

Exit 0: `ok` | `partial`. Exit 1: `invalid` | `not-found`.

## Architecture

```
CurrentUnderstandingHandler
  → CurrentUnderstandingService
      → DerivedRecordStore.listResolved
      → EvaluationStore.listResolved
      → current-understanding.utils.ts
```

No new repository class. No service-to-service calls.

## E6 — measured local experiment (2026-08-19)

E6 asked whether the real E5 history projects through a read-only
current-understanding view without mutation, without collapsing
evidence support into personal recognition, and without implying
current personal belief.

It is a measurement of the existing view, not a product claim and
not a biography.

The private smoke used the three E4b machine `candidate-observation`
records and the three E5 human evaluations (`evidenceSupport =
supported`, `personalRecognition` omitted). Private source text,
observation text, ids, conversation titles, filenames, and
evaluation prose are not in this repository.

No provider or model invocation. No writes.

### Sanitized result

| Field | Measured |
| --- | --- |
| Engine revision | `05ef7ba` (#23) |
| Perspective | named `operator` |
| Primary `asOf` | E5 event time (`2026-08-18T21:18:00.000Z`) |
| Policy | `current-understanding` version `1` |
| `asOfSemantics` | `effective-event-time` |
| Status | `ok` |
| Entries | 3 |
| Kind | `machine-interpretation` × 3 |
| Evidence | `supported` × 3 |
| Recognition | `unassessed` × 3 |
| Conflicts | none |
| Unresolved | `recognition-unassessed` × 3 |
| Contributor / history split | current evidence contributor = the single in-scope E5 act; history count = 1 × 3 |
| Internal exact provenance | present (conversation + node refs + hash × 3) |
| CLI redaction | conversation/node ids and prose absent; source refs hash-only |
| Derived / evaluation / live snapshots | unchanged (0 added, 0 removed, 0 modified) |
| Activity / Daily Chronicle / promotion / materialized view | none |
| Provider / model invocation | none |

`--perspective all` with only the existing operator evaluations
agreed with the named perspective and kept `perspectiveStates`
(length 1 × 3) rather than flattening them.

Temporal comparison on the same stores, still with no mutation:

```text
asOf immediately before E5
  3 machine-interpretation
  evidence = unassessed × 3
  recognition = unassessed × 3

asOf at E5 event time
  same 3 machine-interpretation
  evidence = supported × 3
  recognition = unassessed × 3
```

The view changed. The history did not.

`recognition-unassessed` is the omitted E5 recognition dimension,
not a conflict and not a belief. The smoke must not be read as:

```text
the user believes these three things
these are accepted truths
these are current personal beliefs
```

The correct reading:

```text
three machine interpretations
whose cited evidence was later judged supported
by the named human perspective,
with personal recognition never assessed
```

### Proven

- Real E5 history projects through E6 without mutation
- Human evidence support does not become personal recognition
- Machine provenance kind remains `machine-interpretation` after
  human evaluation
- Current state changes correctly across event-time `asOf`
- The computed view is read-only
- Privacy-safe CLI rendering preserves the internal/external
  boundary

### Not proven

- Personal recognition in real use
- Corrections in real use
- Evaluator disagreement in real use
- Competing machine interpretations
- Successor forks
- Longitudinal multi-revision history
- Known-at-time semantics
- Biography / profile generation
- Alignment hypotheses
- Model reliability

A one-step evidence-support evaluation of three committed
interpretations is not a claim that Chronicle has represented a
human changing their mind.

Longitudinal revision was measured as E7 on this same view. The
equal-time conflict case in that experiment is an adversarial
projection probe, not a real human revision event. See
`docs/design/revision-experiment.md`.

## Out of scope

- Biography / profile / free-form summary
- Materialized current-understanding artifact
- Known-at-time as-of
- Inferred competition edges
- Trust scoring / majority
- Model-written current understanding
- Activity / Daily Chronicle / promotion
- Wayfinder / UI
- A new E7 schema or handler (not required; see
  `docs/design/revision-experiment.md`)
