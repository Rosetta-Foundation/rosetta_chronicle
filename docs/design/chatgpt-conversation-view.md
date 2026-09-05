# Design — ChatGPT conversation view

**Status:** Implemented read-only computed view. Not a memory object.
**Date:** 2026-09-04

Conversation view is a present-tense **projection** over immutable
ChatGPT source-graph snapshots.

```text
SOURCE GRAPH           topology of one archive (content-hash JSON)
    ↓
CONVERSATION VIEW      rebuildable rows keyed by vendor sourceId
                       (stdout only; not a fourth historical event)
```

History is immutable. Views are recomputable. Snapshots are **not
merged**. Two export hashes remain two files.

See `docs/design/chatgpt-export-source-graph.md` for the graph
contract this view reads.

## What it answers

Given a directory of `ChatGptSourceGraph` files: which vendor
conversations appear in which archives, how node counts and
`currentNodeId` differ between a conversation's first and latest
appearance, and a mechanical `changeKind` histogram.

It does not answer what a conversation was about, whether a change
matters, or who someone is.

## Locked semantics

- Computed only. No durable conversation-view artifact.
- No model / provider call. No Activity / Daily Chronicle / promotion.
- Reads graph JSON only. Never vault bytes. Never message text.
- Identity is the vendor `sourceId`. Titles are not stored and not
  reconstructed.
- Latest archive is the snapshot with the maximum `importedAt`.
- `importedAt` is ingestion time. `createTime` / `updateTime` are
  vendor event time. They are never sorted as one history.
- Attachment counts come from the conversation's latest appearance.
- `changeKind` is mechanical:
  - `absent-from-latest` — not in the latest archive hash
  - `new-in-latest` — only in the latest archive, and more than one
    graph is present
  - `grew` / `shrank` — `nodeCount` differs first vs latest appearance
  - `tip-moved` — same `nodeCount`, different `currentNodeId`
  - `unchanged` — otherwise
- `grew` wins over `tip-moved`. A single snapshot is `unchanged`,
  not `new-in-latest`.
- Default CLI stdout omits `conversations[]`. Vendor ids appear only
  with `--show-conversation-ids`.

## Status

`ok | partial | not-found | invalid`.

- Missing `--graphs` directory → `not-found` (exit 1)
- Empty present directory → `ok`
- Valid graphs plus unreadable siblings → `partial`
- No valid graphs, only failures → `invalid` (exit 1)

`ChatGptGraphStore.listResolved` surfaces corrupt siblings so `ok`
cannot be claimed over silent corruption.

## CLI

```text
chronicle chatgpt-conversation-view [--graphs <dir>] [--show-conversation-ids]
chronicle chatgpt-conversation-locate --conversation-id <id> [--graphs <dir>]
```

`--graphs` falls back to `$CHRONICLE_SOURCE_GRAPH_DIR`, then
`<data-dir>/graphs` (`$CHRONICLE_DATA_DIR` or
`~/.local/share/rosetta/chronicle/default/graphs`). The commands
write nothing.

Locate prints one row plus `graphFiles[]` (snapshot JSON paths).
Those content hashes name graph files, not vault objects.
`vault-resolve` still needs a receipt / vault object hash.

`chronicle start` is the V1 turn-on alias for `watch`.

## Not implemented

- Content search / FTS / embeddings
- Merged cross-archive conversation objects
- Interpretation, evaluation, or current-understanding of these rows
- Persisted indexes (rebuildable indexes are not canonical evidence;
  building one is a later privacy decision)

## Why this is not Activity

`Activity` is a day's observed event. This view is a structural
index over source records. Flattening conversations into summaries
would erase the path the graph exists to preserve.
