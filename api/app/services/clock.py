"""What day it is where the traveller is.

Every countdown in the app - "69 days to go", "in 9 days", what is planned for
today - was computed from the UTC date. Nobody is ever in UTC. They are
somewhere, and somewhere has a date, and for a traveller in Israel the two
disagree between midnight and 3am: the app says a day has passed when it has
not. In Auckland it disagrees for half of every evening, the other way.

A trip-planning app that is wrong about what day it is, is wrong about the one
thing a traveller is actually counting.

The zone arrives as an IANA name from the client, which the browser hands over
for free. A named zone rather than an offset because a zone knows about
daylight saving and an offset does not: Israel is +3 in September and +2 in
December, so a fixed offset would start lying again twice a year.

Anything unusable falls back to UTC. That is the wrong date for somebody, but
it is the same wrong date the app had before, so a client that never sends the
header is no worse off than it was.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

#: Long enough for any real IANA name ("America/Argentina/Buenos_Aires" is 30).
#: The value comes from a client, so it is bounded before it reaches a lookup.
_MAX_ZONE_LENGTH = 64


def zone_or_utc(name: str | None) -> tzinfo:
    """The named zone, or UTC if it cannot be used.

    The name is client-supplied, so it is treated as untrusted input: bounded,
    and never allowed to raise. `ZoneInfo` reads from the system database by
    path, so a name with traversal in it is refused before it gets there.
    """
    if not name or len(name) > _MAX_ZONE_LENGTH:
        return UTC
    if ".." in name or name.startswith("/") or "\\" in name:
        return UTC
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError, OSError):
        return UTC


def traveller_today(zone_name: str | None, *, now: datetime | None = None) -> date:
    """The date it is for the traveller right now.

    `now` is injectable so the behaviour can be pinned at a specific instant;
    production never passes it.
    """
    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(zone_or_utc(zone_name)).date()
