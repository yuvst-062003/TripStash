# One container, the whole app: the PWA is built here and served by the API.
# Railway (and any Docker host) builds this from the repository root.

FROM node:22-slim AS web
WORKDIR /srv/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY web ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TRIPSTASH_STATIC_DIR=/srv/static \
    TRIPSTASH_DATABASE_URL=sqlite+pysqlite:////data/tripstash.db \
    TRIPSTASH_STORAGE_DIR=/data/storage
WORKDIR /srv/api
COPY api/pyproject.toml ./
COPY api/app ./app
RUN pip install --no-cache-dir "."
COPY --from=web /srv/web/dist /srv/static
RUN mkdir -p /data/storage
EXPOSE 8000
# Seed the demo trip when the database is new (a no-op afterwards), then serve.
CMD ["sh", "-c", "python -m app.seed; exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
