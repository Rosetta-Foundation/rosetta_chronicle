# Design — Machine interpretation (E4a)

**Status:** Implemented for `candidate-observation` only; not Activity
**Date:** 2026-08-18

E4a is a narrow, attributable path that extracts 1–3 candidate
observations from explicitly cited ChatGPT source nodes. It does not
summarize a conversation, emit Activity, write a Daily Chronicle,
promote, scan in bulk, or vendor a provider SDK.

## Foundational invariant

> **The model returning an answer is not when that answer becomes memory.
> It becomes memory when Chronicle publishes it into the durable derived
> store under an already-durable execution path.**

> **A durable DerivedRecord is accepted Chronicle memory.**

For machine interpretation, therefore:

> **Do not publish a DerivedRecord until the corresponding
> TransformationExecution is already durable.**

That is not write-order trivia. The provenance walker treats any
durable derived file as legitimate lineage, including a `cites` edge
from derived → source **with no execution**. Direct human
`record-derived` is supposed to work that way. A half-written machine
derived file would look like a human note on a forward walk
(`status: ok`). Publishing the execution first is what keeps a
machine-derived record from masquerading as an intentionally direct
human artifact.

```text
definition
→ execution
→ derived record(s)
→ occurrence
```

## Two lineage shapes (do not collapse them)

```text
direct human derived
source → derived

machine interpretation
source → execution → derived
```

`record-derived` and `transform-record` remain the caller-supplied
paths. They reject `candidate-observation`. Direct lineage is not
weakened to make machine persistence easier. Occurrences are not
provenance-graph nodes.

## What owns what

| Piece | Owns |
| --- | --- |
| **InterpretationPolicy** | What claims are allowed. Optional structured fields **on** the recipe / definition. Hashed into definition identity. |
| **TransformationDefinition** | Durable recipe containing that policy |
| **Execution configuration** | How this invoke talks to the model (provider, temperature, template id/hash, schema id) |
| **Expanded prompt** | Ephemeral. Never persisted. Interpolates resolved source nodes in memory. |
| **TransformationExecution** | The run that produced the derived ids |
| **DerivedRecord** | One observation (or one insufficient-evidence result) |
| **ExecutionOccurrence** | One physical provider invocation and whether Chronicle accepted the output as memory |

Changing policy changes definition identity. Existing recipes without
`policy` keep stable ids.

## Payload

One `DerivedRecord` per observation. Discriminated union, not an array
inside the record:

```ts
type CandidateObservationPayload =
  | {
      schemaVersion: 'candidate-observation/1';
      result: 'observation';
      statement: string;
      epistemicClass: 'directly-supported' | 'inferred';
      citedNodeIds: string[];
      supportNote?: string;
    }
  | {
      schemaVersion: 'candidate-observation/1';
      result: 'insufficient-evidence';
      citedNodeIds: string[];
      supportNote?: string;
    };
```

One execution → 1–3 observation records **or** exactly one
insufficient-evidence record. `citedNodeIds` are sorted before the
payload is hashed; citation order is not semantic.

`directly-supported` is a **machine classification of support**, not
source truth. Only the cited nodes are source.

Machine output always starts `unreviewed`. There is no `--review-state`
on `interpret-source`. There is no `priorRecordIds`.

## Occurrence — three axes, written once

An occurrence is not a belief. Execution + derived records are the
epistemic artifacts. The occurrence is the operational receipt of one
physical invoke, including in-process persist retries. Do not write
two occurrences for one invoke.

| Axis | Values | Meaning |
| --- | --- | --- |
| `providerStatus` | `succeeded` \| `failed` \| `uncertain` | What happened to the provider call |
| `outcome?` | `observations` \| `insufficient-evidence` | Schema-valid provider result only |
| `persistenceStatus` | `committed` \| `not-committed` | Whether Chronicle accepted the output as memory |

A provider can succeed while persistence does not:

```text
providerStatus = succeeded
outcome = observations
persistenceStatus = not-committed
```

That is not an invocation failure. The model ran; Chronicle did not
publish memory.

Insufficient-evidence is a fully successful E4 result when published:

```text
providerStatus = succeeded
outcome = insufficient-evidence
persistenceStatus = committed
```

The machine ran, obeyed the policy, and declined to make a claim.

Timeout is `providerStatus: uncertain` with
`providerFailureClass: timeout`. Schema-invalid output is
`providerStatus: failed` / `invalid-output` and writes **no** execution
or derived files.

Occurrence id is `sha256({ definitionId, sourceRefs, producer,
configuration, startedAt, nonce })`. Output hashes, status, outcome,
`endedAt`, and persistence result are not in the id. Those fields
describe the invocation identified by `startedAt + nonce`; rewriting
them under the same id would rewrite history.

