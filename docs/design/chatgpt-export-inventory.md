# Design — ChatGPT export inventory (PRD-0027 Phase 1)

**Status:** Decisions recorded from inspecting a real ChatGPT export
**Date:** 2026-08-17

Read-only inventory of an OpenAI ChatGPT export directory or `.zip`. This is
an experiment in making the existing engine safely aware of a new source. It
does not import, persist, or render ChatGPT content into a Daily Chronicle.

```
chronicle inventory-chatgpt --export <dir-or-zip>
```

## What the engine learned about the export

Structural observations (no source text retained):

| Fact | Implication for the contract |
| --- | --- |
| Conversations may be sharded (`conversations-NNN.json`), each an array | Inventory must accept N shards, not a single `conversations.json` |
| A conversation often has one null-message root node | Null-message roots are normal, not malformed |
| Node keys are `id`, `message`, `parent`; `children` may be absent | `childIds` cannot be assumed from the source; reconstruct from parent links |
| Some conversations branch via shared parents | Branching is real even when `children` is absent |
| Observed roles included `user` and `assistant` | `system` / `tool` / `unknown` remain in the contract even if unseen |
| Content types include `text`, `multimodal_text`, `reasoning_recap`, `thoughts` | `reasoning_recap` / `thoughts` often omit `parts` |
| Part objects include `image_asset_pointer`, `audio_asset_pointer`, `audio_transcription`, `real_time_user_audio_video_asset_pointer` | Attachments are first-class; do not reduce them to captions |
| Message `create_time` may be a unix float; message `update_time` may be absent | Event time comes from conversation and message timestamps that exist |
| Nodes may carry `metadata.attachments`; blobs appear as `.dat` files; `conversation_asset_file_names.json` maps names | Completeness = referenced id vs archive file list |
| Sidecars may include `user.json` (email/phone), `ads.json`, `message_feedback.json`, `shared_conversations.json`, `library_files.json`, `group_chats.json` | Inventory reports privacy-signal **filenames**, never values |
| `export_manifest.json` carries a version and `logical_files.conversations.json` may list shards | Manifest is provenance, not the conversation graph |
| `id` and `conversation_id` may be identical | Prefer `conversation_id`; fall back to `id` |

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
2. **Do not require `status`.** Export messages may have no `status` field.
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
6. **Do not add `chatgpt-export` to `ActivitySource` in Phase 1.** That union
   is the `source` field on `Activity` / `Evidence`. Inventory does not emit
   either. Leave `chatgpt-export` as a `// future:` comment until import
   actually produces activity (PRD-0027 Phase 2).
7. **Promotion is out of scope.** Personal → organizational transfer remains
   ADR-0002 / PRD-0006 only.

## Attachment presence

Authoritative mapping for archive completeness:

```text
metadata.attachments[].id
        ↓  append ".dat"
archive entry (file-….dat / file_….dat)
        ↓  conversation_asset_file_names.json
original display filename  (not used for presence)
```

- An attachment id is present when the archive lists `{id}.dat` (or the id
  itself). Some referenced ids have no blob; those are missing, not a
  mapping miss.
- `conversation_asset_file_names.json` keys are those `.dat` names; values
  are original filenames. Values are not archive paths.
- `library_files.json` is a catalog. Attachment `library_file_id` is a
  `libfile_…` catalog id. Library `file_id` sometimes also has a `.dat`,
  but catalog membership is not archive presence.
- Part-level `file-service://file-…` pointers are a parallel reference
  form; Phase 1 presence uses `metadata.attachments[].id` only.

`attachmentPresentInArchive` implements the `id` → `{id}.dat` rule against
the archive file list. It does not read sidecar JSON and does not load
blob bytes.

## What this phase does not do

- Write ChatGPT content into a Chronicle or sidecar
- Encrypt or vault the export
- Emit `Activity` / `Evidence` records
- Model reflections, dispositions, or path links
- Implement transformation lineage or promotion
