# Chronicle — Overview

> Repo-local operational overview of Chronicle within the Rosetta platform. For the
> platform vision see the workspace `docs/VISION.md`; for founding principles see
> `docs/FOUNDATIONS.md`.

## Mission

Rosetta is an AI-native engineering knowledge platform whose mission is to transform everyday
engineering activity into durable, structured organizational knowledge.

Traditional documentation is manually written, immediately outdated, and disconnected from the
actual engineering process. Rosetta takes the opposite approach: instead of asking engineers to
document more, Rosetta continuously observes engineering activity (Git, GitHub, Jira, AI
conversations, architecture decisions, documentation, etc.) and transforms that activity into
structured knowledge that benefits humans and AI alike.

The long-term vision is a shared organizational memory that improves:

- Developer productivity
- AI effectiveness
- Documentation quality
- Onboarding
- Architecture understanding
- Engineering leadership
- Performance reviews
- Organizational alignment

Rosetta is designed as an extensible **platform**, not a single application.

## Philosophy

Rosetta is **NOT**:

- a documentation website
- a performance review tool
- another Confluence
- another knowledge base

Rosetta **IS**:

> The engineering memory layer for people, projects, and AI.

Every engineering artifact contributes to organizational memory. Every commit tells part of the
story. Rosetta remembers the rest.

## Workspace structure

```
rosetta/
├── rosetta_dev-scripts/   Workspace tooling and scaffolding
├── rosetta_chronicle/     Memory engine (this repo)
├── rosetta_wayfinder/     Knowledge guide (future consumer, placeholder today)
├── docs/                  Cross-cutting product & workspace docs
├── architecture/          Architecture decisions and history
└── shared/                Shared assets
```

Only `rosetta_chronicle` (and the tooling) is under active development today. Everything else
represents future expansion.

## Chronicle's role

Chronicle is the memory engine that continuously captures engineering context and transforms it into
reusable organizational knowledge. It should never become coupled to any single product or workflow,
and should eventually support multiple downstream consumers:

- Wayfinder
- Performance reviews
- Weekly accomplishments
- Promotion packets
- Documentation generation
- AI context retrieval
- Engineering analytics
- Knowledge graphs
- Architecture history

**Chronicle is the source of truth. Everything else consumes Chronicle.**

## Future repositories

Potential future repositories (not to be created until Chronicle proves the core concepts):

```
wayfinder · rosetta_atlas · rosetta_compass · rosetta_beacon · rosetta_shared
```

## Success metrics

Chronicle is successful if it eventually:

- Reduces manual documentation
- Improves onboarding speed
- Improves AI context quality
- Makes performance reviews largely automatic
- Preserves institutional knowledge
- Surfaces organizational history
- Makes engineers more effective
- Makes AI more accurate

## Guiding statement

Rosetta exists to ensure that valuable engineering knowledge is never lost.

Chronicle is the memory. Wayfinder is the guide. Together they transform the everyday work of
engineering into a lasting organizational advantage.
