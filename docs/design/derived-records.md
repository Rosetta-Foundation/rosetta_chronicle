# Design — Derived records (PRD-0027 next phase)

**Status:** Proposed transformation layer, not Activity
**Date:** 2026-08-17

Phase 1 inventories a ChatGPT export. Phase 2 persists a normalized
**source graph**. This phase adds the machinery that creates **derived
records** from that graph without collapsing it into `Activity`.

```text
Source Artifact          (export bytes — still outside this engine)
        ↓
Source Graph             (Phase 2 — structure, not meaning)
        ↓
Derived Record           (this phase — inspectable transformation)
        ↓
Human review
        ↓
Chronicle representation (later — Activity / reflection / path)
        ↓
Intentional promotion    (never automatic)
```

The goal is not "summarize ChatGPT conversations." It is a trustworthy
transformation layer between source structure and human meaning.

## Architecture review (after PR #9)

| Piece | State |
| --- | --- |
| `ChatGptSourceGraph` (ids, topology, clocks, roles/types, attachment presence) | **Stable** |
| Caller-chosen persist dir (`--output` / `CHRONICLE_SOURCE_GRAPH_DIR`) | **Stable** |
| `Activity` / `Evidence` as a day's observed engineering event | **Stable** — do not widen `ActivitySource` here |
| ADR-0002: one engine, separate personal/org repos; no automatic promotion | **Stable** |
| Source-vault / encryption for archive bytes | **Provisional** — out of scope |
| PRD-0027 `ReflectiveRecord` / `ReflectionEvaluation` / `PathLink` | **Provisional** — Phase 3–4 |
| Projecting ChatGPT into `personal`-domain Activity | **Provisional** — not this phase |

**New abstraction:** `DerivedRecord`. It is not a source graph, not
`Activity`, and not yet a full reflective/evaluation loop. It is the
inspectable transformation that those later records can cite.

## 1. What is a derived record?

A derived record is a **transformation created from source material**. It
answers "what did someone (or a later agent) make of this path?" without
replacing the path.

Examples of *kind* (not all implemented as generators): summary,
reflection, insight, decision, activity candidate, human note.

This phase implements the **record**, not automatic generation. Content
is human-created. AI output, when it arrives, is the same shape: a
transformation with identity, timestamp, source refs, and review state —
not truth.

## Identity — immutable transformation event

`DerivedRecord.id` identifies an **immutable transformation event**, not
a persistent conceptual artifact.

| | Immutable transformation event (this phase) | Persistent conceptual artifact (not this phase) |
| --- | --- | --- |
| The id means | This producer made this content from these refs, as this type/version | "The reflection about conversation X" that can be updated |
| Same payload again | Same event (`already-present`; first `createdAt` kept) | Would be a write to the same artifact |
| Content or producer changes | A **new** event with a new id | Same id, mutated body |
| Current meaning | A later view over a sequence of events | The latest row for that id |

The id is the SHA-256 of `{ sourceRefs, transformationType,
transformationVersion, createdBy, contentRef }`. `createdAt` is not in
the id: repeating the same transformation is the same event, not a
second one. Changing content, producer, refs, type, or version is a
different event.

A living concept — "my current reading of this conversation," "the
decision we are working with" — is **not** the derived record. Those
are later materialized views over an append-only sequence of events
(and, in Phase 3–4, evaluations and path links). This phase does not
give a derived record a stable conceptual identity that survives edits.

`reviewState` on the event is a seed, not a license to mutate the
event's meaning in place.

## 2. How is it different from source data?

| | Source graph | Derived record |
| --- | --- | --- |
| Answers | What was the structure? | What was made of it? |
| Identity | Archive content hash | Immutable transformation-event id (refs + type + version + producer + content) |
| Content | No message text / titles | Optional human (or later AI) body via `contentRef` |
| Mutability | Idempotent re-import keeps first `importedAt` | Append-only events; edits are new records, not updates |
| Completeness | Missing attachments stay as refs | Cannot exist without `sourceRefs` |

