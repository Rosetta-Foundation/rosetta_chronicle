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

An evaluation is a historical act, not timeless truth. A later
judgment does not make the earlier interpretation “wrong history.”
See `docs/design/temporal-evaluation-rationale.md`.

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

`evaluatedAt` is the event time of the human judgment. It
participates in identity: 2026 and 2028 do not collapse. That is
what lets a later mind ask what was understood at T1 without
rewriting T1 when T2 arrives
(`docs/design/temporal-evaluation-rationale.md`).

`recordedAt` is when Chronicle persisted that judgment. It is
**not** in the id and must not be rewritten once the artifact exists.

Those clocks are independent. A contemporaneous CLI write may default
both to the same `now`; that equality is not a schema invariant.
Reconstructed evaluations may have `evaluatedAt` earlier than
`recordedAt`.

The same payload with the same `evaluatedAt` is `already-present`.
The store never overwrites an existing file. Identical content is a
no-op; different content under the same id is an integrity failure.
A malformed existing file is not repaired by overwrite.

On read/diagnose the store requires **schema validity and**
content-addressed identity. A self-consistent file with an illegal
enum, timestamp, or reference is invalid even if its id hashes to
itself. Unknown top-level fields are invalid — the persisted object
must conform to the `derived-evaluation/1` key allowlist. If `note`
is present, `noteRef` must be present and `sha256(note)` must equal
`noteRef`.

`precedingEvaluationId` cites an earlier evaluation *act*. It is a
general "responds to" relationship, not "previous evaluation of the
same DerivedRecord." The cited act may evaluate a different record.

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
| edge `cites` | evaluation → supplied derived, or preceding evaluation |

Disposition stays on the artifact. There are no `recognizes` /
`rejects` / `corrects` / `supersedes` edges.

Stored `evaluates` points evaluation → derived. Forward still walks
`source → execution → derived → evaluation`. Backward walks
evaluation → derived → execution → definition / source.

A later evaluation that cites a preceding evaluation walks:

```text
backward: later evaluation → preceding evaluation → its interpretation
forward:  preceding evaluation → later evaluation
```

If that preceding evaluation later disappears, the walk is `partial`
with `preceding-evaluation-missing`.

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

## E5 — measured local experiment (2026-08-18)

E5 asked whether a later human judgment can be recorded as an
append-only Chronicle artifact against pre-existing machine
interpretations — without mutating those records, invoking a model,
or collapsing evidence support with personal recognition.

It is an experiment, not a product feature and not a
current-understanding claim.

The private smoke used the three committed E4b machine
`candidate-observation` records. Private source text, observation
text, ids, conversation titles, filenames, and evaluation prose are
not in this repository.

### Sanitized result

| Field | Measured |
| --- | --- |
| Engine revision | `a4bc74b` (#20) |
| Pre-existing machine interpretations | 3 (E4b committed `candidate-observation`) |
| Human evaluation acts | 3 |
| `evidenceSupport` | `supported` × 3 |
| `personalRecognition` | omitted |
| Human `evaluatedAt` | review event time (`2026-08-18T21:18:00.000Z`), not machine `createdAt` and not persist-time `now` |
| Dry-run durable artifacts | none |
| Persistence | exactly 3 evaluation artifacts |
| Machine records after persist | byte-identical, `reviewState` still `unreviewed` |
| Backward provenance | `ok` × 3 |
| Forward provenance | `ok` × 4 |
| Provider / model invocation | none |
| Activity / Daily Chronicle / promotion | none |
| Public private-data write | none |

Dry-run resolved all three machine records and wrote nothing.
Persist then wrote one evaluation per machine record. Each evaluation
set `evidenceSupport = supported` and omitted `personalRecognition`.
No note, supplied correction, or preceding evaluation was recorded.

Backward walks from each evaluation were `ok`:
`evaluation → interpretation → execution → definition / source`.
Forward walks from each of the four selected source nodes were `ok`:
`source → execution → interpretations → evaluations`.
Each forward walk saw the three machine interpretations and the three
evaluations.

### Proven

- Human evaluation can be recorded append-only without mutating the
  machine interpretation
- Evidence support and personal recognition remain independent. The
  smoke exercised evidence support only
- Evaluation participates bidirectionally in provenance
- A later mind can distinguish source, machine interpretation, and
  subsequent human evaluation as separate historical artifacts
- The human evaluation layer requires no new model invocation

### Not proven

- Current understanding
- Personal recognition semantics in real use
- Correction semantics in private use
- Disagreement between evaluators
- Competing machine interpretations (local adapter is backlog;
  `docs/design/local-model-adapter.md`)
- Longitudinal evaluation
- Biography / profile generation
- Automatic selection of durable memory
- Model reliability

Three append-only evaluations of one committed interpretation set are
not a claim about current understanding or about how a person
recognizes themselves over time.

## Out of scope

- Current-understanding view / biography / profile
- Conflict resolution, voting, trust scores
- `priorRecordIds` / `derived-record/2`
- Machine-as-reviewer
- Activity / Daily Chronicle / promotion
- Provider / model invocation
- Wayfinder / UI
