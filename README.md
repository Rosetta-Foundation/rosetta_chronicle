# rosetta_chronicle

> Transforms engineering activity into durable organizational knowledge.

Chronicle is the **memory engine** of the Rosetta platform. It continuously captures engineering
context — Git, GitHub, Jira, AI conversations, notes, and more — and synthesizes it into structured
knowledge that is equally valuable to humans and AI.

Chronicle is the source of truth. Everything else (Wayfinder, performance reviews, documentation
generation, knowledge graphs) consumes Chronicle. It is deliberately **not** coupled to any single
downstream product.

## Where Chronicle sits

```
 Git · GitHub · Jira · Calendar · Claude Code · Cursor · Confluence · Slack · Notes
                              │
                              ▼
                       Chronicle Engine
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   Career Timeline      Documentation          AI Context
        ▼                     ▼                     ▼
 Promotion Evidence      Wayfinder UI         Knowledge Graph
```

See [`docs/architecture.md`](docs/architecture.md) for the full architecture and design principles,
[`docs/chronicle-overview.md`](docs/chronicle-overview.md) for the Chronicle overview, and [`docs/mvp.md`](docs/mvp.md) for the
v0.1 scope. Keep those documents synchronized with the engine — see
[`docs/documentation-sync.md`](docs/documentation-sync.md).

## MVP — v0.1 Daily Chronicle

The first milestone is intentionally small: generate a **Daily Engineering Chronicle** from a day's
Git changes, Jira tickets (with parent Epic and OKR), Claude Code and Cursor agent sessions, and
manual notes. See [`docs/mvp.md`](docs/mvp.md) for the input/output spec.

## Development

```bash
bun install
bun run build   # tsc (TypeScript 7, native)
bun run test    # jest (@swc/jest transform; type-checking happens in build)
```

### Architecture

All TypeScript follows the **Handler / Service / Repository + InversifyJS** pattern that is mandatory
across Rosetta. See the workspace rule at `../.claude/rules/architecture-hsr.md` and the summary in
[`CLAUDE.md`](CLAUDE.md). ChatGPT export inventory, source-graph import, derived records,
transformations, provenance walks, machine interpretation (`interpret-source`),
and append-only human evaluation (`evaluate-derived`)
are documented under [`docs/design/`](docs/design/).
The memory-publication invariant for machine output lives in
[`docs/design/interpretation-policy.md`](docs/design/interpretation-policy.md).

> Chronicle is the memory. Wayfinder is the guide.

## License

[Apache-2.0](LICENSE) — Copyright 2026 Rosetta Foundation.
