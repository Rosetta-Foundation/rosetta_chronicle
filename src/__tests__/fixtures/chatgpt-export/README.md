# Sanitized ChatGPT export fixture

This fixture is **synthetic**. It is not a redacted copy of any real
conversation. It exists to cover the union of structural shapes observed in
a real ChatGPT export plus Phase 1 edge cases the PRD requires even when a
given export does not contain them.

## Why these conversations (structural coverage)

| Conversation id | Shape | Observed in a real export? |
| --- | --- | --- |
| `conv-linear` | Parent-linked linear thread; root `message: null`; no `children` arrays | Yes (dominant) |
| `conv-parent-branch` | Two children share one parent; `children` omitted | Yes |
| `conv-multimodal` | `multimodal_text` + `image_asset_pointer` + attachment refs | Yes |
| `conv-thoughts` | `thoughts` / `reasoning_recap` without `parts` | Yes |
| `conv-audio` | `audio_asset_pointer` / `audio_transcription` | Yes (rare) |
| `conv-archived` | `is_archived: true` | Yes |
| `conv-explicit-children` | Populated `children` arrays | **No** — older/other exports; required for contract |
| `conv-missing-timestamps` | Message with no `create_time` | **No** — observed messages used unix floats |
| `conv-malformed` | Non-object mapping entry; node without id | **No** — required unsupported-record path |

Sidecars (`user.json`, `ads.json`, `message_feedback.json`, `library_files.json`
with a deleted row, `shared_conversations.json`, `export_manifest.json`) match
sidecar *kinds* present in a real archive. Values are fake.
`file-fixture-present.dat` is present; `file-fixture-absent` is referenced
and missing.

Payload strings such as `REDACTED_SHOULD_NOT_LEAK` are tripwires: inventory
output must not contain them.
