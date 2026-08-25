# Chronicle — MVP v0.1: Daily Chronicle

**Status: deprecated / frozen (2026-08-25).** This document describes the
v0.1 Daily Chronicle prototype. `Activity` / `getActivity` is **not** the
capture contract for new work. See
[`../../rosetta_docs/process/chronicle-build-charter.md`](../../rosetta_docs/process/chronicle-build-charter.md).
Do not extend this MVP. Do not delete the implementation until a
replacement day-view has its own specimen.

The initial goal was intentionally small: generate a **Daily Engineering Chronicle**.
That prototype is frozen. New work does not extend it.

## Inputs

The v0.1 Daily Chronicle is synthesized from:

- **Git changes** — commits/diffs for the day (`GitRepository`)
- **Current Jira tickets** — including their **parent Epic** and **parent OKR** (`JiraRepository`)
- **Claude Code conversation** — the day's AI-assisted work (`ClaudeCodeRepository`)
- **Cursor agent sessions** — Cursor Agent/CLI transcripts + session metadata (`CursorRepository`)
- **Manual notes** — free-form engineer notes (`NotesRepository`)

Each input contributes `Activity` records; each generated statement in the output must carry
`Evidence` tracing back to one of these sources.

## Output

A single Markdown document with these sections:

```markdown
# Daily Chronicle

## Executive Summary

## Work Completed

## Accomplishments

## Staff Signals

## Principal Signals

## Organizational Leverage

## Potential Performance Review Entries

## Suggested Tags

## Questions For Tomorrow
```

## Suggested Tags

Tags are inferred automatically wherever possible (see `src/utils/tags.utils.ts`). The taxonomy:

```
[DELIVERY]  [RELIABILITY]  [PERFORMANCE]  [CROSS-TEAM]  [ARCH]
[OBSERVABILITY]  [SECURITY]  [DEV]  [LEVERAGE]
```

## Out of scope for v0.1

- GitHub, Slack, Confluence sources (future repositories, same pattern)
- ChatGPT export **import** into Daily Chronicle (PRD-0027 Phase 1 is
  inventory-only; see `docs/design/chatgpt-export-inventory.md`)
- Weekly / Monthly / Quarterly Chronicles
- Promotion packets, organizational timeline, knowledge graph
- Any presentation layer (that is Wayfinder's job) — v0.1 emits Markdown only

## Long-term roadmap (context)

After the Daily Chronicle proves out, Chronicle grows to support: Weekly Chronicle (weekly
accomplishments), Monthly Chronicle (career timeline), Quarterly Chronicle (performance review
generation), Promotion Packet (evidence by Staff/Principal competencies), Organizational Timeline
(architecture history, incidents, business decisions), Knowledge Graph (people ↔ projects ↔ repos ↔
architecture ↔ Jira ↔ docs ↔ AI conversations), and Wayfinder integration (Chronicle as the primary
structured knowledge source answering questions like "why was this architecture decision made?").
