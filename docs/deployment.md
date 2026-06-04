# Seed Server Deployment

This is the recommended seed-user deployment path. The server does not clone or build the source repo. It only runs private GHCR images with Docker Compose and persists runtime data in Docker volumes.

## Target Shape

- OS: Ubuntu 22.04/24.04 or Debian 12.
- Runtime: Docker Engine with Docker Compose v2.
- Images:
  - `ghcr.io/kevinalliswell/jfagent-api`
  - `ghcr.io/kevinalliswell/jfagent-web`
- Public entrypoint: Caddy container on ports `80` and `443`.
- Backend API: private Compose network only, listening on `api:3000`.
- Persistent data:
  - uploaded knowledge files: `jfagent_knowledge_uploads`
  - generated export files: `jfagent_output`
  - Caddy certificates/config state: `jfagent_caddy_data`, `jfagent_caddy_config`

This is still a controlled seed trial, not a production SaaS deployment.

If a Codex CLI session will perform deployment directly on the VPS, use `docs/vps-codex-deployment-handoff.md` as the handoff prompt.

## Image Publishing

Images are published by GitHub Actions in `.github/workflows/docker-publish.yml` when `main` is pushed.

Published tags:

```text
ghcr.io/kevinalliswell/jfagent-api:latest
ghcr.io/kevinalliswell/jfagent-api:main
ghcr.io/kevinalliswell/jfagent-api:<commit-sha>
ghcr.io/kevinalliswell/jfagent-web:latest
ghcr.io/kevinalliswell/jfagent-web:main
ghcr.io/kevinalliswell/jfagent-web:<commit-sha>
```

Keep the GHCR packages private for seed trials. The server only needs a GitHub token with `read:packages`.

## Server Setup

Install Docker:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in so the `docker` group takes effect.

Create a deploy directory:

```bash
sudo mkdir -p /opt/jfagent-deploy
sudo chown -R "$USER":"$USER" /opt/jfagent-deploy
cd /opt/jfagent-deploy
```

Copy only these files to the server:

```text
compose.seed.yml
.env.caddy
.env.api  # optional, only when enabling real AI
```

Do not copy the source repo to the server.

## Caddy Auth Environment

Generate two password hashes. Use different passwords for seed users and admins:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'SEED_PASSWORD'
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'ADMIN_PASSWORD'
```

Create `/opt/jfagent-deploy/.env.caddy`:

```dotenv
DOMAIN=your-domain.example.com
SEED_BASIC_AUTH_USER=seeduser
SEED_BASIC_AUTH_HASH='PASTE_SEED_BCRYPT_HASH'
ADMIN_BASIC_AUTH_USER=admin
ADMIN_BASIC_AUTH_HASH='PASTE_ADMIN_BCRYPT_HASH'
```

The hash contains `$` characters. Wrap each hash in single quotes in `.env.caddy` so Docker Compose treats it as a literal value.

## Optional Real AI Environment

Create `/opt/jfagent-deploy/.env.api` only when enabling the real backend agent:

```dotenv
OPENAI_BASE_URL=https://xingwan.store/v1
OPENAI_API_KEY=PASTE_XINGWAN_OR_OPENAI_COMPATIBLE_TOKEN
OPENAI_MODEL=PASTE_AVAILABLE_MODEL_NAME
OPENAI_TIMEOUT_MS=12000
```

Notes:

- If the relay console gives a different base URL, use that exact value.
- The app appends `/chat/completions`, so include `/v1` in the base URL when the provider expects OpenAI-style paths.
- If `.env.api` is missing or `OPENAI_API_KEY` is empty, backend chat falls back to the deterministic rule/mock response.
- The API container reads `.env.api`; the web/Caddy container does not need model credentials.

## GHCR Login

Create a GitHub Personal Access Token with `read:packages`, then log in:

```bash
echo 'GHCR_READ_TOKEN' | docker login ghcr.io -u kevinalliswell --password-stdin
```

## Start

Make sure the domain has an A record pointing to this server and that ports `80` and `443` are open.

```bash
cd /opt/jfagent-deploy
docker compose -f compose.seed.yml pull
docker compose -f compose.seed.yml up -d
docker compose -f compose.seed.yml ps
```

Caddy automatically requests and renews HTTPS certificates.

## Verify

Seed-user health check:

```bash
curl -u seeduser:SEED_PASSWORD https://DOMAIN/api/health
```

Admin knowledge status:

```bash
curl -u admin:ADMIN_PASSWORD https://DOMAIN/api/admin/knowledge/status
```

Admin runtime status:

```bash
curl -u admin:ADMIN_PASSWORD https://DOMAIN/api/admin/runtime/status
```

Logs:

```bash
docker compose -f compose.seed.yml logs -f api
docker compose -f compose.seed.yml logs -f web
```

Seed-user flow:

1. Open `https://DOMAIN/`.
2. Log in with the seed Basic Auth account.
3. Paste a realistic machine-room project description.
4. Confirm dashboard fields, risks, knowledge citations, and export willingness flow.

