#!/usr/bin/env bash
# Chronicle trailing catch-up sweep — makes Chronicle capture eventually
# consistent without a daemon.
#
# Live capture (the stop hooks) can never be complete on its own: sessions can
# end without a stop event (closed window, crash, sleep), and Cursor writes
# session titles to meta.json asynchronously, after capture. This sweep
# re-runs `chronicle backfill` over a trailing window so recent days
# self-heal: late titles upgrade [needs-review] entries and orphaned sessions
# get picked up. Content-hash dedup and the clobber guard make re-runs safe.
#
# Invoked in the background by cursor-session-start.sh on every new Cursor
# session; also safe to run by hand or from a scheduler.
#
# Sweep window (marker-based, not fixed-size — vacation-safe):
#   start = last *successful* sweep date minus 2 days (heals late titles);
#           when no sweep has ever succeeded, 7 days back.
#   end   = today
# The success marker only advances after a clean backfill, so returning from
# any length of absence sweeps the full gap since the last good run.
#
# Throttle: at most one attempt per day (attempt marker), so a failing sweep
# retries tomorrow instead of on every session start.
#
# State lives in ~/.config/rosetta/ (not the Chronicle repo, to keep it clean):
#   last-sweep-success   date swept through on the last clean run
#   last-sweep-attempt   date of the last attempt (throttle)
#   sweep.log            backfill output

set -euo pipefail

ENV_FILE="${ROSETTA_CHRONICLE_ENV:-$HOME/.config/rosetta/chronicle.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

# Nothing to sweep without a Chronicle repo.
if [[ -z "${CHRONICLE_REPO:-}" ]]; then
  exit 0
fi

STATE_DIR="${ROSETTA_CHRONICLE_STATE_DIR:-$HOME/.config/rosetta}"
SUCCESS_MARKER="$STATE_DIR/last-sweep-success"
ATTEMPT_MARKER="$STATE_DIR/last-sweep-attempt"
LOG_FILE="$STATE_DIR/sweep.log"
mkdir -p "$STATE_DIR"

TODAY=$(date +%F)

# Throttle: one attempt per day.
if [[ -f "$ATTEMPT_MARKER" && "$(cat "$ATTEMPT_MARKER")" == "$TODAY" ]]; then
  exit 0
fi

# Subtract days from a YYYY-MM-DD date, handling BSD (macOS) and GNU date.
# BSD date requires -v before -f (flags after the date operand are ignored).
minus_days() {
  local from="$1" days="$2"
  date -j -v-"${days}"d -f %F "$from" +%F 2>/dev/null \
    || date -d "$from - $days days" +%F
}

if [[ -f "$SUCCESS_MARKER" ]]; then
  START=$(minus_days "$(cat "$SUCCESS_MARKER")" 2)
else
  START=$(minus_days "$TODAY" 7)
fi
# Clamp: never start after today (clock skew / hand-edited marker).
if [[ "$START" > "$TODAY" ]]; then
  START="$TODAY"
fi

# Resolve chronicle CLI — prefer the built dist, fall back to a global install.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -x "$REPO_ROOT/dist/bin/cli.js" ]]; then
  CHRONICLE_CMD=(node "$REPO_ROOT/dist/bin/cli.js")
elif command -v chronicle &>/dev/null; then
  CHRONICLE_CMD=(chronicle)
else
  echo "$(date -u +%FT%TZ) [sweep] chronicle CLI not found — run 'yarn build' in $REPO_ROOT" >> "$LOG_FILE"
  exit 0
fi

echo "$TODAY" > "$ATTEMPT_MARKER"
echo "$(date -u +%FT%TZ) [sweep] $START → $TODAY" >> "$LOG_FILE"

if "${CHRONICLE_CMD[@]}" backfill \
  --repo "$CHRONICLE_REPO" \
  ${CHRONICLE_PROJECT:+--project "$CHRONICLE_PROJECT"} \
  --start "$START" \
  --end "$TODAY" \
  >> "$LOG_FILE" 2>&1; then
  echo "$TODAY" > "$SUCCESS_MARKER"
  echo "$(date -u +%FT%TZ) [sweep] done" >> "$LOG_FILE"
else
  echo "$(date -u +%FT%TZ) [sweep] FAILED — will retry tomorrow (window preserved)" >> "$LOG_FILE"
fi
