# Design — Provenance graph traversal

**Status:** First-class engine walk over existing artifacts, not Activity
**Date:** 2026-08-18

PR #13 persisted transformation definitions and made a cited
`definitionId` required lineage. This phase adds a **provenance graph**
the engine can walk in both directions. It does not replace the stored
records. It does not introduce a graph database.

`chronicle transformation-provenance` remains the narrow compatibility
helper (single-hop execution walks and compare). General traversal is
`chronicle provenance`.

## Model

An execution cites **both** its source material and its definition. The
definition does not sit on a causal line between source and run.

```text
TransformationDefinition ← cites ─ TransformationExecution ─ cites → SourceGraph
                                     │
                                     └─ produces → DerivedRecord

SourceGraph ← cites ─ Direct DerivedRecord
```

A source graph *contains* conversations and nodes. Direct
`record-derived` notes are legitimate lineage even when no
`TransformationExecution` exists.

Machine interpretation uses a different shape:

```text
SourceGraph ← cites ─ TransformationExecution ─ produces → DerivedRecord
```

Those two shapes must not be collapsed. The walker still lists every
durable derived file, so a machine `DerivedRecord` published without
its execution would look like a direct human note on a forward walk.
E4a therefore publishes the execution **before** the derived record.
E4b measured that shape on the committed live xAI invoke (the
second of two physical specimen invocations): backward `ok` from
each derived record and forward `ok` from each selected source node,
with no direct `source → derived` machine lineage. See
`docs/design/interpretation-policy.md`.

Occurrences (`ExecutionOccurrence`) are operational receipts of a
provider invoke. They are **not** provenance-graph nodes and are not
included in the default `chronicle provenance` walk.

### Nodes

Handles only. Domain bodies stay in their stores.

| Kind | Identity |
| --- | --- |
| `source-archive` | archive content hash |
| `source-conversation` | `{hash}:{conversationId}` |
| `source-node` | `{hash}:{conversationId}:{nodeId}` |
| `transformation-definition` | definition id |
| `transformation-execution` | execution id |
| `derived-record` | derived-record id |

### Edges

| Type | Meaning |
| --- | --- |
| `cites` | Execution → definition; execution or derived → source archive / conversation / node |
| `produces` | Execution → derived record |
| `contains` | Archive → conversation → node (from a loaded source graph) |

No separate edge index is persisted. Edges are rebuilt from stored
fields on each query.

## API

```
ProvenanceHandler → ProvenanceService → existing stores
```

```
chronicle provenance --from <kind>:<id> --direction backward|forward \
  --graphs <dir> --output <dir> --executions <dir> --definitions <dir>
```

`--from` examples (`execution` / `definition` are aliases for the
canonical kinds `transformation-execution` / `transformation-definition`):

- `derived-record:<hex>`
- `execution:<hex>` or `transformation-execution:<hex>`
- `definition:<hex>` or `transformation-definition:<hex>`
- `source-archive:<hex>`
- `source-conversation:<hash>:<conversationId>`
- `source-node:<hash>:<conversationId>:<nodeId>`

The result is a structured subgraph plus ordered paths:

- `nodes` — reachable handles, sorted by `(kind, id)`
- `edges` — directed edges among those nodes, sorted by `(type, from, to)`
- `paths` — simple walks from the start, lexicographic by node keys
- `failures` — explicit integrity holes; never dropped to make a path look complete

Empty `paths` / `edges` on an existing start means **no relationship**
in that direction, not an error.

## Integrity

Traversal **accumulates** failures and continues through other
resolvable edges. A broken cite stays visible (`resolved: false` plus a
failure code).

| Situation | Status |
| --- | --- |
| Start artifact does not exist | `not-found` / `start-missing` |
| Start exists; every cited artifact resolves | `ok` |
| Start exists; at least one cite is broken | `partial` |
| Required store directory omitted | `invalid` / `*-dir-required` |

`not-found` is reserved for a missing **start**. A missing cited
definition, execution, derived record, graph, conversation, or node is
`partial` with `definition-missing`, `definition-invalid`,
`execution-missing`, `derived-missing`, `source-graph-missing`,
`conversation-missing`, or `node-missing`.

`partial` is this walker's integrity status. Machine interpretation
does not add a new engine-wide status; a crash that leaves an
execution without its derived outputs is visible here as
`derived-missing` on the requested subgraph.

Failures describe the **requested subgraph**. A missing or invalid
source graph, definition, execution, or derived record that is not
reachable from `--from` does not change status. Stores are still
scanned to build cites/produces edges; only artifacts on the walk are
diagnosed.

Cycles are not a valid domain shape. If corruption creates one, the
walk records `cycle` and stops expanding that path.

## Synthetic example

Archive hash `aaa…`, conversation `conv-1`, node `n1`. A human note
recorded through `transform-record` plus a direct `record-derived` on
the same node.

Backward from the transform-produced derived record reaches the
execution, the definition, and `n1`. Forward from `n1` reaches **both**
derived records. Neither walk writes Activity or Daily Chronicle files.

## Private smoke-test procedure

Authorized maintainers only. Do not commit the export, snapshots, or
derived text.

```text
# Placeholders — replace locally, never commit values
EXPORT=</absolute/path/to/private-chatgpt-export.zip-or-dir>
WORK=</absolute/path/to/isolated-temp-workdir>
GRAPH=$WORK/graphs
DERIVED=$WORK/derived
EXEC=$WORK/executions
DEFS=$WORK/definitions

chronicle import-chatgpt --export "$EXPORT" --output "$GRAPH"
# Record HASH and pick one CONVERSATION_ID / NODE_ID from the graph JSON
# (ids only — do not copy message text into notes or PRs).

chronicle transform-record \
  --type human-note --version 1 \
  --source-graph-hash "$HASH" \
  --conversation-id "$CONVERSATION_ID" --node-id "$NODE_ID" \
  --output "$DERIVED" --executions "$EXEC" --definitions "$DEFS" \
  --producer-type human --producer-name fixture \
  --content "SYNTHETIC_SMOKE_NOTE"

chronicle provenance --from derived-record:$DERIVED_ID --direction backward \
  --graphs "$GRAPH" --output "$DERIVED" --executions "$EXEC" --definitions "$DEFS"
# Expect status ok|partial; path includes source-archive $HASH and $NODE_ID.

chronicle provenance --from source-node:$HASH:$CONVERSATION_ID:$NODE_ID \
  --direction forward \
  --graphs "$GRAPH" --output "$DERIVED" --executions "$EXEC" --definitions "$DEFS"
# Expect the smoke derived id among reachable derived-record nodes.

# Isolated integrity check: move the definition file aside, re-run backward,
# expect status=partial and definition-missing. Restore or delete $WORK.
rm -rf "$WORK"
```

Report only structural facts (status, node/edge counts, failure codes).

## Out of scope

- Embeddings, Activity, Daily Chronicle, promotion
- Graph databases or a query language
- Expanding `transformation-provenance` into this API
- Adding occurrences as graph nodes
- Redesigning `partial` as an E4 persistence status

## Future work

- Views over living concepts (current reading of a conversation)
- Path-link / evaluation records (PRD-0027 Phase 3–4)
- Separating authored vs transformation-produced derived types if that
  distinction becomes a real domain boundary
