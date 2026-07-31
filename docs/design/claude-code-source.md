# Design Proposal — Claude Code Source

**Status:** Decisions recorded

**Date:** 2026-07-22

> Proposal for `ClaudeCodeRepository` — turning Claude Code sessions into
> Chronicle activity. Covers both the batch backfill ("scrape past sessions")
> and the live append ("append as a session wraps up") paths.

---

## Motivation

Git records *what changed*; notes record *what you chose to write down*. Neither
captures *how you reasoned* — the investigation, the alternatives weighed, the
decision made. That reasoning happens in Claude Code sessions and is otherwise
lost. This source recovers it.

Two distinct asks from the product owner:

1. **Batch backfill** — scrape *past* sessions into daily logs.
2. **Live append** — as a session wraps up, append to *today's* log.

Both read the same data and produce the same `Activity` shape; they differ only
in *when* they run and *how much* they process.

---

## What the transcripts actually contain

Claude Code stores one JSONL file per session under a per-project directory:

```
~/.claude/projects/<cwd-with-slashes-as-dashes>/<session-uuid>.jsonl
```

Findings from inspecting a real project (34 sessions, ~6k records, one month):

| Record `type` | Value for Chronicle |
| --- | --- |
| **`ai-title`** | A distilled, human-readable session summary — e.g. *"Fix DOB display in anonymous POI Apple Wallet"*. **The single highest-value field**: already Chronicle-grade. 24 / 34 sessions had one. |
| **`pr-link`** | PRs opened in the session (`prNumber`, `prRepository`, `prUrl`). Ideal evidence — ties reasoning to a durable org artifact. |
| **`user`** | Prompts (the intent). Carries `timestamp`, `gitBranch`, `cwd`, `promptSource`. |
| **`assistant`** | Responses + tool calls (the work). |
| **`system` / `mode` / `file-history-snapshot` / …** | Operational noise — ignored. |

Every content record carries **`timestamp`**, **`gitBranch`**, **`cwd`**, and
**`sessionId`** — enough to window by date and scope by project without heuristics.

---

## Design

### Contract

`ClaudeCodeRepository` implements the existing `getActivity(window)` source
pattern (same as git/notes), returning `Activity[]` with `Evidence`.

```ts
export interface IClaudeCodeRepository {
  getActivity(window: ChronicleWindow, projectPath?: string): Promise<Activity[]>;
}
```

- `projectPath` (defaults to the target repo) selects **which project directory**
  to read — never "all transcripts everywhere". See Privacy.

### Extraction — one Activity per session, with sub-task drilling

A session is the base unit of meaningful work. For each session file overlapping
the window:

- **`summary`** ← the session's `ai-title` (fallback behavior: see below).
- **`timestamp`** ← first content record's timestamp in the window.
- **`evidence`** ← the `sessionId` (ref) + any `pr-link` records (PR url/number).

When a session contains multiple distinct `gitBranch` values (mid-session branch
changes), each branch segment is emitted as a **sub-task Activity** — same parent
`sessionId`, additional `branch` annotation. This surfaces multi-repo, multi-branch
work at the right granularity without requiring separate sessions.