Admin upload flow:

1. Open `https://DOMAIN/?admin=1`.
2. Use the seed account for the page if prompted.
3. Upload through the admin panel and enter the admin Basic Auth account if the page asks for it.
4. Start a new chat turn and confirm uploaded sources appear in knowledge hits.

Real AI flow:

1. Create `.env.api` with the provider base URL, token, and model.
2. Restart the API container with `docker compose -f compose.seed.yml up -d`.
3. Confirm `GET /api/admin/runtime/status` shows `llm_configured: true` plus the expected base URL and model.
4. Send a new chat message and confirm the workstation runtime banner switches to `真实模型`.
5. If provider errors occur, check `docker compose -f compose.seed.yml logs -f api`; the app should still answer through fallback and the workstation should show fallback mode for that turn.

## Runtime Behavior

The API container runs `npm run kb:build` on startup before serving traffic. This rebuilds the runtime index from:

- seed files baked into the image under `knowledge/`
- uploaded files stored in `jfagent_knowledge_uploads`

When an admin uploads a file, the API saves it under `/app/knowledge/uploads`, rebuilds the index, and hot-reloads `server/generatedKnowledge.json`. Frontend rebuilding is not required.

## Update

For normal latest-image upgrades:

```bash
cd /opt/jfagent-deploy
docker compose -f compose.seed.yml pull
docker compose -f compose.seed.yml up -d
docker image prune -f
```

Uploaded knowledge files and generated output files remain in named volumes.

## Rollback

Use the previous commit SHA tags:

```bash
cd /opt/jfagent-deploy
JFAGENT_API_IMAGE=ghcr.io/kevinalliswell/jfagent-api:COMMIT_SHA \
JFAGENT_WEB_IMAGE=ghcr.io/kevinalliswell/jfagent-web:COMMIT_SHA \
docker compose -f compose.seed.yml up -d
```

For a longer rollback window, write the two image variables into a local `.env` file next to `compose.seed.yml`:

```dotenv
JFAGENT_API_IMAGE=ghcr.io/kevinalliswell/jfagent-api:COMMIT_SHA
JFAGENT_WEB_IMAGE=ghcr.io/kevinalliswell/jfagent-web:COMMIT_SHA
```

Then run:

```bash
docker compose -f compose.seed.yml pull
docker compose -f compose.seed.yml up -d
```

## Backup And Restore

Back up uploaded knowledge:

```bash
docker run --rm \
  -v jfagent_knowledge_uploads:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/jfagent_knowledge_uploads.tgz -C /data .
```

Back up generated exports:

```bash
docker run --rm \
  -v jfagent_output:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/jfagent_output.tgz -C /data .
```

Restore uploaded knowledge:

```bash
docker run --rm \
  -v jfagent_knowledge_uploads:/data \
  -v "$PWD":/backup \
  alpine sh -c "cd /data && tar xzf /backup/jfagent_knowledge_uploads.tgz"
docker compose -f compose.seed.yml restart api
```

## Local Container Verification

For local Docker verification on a development machine:

```bash
cp .env.caddy.example .env.caddy
```

Set `DOMAIN=:80` in `.env.caddy` for plain local HTTP, and fill the auth hashes with values from `caddy hash-password`.

```bash
docker compose -f compose.seed.yml build
docker compose -f compose.seed.yml up -d
curl -u seeduser:SEED_PASSWORD http://localhost/api/health
docker compose -f compose.seed.yml down
```

## Legacy Fallback: systemd And Nginx

The previous single-server fallback is still viable when Docker is unavailable:

- clone the repo into `/opt/jfagent`
- install Node.js 24+ and Python 3.10+
- install `python-docx`, `openpyxl`, `pdfplumber`, and `pypdf` in a virtualenv
- run `npm ci`, `npm run check`, backend-mode frontend build, and `npm run api:build`
- supervise `node server-dist/index.js` with `systemd`
- serve `dist/` and proxy `/api/` with Nginx
- protect the site and `/api/admin/` with separate Nginx Basic Auth files

Use this only as a fallback. The preferred seed trial path is GHCR images plus Docker Compose.
