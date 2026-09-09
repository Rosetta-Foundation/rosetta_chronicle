# Design — Lexical conversation search

**Status:** Implemented scan-per-query specimen. Not an index.
**Date:** 2026-09-09

```text
VAULT OBJECTS          conversation-NNN.json bytes (content-addressed)
        ↓
RECEIPTS + SCOPES      allowed, not forgotten
        ↓
chronicle search       case-insensitive substring per mapping node
        ↓
HITS                   coordinates + bounded snippet (stdout)
```

This is a **read-only access path** over already-observed ChatGPT
conversation shards. It is not FTS, not embeddings, not MCP, not
`interpret-source`, and not a standing plaintext index.

## What it answers

Given a query and a private data-dir: which vaulted conversation nodes
contain that literal string, with enough coordinates to terminate in
canonical evidence.

It does not answer whether the hit is *relevant*, whether a paraphrase
matches, or what the operator believed.

## Locked semantics

- Scan-per-query. Nothing is persisted.
- Case-insensitive substring. Empty query is `invalid`.
- Only `conversations-NNN.json` shards. Other allowlisted files (Cursor
  JSONL, notes) are not scanned.
- **Branch policy:** `all-mapping-nodes`. Off-current-path siblings are
  searched. This is a documented choice, not a claim that the current
  path is the true path.
- Forgotten scopes are omitted. Stopped scopes remain searchable.
- `eventTime` is vendor `create_time` when present. Never filesystem
  mtime.
- `contentHash` is the vault object hash (receipt), not a graph-file
  hash.
- Snippets are bounded (`--snippet-chars`, default 240).
- Hit cap is `--limit` (default 20).
- `elapsedMs` is measured per run. Do not promote one host's latency
  into a performance claim.

## Status

`ok | invalid | not-found | no-config`.

- Missing observe config → `no-config` (exit 1)
- Unknown `--scope` → `not-found` (exit 1)
- Empty query → `invalid` (exit 1)
- Zero hits → `ok` with `hitCount: 0` (so latency is still reported)

## Out of scope (must be earned)

FTS, query expansion, embeddings, MCP, provider egress, a durable
index, and searching non-ChatGPT vault objects.

## CLI

```text
chronicle search <query> [--data-dir <dir>] [--scope <id>]
                         [--limit <n>] [--snippet-chars <n>]
```
