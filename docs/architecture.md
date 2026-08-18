# Chronicle — Architecture

## Long-term data flow

Chronicle sits between raw engineering activity (sources) and structured knowledge (consumers):

```
                 Git
               GitHub
                Jira
              Calendar
            Claude Code
             Confluence
                Slack
                Notes
                  │
                  ▼
           Chronicle Engine
                  │
      ┌───────────┼────────────┐
      ▼           ▼            ▼
  Career      Documentation   AI Context
  Timeline      Generation    Generation
      ▼           ▼            ▼
 Promotion     Wayfinder      Knowledge
  Evidence        UI            Graph
```

Chronicle owns **structured data**. It does not own presentation — Wayfinder and future products
consume Chronicle's output.

## Internal architecture — Handler / Service / Repository

Chronicle follows the mandatory Rosetta pattern (full ruleset:
`../.claude/rules/architecture-hsr.md`). The layers map onto Chronicle's domain as follows:

| Layer | Chronicle role | Examples |
|-------|----------------|----------|
| **Handler** | Entry points that receive a request (CLI invocation, scheduled job, future API call), dispatch to a service, and return the result. No logic. | `DailyChronicleHandler` |
| **Service** | The synthesis/orchestration logic — gather from source repositories, correlate evidence, infer tags, compose the output document. | `ChronicleService` |
| **Repository** | Source adapters — one per activity source. Resource access only. | `GitRepository`, `JiraRepository`, `ClaudeCodeRepository`, `NotesRepository` |

Adding a new activity source (GitHub, Slack, Confluence, Calendar) means adding a new repository that
implements a source-adapter contract, then wiring it into the service — no changes to the handler.

ChatGPT export inventory (PRD-0027 Phase 1) follows the same layers — `ChatGptInventoryHandler` →
`ChatGptInventoryService` → `ChatGptExportRepository` — but is **not** wired into Daily Chronicle
synthesis. It makes the engine aware of a new source without writing ChatGPT content into a
Chronicle. See `docs/design/chatgpt-export-inventory.md`.

ChatGPT source-graph import (PRD-0027 Phase 2) is a second handler on the same stripped export:
`ChatGptImportHandler` → `ChatGptImportService` → `ChatGptExportRepository` + `ChatGptGraphStore`.
It persists a normalized conversation graph to a **caller-chosen** directory as
`<contentHash>.json`. That path is target-repository configuration, not an engine layout.
The record is source structure, not an archive backup and not `Activity`; it does not
enter Daily Chronicle synthesis. `chatgpt-export` stays off `ActivitySource`. See
`docs/design/chatgpt-export-source-graph.md`.

Derived records (PRD-0027 next phase) are a third handler:
`DerivedRecordHandler` → `DerivedRecordService` → `DerivedRecordStore` (+ optional
`ChatGptGraphStore.readAt` for ref checks). They persist an inspectable
transformation with source-graph provenance. Content is human-created in this
phase. They are not Activity, not automatic summaries, and not promotion. See
`docs/design/derived-records.md`.

### Dependency direction

```
DailyChronicleHandler
        │  (dispatch)
        ▼
   ChronicleService
        │  (gather evidence)
        ├──────────────┬───────────────┬──────────────┐
        ▼              ▼               ▼              ▼
  GitRepository  JiraRepository  ClaudeCode…    NotesRepository
```

The service composes repositories; repositories never call the service or each other. Pure logic
(e.g. tag inference) lives in `src/utils/`, and all boundary/DTO types live in `src/types.ts`.

## Domain model (boundary types)

Defined in `src/types.ts`:

- **Activity** — a single observed engineering event from a source (a commit, a Jira transition, a conversation turn, a note).
- **Evidence** — a reference back to the source artifact that justifies a statement (never fabricated).
- **Tag** — an inferred category from the Rosetta tag taxonomy (see `mvp.md`).
- **DailyChronicle** — the synthesized output document (the v0.1 deliverable).

These types are the contract between the source repositories, the synthesis service, and downstream
consumers.

## Core design principles

- **AI-native** — every component assumes AI is a first-class consumer.
- **Source-driven** — engineering activity becomes documentation automatically; no duplicated work.
- **Evidence-first** — every generated statement traces back to evidence; nothing is fabricated.
- **Durable knowledge** — reusable organizational context, not ephemeral chat history.
- **Human + AI** — outputs serve engineers, managers, and future AI agents equally.
- **Extensible** — Chronicle exposes structured data and does not own presentation.

## Development philosophy

Prefer small iterations, strong architecture, domain-first modeling, clean abstractions,
local-first development, AI-assisted implementation, and extensive automated testing. Avoid
premature optimization. Focus first on proving that engineering activity can be transformed into
durable organizational knowledge.
