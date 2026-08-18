# Design — Transformation registry and execution provenance

**Status:** Proposed process layer above derived records, not Activity
**Date:** 2026-08-17

PR #9 persisted source graphs. PR #11 persisted derived records as
immutable transformation *events*. This phase makes the **process** that
created those events first-class, inspectable, and comparable.

```text
Source Artifact
        ↓
Source Graph
        ↓
Transformation Execution   (this phase — the process run)
        ↓
Derived Record             (the resulting interpretation event)
        ↓
Human review
        ↓
Chronicle representation   (later)
        ↓
Intentional promotion      (never automatic)
```

The goal is not automatic summarization. It is to answer:

- "What transformation created this derived record?"
- "If we ran this transformation again, what would be different?"

## Ownership — do not duplicate DerivedRecord

| Record | Owns |
| --- | --- |
| **Transformation** (registry entry) | Named recipe: type, recipe version, deterministic flag, allowed producers |
| **TransformationExecution** | One run of a recipe: when, configuration, source refs, producer, output handles |
| **DerivedRecord** | The interpretation event: content, content hash, review state, confidence |

`DerivedRecord.transformationVersion` remains the **record schema**
(`derived-record/1`) and stays in the derived-record id. Recipe version
(`1`, `2`, …) lives on the registry entry and the execution. That is a
different axis: changing how an id is computed is not the same as
changing the named process.

`DerivedRecord` already answers "why does this content exist?" via
`sourceRefs`. The execution answers "what process produced it, with
what configuration?" `executionId` on a derived record is a **link**,
not part of the derived id. The same human note recorded without an
execution keeps the same derived id.

`record-derived` still persists a derived record only.
`transform-record` runs a named transformation and writes both records.

## 1. What is a Transformation?

A transformation is a **named, versioned recipe** in the engine
registry. It is not the output and not a single run.

| Field | Meaning |
| --- | --- |
| `type` | Recipe name (`human-note`, `reflection`, …) |
| `version` | Recipe version (`1`). Independent of `derived-record/1` |
| `deterministic` | Same inputs + configuration + output content → same execution id |
| `allowedProducerTypes` | `human` and/or `agent` |
| inputs | Source-graph refs the caller declares |
| outputs | One or more derived records |
| producer | Who ran it (on the execution, not the recipe) |
| execution timestamp | On the execution; not in the execution id |
| configuration | Opaque JSON object on the execution (empty `{}` by default) |

This phase registers the existing derived types at recipe version `1`,
all **deterministic**, because content is still caller-supplied. A later
nondeterministic AI recipe (model + prompt + sampling) is the same
shape with `deterministic: false`. It is not registered here and does
not generate content.

## 2. Transformation identity

Recipe identity is `(type, version)` in the registry.

Execution identity is the SHA-256 of:

```text
{ transformationType, transformationVersion, sourceRefs,
  producer, configuration, outputContentRefs }
```

`createdAt` is not in the id. Re-running the same deterministic
transformation with the same outputs is the same execution
(`already-present`; first `createdAt` kept). Changing content,
producer, refs, recipe version, or configuration is a new execution.

Human example: `human-note` / `1` / producer name / empty config.
Agent example (content still supplied): same recipe, `producer.type:
agent` plus `model` (and optional `promptVersion`). An `llm-reflection`
recipe is future work — this phase does not invent or run one.

## 3. TransformationExecution

```ts
interface TransformationExecution {
  id: string;
  transformationType: DerivedTransformationType;
  transformationVersion: string; // recipe version, e.g. '1'
  sourceRefs: DerivedSourceRef[];
  producer: DerivedProducer;
  createdAt: string;
  configuration: Record<string, unknown>;
  deterministic: boolean;
  outputRefs: string[];        // derived-record ids
  outputContentRefs: string[]; // content hashes (compare without bodies)
}
```

One execution may list multiple `outputRefs` when a single invocation
emits more than one derived record. The CLI emits one. Executions are
append-only: a later invocation never mutates an existing execution to
attach more outputs.

The engine writes `<executionsDir>/<id>.json`. The caller supplies
`--executions` or `CHRONICLE_EXECUTION_DIR`. No personal Chronicle
layout is encoded.

## 4. Provenance chain

```text
Source Archive → Source Graph → Transformation Execution → Derived Record
```

Backward ("what created this?"): derived `executionId`, or a scan of
executions whose `outputRefs` contain the derived id, then
`sourceRefs`.

Forward ("what was created from this?"): executions whose
`sourceRefs` cite the archive hash, then their `outputRefs`.

Compare ("what would be different?"): field-level difference between
two executions (type, recipe version, refs, producer, configuration,
output content hashes). `createdAt` is not a difference that matters
for identity.

## CLI

```
chronicle transform-record --type human-note --version 1 \
  --source-graph-hash <hex> --output <dir> --executions <dir> \
  --producer-type human --producer-name <name> --content <text>

chronicle transformation-provenance --derived <id> \
  --output <dir> --executions <dir>

chronicle transformation-provenance --source-graph-hash <hex> \
  --executions <dir>

chronicle transformation-provenance --compare <id> --with <id> \
  --executions <dir>
```

`--source-ref` is an alias for `--source-graph-hash`. Does not emit
Activity, does not write a Daily Chronicle, does not promote, does not
summarize.

## Out of scope

- Automatic AI summarization or reflection extraction
- Embeddings, semantic search, vector stores, agent memory
- `ActivitySource` membership / Daily Chronicle synthesis
- Organizational promotion
- Nondeterministic registered AI recipes
