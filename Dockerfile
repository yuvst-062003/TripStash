# One image: the built PWA served by the API that backs it.
#
# The compose stack keeps nginx in front (see docker-compose.yml). This is for
# a host that runs a single service - Railway, Fly, a small VPS - where there
# is no second container to proxy /api, and where one process is also the
# cheapest thing to run.

FROM node:22-slim AS web
WORKDIR /srv
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build


FROM python:3.11-slim

# TRIPSTASH_CORS_ORIGINS is empty on purpose: the web app is served from this
# same origin, so there is no cross-origin request to allow. Empty is the
# correct answer here, not a missing one.
#
# The database and the storage directory both sit under /data because that is
# where the host's volume is mounted. The defaults live inside the image, so
# leaving them alone would discard every trip on the next deploy.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TRIPSTASH_STATIC_DIR=/srv/web \
    TRIPSTASH_DATABASE_URL=sqlite+pysqlite:////data/tripstash.db \
    TRIPSTASH_STORAGE_DIR=/data/storage \
    TRIPSTASH_ENVIRONMENT=production \
    TRIPSTASH_CORS_ORIGINS=[]

WORKDIR /srv

RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq5 \
 && rm -rf /var/lib/apt/lists/*

COPY api/pyproject.toml ./
COPY api/app ./app
RUN pip install --no-cache-dir ".[postgres,media]"

COPY --from=web /srv/dist /srv/web

# The storage volume is the only writable path the app needs.
RUN useradd --system --create-home tripstash && mkdir -p /data/storage \
 && chown -R tripstash:tripstash /data

EXPOSE 8000
# Starts as root for one command only. A host's volume is mounted over /data at
# run time and arrives owned by root, which shadows the ownership set above, so
# a container that had already dropped privileges could not write its own
# database. Ownership is therefore fixed after the mount, and setpriv drops to
# the unprivileged user for everything that follows.
#
# Shell form on purpose: the host names the port, and PORT is what they all use.
# Seeds the demo trip when the database is new, which is a no-op afterwards.
CMD chown -R tripstash:tripstash /data \
 && exec setpriv --reuid=tripstash --regid=tripstash --init-groups \
      sh -c 'python -m app.seed; exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}'
