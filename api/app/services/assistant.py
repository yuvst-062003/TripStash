"""The single global Ask assistant (spec 5.5).

There is one assistant. It may use several capabilities internally, but the
product never shows the traveller a fleet of agents. Four rules shape
everything below:

  * retrieve the trip's own records before answering;
  * compute distance, currency and budget deterministically, never by guess;
  * return cards and actions, not only prose;
  * stay read-only - a state change comes back as a proposal to confirm.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters import get_fx, get_travel_wiki, get_weather, get_web_search
from app.models.capture import KnowledgeItem, Source, SourcePlaceEvidence
from app.models.core import Destination, Trip
from app.models.enums import KnowledgeType, PlaceStatus
from app.models.ops import Expense, ItineraryItem
from app.models.places import Place, PlaceFact, TripPlace
from app.services import handoff
from app.services.freshness import group_with_conflicts
from app.services.spatial import (
    haversine_km,
    nearby_trip_places,
    walking_minutes_if_walkable,
)
from app.services.text import normalize_name
from app.services.web_answers import (
    guide_cards,
    guide_disclaimer,
    web_cards,
    web_disclaimer,
)

ASK_RADIUS_KM = 3.0

# Shown whenever an answer leans on a creator's claim or a model inference.
INFERENCE_NOTE = "Inferred from your saved content - not a verified fact."
OFFICIAL_NOTE = "Entry, visa and border rules change; confirm with the official source."
HANDOFF_NOTE = "Opening a link does not book or buy anything."


@dataclass(slots=True)
class AskContext:
    """The context the assistant is using, echoed back so the user can see and
    remove it (spec 5.5)."""

    surface: str = "home"
    trip_place_id: str | None = None
    place_id: str | None = None
    source_id: str | None = None
    destination_id: str | None = None
    collection_id: str | None = None
    lat: float | None = None
    lon: float | None = None
    on: date | None = None
    saved_only: bool = False
    visible_bounds: list[float] | None = None

    def to_dict(self) -> dict:
        return {
            "surface": self.surface,
            "trip_place_id": self.trip_place_id,
            "place_id": self.place_id,
            "source_id": self.source_id,
            "destination_id": self.destination_id,
            "collection_id": self.collection_id,
            "lat": self.lat,
            "lon": self.lon,
            "date": (self.on or datetime.now(UTC).date()).isoformat(),
            "saved_only": self.saved_only,
        }


@dataclass(slots=True)
class Answer:
    text: str
    cards: list[dict] = field(default_factory=list)
    citations: list[dict] = field(default_factory=list)
    disclaimers: list[str] = field(default_factory=list)
    proposed_actions: list[dict] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)

    def to_dict(self, context: AskContext) -> dict:
        return {
            "answer": self.text,
            "context": context.to_dict(),
            "cards": self.cards,
            "citations": self.citations,
            "disclaimers": self.disclaimers,
            "proposed_actions": self.proposed_actions,
            "tools_used": self.tools_used,
            # Read-only by default; anything above must be confirmed to apply.
            "applied_changes": [],
        }


# The subject of a question decides before its phrasing does: "what did I
# save about safety" is a safety question, not a "why did I save this" one.
_INTENTS: list[tuple[str, re.Pattern[str]]] = [
    ("budget", re.compile(r"\b(budget|spend|spent|cost|money|daily burn|afford)\b", re.I)),
    ("stay", re.compile(r"\b(hostel|hotel|stay|accommodation|sleep|dorm)\b", re.I)),
    (
        "transport",
        re.compile(r"\b(bus|shuttle|ferry|boat|taxi|uber|get to|travel to|transport)\b", re.I),
    ),
    ("border", re.compile(r"\b(visa|border|entry|immigration|onward|stamp)\b", re.I)),
    ("safety", re.compile(r"\b(safe|safety|scam|dangerous|careful)\b", re.I)),
    (
        "nearby",
        re.compile(r"\b(near|nearby|around me|close by|walking distance|what'?s here)\b", re.I),
    ),
    (
        "practical",
        re.compile(r"\b(open|now|today|worth going|should i go|is it worth|time to)\b", re.I),
    ),
    ("why", re.compile(r"\b(why|what did i save|remind me|who recommended)\b", re.I)),
]


def classify(question: str) -> str:
    for name, pattern in _INTENTS:
        if pattern.search(question):
            return name
    return "general"


def ask(session: Session, *, trip: Trip, question: str, context: AskContext) -> tuple[Answer, int]:
    started = time.perf_counter()
    on = context.on or datetime.now(UTC).date()
    intent = classify(question)

    focus = _focus_place(session, trip, context) or _place_by_name(session, trip, question)
    handlers = {
        "nearby": _answer_nearby,
        "practical": _answer_practical,
        "why": _answer_why,
        "budget": _answer_budget,
        "stay": _answer_stay,
        "transport": _answer_knowledge_type,
        "border": _answer_knowledge_type,
        "safety": _answer_knowledge_type,
    }
    handler = handlers.get(intent, _answer_general)
    answer = handler(session, trip, question, context, on, focus, intent)
    answer.tools_used.insert(0, f"intent:{intent}")
    return answer, int((time.perf_counter() - started) * 1000)


# ------------------------------------------------------------------ helpers


def _focus_place(session: Session, trip: Trip, context: AskContext) -> TripPlace | None:
    if context.trip_place_id:
        return session.get(TripPlace, context.trip_place_id)
    if context.place_id:
        return session.execute(
            select(TripPlace).where(
                TripPlace.trip_id == trip.id, TripPlace.place_id == context.place_id
            )
        ).scalar_one_or_none()
    return None


def _place_card(
    trip_place: TripPlace,
    *,
    distance_km: float | None = None,
    why: str | None = None,
    facts: list[dict] | None = None,
) -> dict:
    place = trip_place.place
    return {
        "type": "place",
        "trip_place_id": trip_place.id,
        "place_id": place.id,
        "title": place.name,
        "subtitle": ", ".join(filter(None, [place.category, place.city])),
        "status": trip_place.status,
        "is_favourite": trip_place.is_favourite,
        "why_saved": why or trip_place.reason_saved,
        "distance_km": round(distance_km, 2) if distance_km is not None else None,
        "walking_minutes": walking_minutes_if_walkable(distance_km),
        "coordinates": {"lat": place.lat, "lon": place.lon},
        "facts": facts or [],
        "actions": handoff.serialise(handoff.for_place(place)),
    }


def _knowledge_card(item: KnowledgeItem) -> dict:
    return {
        "type": "knowledge",
        "knowledge_item_id": item.id,
        "knowledge_type": item.type,
        "title": item.title,
        "subtitle": item.destination_scope,
        "body": item.body,
        "confidence": round(item.confidence, 2),
        "provenance": item.provenance,
        "source_date": item.source_date.isoformat() if item.source_date else None,
        "requires_official_verification": item.requires_official_verification,
        "actions": [],
    }


def _cite_source(session: Session, source_id: str | None) -> dict | None:
    if not source_id:
        return None
    source = session.get(Source, source_id)
    if source is None:
        return None
    return {
        "kind": "source",
        "label": source.title or source.url or source.filename or "Saved source",
        "url": source.url,
        "source_id": source.id,
        "captured_at": source.created_at.isoformat(),
        "published_on": source.published_on.isoformat() if source.published_on else None,
        "provenance": source.provenance,
    }


def _place_facts(session: Session, place_id: str) -> list[dict]:
    facts = list(
        session.execute(select(PlaceFact).where(PlaceFact.place_id == place_id)).scalars()
    )
    return group_with_conflicts(facts)



def _has_saved_source(session: Session, trip_id: str, place_id: str) -> bool:
    """True when at least one source behind this place is one the traveller saved.

    The benefit of the doubt runs this way on purpose: one saved source makes a
    place theirs. Only a place resting entirely on found clips is described as
    found.
    """
    from app.models.capture import Source, SourcePlaceEvidence

    return session.execute(
        select(SourcePlaceEvidence.id)
        .join(Source, Source.id == SourcePlaceEvidence.source_id)
        .where(
            SourcePlaceEvidence.trip_id == trip_id,
            SourcePlaceEvidence.place_id == place_id,
            Source.found.is_(False),
        )
        .limit(1)
    ).first() is not None


def _sources_for_place(session: Session, trip_id: str, place_id: str) -> list[dict]:
    rows = session.execute(
        select(SourcePlaceEvidence).where(
            SourcePlaceEvidence.trip_id == trip_id, SourcePlaceEvidence.place_id == place_id
        )
    ).scalars()
    citations = []
    for row in rows:
        citation = _cite_source(session, row.source_id)
        if citation:
            citation["takeaway"] = row.takeaway
            citation["quote"] = row.quote
            citations.append(citation)
    return citations


# ------------------------------------------------------------------ handlers


def _answer_nearby(session, trip, question, context, on, focus, intent) -> Answer:
    if context.lat is None or context.lon is None:
        saved_any = session.execute(
            select(TripPlace.id).where(TripPlace.trip_id == trip.id)
        ).first()
        return Answer(
            text=(
                "I don't know where you are, so I can't sort your saves by distance. "
                "Tap Use my location, or mark a stop as here now on Trip."
                if saved_any
                else "You haven't saved anything yet. Save a link or a screenshot and ask again."
            ),
            tools_used=["places:none"],
        )

    matches = nearby_trip_places(session, trip.id, context.lat, context.lon, ASK_RADIUS_KM)
    matches = [
        (tp, km)
        for tp, km in matches
        if tp.status not in (PlaceStatus.ARCHIVED,)
    ]
    if not matches:
        return Answer(
            text=(
                f"Nothing you saved is within {ASK_RADIUS_KM:.0f} km of here. "
                "Widen the map or research this area to add some."
            ),
            tools_used=["spatial:nearby"],
        )

    cards, citations = [], []
    for trip_place, distance in matches[:5]:
        cards.append(_place_card(trip_place, distance_km=distance))
        citations.extend(_sources_for_place(session, trip.id, trip_place.place_id))

    nearest, nearest_km = matches[0]
    # Past the walkable limit a minute figure is noise, so say the distance and
    # stop rather than offering a march as if it were a stroll.
    nearest_walk = walking_minutes_if_walkable(nearest_km)
    closest = (
        f"Closest is {nearest.place.name}, about {nearest_walk} min on foot."
        if nearest_walk is not None
        else f"Closest is {nearest.place.name}, {nearest_km:.1f} km away - too far to walk."
    )
    return Answer(
        text=(
            f"{len(matches)} of your saved places are within {ASK_RADIUS_KM:.0f} km. {closest}"
        ),
        cards=cards,
        citations=citations,
        disclaimers=[HANDOFF_NOTE],
        tools_used=["spatial:nearby", "handoff:navigate"],
    )


def _answer_practical(session, trip, question, context, on, focus, intent) -> Answer:
    if focus is None:
        return _answer_nearby(session, trip, question, context, on, focus, intent)

    place = focus.place
    facts = _place_facts(session, place.id)
    hours = next((f for f in facts if f["kind"] == "hours"), None)
    weather = get_weather().forecast(place.lat, place.lon, on)

    distance_km = (
        haversine_km(context.lat, context.lon, place.lat, place.lon)
        if context.lat is not None and context.lon is not None
        else None
    )
    already_planned = session.execute(
        select(ItineraryItem).where(
            ItineraryItem.trip_id == trip.id,
            ItineraryItem.trip_place_id == focus.id,
            ItineraryItem.on_date == on,
        )
    ).scalar_one_or_none()

    lines = [f"{place.name}: here is what I can and cannot confirm right now."]
    if hours:
        lines.append(
            f"Hours say \"{hours['primary']['value']}\" ({hours['primary']['age_label']}, "
            f"{hours['primary']['provenance']} source)."
        )
        if hours["has_conflict"]:
            lines.append(hours["conflict_note"])
    else:
        lines.append("I have no opening hours on record, so I cannot say whether it is open.")

    lines.append(
        f"Today: {weather.summary.lower()}, {weather.temperature_c:.0f}°C, "
        f"{int(weather.precipitation_probability * 100)}% chance of rain."
    )
    if distance_km is not None:
        walk = walking_minutes_if_walkable(distance_km)
        lines.append(
            f"You are {distance_km:.1f} km away - roughly {walk} min walking."
            if walk is not None
            else f"You are {distance_km:.1f} km away, which is not a walk."
        )
    if already_planned:
        lines.append("It is already on today's plan.")

    proposed = []
    if not already_planned:
        proposed.append(
            {
                "type": "add_to_today",
                "label": f"Add {place.name} to today's plan",
                "preview": "Goes on today's plan. Nothing is booked.",
                "payload": {"trip_place_id": focus.id, "on_date": on.isoformat()},
            }
        )

    return Answer(
        text=" ".join(lines),
        cards=[_place_card(focus, distance_km=distance_km, facts=facts)],
        citations=_sources_for_place(session, trip.id, place.id),
        disclaimers=[HANDOFF_NOTE] + ([INFERENCE_NOTE] if not hours else []),
        proposed_actions=proposed,
        tools_used=["places:facts", "weather:forecast", "spatial:distance"],
    )


def _answer_why(session, trip, question, context, on, focus, intent) -> Answer:
    target = focus or _place_by_name(session, trip, question)
    if target is None:
        return Answer(
            text="Tell me which place you mean, or open it and ask again.",
            tools_used=["places:lookup"],
        )

    citations = _sources_for_place(session, trip.id, target.place_id)
    takeaways = [c["takeaway"] for c in citations if c.get("takeaway")]
    reason = target.reason_saved or (takeaways[0] if takeaways else None)

    # A place standing only on clips the app went looking for was never saved
    # by anyone, and saying otherwise would hand the traveller a false memory -
    # the exact failure the found tier exists to prevent.
    yours = _has_saved_source(session, trip.id, target.place_id)
    verb = "You saved" if yours else "I found"
    text = (
        f"{verb} {target.place.name} because: {reason}"
        if reason and yours
        else f"{verb} {target.place.name}."
        if not reason
        else f"{verb} {target.place.name}: {reason}"
    )
    if citations:
        kind = "saved source" if yours else "found source"
        text += f" It came from {_plural(len(citations), kind)}, all still attached."

    return Answer(
        text=text,
        cards=[_place_card(target, why=reason, facts=_place_facts(session, target.place_id))],
        citations=citations,
        tools_used=["places:lookup", "sources:evidence"],
    )


def _answer_budget(session, trip, question, context, on, focus, intent) -> Answer:
    spent = session.execute(
        select(func.coalesce(func.sum(Expense.amount_base), 0.0)).where(Expense.trip_id == trip.id)
    ).scalar_one()
    today_spent = session.execute(
        select(func.coalesce(func.sum(Expense.amount_base), 0.0)).where(
            Expense.trip_id == trip.id, Expense.spent_on == on
        )
    ).scalar_one()

    cur = trip.base_currency
    lines = [
        f"Spent so far: {spent:,.0f} {cur}"
        + (f", {today_spent:,.0f} of it today." if today_spent else ", nothing today.")
    ]
    remaining: float | None = None
    if trip.total_budget:
        remaining = trip.total_budget - spent
        lines.append(
            f"That leaves {remaining:,.0f} of a {trip.total_budget:,.0f} {cur} budget."
            if remaining >= 0
            else f"That is {-remaining:,.0f} {cur} over the {trip.total_budget:,.0f} budget."
        )
        if trip.end_date and trip.end_date >= on and remaining > 0:
            days_left = (trip.end_date - on).days + 1
            lines.append(
                f"Across the {_plural(days_left, 'day')} left, that is "
                f"{remaining / days_left:,.0f} {cur} a day."
            )
    else:
        lines.append("No total budget is set, so I cannot forecast a daily allowance.")

    price_notes = list(
        session.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.trip_id == trip.id,
                KnowledgeItem.type == KnowledgeType.PRICE,
                KnowledgeItem.is_archived.is_(False),
            )
        ).scalars()
    )
    if price_notes:
        lines.append(
            f"You noted {_plural(len(price_notes), 'expected price')} — shown below to compare."
        )

    return Answer(
        text=" ".join(lines),
        cards=[
            {
                "type": "budget",
                "title": "Trip spending",
                "currency": trip.base_currency,
                "spent": round(spent, 2),
                "spent_today": round(today_spent, 2),
                "budget": trip.total_budget,
                "remaining": round(remaining, 2) if remaining is not None else None,
                "actions": [],
            },
            *[_knowledge_card(item) for item in price_notes[:5]],
        ],
        citations=[
            c for c in (_cite_source(session, item.source_id) for item in price_notes) if c
        ],
        disclaimers=[
            "Captured prices are estimates from creators unless a provider confirmed them."
        ],
        tools_used=["money:sum", "fx:" + get_fx().name],
    )


def _answer_stay(session, trip, question, context, on, focus, intent) -> Answer:
    destination = _current_destination(session, trip, context)
    if destination is None and not trip.destinations:
        return Answer(
            text=(
                "You haven't added a stop yet, so I can't search stays. "
                "Add one on Trip and ask again."
            ),
            tools_used=["places:none"],
        )
    where = destination.name if destination else trip.destinations[0].name

    saved = list(
        session.execute(
            select(TripPlace)
            .join(Place, Place.id == TripPlace.place_id)
            .where(TripPlace.trip_id == trip.id, Place.category == "accommodation")
        ).scalars()
    )
    knowledge = list(
        session.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.trip_id == trip.id,
                KnowledgeItem.type == KnowledgeType.ACCOMMODATION,
                KnowledgeItem.is_archived.is_(False),
            )
        ).scalars()
    )

    cards = [_place_card(tp) for tp in saved] + [_knowledge_card(k) for k in knowledge]
    cards.append(
        {
            "type": "handoff",
            "title": f"Search stays in {where}",
            "subtitle": "Prices and availability come from the provider",
            "actions": handoff.serialise(handoff.stay_search(where)),
        }
    )

    text = (
        f"You have {_plural(len(saved), 'saved stay')} and "
        f"{_plural(len(knowledge), 'saved recommendation')} for {where}. "
        "I have not checked availability or prices — open a provider for that."
    )
    return Answer(
        text=text,
        cards=cards,
        citations=[c for c in (_cite_source(session, k.source_id) for k in knowledge) if c],
        disclaimers=[HANDOFF_NOTE],
        tools_used=["places:filter", "knowledge:filter", "handoff:stay"],
    )


def _answer_knowledge_type(session, trip, question, context, on, focus, intent) -> Answer:
    wanted = {
        "transport": [KnowledgeType.TRANSPORT, KnowledgeType.ROUTE],
        "border": [KnowledgeType.BORDER],
        "safety": [KnowledgeType.SAFETY],
    }[intent]

    items = list(
        session.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.trip_id == trip.id,
                KnowledgeItem.is_archived.is_(False),
                KnowledgeItem.type.in_(wanted),
            )
        ).scalars()
    )
    # Filtering by type alone answered "is Tbilisi safe?" with a note about
    # Antigua, which reads as an answer and is not one. If the question names a
    # place, only notes about that place count; if none do, the traveller has
    # nothing saved about it, whatever else is in the trip.
    # Only a confident place name may discard saved notes. "What did I save
    # about safety?" is a question about the library, and guessing "safety" is
    # a place would throw away the very notes being asked for.
    subject = _place_subject(question)
    if subject and items:
        about_here = [i for i in items if _note_mentions(i, subject)]
        if not about_here:
            return _answer_from_the_web(question, prefer=wanted[0])
        items = about_here

    if not items:
        # Nothing saved of this kind. The free guide has a section for exactly
        # this - "Stay safe" is a safety note, "Get in" is transport - so the
        # right part of it can be handed back without anything having to infer
        # what a paragraph is about.
        return _answer_from_the_web(question, prefer=wanted[0])

    disclaimers = [INFERENCE_NOTE]
    if intent == "border":
        disclaimers = [OFFICIAL_NOTE]

    oldest = min((i.source_date for i in items if i.source_date), default=None)
    text = f"You saved {_plural(len(items), f'{intent} note')}."
    if oldest:
        when = oldest.strftime("%-d %b %Y")
        text += f" The oldest is from {when} — check whether it still holds."

    return Answer(
        text=text,
        cards=[_knowledge_card(item) for item in items],
        citations=[c for c in (_cite_source(session, i.source_id) for i in items) if c],
        disclaimers=disclaimers,
        tools_used=["knowledge:filter"],
    )


def _note_mentions(item: KnowledgeItem, subject: str) -> bool:
    """Whether a saved note is about the place that was asked about.

    Matched on the note's own scope first, then its words. Loose on purpose: a
    note scoped to "Antigua" should answer a question about "Antigua
    Guatemala", and the cost of a false match here is one irrelevant card
    rather than a wrong answer to a safety question.
    """
    haystack = normalize_name(
        " ".join(filter(None, [item.destination_scope, item.title, item.body]))
    )
    needle = normalize_name(subject)
    if not needle:
        return False
    words = needle.split()
    long_words = [word for word in words if len(word) > 3]
    if long_words:
        return any(word in haystack for word in long_words)
    # Every word is short - "Rio", "Leh", "Ica" - so match the name whole, on
    # word boundaries, rather than dropping it and losing the traveller's notes.
    return re.search(rf"\b{re.escape(needle)}\b", haystack) is not None


def _answer_from_the_web(question: str, prefer: KnowledgeType | None = None) -> Answer:
    """Read the open web, when the traveller's own library has nothing.

    Everything that comes back is labelled as the web's rather than theirs,
    graded below anything they saved, and dropped entirely if it arrives with
    no quote behind it. A search that fails returns nothing and says so, rather
    than letting a network problem look like a place nobody has written about.
    """
    subject = _subject_of(question)
    if not subject:
        return Answer(
            text=(
                "I could not match that to anything you saved, and I am not sure what to "
                "look up. Name a place and I will read what people have written about it."
            ),
            disclaimers=["Answers come from your saved records first."],
            tools_used=["knowledge:search", "places:search"],
        )

    # The free travel guide first. It needs no key, no account and no quota,
    # and its sections already carry the meaning this app's knowledge types
    # carry - so it is both the cheaper source and the better one. The search
    # engine is the fallback, and only exists if somebody configured one.
    guide = get_travel_wiki().guide(subject)
    cards = guide_cards(guide)
    if cards and prefer is not None:
        # Asked about safety, lead with the safety section rather than with
        # sightseeing. The rest still follows, because a traveller reading
        # about one thing usually wants the others too.
        cards.sort(key=lambda c: c.get("knowledge_type") != prefer)
    if cards:
        # Asked about one thing and the guide covers everything but that, say
        # so. Leading with a section about something else, silently, reads as
        # an answer to a question nobody asked.
        missing = prefer is not None and not any(
            c.get("knowledge_type") == prefer for c in cards
        )
        said = (
            f"Nothing saved about {guide.title} yet. This is from a free travel guide "
            "rather than from you."
        )
        if missing:
            said = (
                f"Nothing saved about {guide.title}, and the free guide has nothing on "
                f"{prefer.value} there either. Here is what it does cover."
            )
        return Answer(
            text=said,
            cards=cards,
            citations=[{"url": guide.url, "title": guide.title, "host": "en.wikivoyage.org"}],
            disclaimers=[guide_disclaimer(guide.title)],
            tools_used=["knowledge:search", "places:search", "guide:wikivoyage"],
        )

    results = get_web_search().search(subject)
    cards = web_cards(results)

    if not cards:
        return Answer(
            text=(
                f"Nothing saved about {subject}, and nothing I could read about it either. "
                "A travel guide covers destinations rather than single businesses, so try "
                "the town it is in - or share a reel about it and it becomes yours."
            ),
            disclaimers=["Answers come from your saved records first."],
            tools_used=["knowledge:search", "places:search", "guide:wikivoyage", "web:search"],
        )

    return Answer(
        text=(
            f"Nothing saved about {subject} yet, so this is from the web rather than from you."
        ),
        cards=cards,
        citations=[{"url": c["url"], "title": c["title"], "host": c["host"]} for c in cards],
        disclaimers=[web_disclaimer(len(cards))],
        tools_used=["knowledge:search", "places:search", "guide:wikivoyage", "web:search"],
    )


#: Capitalised words that are still not place names.
_NOT_A_PLACE = {"i", "im", "id", "ive", "ill", "the", "a", "an", "is", "it"}

#: Words that are never the thing being asked about.
_NOT_A_SUBJECT = {
    "what", "where", "when", "why", "how", "who", "which", "there", "here",
    "about", "should", "could", "would", "there's", "thing", "things", "some",
    "good", "best", "nice", "much", "many", "does", "doing", "have", "with",
    "from", "into", "that", "this", "these", "those", "like", "anything",
}


def _place_subject(question: str) -> str:
    """A place name the question names, or nothing.

    Only capitalised words past the first count, because a place name is
    capitalised in every language this app is likely to meet in Latin script.
    Deliberately returns nothing rather than guessing: this answer decides
    whether saved notes are discarded, and a guess is far too weak for that.
    """
    words = re.findall(r"[\w\u00C0-\u024F']+", question)
    proper = [
        w
        for w in words[1:]
        # "I" is capitalised and is not a place. Nor is a single letter of any
        # kind, and nor is a word that only starts a sentence.
        if w[:1].isupper() and len(w) > 1 and w.casefold() not in _NOT_A_PLACE
    ]
    return " ".join(proper)


def _subject_of(question: str) -> str:
    """The thing a question is probably about, for looking it up.

    A confident place name first; otherwise the longest ordinary word, which
    is a guess. A wrong guess here costs one lookup that returns nothing
    useful, which is why it is allowed here and not in `_place_subject`.
    """
    named = _place_subject(question)
    if named:
        return named
    words = re.findall(r"[\w\u00C0-\u024F']+", question)
    ordinary = [w for w in words if len(w) > 3 and w.casefold() not in _NOT_A_SUBJECT]
    return max(ordinary, key=len, default="")


def _answer_general(session, trip, question, context, on, focus, intent) -> Answer:
    if focus is not None:
        return _answer_why(session, trip, question, context, on, focus, intent)

    tokens = {t for t in normalize_name(question).split() if len(t) > 3} - _QUESTION_WORDS
    items = list(
        session.execute(
            select(KnowledgeItem).where(
                KnowledgeItem.trip_id == trip.id, KnowledgeItem.is_archived.is_(False)
            )
        ).scalars()
    )
    places = _search_places(session, trip, tokens)
    place_words = {t for tp in places for t in normalize_name(tp.place.name).split()}
    scored = [
        (item, len(tokens & {t for t in normalize_name(f"{item.title} {item.body or ''}").split()}))
        for item in items
    ]
    # One shared word is chance; two, or a saved place's name, is a match.
    hits = [
        item
        for item, score in sorted(scored, key=lambda p: -p[1])
        if score >= 2 or (score >= 1 and place_words & set(normalize_name(item.title).split()))
    ][:5]

    if not hits and not places:
        # Nothing saved about this. Until the web was reachable this was a dead
        # end - true, and useless to someone still deciding where to go. The
        # library is still answered from first; this is only what happens when
        # the library has nothing at all.
        return _answer_from_the_web(question)

    return Answer(
        text=(
            f"Found {_plural(len(places), 'saved place')} and "
            f"{_plural(len(hits), 'saved note')} matching that."
        ),
        cards=[_place_card(tp) for tp in places] + [_knowledge_card(i) for i in hits],
        citations=[c for c in (_cite_source(session, i.source_id) for i in hits) if c],
        tools_used=["knowledge:search", "places:search"],
    )


# Words that ask, not name: never a match on their own.
_QUESTION_WORDS = {
    "about", "tell", "what", "where", "which", "when", "should", "could", "would", "there",
    "this", "that", "these", "those", "have", "with", "from", "into", "know", "anything",
    "something", "saved", "save", "trip", "place", "places", "again", "more", "some",
}


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _search_places(session: Session, trip: Trip, tokens: set[str]) -> list[TripPlace]:
    if not tokens:
        return []
    rows = list(
        session.execute(select(TripPlace).where(TripPlace.trip_id == trip.id)).scalars()
    )
    matched = [
        tp
        for tp in rows
        if tokens & set(normalize_name(tp.place.name).split())
    ]
    return matched[:5]


def _place_by_name(session: Session, trip: Trip, question: str) -> TripPlace | None:
    tokens = {t for t in normalize_name(question).split() if len(t) > 2} - _QUESTION_WORDS
    matches = _search_places(session, trip, tokens)
    return matches[0] if matches else None


def _current_destination(session: Session, trip: Trip, context: AskContext) -> Destination | None:
    if context.destination_id:
        return session.get(Destination, context.destination_id)
    return session.execute(
        select(Destination).where(
            Destination.trip_id == trip.id, Destination.is_current.is_(True)
        )
    ).scalar_one_or_none()
