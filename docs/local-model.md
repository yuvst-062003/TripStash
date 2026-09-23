# Running a free, local model

TripStash does not need a paid API. Extraction runs against open weights on
your own machine through any OpenAI-compatible server, so the running cost is
electricity.

## Which model

The job is narrow: read a caption or transcript and emit a strict JSON object.
That rewards instruction-following and schema adherence far more than general
knowledge, so a 7B model is the right size — and the review queue catches what
it gets wrong.

| Machine | Model | Roughly |
| --- | --- | --- |
| 16 GB RAM or better | **Qwen2.5 7B Instruct**, Q4_K_M | ~4.7 GB, the default |
| 8 GB RAM | Qwen2.5 3B Instruct, Q4_K_M | ~2 GB |
| Plenty of RAM, want better | Qwen2.5 14B Instruct, Q4_K_M | ~9 GB |

**Why Qwen2.5 as the default:** Apache 2.0, so no licence conditions for a
personal app; strong JSON-schema adherence, which is the actual task; and
genuinely multilingual, which matters when half the place names in the saved
content are Spanish.

Reasonable alternatives: **Phi-4** (MIT licence, strong for its size),
**Mistral 7B Instruct** (Apache 2.0). Llama models work but carry a community
licence rather than a plain open one. Avoid anything under 3B — schema
adherence collapses and you spend the saving on correcting extractions.

> These were chosen on task fit and licence. The sandbox this was built in
> blocks Hugging Face and the Ollama registry, so the exact tag names should be
> confirmed on the hub before you pull, and no model was benchmarked here.

## Setting it up

```bash
# 1. Install Ollama (ollama.com), then pull the model once
ollama pull qwen2.5:7b-instruct-q4_K_M

# 2. Point TripStash at it
export TRIPSTASH_AI_PROVIDER=local
export TRIPSTASH_LLM_BASE_URL=http://localhost:11434/v1
export TRIPSTASH_LLM_MODEL=qwen2.5:7b-instruct-q4_K_M

# 3. Restart the API
uvicorn app.main:app --reload
```

Any OpenAI-compatible server works the same way — llama.cpp's `llama-server`
(`--port 8080` → `http://localhost:8080/v1`), LM Studio, or vLLM. Nothing in
the adapter is Ollama-specific.

Check which provider is live at any time: `curl localhost:8000/health`.

## What keeps a small model honest

A 7B model will hallucinate if you let it. Three things in
`app/adapters/local_llm.py` stop that reaching you:

1. **Constrained decoding.** The `ExtractionResult` JSON schema travels with
   every request, in both the OpenAI (`response_format`) and Ollama (`format`)
   spelling, so the output cannot drift out of the contract.
2. **One repair attempt.** A schema violation is handed back verbatim once. A
   second failure is a failure.
3. **Evidence grounding.** Every candidate must quote the source word for word,
   and any quote not actually present in the text is **dropped before you see
   it**. This is the important one: it is what makes a small model usable for a
   product whose whole premise is that it does not invent things.

If the server is not running, extraction falls back to the built-in rule-based
reader and says so, rather than losing the capture.

## Adapting it to your data

Two stages, and the first one is already running.

**Now — few-shot, free, no training.** Every approve, edit and ignore in the
review queue is a labelled example. `app/services/adaptation.py` sends your
route and a handful of your own recent decisions with each extraction request,
preferring items you *corrected*, since those are where you and the model
disagreed. This improves results from your first correction onward and costs
nothing.

**Later — a LoRA, if it earns its place.** The same decisions export as a
supervised fine-tuning set:

```bash
python -m app.export_training > tripstash-sft.jsonl
```

Each line is one source and exactly the items you kept — a source where you
rejected everything is a valid record, because that is how a model learns
restraint. The command prints how many reviewed sources you have and whether
that is enough.

**Fine-tuning is deliberately not wired up yet, and that is a recommendation,
not an omission.** Below roughly 50 reviewed sources a LoRA mostly memorises
your examples and gets worse at everything else, and training needs a GPU that
this project assumes you do not have. Free GPU tiers (Colab, Kaggle) are
usable for a 7B LoRA with Unsloth or PEFT when you get there. Until then,
few-shot adaptation plus the review queue gets you most of the benefit for none
of the cost.

## Honest limits

- Extraction quality on a 7B model is below a frontier model. The review queue
  and the grounding guard are what make that an acceptable trade, not a claim
  that they are equivalent.
- **No speech-to-text or OCR is wired up.** A downloaded video with no caption
  still lands in Inbox as a recoverable failure. Whisper (`whisper.cpp`, also
  free and local) is the natural next step and slots behind the same
  `transcribe()` method.
- The assistant (`app/services/assistant.py`) remains deterministic Python. It
  retrieves your records and computes distances and budgets exactly; only
  extraction uses the model. Routing its prose through a 7B model would risk
  ungrounded answers for very little gain, so that is a deliberate choice.
