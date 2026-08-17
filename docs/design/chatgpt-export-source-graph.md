# Design — ChatGPT source graph (PRD-0027 Phase 2)

**Status:** Proposed schema for durable path, not activity
**Date:** 2026-08-17

Phase 1 inventories a ChatGPT export without writing Chronicle records.
Phase 2 persists the **normalized conversation graph** into the owner's
personal Chronicle repository. It does not interpret the graph, project
`Activity`, or touch Daily Chronicle synthesis.

```
chronicle import-chatgpt --export <dir-or-zip> --repo <personal-chronicle>
```

## Why this is not Activity

`Activity` is a day's observed event: one `id`, one `timestamp`, one
`summary`, optional `evidence`. That shape is a destination. The export is a
graph: parent-linked nodes, a vendor `currentNodeId`, branches reconstructed
from shared parents, attachment refs that may lack blobs, and two clocks
(event time vs ingestion time).

Flattening a conversation into a summary would erase the path Phase 1
existed to learn. Registering `chatgpt-export` on `ActivitySource` would
claim the source already produces activity. It does not.

So Phase 2 stores a **source record**:

```text
immutable source archive   (bytes stay outside this repo for now)
        ↓
normalized conversation graph   (this PR)
        ↓
later: personal-domain Activity / reflection
        ↓
never automatic: organizational Chronicle
```

This is not a permanent ban on source bytes in a private Chronicle. This PR
simply does not copy zip/directory bytes into Git while storage policy is
undecided. Identity is the archive content hash.

## Schema

Persisted at `chronicles/.data/chatgpt-export/<contentHash>.json`.

```ts
interface ChatGptSourceGraph {
  archive: ChatGptSourceArchive;
  conversations: ChatGptSourceConversation[];
  unsupported: ChatGptUnsupportedRecord[];
}

interface ChatGptSourceArchive {
  contentHash: string;          // SHA-256; idempotency key
  kind: 'directory' | 'archive';
  importedAt: string;           // ingestion time (ISO-8601)
  shardNames: string[];
  sidecarFiles: string[];       // filenames only
}

interface ChatGptSourceConversation {
  sourceId: string;             // vendor conversation_id
  currentNodeId?: string;
  createTime?: string;          // event time
  updateTime?: string;          // event time
  archived: boolean;
  nodes: ChatGptSourceNode[];
}

interface ChatGptSourceNode {
  id: string;
  parentId?: string | null;
  sourceChildIds: string[];          // vendor `children` as written
  reconstructedChildIds: string[];   // inferred from parent links
  hasMessage: boolean;
  role?: string;
  contentType?: string;
  createTime?: string;          // event time
  updateTime?: string;
  attachments: ChatGptSourceAttachmentRef[];
}

interface ChatGptSourceAttachmentRef {
  id?: string;
  presentInArchive: boolean;    // `{id}.dat` in the listing
  mimeType?: string;
  size?: number;
  libraryFileId?: string;       // catalog id, not a filename
}
```

### What is stored

- Archive hash and sidecar *names*
- Conversation and node ids
- Parent links
- Source children and reconstructed children, separately
- `currentNodeId`
- Event timestamps and `importedAt`
- Roles and content types
- Attachment ids and present/missing
- Unsupported records (kept by reference)

### What is not stored

- Message text / parts
- Conversation titles
- Attachment display filenames
- Attachment / zip bytes
- `Activity` / Daily Chronicle rows
- Organizational promotion state

## Topology

Vendor exports may omit `children`. Phase 1 reconstructs branches from
`parent`. The durable record keeps both:

- `sourceChildIds` — what the export wrote (often empty)
- `reconstructedChildIds` — children of this node inferred from parent
  pointers

Callers must not treat one as the other.

## Attachments

A missing blob does not delete its node. The node stays; the ref stays with
`presentInArchive: false`, and an unsupported record notes the gap.

## Idempotency

Re-import of the same `contentHash` does not write a second graph and does
not change the original `importedAt`.

## Out of scope

- Source-vault / encryption policy
- `ActivitySource` membership
- Daily Chronicle synthesis
- Reflections, path links, promotion
