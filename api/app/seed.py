"""Seed a demo trip: `python -m app.seed`.

Runs the real pipeline rather than inserting rows directly, so the demo data
is exactly what capture produces - including the items that need review and
the upload that deliberately fails.
"""

from __future__ import annotations

import sys
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from app.db import init_db, session_scope
from app.models.core import Destination, Trip, User
from app.models.enums import PLACE_LIKE_TYPES, KnowledgeType, SourceKind
from app.models.ops import Expense
from app.services.extraction import (
    DuplicateSourceError,
    approve_candidate,
    create_source,
    process_source,
)
from app.services.security import hash_password

DEMO_EMAIL = "traveller@example.com"
DEMO_PASSWORD = "tripstash-demo-password"

SOURCES = [
    {
        "kind": SourceKind.LINK,
        "url": "https://www.example-social.test/reel/antigua-3-days",
        "title": "3 perfect days in Antigua",
        "author": "@backpackerlina",
        "published_on": date(2026, 7, 4),
        "text": (
            "Antigua completely got me. Go to Cerro de la Cruz just before sunset, the "
            "view over the city and the volcano behind it is unreal. We stayed at "
            "Tremendo Hostel, the rooftop is the best part. Careful with the taxi scam "
            "at the bus terminal, they quote four times the normal price and act "
            "offended when you say no. The shuttle to Lake Atitlán costs Q150 and takes "
            "about three hours. If you do the Acatenango Volcano hike, bring a headlamp "
            "and a proper warm layer, it drops below freezing at the top."
        ),
    },
    {
        "kind": SourceKind.MESSAGE,
        "title": "WhatsApp from Dani",
        "text": (
            "Eat at Rainbow Café in Antigua, cheap breakfast and they have live music at "
            "night. Also do not miss Semuc Champey, it is a long bus but worth it."
        ),
    },
    {
        "kind": SourceKind.ARTICLE,
        "url": "https://www.example-blog.test/guatemala-border",
        "title": "Crossing into Guatemala overland",
        "published_on": date(2026, 3, 18),
        "text": (
            "At the border crossing they sometimes ask for proof of onward travel. "
            "Immigration officers may also request an unofficial exit fee; a receipt is "
            "your right to ask for. Budget around 40 USD per day in Guatemala if you "
            "stay in hostels."
        ),
    },
    {
        "kind": SourceKind.NOTE,
        "title": "Note to self",
        "text": (
            "Tikal National Park at sunrise needs a guide booked the day before. "
            "Entrance is roughly Q150 plus the sunrise supplement."
        ),
    },
]


def seed() -> None:
    init_db()
    with session_scope() as session:
        if session.execute(select(User).where(User.email == DEMO_EMAIL)).scalar_one_or_none():
            print(f"Demo account {DEMO_EMAIL} already exists - nothing to do.")
            return

        user = User(
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            display_name="Demo traveller",
            base_currency="USD",
        )
        session.add(user)
        session.flush()

        today = datetime.now(UTC).date()
        trip = Trip(
            user_id=user.id,
            name="Central America, four months",
            start_date=today - timedelta(days=21),
            end_date=today + timedelta(days=95),
            base_currency="USD",
            total_budget=7200,
            interests="hiking,food,diving",
        )
        session.add(trip)
        session.flush()

        for position, (name, country, lat, lon, current) in enumerate(
            [
                ("Antigua", "Guatemala", 14.5586, -90.7295, True),
                ("Lake Atitlán", "Guatemala", 14.6907, -91.2025, False),
                ("Lanquín", "Guatemala", 15.5750, -89.9800, False),
                ("Flores", "Guatemala", 16.9280, -89.8920, False),
            ]
        ):
            session.add(
                Destination(
                    trip_id=trip.id,
                    name=name,
                    country=country,
                    lat=lat,
                    lon=lon,
                    position=position,
                    is_current=current,
                )
            )
        session.flush()

        approved = 0
        left_for_review = 0
        for spec in SOURCES:
            try:
                source = create_source(session, trip_id=trip.id, **spec)
            except DuplicateSourceError:
                continue
            candidates = process_source(session, source)

            for candidate in candidates:
                # Confident place matches are pre-approved so the map has pins;
                # everything else is left in Inbox, which is the honest state.
                resolutions = candidate.resolution_json != "[]"
                if (
                    KnowledgeType(candidate.type) in PLACE_LIKE_TYPES
                    and resolutions
                    and candidate.confidence >= 0.8
                ):
                    approve_candidate(session, candidate)
                    approved += 1
                elif KnowledgeType(candidate.type) in (
                    KnowledgeType.SAFETY,
                    KnowledgeType.TRANSPORT,
                    KnowledgeType.PACKING,
                ):
                    approve_candidate(session, candidate)
                    approved += 1
                else:
                    left_for_review += 1

        for days_ago, amount, currency, category, note in [
            (1, 45, "GTQ", "food", "Breakfast and coffee"),
            (2, 150, "GTQ", "transport", "Shuttle to Antigua"),
            (3, 18, "USD", "accommodation", "Hostel dorm"),
            (5, 220, "GTQ", "activity", "Volcano hike deposit"),
        ]:
            from app.adapters import get_fx

            rate = get_fx().rate(currency, trip.base_currency)
            session.add(
                Expense(
                    trip_id=trip.id,
                    spent_on=today - timedelta(days=days_ago),
                    amount=amount,
                    currency=currency,
                    amount_base=round(amount * rate, 2),
                    category=category,
                    country="Guatemala",
                    note=note,
                )
            )

        print(
            f"Seeded {DEMO_EMAIL} / {DEMO_PASSWORD}\n"
            f"  trip: {trip.name}\n"
            f"  approved records: {approved}\n"
            f"  still awaiting review in Inbox: {left_for_review}"
        )


if __name__ == "__main__":
    sys.exit(seed())
