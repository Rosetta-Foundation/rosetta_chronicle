#!/usr/bin/env bash
# Cursor sessionStart hook — injects CHRONICLE_* into the agent session env.
#
# Registered in ~/.cursor/hooks.json by team-setup. Reads the shared env file
# written during personal Chronicle provisioning:
#   ~/.config/rosetta/chronicle.env
#
# Stdout must be JSON Cursor understands:
#   { "env": { "CHRONICLE_REPO": "...", "CHRONICLE_PROJECT": "..." } }

set -euo pipefail

ENV_FILE="${ROSETTA_CHRONICLE_ENV:-$HOME/.config/rosetta/chronicle.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  printf '%s\n' '{}'
  exit 0
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

# Fire the trailing catch-up sweep in the background — heals recent days
# (late titles, sessions that ended without a stop event) without blocking
# session start. The sweep self-throttles to one attempt per day.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$SCRIPT_DIR/chronicle-sweep.sh" ]]; then
  nohup "$SCRIPT_DIR/chronicle-sweep.sh" </dev/null >/dev/null 2>&1 &
fi

node -e '
const repo = process.env.CHRONICLE_REPO || "";
const project = process.env.CHRONICLE_PROJECT || "";
process.stdout.write(JSON.stringify({
  env: { CHRONICLE_REPO: repo, CHRONICLE_PROJECT: project },
}) + "\n");
'