This deliberately produces a **compact, summary-level** record — *"Worked on:
Fix DOB display in anonymous POI Apple Wallet (PR #170)"* — **not** a dump of the
raw conversation. Raw transcript content never enters the Chronicle.

### Title fallback — truncate and flag, never drop

**Decision:** sessions without an `ai-title` (~30% in observed data) are not
dropped. They represent real work. Instead:

- **`summary`** ← first user prompt, truncated to ~120 characters.
- The entry is tagged `review-needed` and rendered in a distinct
  **"Sessions to review"** subsection in the daily Chronicle — a visual
  trash-can the engineer can accept, retitle, or discard during their daily
  pass.

A truncated first prompt is almost always more informative than silence.
The flag makes quality gaps visible without burying the work.

### Compaction handling

Engineers frequently run a single session across multiple compactions (the context
window fills, the conversation is summarized, work continues in the same session).
Chronicle handles this automatically — no session management required from the
engineer:

- `ai-title` is taken from the **last occurrence** in the session file — the most
  current distilled summary, post-compaction.
- Compaction markers in the JSONL (`system` summary records) are used to detect
  segment boundaries for sub-task extraction when branch changes coincide.
- The session UUID is stable across compactions, so dedup works correctly
  regardless of how many compaction cycles a session went through.

### Cross-project / multi-repo sessions — cwd-prefix scoping

**Decision:** the vast majority of work crosses multiple repos. Launching Claude
from a workspace root (`~/projects/rosetta`, `~/projects/aiops`,
`~/projects/enterprise`) is the norm. Scoping to a single repo directory would
miss most sessions entirely.

Scoping rules:

- The Chronicle `projectPath` is matched against the **prefix** of each session's
  `cwd`, not an exact directory name. A session launched from
  `~/projects/rosetta` matches any Chronicle rooted at or below that path.
- Generating a Chronicle at the workspace root captures all cross-repo sessions
  naturally — this is the primary use case.
- Generating one scoped to a single sub-repo captures only sessions launched from
  within that repo — useful, but a narrower slice.
- `gitBranch` per-record annotations are preserved on each Activity for filtering
  and tagging, even when they don't change the scoping.

### The two run modes

| | Batch backfill | Live append |
| --- | --- | --- |
| Trigger | CLI / on demand | Claude Code **Stop hook** (automatic) |
| Window | any past range | today |
| Scope | all sessions in window | the just-ended session |
| Output | via `ChronicleService` → persist | append one entry to today's file |

Both rely on the **content-hash dedup already built for notes**: re-running
either mode never duplicates a session's entry (session id → stable Activity id).
This is why notes were built with dedup first — live append is safe by
construction.

### Live-append trigger — automatic stop hook, plus on-demand

**Decision:** automatic capture is the goal. Both modes are supported:

1. **Automatic** — the Claude Code Stop hook fires on every session end and
   appends the session to today's Chronicle. The engineer's workflow is never
   interrupted; hook failures are logged silently.
2. **On-demand** — a CLI command (`chronicle append-session <session-id>`) allows
   explicit capture at any time: for sessions where the hook wasn't running, for
   replaying past sessions, or for testing.

The Stop hook is **opt-in** — installed by engineer choice, not by default setup.
Once installed, capture is fully automatic.

---

## Privacy — the load-bearing section

Transcripts contain **everything** discussed with Claude across all work,
some sensitive. This source must honor ADR-0002's *"private by default"*.

1. **Project-scoped, never global.** Read only transcript directories whose `cwd`
   matches the target project prefix. Never sweep `~/.claude/projects/*`. A session
   from an unrelated workspace cannot leak into another Chronicle.
2. **Summaries, not transcripts.** Only the `ai-title` and PR links are
   extracted. Prompt/response bodies are used at most for a truncated fallback
   title — never copied wholesale.
3. **Personal-repo destination.** Output lands in the engineer's *private*
   Chronicle (per ADR-0002). Publishing anything onward stays intentional and
   human-gated.
4. **Opt-in Stop hook.** The Stop hook is installed by choice, not by default.
   Batch backfill runs on demand without any hook.

Note on titles: even project-scoped titles may name systems or people. This is
acceptable for a **private** log; must be re-sanitized on any publication to the
organizational Chronicle — same gate as every other source (ADR-0002, Publication
section).

---

## Build plan

Reviewable slices, each shippable:

1. **`ClaudeCodeRepository` (batch)** — parse project transcripts → session
   `Activity[]` with sub-task drilling; wire into `ChronicleService`; add a
   "Claude Sessions" section with a "Sessions to review" subsection.
   Answers "scrape past sessions."
2. **Backfill CLI** — generate + persist over a past date range.
3. **Stop-hook live append** — reuse (1)'s extraction for the single ended
   session; append to today's file. Answers "append as it wraps up."

Recommend building (1) first; (3) is small once (1)'s extraction exists.
