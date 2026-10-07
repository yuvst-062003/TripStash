"""The activity types a traveller can pick.

Picks filter what the planning screens show. They are never weighted: how many
independent sources name a thing is what orders it, and that is a number the
traveller can check rather than a score they guessed.

The vocabulary is deliberately short and deliberately concrete. "Hike and
trek" is something a video can be about; "adventure" is not.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Activity:
    slug: str
    label: str


ACTIVITIES: tuple[Activity, ...] = (
    Activity("hike", "Hike and trek"),
    Activity("surf", "Surf"),
    Activity("volcano", "Volcanoes"),
    Activity("dive", "Diving"),
    Activity("spanish", "Spanish school"),
    Activity("street_food", "Street food"),
    Activity("nightlife", "Hostels and nightlife"),
    Activity("waterfall", "Waterfalls and caves"),
    Activity("ruins", "Ruins"),
    Activity("wildlife", "Wildlife"),
    Activity("coffee", "Coffee farms"),
    Activity("islands", "Islands and boats"),
)

ACTIVITY_SLUGS: frozenset[str] = frozenset(a.slug for a in ACTIVITIES)
