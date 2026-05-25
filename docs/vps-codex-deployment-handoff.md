# VPS Codex Deployment Handoff

This handoff is for a Codex CLI session running on the target VPS. Its job is to deploy the seed-user trial from private GHCR images. The VPS must not clone or receive the source repository.

## Current Release

- Source branch: `main`
- Workflow: `Publish Docker images`
- GHCR packages: private and published
- Images:
  - `ghcr.io/kevinalliswell/jfagent-api:latest`
  - `ghcr.io/kevinalliswell/jfagent-web:latest`
- Deployment shape: Docker Compose plus Caddy.
- Public ports: `80` and `443`.
- Backend API exposure: Compose internal network only.
- Persistent data:
  - `jfagent_knowledge_uploads`
  - `jfagent_output`
  - `jfagent_caddy_data`
  - `jfagent_caddy_config`

## Inputs Needed On The VPS

Ask the operator for:

- Domain name, for example `agent.example.com`.
- GHCR read token with `read:packages`.
- Seed Basic Auth username and password.
- Admin Basic Auth username and password.
- Optional OpenAI-compatible provider values: base URL, API key, and model.

Do not print tokens or plaintext passwords back to the terminal after collecting them.

## Copy-Paste Prompt For VPS Codex CLI

Use this prompt in Codex CLI on the VPS:

```text
You are deploying JF Agent seed trial on this VPS.

Important constraints:
- Do not clone the source repository.
- Do not copy application source code onto this server.
- Use private GHCR images only.
- Use Docker Compose and Caddy.
- Expose only ports 80 and 443 publicly.
- Keep the API service private inside the Compose network.
- Persist uploads, generated exports, and Caddy state with Docker named volumes.
- Do not implement new app features or edit app source.
- Ask me before deleting files, volumes, images, or changing firewall rules.

Target images:
- ghcr.io/kevinalliswell/jfagent-api:latest
- ghcr.io/kevinalliswell/jfagent-web:latest

Deployment directory:
- /opt/jfagent-deploy

Collect these values from me:
- DOMAIN
- GHCR_READ_TOKEN
- SEED_BASIC_AUTH_USER
- SEED_BASIC_AUTH_PASSWORD
- ADMIN_BASIC_AUTH_USER
- ADMIN_BASIC_AUTH_PASSWORD
- Optional: OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL

Deployment tasks:
1. Inspect the OS and whether Docker Compose v2 is available.
2. If Docker is missing, install Docker Engine using the official convenience script or apt packages appropriate for Ubuntu/Debian.
3. Create /opt/jfagent-deploy and work from there.
4. Create compose.seed.yml exactly as specified below. Use a single-quoted heredoc, for example `cat > compose.seed.yml <<'EOF'`, so `${...}` placeholders are not expanded by the shell.
5. Generate Caddy bcrypt hashes for the seed and admin passwords with:
   docker run --rm caddy:2-alpine caddy hash-password --plaintext 'PASSWORD'
6. Create .env.caddy with DOMAIN, users, and single-quoted bcrypt hashes.
7. If I provide OpenAI-compatible provider values, create .env.api as specified below; otherwise omit it so the app uses fallback mode.
8. Login to GHCR:
   echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u kevinalliswell --password-stdin
9. Run:
   docker compose -f compose.seed.yml pull
   docker compose -f compose.seed.yml up -d
10. Verify:
   docker compose -f compose.seed.yml ps
   curl -u SEED_USER:SEED_PASSWORD https://DOMAIN/api/health
   curl -u ADMIN_USER:ADMIN_PASSWORD https://DOMAIN/api/admin/knowledge/status
11. If HTTPS is not ready yet, inspect Caddy logs and DNS A record status:
   docker compose -f compose.seed.yml logs --tail=120 web
12. Report the final URL, service status, image tags, volume names, and any remaining manual action.

compose.seed.yml content:

services:
  api:
    image: ${JFAGENT_API_IMAGE:-ghcr.io/kevinalliswell/jfagent-api:latest}
    restart: unless-stopped
    env_file:
      - path: .env.api
        required: false
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 3000
      PYTHON_BIN: /opt/jfagent-venv/bin/python
    volumes:
      - jfagent_knowledge_uploads:/app/knowledge/uploads
      - jfagent_output:/app/output
    expose:
      - "3000"

  web:
    image: ${JFAGENT_WEB_IMAGE:-ghcr.io/kevinalliswell/jfagent-web:latest}
    restart: unless-stopped
    depends_on:
      - api
    env_file:
      - path: .env.caddy
        required: true
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - jfagent_caddy_data:/data
      - jfagent_caddy_config:/config

volumes:
  jfagent_knowledge_uploads:
    name: jfagent_knowledge_uploads
  jfagent_output:
    name: jfagent_output
  jfagent_caddy_data:
    name: jfagent_caddy_data
  jfagent_caddy_config:
    name: jfagent_caddy_config

.env.caddy format:

DOMAIN=DOMAIN_VALUE
SEED_BASIC_AUTH_USER=SEED_USER_VALUE
SEED_BASIC_AUTH_HASH='SEED_BCRYPT_HASH_VALUE'
ADMIN_BASIC_AUTH_USER=ADMIN_USER_VALUE
ADMIN_BASIC_AUTH_HASH='ADMIN_BCRYPT_HASH_VALUE'

.env.api format, optional:

OPENAI_BASE_URL=https://xingwan.store/v1
OPENAI_API_KEY=PROVIDER_TOKEN_VALUE
OPENAI_MODEL=PROVIDER_MODEL_VALUE
OPENAI_TIMEOUT_MS=12000

Acceptance criteria:
- https://DOMAIN/ loads behind seed Basic Auth.
- https://DOMAIN/api/health returns ok under seed Basic Auth.
- https://DOMAIN/?admin=1 shows the admin upload panel.
- /api/admin/knowledge/status requires admin Basic Auth and returns index status.
- Uploaded knowledge and generated exports are stored in Docker named volumes.
- No application source repository exists on the VPS.
```

## Operator Notes

- The first Caddy HTTPS issuance requires the domain A record to point at the VPS and inbound `80/443` to be open.
- `.env.caddy` hash values must be single-quoted because bcrypt hashes contain `$`.
- Admin upload supports `.md`, `.txt`, `.docx`, `.pdf`, `.xlsx`, `.csv`, and `.tsv`.
- Admin page URL: `https://DOMAIN/?admin=1`.
- After uploading knowledge, start a new chat turn to test retrieval hits.

## Useful Commands After Deployment

```bash
cd /opt/jfagent-deploy
docker compose -f compose.seed.yml ps
docker compose -f compose.seed.yml logs -f api
docker compose -f compose.seed.yml logs -f web
docker compose -f compose.seed.yml pull
docker compose -f compose.seed.yml up -d
```

Back up uploaded knowledge:

```bash
docker run --rm \
  -v jfagent_knowledge_uploads:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/jfagent_knowledge_uploads.tgz -C /data .
```

Roll back to a commit-tagged image:

```bash
JFAGENT_API_IMAGE=ghcr.io/kevinalliswell/jfagent-api:COMMIT_SHA \
JFAGENT_WEB_IMAGE=ghcr.io/kevinalliswell/jfagent-web:COMMIT_SHA \
docker compose -f compose.seed.yml up -d
```
