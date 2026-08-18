# Design — Human evaluation of derived records (E5)

**Status:** Implemented append-only evaluation layer, not current understanding
**Date:** 2026-08-18

E4 published machine interpretation as unreviewed `DerivedRecord`s.
E5 records what a human later thought about a specific interpretation
without rewriting that record.

```text
SOURCE                 what existed
    ↓
INTERPRETATION         what someone made of it
    ↓
EVALUATION             what someone later thought about that interpretation
    ↓
CURRENT UNDERSTANDING  a future VIEW over those histories — not this phase
```

An evaluation is a historical act, not timeless truth.

## What is an evaluation?

A `DerivedEvaluation` cites one existing `DerivedRecord` and records
two independent dimensions:

| Dimension | Question | Values |
| --- | --- | --- |
| `evidenceSupport` | Do the cited source nodes support this interpretation as classified? | `supported` / `not-supported` / `uncertain` |
| `personalRecognition` | What is the evaluator's present relationship to the interpretation? | `recognized` / `rejected` / `uncertain` |

These are not equivalent. A Chronicle may honestly hold:

```text
evidenceSupport = supported
personalRecognition = rejected
```

“The source supports that this was the interpretation then” is not
“I recognize this as true of me now.”

`personalRecognition` is the evaluator's present relationship to the
interpretation, not an objective truth judgment. The three-value
vocabulary is provisional.

At least one dimension is required. `corrected` is not a dimension.

## Creation-time resolution

The evaluated `DerivedRecord` must resolve at write time. So must a
supplied correction record and a preceding evaluation, when cited.

```text
X missing now  → evaluated-record-missing → no artifact
Y missing now  → supplied-record-missing → no artifact
preceding missing now → preceding-evaluation-missing → no artifact
```

A later hole in a previously valid relationship is provenance
`partial` (`evaluated-record-missing`). That is historical loss, not
an input error Chronicle should have written anyway.

`--output` / the derived store is required. There is no mode that
creates dangling evaluations.

## Identity

`id` is SHA-256 of:

```text
schemaVersion, evaluatedRecordId, evaluator, evaluatedAt,
evidenceSupport?, personalRecognition?, noteRef?,
suppliedRecordId?, precedingEvaluationId?
```

`evaluatedAt` is the event time of the human act, not persist time.
It participates in identity: 2026 and 2028 do not collapse.

`recordedAt` is persist time and is **not** in the id.

The same payload with the same `evaluatedAt` is `already-present`.

## Append-only

The evaluated machine record stays `reviewState = unreviewed` as a
creation fact. Human evaluation is a new artifact. A later evaluation
does not erase an earlier one.

## Correction

```text
X = existing interpretation (unchanged)
Y = independently recorded human DerivedRecord
E = evaluation of X with suppliedRecordId = Y
```

Record Y first, then evaluate X. E5 does not add `priorRecordIds` or
bump `derived-record/1`.

## Provenance

| Addition | Meaning |
| --- | --- |
| node `evaluation` | evaluation id |
| edge `evaluates` | evaluation → evaluated derived |
| edge `cites` | evaluation → supplied derived (correction only) |

Disposition stays on the artifact. There are no `recognizes` /
`rejects` / `corrects` / `supersedes` edges.

Stored `evaluates` points evaluation → derived. Forward still walks
`source → execution → derived → evaluation`. Backward walks
evaluation → derived → execution → definition / source.

## Privacy

Public engine: schema, machinery, synthetic fixtures.
Personal store: real evaluation artifacts and optional notes.
Default stdout prints ids, timestamps, and dimension enums — not
`note`. No provider call.

## CLI

```
chronicle evaluate-derived \
  --derived <id> \
  --evaluator-name <name> \
  [--evidence-support supported|not-supported|uncertain] \
  [--personal-recognition recognized|rejected|uncertain] \
  [--note <text>] \
  [--supplied-record <id>] \
  [--preceding-evaluation <id>] \
  [--evaluated-at <iso>] \
  --evaluations <dir> \
  --output <derived-dir> \
  [--dry-run]
```

Human only. `--evaluator-type` other than `human` is rejected.

Exit 0: `recorded` | `already-present` | `dry-run`.

Env: `CHRONICLE_EVALUATION_DIR`, `CHRONICLE_DERIVED_DIR`.

## Out of scope

- Current-understanding view / biography / profile
- Conflict resolution, voting, trust scores
- `priorRecordIds` / `derived-record/2`
- Machine-as-reviewer
- Activity / Daily Chronicle / promotion
- Provider / model invocation
- Wayfinder / UI
