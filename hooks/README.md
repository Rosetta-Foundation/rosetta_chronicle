# Chronicle Session Hooks — Live Session Append

Automatically appends ended agent sessions to your Daily Chronicle. Zero manual
action required once installed via `team-setup` full `setup`.

## How it works

### Claude Code

Claude Code fires the **Stop** event when an agent finishes responding. The
hook receives a JSON payload (stdin) with `session_id` and `cwd`, then calls
`chronicle append-session` which:

1. Finds the session's JSONL transcript file in `~/.claude/projects/`
2. Extracts the `ai-title` (or truncated first prompt, flagged for review)
3. Appends one activity entry to today's Daily Chronicle in your personal repo
4. Commits the result

Content-hash dedup means re-running never creates duplicates.

### Cursor Agent / CLI

team-setup also registers Cursor hooks in `~/.cursor/hooks.json`:

- `sessionStart` → `cursor-session-start.sh` injects `CHRONICLE_*` into the session
- `stop` → `cursor-stop-append.sh` normalizes the Cursor payload and delegates to
  `stop-append.sh`

Cursor sessions are read by `CursorRepository` from two places:

1. **Transcripts** — `~/.cursor/projects/<cwd-slug>/agent-transcripts/<session-id>/<session-id>.jsonl`
2. **Session metadata** — `~/.cursor/chats/<md5-of-cwd>/<session-id>/meta.json`
   (`title`, `createdAtMs`, `cwd`), when Cursor has written it

The session title comes from `meta.json`; untitled sessions fall back to the
first user prompt (unwrapped from Cursor's `<user_query>` envelope), truncated
and flagged `[needs-review]`. The session timestamp comes from `createdAtMs`,
falling back to the transcript file's birthtime — so a multi-day session is
attributed to the day it started. `backfill` and `append-session` cover Claude
Code and Cursor sessions in a single run. Because Cursor sessions belong to
their creation day, `append-session` resolves that day from the session id and
regenerates it — a stop event after midnight updates the right Chronicle.

### Automatic catch-up sweep

Live capture alone can never be complete: sessions can end without a stop
event (closed window, crash, sleep), and Cursor writes session titles
asynchronously, after capture. `chronicle-sweep.sh` closes both gaps. It is
fired in the background by `cursor-session-start.sh` on every new Cursor
session (throttled to one attempt per day) and re-runs `chronicle backfill`
over a trailing window so recent days self-heal — late titles upgrade
`[needs-review]` entries and orphaned sessions get picked up.

The window is **marker-based, not fixed-size**, so any length of absence is
covered: each sweep starts 2 days before the last *successful* sweep date and
runs through today (first ever run: 7 days back). Return from a three-week
vacation and the first session start sweeps the whole gap. Quiet days are
never committed — backfill skips days with zero activity unless a Chronicle
already exists for them.

Sweep state lives in `~/.config/rosetta/`:

| File                 | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `last-sweep-success` | Date swept through on the last clean run    |
| `last-sweep-attempt` | Date of the last attempt (daily throttle)   |
| `sweep.log`          | Backfill output from each sweep             |

The sweep is safe to run by hand at any time:

```bash
~/projects/rosetta/rosetta_chronicle/hooks/chronicle-sweep.sh
```

Both tools share `~/.config/rosetta/chronicle.env` written by team-setup.

## Install

Prefer:

```bash
cd ~/projects/rosetta/rosetta_dev-scripts
yarn workspace team-setup dev -- setup
```

That writes the shared env file and registers Claude + Cursor hooks. Manual
install steps below are for reference / recovery.

### 1. Build the CLI

```bash
cd ~/projects/rosetta/rosetta_chronicle
yarn build
```

### 2. Shared Chronicle env

Created automatically at `~/.config/rosetta/chronicle.env`:

```bash
export CHRONICLE_REPO="$HOME/projects/rosetta/rosetta_chronicle_<your-login>"
export CHRONICLE_PROJECT="$HOME/projects/rosetta"
```

You may also add those exports to `~/.zshrc` if you want them in every shell.

### 3. Register the Claude Code Stop hook

Add to your `~/.claude/settings.json` under `"hooks"`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/<you>/projects/rosetta/rosetta_chronicle/hooks/stop-append.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

### 4. Register Cursor hooks

Add to `~/.cursor/hooks.json` (user-level):

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "command": "/Users/<you>/projects/rosetta/rosetta_chronicle/hooks/cursor-session-start.sh"
      }
    ],
    "stop": [
      {
        "command": "/Users/<you>/projects/rosetta/rosetta_chronicle/hooks/cursor-stop-append.sh",
        "loop_limit": null
      }
    ]
  }
}
```

### 5. Verify

Start and end a Claude Code session, then check the log:

```bash
tail -20 "$CHRONICLE_REPO/stop-hook.log"
```

You should see lines like:

```
2026-07-22T19:00:00Z [stop-append] done
```

And check your Chronicle repo for today's entry:

```bash
cat "$CHRONICLE_REPO/chronicles/$(date +%F).md"
```

## Manual backfill

To generate Chronicles for past sessions you already have:

```bash
chronicle backfill \
  --repo "$CHRONICLE_REPO" \
  --project ~/projects/rosetta \
  --start 2026-07-01 \
  --end 2026-07-21
```

To preview without writing:

```bash
chronicle backfill \
  --project ~/projects/rosetta \
  --start 2026-07-21 \
  --dry-run
```

## Append a specific session on demand

```bash
chronicle append-session \
  --repo "$CHRONICLE_REPO" \
  --session-id <uuid>
```

## Multiple workspaces

If you work across several workspace roots, run one backfill per workspace, or
set `CHRONICLE_PROJECT` to the broadest root that covers all your sessions:

```bash
export CHRONICLE_PROJECT="$HOME/projects"  # matches all sub-projects by prefix
```

The Claude Stop hook uses the `cwd` from each Stop event automatically, so
cross-workspace sessions are scoped correctly per session without extra config.
