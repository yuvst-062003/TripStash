# The media pipeline

A video is not one problem but three — what was said, what was written on the
screen, and what is visible — so it gets three small free models rather than one
big one. Each stage runs on its own, one at a time, which is what makes it
affordable on an ordinary CPU.

```
ffmpeg ─┬─ audio  ─→ faster-whisper ─→ transcript + timestamps ─┐
        └─ frames ─→ pHash dedupe ─→ PP-OCRv4 ─→ on-screen text ┤
                                                                ↓
                                        Qwen2.5 7B → typed candidates
                                                                ↓
                                   grounding · resolve · deduplicate
                                                                ↓
                                                     the review queue
```

| Stage | Engine | Licence | Where the weights come from |
| --- | --- | --- | --- |
| link | oEmbed / Open Graph | — | Nothing to install |
| probe, audio, frames | ffmpeg (via `imageio-ffmpeg`) | LGPL/GPL build | Bundled in the wheel |
| speech → text | faster-whisper `small` | MIT | Fetched once, on first use |
| on-screen text | RapidOCR / PP-OCRv4 | Apache 2.0 | **Bundled in the wheel**, ~15 MB |
| structured extraction | Qwen2.5 7B via Ollama | Apache 2.0 | `ollama pull`, once |

```bash
pip install -e ".[media]"        # ffmpeg + OCR, both offline
pip install -e ".[asr]"          # optional: speech to text
```

Nothing above costs money and nothing needs an account.

## Links: the client reads, the server understands

The server is the worst place in the system to read a social link. It sits on a
datacenter IP, which is the first thing bot protection blocks; it is signed in
to nothing; and it is geographically wherever the host happens to be. The
traveller's own browser is on a residential connection, already holds whatever
session the platform gave it, and is where the content was being looked at
anyway.

So a link is tried in this order, and the status records which path worked:

1. **The operating system's share sheet.** The manifest declares TripStash as a
   share target, so sharing a post into the installed app hands over the
   caption directly - no fetching at all, and nothing that can be blocked. This
   is the best path and it is also the least clever.
2. **The browser calling oEmbed**, from the traveller's own connection.
3. **The server calling oEmbed or reading Open Graph**, for ordinary pages
   where nobody is being blocked.
4. **Asking**, with the link kept either way.

### What is deliberately not built

Scraping a platform's markup with a headless browser, or downloading video
files. Both breach the platforms' terms, both are non-goals in specification
3.3, and - separately from any of that - a datacenter scraper is the *most*
fragile option available, not the most powerful. The client-side paths above
are better on every axis at once.

## Links: only what a site publishes

A pasted URL is read before anything else, because that is usually where the
caption lives. Two routes, both free and keyless:

- **oEmbed**, where a platform publishes one. TikTok, YouTube and Vimeo all do,
  and the caption arrives as the response's `title`.
- **Open Graph and the page description** for everything else.

That word *publishes* is the boundary. This reads what a site offers for
sharing and nothing more: no logging in, no downloading videos, no scraping
restricted content - all non-goals in specification 3.3, and against the
platforms' terms besides.

When a platform declines, the URL is kept and the traveller is asked for the
caption, a screenshot or the downloaded video. That is specification 12's first
row, and it is a designed path rather than a failure. Instagram and Facebook
are not even requested: they publish nothing to an anonymous reader, and
pretending otherwise would just waste a round trip.

The link stage reports the cause; the advice is separate and says only what to
do next. Saying the same thing twice in two tones is how an interface starts
sounding like a machine.

## On-screen text is the primary channel, not the fallback

The audio on a travel Reel is usually music. The place name, the price and the
handle are burned into the picture as captions. A pipeline that only listens
recovers nothing from the most common case, which is why OCR runs whether or
not speech succeeded — and why the OCR weights, not the speech model, are the
ones that ship bundled and offline.

## What keeps it honest

**Whisper hallucinates on silence and music.** It emits "Thanks for watching",
subtitle credits and `[Music]` over a soundtrack. Left alone that becomes
fabricated travel advice. Three filters apply in `app/media/asr.py`: the
model's own `no_speech_prob`, its average log-probability, and a denylist of
the artefacts it invents. A fourth sits downstream — the extractor only accepts
a claim whose quote appears verbatim in the recovered text — so anything that
slips through still cannot become a saved place.

**Frames are sampled, not decoded.** A sixty-second clip is eighteen hundred
images. `limit` frames are spread evenly across the duration, then a difference
hash drops the near-identical ones, because a caption held across a scene is
one fact rather than one per frame. Even spacing also means every frame has an
exact timestamp.

**A stage that cannot run says so.** No audio track, no speech model, a clip
over the duration limit: each is recorded as `skipped` or `failed` with a
reason, visible in Saved → Sources. There is never a silent gap, and the source
stays recoverable in Inbox.

## Timestamps

`Evidence.media_timestamp_seconds` existed from the first commit and was always
null, because nothing knew when a line was said or shown. Both readers now
return timed segments, so a quote cites its moment and the review card shows
`from the ocr at 0:03`.

## Cost, measured

On this repository's 4-core CPU with no GPU, a 9-second silent Reel at
720×1280:

| Stage | Time |
| --- | --- |
| probe | 6 ms |
| audio | skipped, no track |
| speech | skipped, no audio |
| frames (12 sampled) | 72 ms |
| on-screen text (7 lines) | 1.2 s |

Extraction then runs on the recovered text. With speech present, whisper
`small` is roughly real-time on CPU and dominates the total — which is why the
whole thing belongs in the worker, never in a request.

## Settings

```bash
TRIPSTASH_MEDIA_ENABLED=true
TRIPSTASH_MEDIA_ASR=true             # attempt speech to text
TRIPSTASH_MEDIA_OCR=true             # read text in the frames
TRIPSTASH_MEDIA_MAX_FRAMES=12
TRIPSTASH_MEDIA_MAX_DURATION_SECONDS=900
TRIPSTASH_MEDIA_ASR_MODEL=small      # tiny | base | small | medium
```

## Not done

- **No visual understanding.** A small vision-language model (moondream2,
  Qwen2-VL 2B) on a few keyframes would describe what is *shown* rather than
  what is written. It is the heaviest stage on CPU and is left out on purpose.
- **Frame timestamps are the sampling positions**, accurate to the sampling
  interval rather than to the exact frame a caption appeared on.
- **The speech model is the one thing that downloads.** Everything else in this
  pipeline runs from what `pip install` already put on disk.
