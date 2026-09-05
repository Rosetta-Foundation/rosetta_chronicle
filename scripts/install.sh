#!/usr/bin/env bash
# From-source install: build the engine CLI and put `chronicle` on PATH.
# Product users who do not want a checkout will use a later release channel.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${CHRONICLE_BIN_DIR:-$HOME/.local/bin}"
DATA_DIR="${CHRONICLE_DATA_DIR:-$HOME/.local/share/rosetta/chronicle/default}"
TARGET="$BIN_DIR/chronicle"
SOURCE="$ROOT/dist/bin/cli.js"

cd "$ROOT"

if ! command -v bun >/dev/null 2>&1; then
  echo "chronicle install: bun is required (https://bun.sh)" >&2
  exit 1
fi

bun install
bun run build

if [[ ! -x "$SOURCE" ]]; then
  echo "chronicle install: missing $SOURCE after build" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR" 2>/dev/null || true
ln -sfn "$SOURCE" "$TARGET"

echo "installed $TARGET -> $SOURCE"
echo "default data-dir $DATA_DIR"
if ! command -v chronicle >/dev/null 2>&1; then
  echo "chronicle is not on PATH yet; add $BIN_DIR to PATH" >&2
fi
"$TARGET" version
