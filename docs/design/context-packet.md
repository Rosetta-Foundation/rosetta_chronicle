# Design — Context packet

**Status:** Implemented source-only specimen. Not an index. Not a person model.
**Date:** 2026-09-17
**Plan:** [`shared-living-context-plan.md`](shared-living-context-plan.md)

```text
VAULT OBJECTS          conversation-NNN.json bytes (content-addressed)
        ↓
RECEIPTS + SCOPES      explicit allowlist, not forgotten
        ↓
chronicle context-packet --request <file>
        ↓
PACKET                 bounded JSON evidence + limitations (stdout)
```

A packet is a **disposable access artifact**. Same frozen input plus
policy yields the same selection. It is not written back to the vault,
not a concept registry, and not identity resolution.

## What it answers

Given an explicit `dataDir`, nonempty scope allowlist, and 1–8 literal
selectors: which verified vault nodes contain those strings, with
role, native time, occurrence refs, and mechanical reasons.

It does not answer whether two mentions are the same person, whether
the earliest dated match is a concept's origin, or whether a user
message endorses quoted assistant text.

## Locked semantics

- Requires `--request` JSON. Does **not** inherit the live default
  data-dir. A request file authorizes reading that file, not expanding
  scopes. Contents are not persisted.
- Selectors are query alternatives, not stored aliases. One scan
  applies all selectors.
- `--match` is the request field `matchMode`: `raw` (default) or
  `normalized` (same rewrite as `chronicle search`). Display of
  normalized hits is labeled `transformed`; do not quote it as raw.
- Conversation boundaries are source coordinates, not relevance walls.
- Forgotten requested scopes → `withheld` with no evidence
  fingerprints. Unknown scope → `not-found`. Missing config →
  `no-config`.
- STOP still means "no new observe," not "hide retained evidence."
- `contentHash` is the shard object. Two snapshots with the same
  vendor conversation/node ids remain distinct.
- Adjacent parent/child nodes may be attached as
  `structural-neighbor`. Adjacency is not causation or endorsement.
- Mandatory cautions always present: `identityResolution:
  not-performed`, `conceptOrigin: not-established`, expression is not
  endorsement.
- Derived/evaluation attachment is **not** in this slice. There is no
  verified vault-to-source-graph membership bridge that would let a
  shard hash be passed to `SourceContentRepository.resolve`.

## Status and exits

`ok | partial | withheld | invalid | no-config | not-found | stale-scope`.

- `ok` — bounded request finished without integrity/coverage holes.
  No-match can be `ok` with a `no-match` limitation.
- `partial` — scan/selection truncated or an integrity gap. Exit 2.
- Other failures exit 1. Consumers must inspect `status` and
  `limitations`, not only the process exit.

## CLI

```text
chronicle context-packet --request <file>
```

Example request (synthetic fixture directory only):

```json
{
  "dataDir": "/tmp/chronicle-fixture",
  "scopes": ["practice-a", "practice-b"],
  "selectors": ["winding path", "practicing the winding path"],
  "matchMode": "raw"
}
```

Redirecting stdout is an operator copy. Chronicle cannot retract it
after `forget-scope`.

## Out of scope (must be earned)

FTS, embeddings, automatic selectors, paraphrase recall, persistent
entity registry, model consumer, live-corpus default, derived
attachment without a proven graph-to-vault association, atomic
read/forget locking.

Compatibility: [`lexical-search.md`](lexical-search.md) remains the
scan-per-query hit list. This command is a second, stricter packet
surface over the same vault.
