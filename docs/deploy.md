# Deploying

TripStash is two pieces: a static PWA and a Python API with a database and a
little file storage. Both are small enough for a free or near-free tier.

## Before anything else: the secret key

`TRIPSTASH_SECRET_KEY` signs session tokens **and** the signed file URLs. Its
default value is a literal in this repository, so it is public. A production
instance refuses to start with it:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Set that, and set `TRIPSTASH_ENVIRONMENT=production`. If you forget, the API
crashes on boot with instructions rather than quietly accepting forged logins.

## The shape of it

| Piece | Needs | Free-ish options |
| --- | --- | --- |
| Web (PWA) | Static hosting, HTTPS | Netlify, Vercel, Cloudflare Pages, GitHub Pages |
| API | Python 3.11, one process | Fly.io, Railway, Render, a small VPS |
| Database | Postgres (PostGIS for spatial indexes) | Neon, Supabase, the same VPS |
| Files | Any object storage, or a disk | A mounted volume is fine for one person |
| Model | Your own machine, or the same host | Ollama |

HTTPS is not optional: the PWA needs it for installability, the share target
and geolocation.

## Self-hosted, all in one

```bash
./setup.sh                    # writes a signing key to .env, once
docker compose up --build -d  # Postgres + PostGIS, the API, the web app
```

That is the whole thing. nginx serves the web app and proxies `/api` to the
API, so the browser sees a single origin and CORS never comes into it. The API
port is not published to the host; the only way in is through the web
container.

If you skip `setup.sh`, compose refuses to start and says so, rather than
falling back to the signing key published in this repository.

For your phone you need HTTPS. Caddy does it in two lines:

```
tripstash.example.com {
  reverse_proxy localhost:5173
}
```

## Railway (one service)

Railway runs one container per service, with no nginx to proxy `/api`, so the
root `Dockerfile` builds the PWA and hands it to the API to serve. Same origin,
one process, one bill.

```
Dockerfile     node builds web/  →  python serves api/ + the build
railway.json   Dockerfile builder, health check on /health
```

**1. Create the project and the database.**

```bash
npm i -g @railway/cli
railway login                 # opens a browser; only you can do this
railway init                  # creates the project
railway add --database postgres
```

Railway's Postgres has **no PostGIS**. That is fine: `services/spatial.py`
falls back to a bounding box plus a haversine distance, which is exact enough
for one person's saved places and needs no extension. Install PostGIS only if
you later want spatial indexes.

**2. Set the variables.** In the service's Variables tab, or with the CLI:

| Variable | Value |
| --- | --- |
| `TRIPSTASH_SECRET_KEY` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `TRIPSTASH_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — Railway substitutes it |
| `TRIPSTASH_ENVIRONMENT` | `production` (the image already sets this) |
| `TRIPSTASH_CORS_ORIGINS` | `[]` (the image already sets this) |

The `postgresql://` URL Railway publishes is rewritten to name the driver, so
it can be pasted in untouched.

**3. Add a volume**, mounted at `/data`. Without it every uploaded video is
deleted on the next deploy — the database would keep rows pointing at files
that no longer exist.

**4. Deploy and open it.**

```bash
railway up
railway domain                # generates the https://*.up.railway.app URL
```

The generated domain is HTTPS, which the PWA needs for installability, the
share target and geolocation.

**What it costs.** One small service plus a Postgres instance on the Hobby
plan; the usage-based charge for something one person opens a few times a day
is small, but it is not zero, and Railway has no permanently free tier. The
extraction model is not part of this: `TRIPSTASH_AI_PROVIDER=fake` runs the
rule-based extractor with nothing to install, and pointing
`TRIPSTASH_LLM_BASE_URL` at Ollama on your own machine keeps the model free.

The same image runs anywhere that takes a Dockerfile and a `PORT`:

```bash
docker build -t tripstash .
docker run -p 8000:8000 -v tripstash-files:/data \
  -e TRIPSTASH_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  tripstash
```

## Split hosting

**Web.** Build and upload the static output:

```bash
cd web && npm ci && npm run build      # → web/dist
```

Set `TRIPSTASH_CORS_ORIGINS` to the domain serving that build, or the browser
will refuse every request. This only applies to split hosting - the compose
file above serves both from one origin and needs none of it.

**API.** Any host that runs a Python process:

```bash
cd api && pip install ".[postgres,media]"
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Environment: `TRIPSTASH_DATABASE_URL`, `TRIPSTASH_SECRET_KEY`,
`TRIPSTASH_ENVIRONMENT`, `TRIPSTASH_CORS_ORIGINS`, `TRIPSTASH_STORAGE_DIR`.

**The model** stays on your own machine by default. Point
`TRIPSTASH_LLM_BASE_URL` at it, or leave `TRIPSTASH_AI_PROVIDER=fake` and the
rule-based extractor runs with nothing to install. Do not expose Ollama to the
public internet; it has no authentication.

## Known gaps before this carries real trips

These are honest limitations, not oversights - each is a deliberate trade for a
single-user prototype.

1. **No migrations.** The schema is created with `create_all`. Add Alembic
   before the second deploy, or a model change will need the database dropped.
2. **Malware scanning is a stub.** `scan_for_malware` checks one test string.
   If anyone but you can upload, wire a real scanner.
3. **No rate limiting and no refresh tokens.** Sessions are long-lived bearer
   tokens. Fine for one person behind HTTPS, not for a public sign-up.
4. **Documents are metadata only.** Specification 16 defers a passport vault
   until there is encryption and audit to match; nothing here changes that.
5. **Backups are yours.** One Postgres database and one storage directory hold
   everything. `GET /api/v1/export` is a complete export - use it.

## After deploying

Install the PWA on your phone (Add to Home Screen). That is what registers
TripStash in the operating system's share sheet, which is the capture path that
works when a platform will not answer anyone else.
