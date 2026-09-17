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
| probe, audio, frames | ffmpeg (via `imageio-ffmpeg`) | LGPL/GPL build | Bundled in the wheel |
| speech → text | faster-whisper `small` | MIT | Fetched once, on first use |
| on-screen text | RapidOCR / PP-OCRv4 | Apache 2.0 | **Bundled in the wheel**, ~15 MB |
| structured extraction | Qwen2.5 7B via Ollama | Apache 2.0 | `ollama pull`, once |

```bash
pip install -e ".[media]"        # ffmpeg + OCR, both offline
pip install -e ".[asr]"          # optional: speech to text
```

Nothing above costs money and nothing needs an account.

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
