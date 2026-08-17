# Sanitized ChatGPT export fixture

This fixture is **synthetic**. It is not a redacted copy of any real
conversation. It exists to cover the union of structural shapes observed in a
real owner-provided export (2026-08-16) plus Phase 1 edge cases the PRD
requires even when the inventoried export did not contain them.

## Why these conversations (structural coverage)

| Conversation id | Shape | Observed in real export? |
| --- | --- | --- |
| `conv-linear` | Parent-linked linear thread; root `message: null`; no `children` arrays | Yes (dominant) |
| `conv-parent-branch` | Two children share one parent; `children` omitted | Yes (15 conversations; max 15 siblings) |
| `conv-multimodal` | `multimodal_text` + `image_asset_pointer` + attachment refs | Yes |
| `conv-thoughts` | `thoughts` / `reasoning_recap` without `parts` | Yes |
| `conv-audio` | `audio_asset_pointer` / `audio_transcription` | Yes (rare) |
| `conv-archived` | `is_archived: true` | Yes (1 conversation) |
| `conv-explicit-children` | Populated `children` arrays | **No** — older/other exports; required for contract |
| `conv-missing-timestamps` | Message with no `create_time` | **No** — messages in this export always had floats |
| `conv-malformed` | Non-object mapping entry; node without id | **No** — required unsupported-record path |

Sidecars (`user.json`, `ads.json`, `message_feedback.json`, `library_files.json`
with a deleted row, `shared_conversations.json`, `export_manifest.json`) match
files present in the real archive. Values are fake. `file-fixture-present.dat`
is present; `file-fixture-absent` is referenced and missing.

Payload strings such as `REDACTED_SHOULD_NOT_LEAK` are tripwires: inventory
output must not contain them.
