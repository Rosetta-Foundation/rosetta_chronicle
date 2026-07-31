# Chronicle Stop Hook — Live Session Append

Automatically appends each Claude Code session to your Daily Chronicle the
moment it ends. Zero manual action required once installed.

## How it works

Claude Code fires the **Stop** event when an agent finishes responding. The
hook receives a JSON payload (stdin) with `session_id` and `cwd`, then calls
`chronicle append-session` which:

1. Finds the session's JSONL transcript file in `~/.claude/projects/`
2. Extracts the `ai-title` (or truncated first prompt, flagged for review)
3. Appends one activity entry to today's Daily Chronicle in your personal repo
4. Commits the result

Content-hash dedup means re-running never creates duplicates.

## Install

### 1. Build the CLI

```bash
cd ~/projects/rosetta/rosetta_chronicle
yarn build
```

### 2. Set your Chronicle repo path

Add to your `~/.zshrc` (or `~/.bashrc`):

```bash
export CHRONICLE_REPO="$HOME/projects/rosetta/rosetta_chronicle_<your-login>"
```

Replace `<your-login>` with your GitHub login (e.g. `example-user`).

Reload: `source ~/.zshrc`

### 3. Register the Stop hook

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

Use the **absolute path** to `stop-append.sh`. The `"async": true` flag means
the hook runs in the background and never delays the session ending.

### 4. Verify

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

If you work across several workspace roots (rosetta, aiops, enterprise), run
one backfill per workspace, or set `CHRONICLE_PROJECT` to the broadest root
that covers all your sessions:

```bash
export CHRONICLE_PROJECT="$HOME/projects"  # matches all sub-projects by prefix
```

The hook uses the `cwd` from each Stop event automatically, so cross-workspace
sessions are scoped correctly per session without extra config.
