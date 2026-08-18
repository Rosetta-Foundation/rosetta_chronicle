# Design — Local model transport (backlog)

**Status:** Backlog. Not implemented. Not E6.
**Date:** 2026-08-18

A local open-weight model should be **another
`IModelInvocationRepository` adapter**, not another interpretation
pathway.

```text
InterpretationService
        │
        ▼
IModelInvocationRepository
        │
        ├── current: fixture / xAI Responses (`grok-4.6`)
        │
        └── backlog: local inference HTTP
                └── ollama | llama.cpp | vLLM | …
```

Everything above that boundary stays identical: interpretation
policy, source resolution, schema validation, execution identity,
occurrence semantics, derived records, evaluation, and provenance.

Chronicle should not care whether the intelligence came from a
remote API or a local runtime. It should care **which machine
performed the interpretation and under what reproducible
conditions**.

This is **not** E6. E6 is a read-only current-understanding view
over existing history. It must stay model-free.

## Why stronger provenance than xAI

For xAI, `model: grok-4.6` ultimately points at something xAI
controls. `providerRequestId` and provider-returned `modelVersion`
are the receipt we can keep.

For a local open-weight model, Chronicle can potentially identify
the **actual model artifact**:

```text
provider: local
runtime: ollama | llama.cpp | vllm | …
runtimeVersion: …
model: …
modelDigest: sha256:…
quantization: …
configuration:
  temperature: …
  seed: …
```

The digest is the interesting field. Combined with policy identity
and exact source refs, a later mind can ask:

> This interpretation was produced from these source nodes, under
> policy P, using these exact model weights, through runtime R,
> with configuration C.

`model: "llama-whatever"` is not enough.

These fields belong on the **occurrence / producer / configuration**
surface, not in a second interpretation schema. Exact key names are
an implementation decision. Do not invent a parallel derived-record
type.

## Execution boundary is not a privacy blessing

A later explicit property such as:

```text
dataBoundary: local | remote
```

may be useful. It must describe the **actual execution boundary**,
not a vague safety claim.

`local` is not synonymous with private or safe. A local runtime can
have telemetry, remote tools, model downloads, and plugins. Do not
attach a privacy blessing to the word `local`.

## Competing-machines experiment (future)

E5 explicitly did **not** prove competing machine interpretations.

Once a local adapter exists, the same source selection and the same
`InterpretationPolicy` can be run twice:

```text
                 same source
                     │
                     ▼
             same interpretation
                  policy
                 /      \
                /        \
        Grok 4.6       local model
             │             │
             ▼             ▼
            X1             X2
              \           /
               \         /
            HUMAN EVALUATION
```

Keep both paths. Do not decide that one model is better.

The human may support both, recognize neither, or prefer one on
evidence and the other on recognition. Disagreement is part of the
historical record. Identity remains artifact identity. E6, if later
approved, would project that history — it would not collapse it.

First competing-machines smoke should use **one** local model, the
same policy, and the same source selection as the xAI path, then
human evaluation of both `DerivedRecord`s. The experiment is two
minds, not a size contest and not a ranking.

## Choosing a local model

The engine does not name a default local model.

Pick a local model by:

- schema discipline on `candidate-observation/1`
- exact artifact digest (not a marketing tag)
- license
- available hardware

Embeddings, vision-only tags, and uncensored/roleplay fine-tunes
are the wrong artifact class for this path.

Family names, VRAM bands, and “looks good on this date” picks are
operator guidance, not architecture. A disposable 2026-08-18
snapshot lives at
`docs/experiments/local-model-candidates-2026-08-18.md`. It is
non-normative and will go stale.

## Out of scope (this backlog item)

- Implementing the adapter
- E6 current-understanding
- Vendor SDKs
- Cursor agent transport
- Declaring a default local model in the engine
- Treating `local` as private
- Reliability claims
- Automatic preference of one machine over another
- Activity / Daily Chronicle / promotion
