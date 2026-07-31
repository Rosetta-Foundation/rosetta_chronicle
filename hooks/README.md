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

Cursor transcripts are **not** Claude Code JSONL. Auto-append for Cursor is
best-effort today; Chronicle will log a miss until a Cursor transcript adapter
lands. Env wiring is ready either way.

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
