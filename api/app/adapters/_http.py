"""One way to make an outbound HTTPS request, so every adapter makes it the same.

Certificate verification is the whole point of this module. A Python installed
from python.org on macOS ships without a usable CA bundle, so `urlopen` fails
on every HTTPS request with a verification error - which, wrapped in the broad
`except` an adapter needs for network failures, looks exactly like "that place
has no guide" rather than "this machine cannot verify anybody".

`certifi` carries a bundle and is already here as a transitive dependency, so
it is preferred when present and the system store is used otherwise. Neither
path disables verification: an adapter that cannot verify a certificate must
fail, not shrug.
"""

from __future__ import annotations

import json
import ssl
import urllib.request
from functools import lru_cache


@lru_cache
def verified_context() -> ssl.SSLContext:
    """A context that verifies, using the best bundle available here."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        # No certifi: the system store is the right fallback, and on a server
        # it is usually the better one anyway.
        return ssl.create_default_context()


def get_json(url: str, *, headers: dict[str, str], timeout: float) -> dict:
    """Fetch and parse JSON, or return an empty dict.

    Adapters call this instead of `urlopen` directly so that a network failure,
    a refusal and a malformed body all arrive the same way: as nothing, for the
    caller to describe honestly. Nothing here decides what "nothing" means.
    """
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=verified_context()) as r:
            return json.loads(r.read())
    except Exception:
        return {}
