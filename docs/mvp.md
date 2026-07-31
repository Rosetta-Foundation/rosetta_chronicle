# Chronicle — MVP v0.1: Daily Chronicle

The initial goal is intentionally small: generate a **Daily Engineering Chronicle**. This proves the
core concept — that engineering activity can be transformed into durable, evidence-backed knowledge —
before we expand to weekly/monthly/quarterly rollups and additional sources.

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

- GitHub, Slack, Confluence, Calendar sources (future repositories, same pattern)
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
