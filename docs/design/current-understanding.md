# Design — Current understanding (E6)

**Status:** Implemented read-only computed view. Not a memory object.
**Date:** 2026-08-18

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

## Out of scope

- Biography / profile / free-form summary
- Materialized current-understanding artifact
- Known-at-T as-of
- Inferred competition edges
- Trust scoring / majority
- Model-written current understanding
- Activity / Daily Chronicle / promotion
- Wayfinder / UI
- E7
