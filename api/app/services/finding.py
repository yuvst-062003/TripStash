"""Going looking for video, and keeping it separate from what was saved.

The rule this whole feature turns on: a found clip may suggest, and it counts
for nothing until the traveller stamps it. "Nine of your twelve" has to keep
meaning nine of twelve they chose, or it quietly becomes the same claim every
other app on the market already makes.

So found sources are marked at the moment they are created, their provenance
is the lowest rung the ladder has, and every count in the app reads the flag
rather than inferring it from a URL.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.video_search import FoundVideo
from app.models.capture import Source
from app.models.enums import Provenance, SourceKind
from app.services.extraction import DuplicateSourceError, create_source


@dataclass(frozen=True)
class FindOutcome:
    """What a search actually produced, said plainly enough to show a person."""

    query: str
    created: list[Source]
    already_had: int
    searched: bool
    # Set when nothing came back, so the screen can say why rather than
    # rendering an empty shelf and leaving the traveller to guess.
    nothing_reason: str | None = None


def search_query(*, place: str, activity: str | None = None) -> str:
    """What to ask the platform. Kept short: long queries return worse video."""
    parts = [place.strip()]
    if activity:
        parts.append(activity.replace("_", " "))
    return " ".join(part for part in parts if part)


def find_videos(
    session: Session,
    *,
    trip_id: str,
    provider,
    place: str,
    activity: str | None = None,
    limit: int = 5,
) -> FindOutcome:
    """Search, then keep whatever is new as a found source.

    A clip already in the library is left alone rather than duplicated, and the
    outcome says how many those were, because "I found four, you already had
    three" is a more useful sentence than "four".
    """
    query = search_query(place=place, activity=activity)
    if not query:
        return FindOutcome(query="", created=[], already_had=0, searched=False,
                           nothing_reason="There was nothing to search for.")

    results: list[FoundVideo] = provider.search(query, limit=limit)
    if not results:
        return FindOutcome(
            query=query,
            created=[],
            already_had=0,
            searched=True,
            nothing_reason=(
                f"I looked for {query} and found nothing worth keeping. "
                "Ask me about it instead, or save a reel and I will work from that."
            ),
        )

    existing = {
        url
        for (url,) in session.execute(
            select(Source.url).where(Source.trip_id == trip_id, Source.url.isnot(None))
        ).all()
    }

    created: list[Source] = []
    already = 0
    for result in results:
        if result.url in existing:
            already += 1
            continue
        try:
            source = create_source(
                session,
                trip_id=trip_id,
                kind=SourceKind.LINK,
                url=result.url,
                title=result.title,
                author=result.channel,
                text=result.description,
            )
        except DuplicateSourceError:
            # The same clip reached the library another way. Left alone: a
            # video the traveller already saved is theirs, not found.
            already += 1
            continue
        # Marked immediately, not inferred later. The flag is what every count
        # reads, so it has to be true from the first moment the row exists.
        source.found = True
        source.provenance = Provenance.INFERENCE
        created.append(source)

    session.flush()
    return FindOutcome(query=query, created=created, already_had=already, searched=True)
