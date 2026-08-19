# Rosetta Chronicle Engine — Documentation Synchronization Directive

**Status:** standing order (agents load this via the `documentation-sync` rule)
**Copies:** this file (engine-local) and
`rosetta_dev-scripts/team-setup/docs/documentation-sync.md`. Keep them aligned.

## Purpose

Keep all documentation in `Rosetta-Foundation/rosetta_chronicle` synchronized with the actual engine.

This is not a one-time README rewrite. Treat documentation drift as an engineering problem.

The repository should accurately represent:

- what exists today
- what is experimental
- what is planned
- what architectural direction is emerging

The documented model, implemented model, and accepted architectural model should agree.

---

## Audit Scope

Review:

- README.md
- architecture documentation
- ADR references
- PRD references
- CLI documentation
- source documentation
- data model documentation
- setup documentation
- testing documentation
- examples
- architectural comments
- command help output

Classify findings:

- CURRENT
- OUTDATED
- MISSING
- CONTRADICTORY
- IMPLEMENTED BUT UNDOCUMENTED
- DOCUMENTED BUT NOT IMPLEMENTED

---

## Architecture Documentation

Document the architecture that actually exists.

Include:

CLI → Handler → Service → Repository/Adapters → Domain Types → Outputs

Clearly distinguish:

- source adapters
- repositories
- services
- handlers
- domain models
- persistence
- derived representations

Do not invent abstractions that do not exist.

---

## Data Model Accuracy

Document the actual meaning of:

- Activity
- Evidence
- Daily Chronicle
- source-specific records

Do not imply that source records are Activities.

Preserve the conceptual distinction:

Source
↓
Source Record / Artifact
↓
Derived Representation
↓
Activity / Reflection / Other Chronicle representation

Clearly label implemented versus planned capabilities.

---

## ChatGPT Export Documentation

Document accurately.

Implemented:

- read-only export inventory
- archive inspection
- conversation shard discovery
- graph reconstruction
- parent/child topology reconstruction
- current-node preservation
- attachment reference inspection
- event time versus ingestion time distinction
- missing attachment representation
- synthetic fixtures
- archive hashing
- source-graph persistence (topology and type only; not Activity)
- provenance-preserving derived records (human-authored; not Activity)
- named transformation registry and immutable execution records
- persisted transformation definition artifacts (recipe identity)
- transformation-provenance compatibility helper (single-hop execution walk)
- first-class provenance graph traversal (backward and forward; partial integrity)
- machine interpretation of explicitly cited ChatGPT nodes
  (`candidate-observation` / `interpret-source`; not Activity)
- live xAI Responses HTTP transport for interpret-source
  (`XAI_API_KEY`, `grok-4.6`, `reasoning_effort=high`; no vendor SDK)
- E4b measured locally (two physical xAI / `grok-4.6` invocations
  against the private specimen: first transport failure
  `not-committed`, second committed interpretation; sanitized
  result in `docs/design/interpretation-policy.md`; private source
  and observations are not in this repository)
- append-only human evaluation of a derived record
  (`evaluate-derived`; not biography, not Activity)
- read-only current-understanding view
  (`current-understanding`; computed, not a durable artifact;
  `docs/design/current-understanding.md`)
- E5 measured locally (three append-only human evaluations of the
  three E4b machine interpretations: `evidenceSupport = supported`
  × 3, `personalRecognition` omitted; machine records remained
  byte-identical and `unreviewed`; no provider invoke; sanitized
  result in `docs/design/evaluation.md`; private source,
  observations, and evaluation prose are not in this repository)

Not implemented:

- ChatGPT import into Activity
- Daily Chronicle synthesis from ChatGPT
- organizational promotion
- automatic summarization or reflection extraction
- raw attachment persistence
- generalized personal activity modeling
- a second live provider, Cursor agent transport, a vendored SDK,
  or a local inference adapter (backlog:
  `docs/design/local-model-adapter.md`; not E6)
- bulk conversation scan
- biography, profile, or materialized current-understanding artifact
- general model reliability, multimodal coverage, or biography

---

## Privacy Boundaries

The public engine may contain:

- machinery
- schemas
- algorithms
- generalized knowledge
- synthetic fixtures
- tests

The public engine must not contain:

- personal conversations
- personal exports
- personal images
- personal audio
- private attachments
- private Chronicle content
- unnecessary personal corpus fingerprints

Personal Chronicle and Organizational Chronicle are separate contexts.

Document:

Personal Chronicle
↓
intentional selection/transformation
↓
review
↓
Organizational Chronicle

Do not document automatic promotion unless implemented.

---

## CLI Documentation

Document commands from actual implementation.

Include:

- command names
- arguments
- outputs
- side effects
- read-only versus mutating behavior
- failure behavior

Keep inventory, import, interpret-source, evaluate-derived, and
current-understanding separate.

---

## Future PR Documentation Requirement

PRs that change:

- behavior
- architecture
- CLI
- schema
- source support
- privacy boundaries

should update documentation in the same change.

Documentation drift should be treated like test drift.

---

## Documentation Map

Maintain clear ownership:

README
- Architecture
- Operations
- Sources
- Planning

Avoid duplicating the same architectural truth in multiple places.

---

## Architectural History

Document evolution without turning operational docs into a diary.

Example:

v0.1 engineering synthesis
↓
source inventory
↓
source graph discovery
↓
source-record persistence
↓
derived representations
↓
transformation registry / execution provenance
↓
persisted transformation definitions
↓
provenance graph traversal
↓
machine interpretation (candidate-observation)

The detailed path belongs in Chronicle records.

The repository documentation should preserve durable architectural state.

---

## Definition of Done

- [ ] README accurately describes the current engine.
- [ ] Architecture is documented.
- [ ] Data model is documented.
- [ ] CLI documentation matches implementation.
- [ ] ChatGPT capability is documented accurately.
- [ ] Unsupported capabilities are explicit.
- [ ] Privacy boundaries are documented.
- [ ] PRD and ADR references are reconciled.
- [ ] Personal corpus fingerprints are removed where unnecessary.
- [ ] Implemented features are documented.
- [ ] Unimplemented features are not presented as complete.
- [ ] Documentation ownership is clear.
- [ ] Future PRs include documentation synchronization.

---

## Final Principle

The engine should be capable of explaining itself.

A system that cannot preserve an accurate representation of its own current state is already losing its path.

The public engine contains the machinery.

The private Chronicle contains the richer lived trajectory.

Documentation must accurately represent both.

**The path is the data.**
