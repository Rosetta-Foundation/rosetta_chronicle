#!/usr/bin/env bash
# Cursor stop hook — best-effort Chronicle append for Cursor Agent sessions.
#
# Registered in ~/.cursor/hooks.json by team-setup. Sources shared env from
# ~/.config/rosetta/chronicle.env, normalizes the Cursor stdin payload into the
# shape chronicle append-session expects, then delegates to stop-append.sh.
#
# Cursor transcripts are not Claude Code JSONL. append-session may no-op or
# log a miss until Chronicle gains a Cursor transcript adapter — that is OK;
# this hook must never block the agent loop.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROSETTA_CHRONICLE_ENV:-$HOME/.config/rosetta/chronicle.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

HOOK_PAYLOAD=$(cat || true)
export HOOK_PAYLOAD

NORMALIZED="$(node <<'NODE'
const raw = process.env.HOOK_PAYLOAD || '';
let data = {};
try {
  data = JSON.parse(raw || '{}');
} catch {
  data = {};
}
const sessionId =
  data.session_id || data.conversation_id || data.generation_id || '';
const roots = Array.isArray(data.workspace_roots) ? data.workspace_roots : [];
const cwd = data.cwd || roots[0] || process.cwd();
process.stdout.write(
  JSON.stringify({
    session_id: sessionId,
    cwd,
    hook_event_name: 'Stop',
    transcript_path:
      data.transcript_path || process.env.CURSOR_TRANSCRIPT_PATH || null,
    source: 'cursor',
  }),
);
NODE
)" || NORMALIZED='{"session_id":"","cwd":"","hook_event_name":"Stop","source":"cursor"}'

# Always succeed from Cursor's perspective — Chronicle capture is best-effort.
echo "$NORMALIZED" | "$SCRIPT_DIR/stop-append.sh" || true

# Cursor stop hooks may print JSON; empty object = no follow-up.
printf '%s\n' '{}'
