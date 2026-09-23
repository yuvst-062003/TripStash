#!/usr/bin/env sh
# One-time setup for running TripStash yourself.
#
# Generates the signing key and writes it to .env. That key signs your session
# and your file URLs, so it must not be the one published in this repository -
# the app refuses to start in production if it is.
set -eu

if [ -f .env ] && grep -q '^TRIPSTASH_SECRET_KEY=.\{32,\}' .env; then
  echo "✓ .env already has a signing key. Nothing to do."
else
  KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))' 2>/dev/null \
     || head -c 48 /dev/urandom | base64 | tr -d '\n/+=')
  printf 'TRIPSTASH_SECRET_KEY=%s\n' "$KEY" >> .env
  echo "✓ Wrote a new signing key to .env"
fi

echo
echo "Next:"
echo "  docker compose up --build -d     start everything"
echo "  docker compose exec api python -m app.seed    (optional) demo trip"
echo
echo "Then open http://localhost:5173"
echo "For your phone you need HTTPS - see docs/deploy.md."
