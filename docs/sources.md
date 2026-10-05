# Where city knowledge comes from

TripStash knows what *you* saved. It knows nothing about a city you have not
been to yet, and the city layer needs that: what a dorm costs in Rio, which
steps not to walk alone after dark, what the metro fare actually is this year.

That information exists, on other people's sites. This is how it gets used
without taking what is not ours.

## The rule

**Facts, one short verbatim quote, a credit, a link back. Never the article.**

A travel site's prose is their work. Reproducing it inside TripStash would be
copyright infringement however the text arrives — fetched, summarised by a
model, or retyped. What TripStash keeps instead is:

| Kept | Why it is ours to keep |
| --- | --- |
| The fact (`R$90`, `90 days visa-free`, `closed Mondays`) | Facts are not copyrightable |
| One short quote, verbatim | Quotation with attribution, and it lets the traveller judge the claim rather than trust a paraphrase |
| The source name, URL and fetch date | Attribution, and the freshness machinery already requires it |

Everything else stays on the original site, one tap away. A `KnowledgeItem`
that cannot name its source and link to it does not get written.

## The trust order

When two sources say different things, the higher tier wins the *position* —
never the argument. Both are shown (see Conflicts).

1. **Your own saved media.** A clip you chose outranks anything a publisher
   wrote, because you picked it. Always rendered first, with its timestamp.
2. **Official pages.** Consulates, immigration, the operator's own site, the
   municipality. The only acceptable source for a border, visa or entry answer.
3. **Open-licensed guides.** Wikivoyage is CC BY-SA: its text may be reused in
   full, with attribution and under the same licence. This is the base layer
   for city descriptions, because it is the one source that can be copied
   rather than cited.
4. **Travel publishers.** Gringo and the like — the Israeli backpacker view of
   South America that no English source carries: real prices, which hostels,
   which border crossing. Facts and one quote only, never the article.
5. **Provider APIs.** Places, weather, FX. Already adapters; already expiring.

## Conflicts are shown, not resolved

`services/freshness.py::group_with_conflicts` already does this and the city
layer reuses it: when Wikivoyage says R$7.10 three weeks ago and Gringo said
R$6.50 eight months ago, both appear side by side with their dates. Picking one
silently would hide the thing the traveller actually needs to see — that one
number is simply old.

## Freshness

Every fact carries `checked_at` and an `expires_at` derived from its kind. A
price ages differently from a street name. Stale values are not removed; they
are labelled, in the exception-reporting style the rest of the app uses
("checked 4 months ago" in amber, not a silent number in black).

## When collection happens

Three paths into the same pipeline, because no single one is right:

**Seeded.** Destinations already on the traveller's route get collected ahead
of time, so the city screen is populated the first time it opens and keeps
working on a bus with no signal. Bounded: the route's cities, not a continent.

**On demand.** Opening a city that has no cached knowledge fetches what is
missing and caches it. Subsequent opens are served from the cache until the
freshness window lapses.

**Asked for.** "Check again" on the city screen, or a question to the agent
that cannot be answered from what is stored, triggers a refresh of just the
items in question.

A fetch budget per host per day sits across all three, so a seeded run and a
curious afternoon cannot combine into something that looks like a crawl.

## Before any fetch runs

Not optional, and not steps to do afterwards:

1. **Read `robots.txt`** for the host and obey it, including `Crawl-delay`.
2. **Read the terms of use.** If they forbid automated access, the host is
   excluded — the trust tier does not override it.
3. **Identify honestly** in the User-Agent, with a contact URL.
4. **Conditional requests.** `ETag` / `If-Modified-Since` on every refetch, so
   a freshness check costs the host almost nothing.
5. **One request at a time per host**, with the published crawl delay.
6. **Honour a removal request** by host, immediately and permanently.

> **Not yet verified.** `gringo.co.il` could not be reached from the
> development sandbox — the egress proxy refuses it by policy, so neither its
> `robots.txt` nor its terms have been read. Steps 1 and 2 are outstanding for
> that host and must happen on an environment that can reach it, before the
> adapter is pointed at it.

## How it reuses the pipeline that exists

A web page is just another `Source`. Nothing new is invented:

```
URL → fetch (robots-checked, conditional)
    → readable text extraction
    → LLM extraction, evidence-grounded (a candidate whose quote is not
      verbatim in the fetched text is dropped, exactly as for video)
    → ExtractionCandidate, typed, with its quote and source URL
    → KnowledgeItem / PlaceFact, with provenance, confidence, checked_at
```

The grounding step matters more here than anywhere: it is what stops the model
inventing a price that no source states.

## Approval, and where the rule stops

"Nothing reaches your map without you approving it" governs **your library** —
your places, your trip's knowledge. It does not govern reference material.

- City background from public sources is **displayed**, labelled with its
  source, like a guidebook open on the table. It is not in your library.
- The moment something is attached to one of your places, or saved as your
  trip's knowledge, it goes through the review queue like any candidate.

So a traveller can read what Gringo says about Rio without having agreed to
anything, and still ends up with a library containing only what they chose.

## The agent's web search

The assistant gets a `SearchProvider` adapter alongside the existing ones. Its
rules are the same as everything above, plus two:

- **It must cite.** An answer drawn from the web names its sources inline, and
  a claim from one of the traveller's own clips links to that second of video.
- **It may propose, never act.** A suggestion arrives as a card with Add and
  Dismiss. Searching the web does not promote the agent to an editor.

A border or visa answer carries the official-verification warning whatever the
source said, because `requires_official_verification` is set by the knowledge
*type*, not by how confident the text sounded.

## Adapters this adds

| Adapter | Does | Fake for local dev |
| --- | --- | --- |
| `ContentSourceAdapter` | robots check, conditional fetch, readable-text extraction | fixture pages, no network |
| `SearchProvider` | the agent's web search | fixed result set |

Both default to the fake, like every other adapter, so the stack still runs
with no accounts and no network.
