# Local Mac Deploy Test (dry run before the real server)

Goal: run the **exact same stack** the seed server will run — Caddy + web +
backend API in Docker Compose — on your Mac over plain HTTP, so you validate the
whole flow before touching the real VPS. This builds the images locally (no GHCR
pull, no token needed).

Prereq: **Docker Desktop for Mac** installed and running (`docker version` works).

---

## 1. Get the files

You only need the repo checked out. From the repo root you already have
`compose.seed.yml`, `docker/Caddyfile`, and the `.env.*.example` templates.

## 2. Make local env files (plain HTTP, no domain)

Create `.env.caddy` in the repo root:

```dotenv
DOMAIN=:80
SEED_BASIC_AUTH_USER=seeduser
SEED_BASIC_AUTH_HASH='PASTE_SEED_HASH'
ADMIN_BASIC_AUTH_USER=admin
ADMIN_BASIC_AUTH_HASH='PASTE_ADMIN_HASH'
```

`DOMAIN=:80` tells Caddy to serve plain HTTP on localhost (no TLS, no real
domain). Generate the two hashes — pick simple test passwords:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'seedpass'
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'adminpass'
```

Paste each output into the matching `_HASH` line (keep the single quotes — the
hash contains `$`).

**Optional real AI** — only if you want to see `真实模型` instead of fallback.
Create `.env.api`:

```dotenv
OPENAI_BASE_URL=https://xingwan.store/v1
OPENAI_API_KEY=PASTE_TOKEN
OPENAI_MODEL=PASTE_MODEL
OPENAI_TIMEOUT_MS=12000
```

Skip this file entirely to test in deterministic fallback mode first.

## 3. Build and start

```bash
docker compose -f compose.seed.yml build
docker compose -f compose.seed.yml up -d
docker compose -f compose.seed.yml ps
```

First build takes a few minutes (installs Python deps + npm). `ps` should show
`api` and `web` both `running`.

## 4. Verify (copy-paste, expect the noted result)

```bash
# health — expect HTTP 200 + {"status":"ok"...}
curl -u seeduser:seedpass http://localhost/api/health

# knowledge status — expect the 4 seed files indexed
curl -u admin:adminpass http://localhost/api/admin/knowledge/status

# runtime status — llm_configured:false if you skipped .env.api
curl -u admin:adminpass http://localhost/api/admin/runtime/status
```

Then the human flow in a browser:

1. Open `http://localhost/` → log in with `seeduser` / `seedpass`.
2. Paste a realistic machine-room description (messy is fine), send.
3. Confirm the V2 first screen fills in: completeness, risk level, evidence
   (knowledge citations), delivery/export status.
4. Trigger an export and confirm the willingness/download flow appears.

Admin upload flow:

1. Open `http://localhost/?admin=1`.
2. Upload a test doc through the admin panel; enter `admin` / `adminpass` if asked.
3. Start a new chat turn and confirm the uploaded source shows up in knowledge hits.

## 5. Logs / teardown

```bash
docker compose -f compose.seed.yml logs -f api    # watch backend
docker compose -f compose.seed.yml logs -f web    # watch caddy
docker compose -f compose.seed.yml down           # stop (keeps volumes)
docker compose -f compose.seed.yml down -v        # stop + wipe test data
```

---

## What this proves before the real server

- the images build clean from the current `main`,
- Caddy Basic Auth (seed vs admin split) works,
- backend session → knowledge retrieval → export runs end to end,
- admin upload re-indexes and shows up in citations,
- (optional) real-AI wiring switches the runtime banner to `真实模型`.

## Differences vs the real VPS (intentional)

| Local Mac test | Real seed server |
| -------------- | ---------------- |
| `DOMAIN=:80`, plain HTTP | real domain, Caddy auto-HTTPS on 80/443 |
| images built locally (`build:`) | images pulled from GHCR (`docker login` + `pull`) |
| test passwords | strong distinct passwords |
| `.env.api` optional | decide real-AI on/off for the pilot |

Once the local run looks right, the only new steps on the VPS are: point DNS at
the box, `docker login ghcr.io`, and `pull` instead of `build`. Everything else
is identical. Full server steps: `docs/deployment.md`.