`startedAt` and `nonce` default **immediately before** the provider
invoke. They identify the physical call, not interpret-request start.
`createdAt` remains request/artifact time for definition and derived
records. Tests may pin `startedAt` / `nonce`; the CLI does not.

The store enforces append-only at the file boundary:

```text
file absent → write
file present and semantically identical → already-present / no rewrite
file present but different → integrity error
```

Requested `--model` lives on `producer` (and thus the execution).
Provider-returned `modelVersion` lives on the occurrence only.

No occurrence if the provider was never called (dry-run, unresolved
source). Crash before a terminal provider result = no occurrence
(accepted gap).

Any occurrence-store write failure is:

```text
status = occurrence-persist-failed
providerStatus = failed | uncertain | succeeded
providerFailureClass = …   (when the provider did not succeed)
persistenceStatus = committed | not-committed
error = occurrence-persist-failed
occurrenceId absent
```

Top-level `status` says the command failed to durably record the
receipt. The structured fields keep the provider result.

If the interpretation was already Chronicle memory, `persistenceStatus`
stays `committed` and `executionId` / `derivedIds` stay present. If the
provider failed or was uncertain, there is no execution or derived
file — the lost occurrence was the only durable proof the invoke
happened, and the result must say the receipt failed rather than
merely `unavailable` / `uncertain`.

## Crash states (append-only, not transactional)

E4a does not pretend to have transactional storage.

```text
execution exists, outputs incomplete
→ partial machine path

full epistemic set exists, occurrence missing
→ belief survived, operational receipt did not
```

`partial` remains the **provenance walker** status from the graph
implementation (broken cite on a requested subgraph). E4a does not
redesign `ProvenanceStatus` or add a new engine-wide `partial`.

When derived persist fails after the execution is durable, the
occurrence records `persistenceStatus: not-committed` and does not
cite a complete `executionId` / `derivedIds` set.

## Dry-run

`--dry-run` validates the graph, export hash, cited refs, and hashes
the definition **in memory**. It does not call the provider and writes
**no files**, including no definition.

## Source resolution

`ISourceContentRepository` is separate from `IChatGptExportRepository`
(strip-only). The live export hash must match the cited
`sourceGraphHash`. Source text is resolved ephemerally into the
expanded prompt and is never persisted.

A missing attachment with resolvable node text may still run. The
model must not invent blob contents; `insufficient-evidence` is
legitimate. There is no attachment-lineage walk.

CLI stdout does not print source text or observation statements.

## Producer and transport

`DerivedProducer` for this path is `type: agent`,
`name: chronicle-interpret`, plus the requested `model`.
`promptVersion` is not set; template id/hash live on definition policy
and execution configuration. `providerRequestId` and provider-returned
`modelVersion` live on the occurrence only.

E4a does not vendor a provider SDK. Chronicle does not depend on
`sdlc-workflow`. Default transport is a fixture file
(`CHRONICLE_INTERPRET_MODEL_FIXTURE`) or `unavailable`. Live adapters
should follow the existing `IModelRepository` convention
(`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) in a later PR.

Public tests use the synthetic ChatGPT export fixture and a mocked
provider. E4b (private Specimen A smoke) is out of scope.

## Architecture

```
InterpretHandler
  → InterpretationService
      → TransformationRegistry
      → TransformationDefinitionStore
      → TransformationExecutionStore
      → DerivedRecordStore
      → ExecutionOccurrenceStore
      → ChatGptGraphStore
      → SourceContentRepository
      → ModelInvocationRepository
```

The service does not call `TransformationService` or
`ProvenanceService`. Provenance reuse is the same stores and types.
The default `chronicle provenance` walk does not include occurrences.

## CLI

```
chronicle interpret-source \
  --type candidate-observation \
  --export <path> --graph <file> --source-graph-hash <hex> \
  --conversation-id <id> --node-id <id> [--node-id ...] \
  --output <dir> --executions <dir> --definitions <dir> \
  --occurrences <dir> \
  --provider <name> --model <id> [--temperature] [--dry-run]
```

Env: `CHRONICLE_DERIVED_DIR`, `CHRONICLE_EXECUTION_DIR`,
`CHRONICLE_DEFINITION_DIR`, `CHRONICLE_OCCURRENCE_DIR`,
`CHRONICLE_INTERPRET_MODEL_FIXTURE`.

Exit 0 only for `recorded` | `already-present` | `dry-run`.

Does not emit Activity, does not write a Daily Chronicle, does not
promote, does not accept `--review-state` or `--content`.

## Out of scope (E4a)

- Activity / Daily Chronicle / promotion / bulk scan
- `priorRecordIds` / `derived-record/2`
- Review CLI
- Attachment-lineage walk
- Vendor SDK / live OpenAI or Anthropic adapter
- E4b private Specimen A
- Redesigning provenance `partial`
