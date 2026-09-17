FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq5 \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir ".[postgres]"

# Runs unprivileged; the storage volume is the only writable path it needs.
RUN useradd --system --create-home tripstash && mkdir -p /data/storage \
 && chown -R tripstash:tripstash /data
USER tripstash

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
