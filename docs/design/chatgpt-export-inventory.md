# Design — ChatGPT export inventory (PRD-0027 Phase 1)

**Status:** Decisions recorded from a real owner-provided export
**Date:** 2026-08-17

Read-only inventory of an OpenAI ChatGPT export directory or `.zip`. This is
an experiment in making the existing engine safely aware of a new source. It
does not import, persist, or render ChatGPT content into a Daily Chronicle.

```
chronicle inventory-chatgpt --export <dir-or-zip>
```

## What the engine learned about the export

Observed in the 2026-08-16 owner export (structure only; no source text
retained):

| Fact | Implication for the contract |
| --- | --- |
| Conversations are sharded (`conversations-000.json` … `003.json`), each an array | Inventory must accept N shards, not a single `conversations.json` |
| 366 conversations, 5951 nodes, 5585 message nodes | One null-message root node per conversation is normal |
| Node keys are `id`, `message`, `parent` — **no `children` key** | `childIds` cannot be read from the source; reconstruct from parent links |
| 15 conversations branch via shared parents (max 15 siblings) | Branching is real even when `children` is absent |
| Roles are only `user` and `assistant` | `system` / `tool` / `unknown` remain in the contract but were not observed |
| Content types: `text`, `multimodal_text`, `reasoning_recap`, `thoughts` | `reasoning_recap` / `thoughts` often omit `parts` |
| Part objects: `image_asset_pointer`, `audio_asset_pointer`, `audio_transcription`, `real_time_user_audio_video_asset_pointer` | Attachments are first-class; do not reduce them to captions |
| Message `create_time` is always a unix float; message `update_time` is always absent | Event time comes from conversation + message `create_time` |
| 181 nodes carry `metadata.attachments`; 330 `.dat` blobs; `conversation_asset_file_names.json` maps names | Completeness = referenced id vs archive file list |
| Sidecars include `user.json` (email/phone), `ads.json`, `message_feedback.json`, `shared_conversations.json`, `library_files.json`, `group_chats.json` | Inventory reports privacy-signal **filenames**, never values |
| `export_manifest.json` `version` is `1`; `logical_files.conversations.json` lists shards | Manifest is provenance, not the conversation graph |
| `id` === `conversation_id` on every conversation | Prefer `conversation_id`; fall back to `id` |

## Distinctions this command preserves

| Kind | What it is |
| --- | --- |
| Source data | Export bytes on disk. Never copied into Chronicle. Titles and parts stripped at the repository boundary. |
| Derived inventory | Counts, topology flags, content-type names, attachment completeness, unsupported reasons. |
| Event time | Unix timestamps from the export, converted to ISO-8601. |
| Ingestion time | When the inventory ran (`ingestedAt`). Not an event timestamp. |
| Unsupported records | Malformed nodes, non-array shards, unknown content types, missing attachment blobs. |
| Missing / invalid archives | First-class `status: missing \| invalid`, not an empty success. |

## Fixture justification

`src/__tests__/fixtures/chatgpt-export/` is a **synthetic union of structural
shapes**, not a selected real conversation. See that folder's README for the
coverage table. Tripwire strings (`REDACTED_SHOULD_NOT_LEAK`, …) must never
appear in inventory JSON.

## Contract revisions vs PRD-0027 §4

The PRD types remain the Phase 2 target. Phase 1 revises them as follows:

1. **`ConversationNode.childIds` is derived.** When the source omits
   `children`, reconstruct from `parent`. Persist both `sourceChildIds` (as
   written) and `childIds` (reconstructed) at import time so we do not pretend
   the vendor emitted a children array.
2. **Do not require `status`.** This export's messages have no `status` field.
   Deleted/unavailable is not a message status here; look at
   `library_files.deleted_at` and missing `.dat` blobs instead.
3. **`contentType` is an open string.** Observed types already exceed `text`.
   Unknown types become unsupported records, not dropped nodes.
4. **Event time ≠ `importedAt`.** `SourceArchive.importedAt` is ingestion.
   Conversation/node `createdAt` is event time. Message `update_time` may be
   absent.
5. **Titles are source content.** Default inventory does not emit them.
   `ConversationArtifact.title` stays optional and must not be required for
   topology.
6. **`chatgpt-export` is an `ActivitySource`.** Daily Chronicle synthesis does
   not collect it. Phase 2 may project personal-domain activity from the
   normalized graph; that is a later, explicit import.
7. **Promotion is out of scope.** Personal → organizational transfer remains
   ADR-0002 / PRD-0006 only.

## What this phase does not do

- Write ChatGPT content into a Chronicle or sidecar
- Encrypt or vault the export
- Emit `Activity` / `Evidence` records
- Model reflections, dispositions, or path links
- Implement transformation lineage or promotion