The graph is not an archive backup. The derived record is not a graph
backup. Losing the export still loses source text; losing the graph
still loses topology the derivation pointed at.

## 3. How is it different from Activity?

`Activity` is a day's observed event: one `id`, one `timestamp`, one
`summary`, optional `evidence`. That is a Chronicle *representation* —
a destination.

A derived record keeps:

- graph-level provenance (hash, conversation, nodes)
- transformation type and version
- producer identity (human vs agent, model, prompt version)
- confidence and review state
- content as a hashed ref, not a flattened daily summary

Shortcut `source node → Activity` would drop branches, uncertainty,
context, and transformation history. `chatgpt-export` stays off
`ActivitySource` until a later phase actually emits Activity.

## 4. How is provenance preserved?

Every derived record must answer **"Why does this exist?"**

```ts
sourceRefs: [{
  sourceGraphHash: string;   // archive content hash
  conversationId?: string;
  nodeIds: string[];
}]
```

Optional `--graph <file>` checks that those ids exist on a loaded
source graph. The engine does not require the graph file to persist
the record — the graph may live in another caller-chosen directory.

Provenance is structural. It is not inferred from timestamps or
directory proximity.

## 5. How are transformations versioned?

`transformationVersion` is a string on the record (`derived-record/1`
for this phase). Changing the id algorithm or required fields bumps
the version. The version is part of the stable id input so two
versions of the same human note are distinct records, not overwrites.

Later AI transformations add `createdBy.model` and
`createdBy.promptVersion` under the same versioning rule.

## 6. How are human edits represented?

Edits are **new derived records**, not in-place rewrites.

- Correcting a note creates another record (e.g. `transformationType:
  revision`) that cites the same source refs (and, later, the prior
  derived id).
- `reviewState` on a record is the current evaluation seed
  (`unreviewed` / `recognized` / `rejected` / `corrected` /
  `uncertain`). Replacing it in a later phase becomes an append-only
  `ReflectionEvaluation` (PRD-0027 Phase 3). This phase does not
  rewrite history to change meaning.

Human-authored content defaults to `recognized`. Agent-authored
content defaults to `unreviewed` and requires a model identity.

## 7. How does privacy boundary enforcement work?

| Context | May contain |
| --- | --- |
| Public engine | Machinery, schemas, algorithms, synthetic fixtures, tests |
| Personal Chronicle | Personal source graphs, derived content, lived notes |
| Organizational Chronicle | Intentionally promoted shared knowledge only |

The engine writes `<outputDir>/<id>.json`. It does not encode a
personal Chronicle layout. Callers pass `--output` (or
`CHRONICLE_DERIVED_DIR`).

Public tests use synthetic content only. Derived bodies in fixtures
must not be personal corpus. No automatic personal → organizational
flow.

## Schema

```ts
interface DerivedRecord {
  id: string;                          // immutable event id (not a conceptual artifact)
  sourceRefs: DerivedSourceRef[];
  transformationType: DerivedTransformationType;
  transformationVersion: string;       // 'derived-record/1'
  createdAt: string;
  createdBy: DerivedProducer;
  contentRef: string;                  // sha256 of content
  content?: string;                    // optional body (private store)
  confidence?: number;                 // 0..1
  reviewState: DerivedReviewState;
}
```

Persisted at `<outputDir>/<id>.json`. Re-record of the same stable
fields is `already-present` and keeps the first `createdAt`.

## CLI

```
chronicle record-derived --output <dir> \
  --source-graph-hash <hex> \
  --type human-note \
  --producer-type human --producer-name <name> \
  --content <text>
```

Does not emit Activity, does not write a Daily Chronicle, does not
promote.

## Out of scope

- Automatic summarization or reflection extraction
- `ActivitySource` membership / Daily Chronicle synthesis
- Organizational promotion
- Full `ReflectiveRecord` / `PathLink` model
- Source-vault policy
