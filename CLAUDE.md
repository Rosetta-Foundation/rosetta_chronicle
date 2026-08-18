# rosetta_chronicle

Chronicle is the **memory engine** of the Rosetta platform — it turns engineering activity into
durable, structured organizational knowledge. It is the source of truth that downstream products
(Wayfinder, performance reviews, docs generation, knowledge graphs) consume. **Chronicle must never
become coupled to any single downstream consumer.**

## Core Design Principles

- **AI-native** — assume AI is a first-class consumer of everything Chronicle produces.
- **Source-driven** — never ask engineers to duplicate work; activity becomes knowledge automatically.
- **Evidence-first** — every output traces back to real evidence (commits, PRs, Jira, conversations). Nothing is fabricated.
- **Durable** — knowledge improves over time; avoid ephemeral chat history, create reusable context.
- **Human + AI** — outputs are equally valuable to engineers, managers, and future AI agents.
- **Extensible** — Chronicle exposes structured data; it does not own presentation.

## Architecture — Handler / Service / Repository (MANDATORY)

All TypeScript in this repo follows the Handler / Service / Repository + InversifyJS pattern. The
full ruleset is the workspace rule at `../.claude/rules/architecture-hsr.md` — read it before writing
or reviewing code. In brief:

- One-way dependency: **Handler → Service → Repository**. Repos never call services; services never call services.
- **Handler** — entry point; parse input, dispatch to a service, return output. No business logic.
- **Service** — business/orchestration logic; composes repository calls.
- **Repository** — resource access only (Git, GitHub, Jira, filesystem). No business logic.
- Every class `@injectable()`; deps constructor-injected via `@inject(TOKEN)`; private fields `_`-prefixed and `readonly`.
- Tokens are `Symbol.for(...)` in `CHRONICLE_TOKENS` (`src/tokens.ts`); the token is the runtime injection key.
- Each file co-locates `interface IFoo` + `@injectable() class Foo implements IFoo`. Interfaces are `I`-prefixed; no `abstract class`.
- `index.ts` wires the container only. Pure functions → `src/utils/`; boundary types → `src/types.ts`.

### Source layout

```
src/
├── index.ts                     composition root (reflect-metadata, Container, bindings)
├── tokens.ts                    CHRONICLE_TOKENS (Symbol.for)
├── types.ts                     boundary/DTO types (Activity, Evidence, DailyChronicle, Tag, …)
├── daily-chronicle.handler.ts   IDailyChronicleHandler / DailyChronicleHandler
├── chatgpt-inventory.handler.ts IChatGptInventoryHandler (PRD-0027 Phase 1)
├── chatgpt-import.handler.ts    IChatGptImportHandler (PRD-0027 Phase 2)
├── derived-record.handler.ts    IDerivedRecordHandler (PRD-0027 derived records)
├── transformation.handler.ts    ITransformationHandler (PRD-0027 executions / definitions)
├── services/
│   └── chronicle.service.ts     IChronicleService — synthesize sources → DailyChronicle
├── repositories/                one per source (interface + stub impl)
│   ├── git.repository.ts
│   ├── jira.repository.ts
│   ├── claude-code.repository.ts
│   └── notes.repository.ts
└── utils/
    └── tags.utils.ts            pure tag-inference helper
```

Future sources (GitHub, Slack, Confluence, Calendar) are added as new repositories following the
same pattern.

## Build & Test

```bash
bun install
bun run build   # tsc (TypeScript 7, native)
bun run test    # jest (@swc/jest transform; type-checking happens in build)
```

### Testing the DI pattern

Per test: fresh `new Container()`, bind `jest.fn()` mocks via `.toConstantValue`, bind the real class
via `.to`, then `container.get(TOKEN)`. `require()` the class + tokens after module-level `jest.mock()`s.
Test class behaviour, never the container wiring.

## Git Workflow

Standard Rosetta workflow (see the workspace root `CLAUDE.md`): branch from an up-to-date `main`
(`f/` features, `b/` bugs), Conventional Commits (ticket as scope when the branch has one), open a PR
with `gh pr create --fill`, then run the Copilot and PR-checks review cycles.
**Do not commit on `main`** unless a human explicitly authorizes a documented exception (foundation
bootstrap or emergency hotfix). Husky enforces Conventional Commits on every commit.

## Code Style

- TypeScript strict mode
- Prettier: single quotes, semicolons, 2-space indent, 80 char width
- No unused variables or imports; prefer `const`, never `var`
