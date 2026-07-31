#!/usr/bin/env bash
# Chronicle Stop hook — appends the ended session to today's Daily Chronicle.
#
# Installed in Claude Code settings.json as:
#   {
#     "Stop": [{
#       "hooks": [{
#         "type": "command",
#         "command": "/path/to/rosetta_chronicle/hooks/stop-append.sh",
#         "async": true
#       }]
#     }]
#   }
#
# Required env var (set in settings.json "env" block or shell profile):
#   CHRONICLE_REPO   Absolute path to your personal Chronicle repository.
#
# Optional env var:
#   CHRONICLE_PROJECT  Project path to scope session extraction to.
#                      Defaults to the cwd from the Stop hook payload.
#
# The hook receives a JSON payload on stdin with at minimum:
#   { "session_id": "...", "cwd": "...", "hook_event_name": "Stop" }
#
# The hook is async so it never blocks the session from ending.
# All output goes to a log file; nothing is printed to the user.

set -euo pipefail

# Shared env written by team-setup (Claude + Cursor). Optional if vars already set.
ENV_FILE="${ROSETTA_CHRONICLE_ENV:-$HOME/.config/rosetta/chronicle.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

LOG_DIR="${CHRONICLE_REPO:-$HOME/chronicle-logs}"
LOG_FILE="$LOG_DIR/stop-hook.log"
mkdir -p "$(dirname "$LOG_FILE")"

# Read stdin payload (passed by Claude Code or the Cursor adapter).
HOOK_PAYLOAD=$(cat)

# Nothing to do if CHRONICLE_REPO is not set.
if [[ -z "${CHRONICLE_REPO:-}" ]]; then
  echo "$(date -u +%FT%TZ) [stop-append] CHRONICLE_REPO not set — skipping" >> "$LOG_FILE"
  exit 0
fi

# Resolve chronicle CLI — prefer the built dist, fall back to ts-node dev path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -x "$REPO_ROOT/dist/bin/cli.js" ]]; then
  CHRONICLE_CMD="node $REPO_ROOT/dist/bin/cli.js"
elif command -v chronicle &>/dev/null; then
  CHRONICLE_CMD="chronicle"
else
  echo "$(date -u +%FT%TZ) [stop-append] chronicle CLI not found — run 'yarn build' in $REPO_ROOT" >> "$LOG_FILE"
  exit 0
fi

# Run the append-session command, piping the Stop hook payload on stdin.
# The CLI reads session_id and cwd from the JSON payload automatically.
echo "$HOOK_PAYLOAD" | $CHRONICLE_CMD append-session \
  --repo "$CHRONICLE_REPO" \
  ${CHRONICLE_PROJECT:+--project "$CHRONICLE_PROJECT"} \
  >> "$LOG_FILE" 2>&1 || true

echo "$(date -u +%FT%TZ) [stop-append] done" >> "$LOG_FILE"
