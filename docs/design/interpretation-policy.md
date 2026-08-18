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

Chronicle does not vendor a provider SDK and does not depend on
`sdlc-workflow`. Transport order:

1. `CHRONICLE_INTERPRET_MODEL_FIXTURE` if the file exists
2. one xAI Responses HTTP call when `--provider` is `xAI`, the
   requested model is exactly `grok-4.6`, and `XAI_API_KEY` is set
   (`reasoning_effort` `high`, `store` false, no tools, no
   `search_parameters`). Any other model on this provider is
   `unavailable`. `search_parameters` is omitted because xAI
   deprecates that field with HTTP 410.
3. otherwise `unavailable`

The live call returns response text plus `providerRequestId` /
`modelVersion` when the API supplies them. Occurrence configuration
records `provider`, `reasoningEffort: high`, and the requested model
on `producer.model`. Do not record Cursor model display names.

The adapter does not validate observation schema, persist the
expanded prompt, or log credentials or source. A second provider,
Cursor agent transport, and a vendored SDK are out of scope.

Public tests use the synthetic ChatGPT export fixture and a mocked
HTTP transport. E4b private smoke is a local experiment; its source
and observation text are not in this repository.

## E4b — measured local experiment (2026-08-18)

E4b asked whether one bounded real-model invocation can interpret a
deliberately selected slice of private source and leave a provenance
path that distinguishes source, policy, execution, physical
invocation, and epistemic restraint.

It is an experiment, not a product feature and not a reliability
claim.

### Sanitized result

| Field | Measured |
| --- | --- |
| Engine revision | `27a3008` (#18 merge on #17) |
| Provider / requested model | xAI / `grok-4.6` |
| Selected nodes | 4 |
| Roles | 2 user / 2 assistant |
| Content types | `text` 3, `multimodal_text` 1 |
| Attachments | 1 present image, 0 missing |
| Observations | 3 |
| Epistemic classes | `directly-supported` 3 |
| `providerStatus` | `succeeded` |
| `outcome` | `observations` |
| `persistenceStatus` | `committed` |
| `providerRequestId` captured | yes |
| Provider `modelVersion` captured | yes, `grok-4.6` |
| Backward provenance | `ok` × 3 |
| Forward provenance | `ok` × 4 |
| Structural failures | none |
| Privacy tripwire | pass |
| Activity / Daily Chronicle / promotion | none |
| Human review | all supported as classified |

Additional sanitized behavioral finding: all three observations were
supported by cited source text. The present image attachment was not
described or invented. The multimodal node was not cited.
`supportNote` behaved as machine commentary rather than source. All
machine observations remained `unreviewed` in Chronicle.

A prior live attempt against the same selection failed as
`unavailable` after xAI returned HTTP 410 for deprecated
`search_parameters`. That receipt stayed `not-committed`. #18 omitted
the field. The measured success above is the single subsequent invoke.
There was no retry of a schema-valid result.

### Proven

- Bounded real machine interpretation can be produced
- Machine interpretation remains distinct from source
- Exact source lineage survives
- Transformation policy survives
- Provider/model invocation identity survives
- Physical invocation receipt survives
- Machine observations begin `unreviewed`
- Forward and backward provenance survive
- Private source does not enter the public engine artifacts tested
- No Activity / Daily Chronicle / promotion occurs
- In this experiment, human review found all three classifications
  supported

### Not proven

- General model reliability
- Reliability across the corpus
- Reliable multimodal interpretation
- Behavior with missing attachments
- Biography
- Automatic memory creation
- Current understanding
- Conflict resolution
- Review / evaluation semantics
- Promotion
- Organizational use
- Wayfinder
- Background interpretation

One successful invoke is not a claim about model reliability. The
human review act itself is **not** yet a Chronicle artifact.

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
`CHRONICLE_INTERPRET_MODEL_FIXTURE`, `XAI_API_KEY`.

Exit 0 only for `recorded` | `already-present` | `dry-run`.

Does not emit Activity, does not write a Daily Chronicle, does not
promote, does not accept `--review-state` or `--content`.

## Out of scope (E4a)

- Activity / Daily Chronicle / promotion / bulk scan
- `priorRecordIds` / `derived-record/2`
- Review CLI
- Attachment-lineage walk
- Vendor SDK / Cursor agent transport / a second live provider
- Human evaluation as a durable Chronicle event (E5)
- Private E4b source or observation text in this repository
- Redesigning provenance `partial`
