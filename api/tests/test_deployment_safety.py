"""Refusing to ship the laptop defaults.

`secret_key` signs both session tokens and the signed file URLs, and its
default value is a literal in this repository. Deploying with it would let
anyone who can read the source sign in as the traveller and mint a URL for any
stored file, so a production instance refuses to start instead.
"""

from __future__ import annotations

import pytest

from app.config import INSECURE_SECRET, InsecureDeploymentError, Settings, assert_deployable

STRONG = "Q7hK2pW9zR4tY6uI8oP1aS3dF5gH7jK9lZ0xC2vB4nM6"


def test_a_laptop_may_use_the_development_default():
    assert_deployable(Settings(environment="development", secret_key=INSECURE_SECRET))


def test_production_refuses_the_secret_that_is_published_in_this_repository():
    with pytest.raises(InsecureDeploymentError) as raised:
        assert_deployable(Settings(environment="production", secret_key=INSECURE_SECRET))

    # The message has to be actionable at three in the morning.
    message = str(raised.value)
    assert "TRIPSTASH_SECRET_KEY" in message
    assert "secrets.token_urlsafe" in message


def test_production_refuses_a_key_short_enough_to_brute_force():
    with pytest.raises(InsecureDeploymentError):
        assert_deployable(Settings(environment="production", secret_key="short"))


def test_production_starts_with_a_real_key():
    assert_deployable(Settings(environment="production", secret_key=STRONG))


def test_localhost_only_cors_warns_but_does_not_block(caplog):
    """A wrong origin breaks the app visibly; it does not expose anything."""
    with caplog.at_level("WARNING"):
        assert_deployable(Settings(environment="production", secret_key=STRONG))
    assert any("CORS" in record.message for record in caplog.records)
