# Clips — the saved video, per spot

> "In every country / city I want to store the video or the section that is
> relevant to us, and create like a TikTok of that spot, so I could scroll up
> and down on the videos I saved."

Two things separate this from the feed whose gesture it borrows. Every clip is
one the traveller saved themselves — nothing is recommended in — and each one
opens at the second the place was actually named, not at zero.

## Where the section comes from

Nothing new had to be extracted. The media pipeline already records *which
second* a claim came from, because evidence for a place is stored with its
timestamp:

```
frames sampled at a fixed interval → PP-OCRv4 reads "Cerro de la Cruz"
        → Evidence(quote, media_timestamp_seconds=32.0)
                → SourcePlaceEvidence.media_timestamp_seconds
                        → the clip opens at 0:29.5
```

`app/services/reels.py` turns that one number into a window:

| Input | Window | Why |
| --- | --- | --- |
| timestamp 32s, duration 48s | 29.5 → 44.5, cut | 2.5s lead-in: the name is usually said just after it appears |
| timestamp 4s, duration 20s | whole video | Below 25s there is nothing worth cutting |
| no timestamp | whole video | Never invent a moment |
| timestamp 46s, duration 48s | 33 → 48, cut | Pulled back from the end, so the window keeps its length |

The traveller is never held to the cut: **Whole video** plays it end to end,
and the scrub bar shows where the saved section sits inside the full running
time.

## Scope

A clip belongs to a spot, and a spot sits under a heading — its destination if
one was chosen when the place was approved, otherwise its city, otherwise its
country. The label is never invented; a place with none of the three appears
under "Elsewhere".

| Endpoint | Answers |
| --- | --- |
| `GET /api/v1/reels/spots` | Which spots have video, grouped by where they are |
| `GET /api/v1/reels/spots/{trip_place_id}` | One spot's header |
| `GET /api/v1/reels?trip_place_id=…` | That spot's clips |
| `GET /api/v1/reels?scope=Antigua` | A whole city in one run |
| `GET /api/v1/reels?destination_id=…` | A whole stop on the route |
| `GET /api/v1/reels` | Everything saved, spots kept together |

`playable_only=true` drops the link-only cards.

## What the app does not hold

A link saved from TikTok or Instagram leaves the bytes on their servers. Those
clips still appear — the quote and the spot are the point — as a card that says
so plainly and offers the original. `playable_count` on each spot is the honest
count of what will actually play, next to the total.

## Serving the bytes

`GET /api/v1/files/{key}` is HMAC-signed and short-lived, and now answers
`Range` requests with `206 Partial Content` and the real media type. Without
that a browser cannot seek, so every clip would download from byte zero before
showing its 15th second.

## Proof

`api/tests/test_reels.py` covers the window arithmetic and runs the feed
end to end on a generated 48-second MP4: OCR reads "Cerro de la Cruz" at 32s
and "Rainbow Café" at 36s, both places are approved, and the feed returns them
cut to 29.5 → 44.5 and 33 → 48. The same file, served ranged, returns 206 with
`content-range` and the exact bytes requested.
