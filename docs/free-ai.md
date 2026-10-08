# Running the AI without paying for it

Three capabilities, three answers, no subscription and no API key held by
anyone but you.

| | What it does | Cost | Key |
|---|---|---|---|
| **Travel guide** | Answers about places you have saved nothing about | Free | None |
| **Local model** | Reads a reel or a document into typed candidates | Free | None |
| **Web search** | A general search engine, when the guide has nothing | Paid | Yes |

The first two are on. The third is optional and off.

## The travel guide — already running

Wikivoyage, via its public API. No key, no account, no quota beyond being
polite about it. Confirm with:

```
curl -s https://app-production-f91d.up.railway.app/health | grep travel_guide
```

It answers about **destinations**, not individual businesses. Ask it about
Antigua and it answers; ask about one hostel in Antigua and it has never heard
of the place, and says so.

Its section headings are the reason it beats a search engine here: "Stay safe"
is a safety note, "Get in" is transport, "Sleep" is accommodation. Ask "is
Tbilisi safe at night?" and the safety section comes back first, correctly
typed, with nothing having to guess what the paragraph was about.

Everything it returns is marked `from_web` and `yours: false`, graded as
`reviews` and never `official`, and carries its CC BY-SA attribution.

## The local model — free, on your own machine

Ollama is already installed here, and `gemma3:12b` is already pulled.

```bash
ollama serve                       # leave it running

cd api
TRIPSTASH_AI_PROVIDER=local \
TRIPSTASH_LLM_MODEL=gemma3:12b \
  .venv/bin/python3 -m uvicorn app.main:app --port 8000
```

Or permanently, in `api/.env`:

```
TRIPSTASH_AI_PROVIDER=local
TRIPSTASH_LLM_MODEL=gemma3:12b
```

**What it changes:** how well the app reads what you save. A reel's caption or
a pasted plan becomes typed candidates — a transport tip, a price, a safety
note — instead of the rule-based extractor's cruder guesses. It does not
compose answers; the assistant is still rule-based.

**What it costs:** about 35 seconds per source on an M4, and 8GB of memory
while it runs. Extraction happens in a worker, so nothing waits on it.

**Where it does not work:** the deployed app on Railway cannot reach a model
running on your laptop. Local model, local app. Leaving the provider unset in
production is deliberate and correct.

### Other models

Anything Ollama serves works, since the adapter speaks OpenAI-compatible
chat. `gemma3:12b` is the one tested here. A smaller model is faster and
sloppier; the grounding guard will simply discard more of what it invents,
which is the failure mode you want.

The app asks for structured output and sends a **stricter schema than its own**
— evidence quotes are optional in the app and required of the model. That is
not pedantry: asked in prose for verbatim quotes, gemma3 returned four
well-typed candidates with no evidence at all and every one was dropped.
Said in the schema, it complies.

## Web search — optional, and the only one that costs

Only worth adding if you want a general search engine behind the guide.

```
TRIPSTASH_WEB_SEARCH_PROVIDER=brave
TRIPSTASH_WEB_SEARCH_API_KEY=<yours>
```

The assistant tries the free guide first regardless, so this only runs when
the guide has nothing. It refuses to start without a key rather than quietly
returning nothing, because a silent empty search looks exactly like a place
nobody has written about.

## What is still not free

Nothing composes prose. The assistant selects and quotes; it does not write.
Making it write would mean a model in production, which means either a hosted
endpoint with a key or a server you pay to run.

That is a real limitation and worth stating plainly: this setup gives the app
**data it did not have** and **better reading of what you save**. It does not
give it a voice.
