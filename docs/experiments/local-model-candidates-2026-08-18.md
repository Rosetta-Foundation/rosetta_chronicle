# Experiment note — local model candidates (2026-08-18)

**Status:** Disposable operator snapshot. Not engine design.
**Not:** a Chronicle default, ranking, or architectural recommendation.

Durable contract: `docs/design/local-model-adapter.md`.

Pick a local model by schema discipline on
`candidate-observation/1`, exact digest, license, and available
hardware — not by chat-arena rank. Confirm the served digest before
any smoke. This list will rot.

## Verified-available families (non-normative)

Families commonly present on Ollama’s public library on 2026-08-18,
plus notes from that day’s operator conversation. Not an
endorsement.

| Family | Operator note that day | Caution |
| --- | --- | --- |
| Qwen 3 / 3.5 | Often used for structured output; many Apache-2.0 sizes | Confirm tag + digest |
| Gemma 4 | Apache 2.0; workstation-sized dense/MoE variants exist | Confirm digest, not display name |
| Llama 3.3 / 4 | Mature local-runtime ecosystem | Meta community license, not Apache; large MoE variants need serious VRAM |
| DeepSeek-R1 distills | Different reasoning style; possible *second* local mind later | Often verbose; weaker first pick for strict JSON |
| Mistral Small / Magistral | Lean Apache-2.0 line | Confirm schema obedience on this prompt |
| gpt-oss | Open-weight Apache-2.0; runs on Ollama / llama.cpp / vLLM | Unproven on this observation contract |

Hardware bands discussed that day (not a Chronicle recommendation):

- ~8–16 GB unified / VRAM: Qwen 3.x in the 7B–14B band
- ~24–36 GB: Qwen 3.x 32B or Gemma 4 26B/31B-class
- Do not start a competing-machines smoke with 70B+ or 400B-class
  MoE. The experiment is two minds, not a size contest.

Do not treat any row as “the Chronicle local model.”
