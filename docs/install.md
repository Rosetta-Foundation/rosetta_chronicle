# Install Chronicle (CLI)

Chronicle is a local engine. The first consumer is this CLI. There is
not yet a Homebrew tap or compiled release — those come after this
from-source path is stable.

## From source (checkout)

Requires [Bun](https://bun.sh) 1.3+ and Node 20+.

```bash
git clone https://github.com/Rosetta-Foundation/rosetta_chronicle.git
cd rosetta_chronicle
./scripts/install.sh
```

The script runs `bun install` + `bun run build` and symlinks
`dist/bin/cli.js` to `~/.local/bin/chronicle`. Put `~/.local/bin` on
your `PATH` if `chronicle` is not found.

```bash
chronicle version
chronicle vault-status
```

Rebuild after pulling CLI changes (`./scripts/install.sh` or
`bun run build` — the symlink already points at `dist/`).

`CHRONICLE_BIN_DIR` overrides the symlink location.

## Default data-dir

`chronicle start` is the V1 turn-on command (same as `watch`).
`--once` is a single pass. Data-dir defaults as below.

Observe and vault commands use, in order:

1. `--data-dir <dir>`
2. `$CHRONICLE_DATA_DIR`
3. `~/.local/share/rosetta/chronicle/default`

`install.sh` creates the default directory (`0700`). It does **not**
move or rename an existing pilot vault. Pass `--data-dir` to keep
using a path you already have.

## Not this drop

- npm / `npx` publish
- Homebrew tap / bottled binary
- Docker
- `team-setup` does not install this CLI; it only writes
  `CHRONICLE_REPO` / `CHRONICLE_PROJECT` for the personal ledger
