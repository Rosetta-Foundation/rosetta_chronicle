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

## Open-weight candidates (dated, not a product pick)

This list is a **2026-08-18** snapshot of families commonly served
by Ollama and similar local runtimes. It is not a Chronicle
endorsement and will go stale. Pick by instruction-following and
schema discipline (the `candidate-observation/1` contract), then by
license and VRAM — not by chat-arena rank.

| Family | Why it is a candidate | Caution |
| --- | --- | --- |
| Qwen 3 / 3.5 | Strong structured-output and instruction following; many Apache-2.0 sizes; wide VRAM ladder | Confirm the exact tag + digest before a smoke |
| Gemma 4 | Apache 2.0; dense and MoE sizes that fit a workstation | Confirm the served digest, not only the display name |
| Llama 3.3 / 4 | Mature ecosystem; easy to run | Meta community license, not Apache; Scout/Maverick need serious VRAM |
| DeepSeek-R1 distills | Useful later as a *second* mind (reasoning style) | Often verbose; weaker first pick for strict JSON |
| Mistral Small / Magistral | Lean Apache-2.0 European line | Confirm schema obedience on this prompt |
| gpt-oss | Open weights on common local runtimes | Unproven on this observation contract |

First competing-machines smoke should use **one** local model, same
policy and same source selection as the xAI path, then human
evaluation of both `DerivedRecord`s. Suggested starting class:

- **~8–16 GB** unified / VRAM: Qwen 3.x in the 7B–14B band
- **~24–36 GB**: Qwen 3.x 32B or Gemma 4 26B/31B-class
- Do **not** start with 70B+ or 400B-class MoE. The experiment is
  two minds, not a size contest.

Embeddings, vision-only tags, and uncensored/roleplay fine-tunes
are the wrong artifact for this path.

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
