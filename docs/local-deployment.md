# Local Deployment Runbook

This runbook covers local deployment and verification on Windows, Linux, and
macOS. It supports the Phase B seed-pilot goal: prove the backend-mode stack can
run reliably before using a real server/customer environment.

Use the Docker path when you want the closest match to the seed deployment. Use
the source path when you are actively developing or debugging code.

## Common Requirements

- Git.
- Docker Desktop or Docker Engine with Docker Compose v2.
- Node.js 24+ when running from source.
- Python 3.10+ when running from source.
- Optional: LibreOffice/`soffice` and Poppler/`pdftoppm` for full DOCX visual QA.
- Optional: a GHCR token with `read:packages` if you want to pull private images
  instead of building them locally.

## Shared Smoke Checks

Use these checks after any local deployment:

```bash
curl -u seeduser:SEED_PASSWORD http://localhost/api/health
curl -u admin:ADMIN_PASSWORD http://localhost/api/admin/runtime/status
```

Open the app:

```text
http://localhost/
```

Seed Basic Auth:

```text
seeduser / SEED_PASSWORD
```

Admin Basic Auth:

```text
admin / ADMIN_PASSWORD
```

Admin panel:

```text
http://localhost/?admin=1
```

## Docker Seed Stack

The Docker path runs the same two-image shape used by the seed server:

- `jfagent-api`: backend API, persistence, knowledge ingestion, DOCX export.
- `jfagent-web`: Caddy + built frontend + reverse proxy.

### 1. Prepare Caddy Auth

Generate two Caddy bcrypt hashes:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext "SEED_PASSWORD"
docker run --rm caddy:2-alpine caddy hash-password --plaintext "ADMIN_PASSWORD"
```

Create `.env.caddy` from the example:

```bash
cp .env.caddy.example .env.caddy
```

For local plain HTTP, use:

```dotenv
DOMAIN=:80
SEED_BASIC_AUTH_USER=seeduser
SEED_BASIC_AUTH_HASH='PASTE_SEED_BCRYPT_HASH'
ADMIN_BASIC_AUTH_USER=admin
ADMIN_BASIC_AUTH_HASH='PASTE_ADMIN_BCRYPT_HASH'
```

Keep the single quotes around hashes because bcrypt hashes contain `$`.

### 2. Choose Pull Or Build

Pull latest private GHCR images when testing the published artifact:

```bash
echo "GHCR_READ_TOKEN" | docker login ghcr.io -u kevinalliswell --password-stdin
docker compose -f compose.seed.yml pull
```

Build locally when testing the current checkout or when you do not have a GHCR
read token:

```bash
docker compose -f compose.seed.yml build
```

### 3. Start And Stop

Start:

```bash
docker compose -f compose.seed.yml up -d
docker compose -f compose.seed.yml ps
```

View logs:

```bash
docker compose -f compose.seed.yml logs -f api
docker compose -f compose.seed.yml logs -f web
```

Stop while keeping data volumes:

```bash
docker compose -f compose.seed.yml down
```

Reset local runtime data:

```bash
docker compose -f compose.seed.yml down -v
```

### 4. Optional Real AI

Create `.env.api` only when enabling the real backend agent:

```bash
cp .env.api.example .env.api
```

Fill:

```dotenv
OPENAI_BASE_URL=https://xingwan.store/v1
OPENAI_API_KEY=PASTE_TOKEN
OPENAI_MODEL=PASTE_MODEL
OPENAI_TIMEOUT_MS=12000
```

Restart:

```bash
docker compose -f compose.seed.yml up -d
```

If `.env.api` is missing or incomplete, the app stays in deterministic fallback
mode. That is expected and should remain green.

## Windows

Recommended: Docker Desktop with WSL2 backend. Use PowerShell for Docker
commands, or use WSL2 Ubuntu for source development.

### Windows Docker Flow

```powershell
cd C:\path\to\jfagent
git pull
docker run --rm caddy:2-alpine caddy hash-password --plaintext "SEED_PASSWORD"
docker run --rm caddy:2-alpine caddy hash-password --plaintext "ADMIN_PASSWORD"
copy .env.caddy.example .env.caddy
notepad .env.caddy
docker compose -f compose.seed.yml build
docker compose -f compose.seed.yml up -d
docker compose -f compose.seed.yml ps
curl.exe -u seeduser:SEED_PASSWORD http://localhost/api/health
```

In PowerShell, paste the generated bcrypt hashes into `.env.caddy` manually and
keep the single quotes. Do not construct the hash values through shell variable
expansion because `$` is part of the hash.

Use `docker compose -f compose.seed.yml pull` instead of `build` if you have
logged in to GHCR and want to test published images.

### Windows Source Flow

For source mode, prefer WSL2 Ubuntu:

```bash
cd /path/to/jfagent
git pull
bash scripts/setup-env.sh
npm run check
npm run api:smoke
```

Mock-mode frontend:

```bash
npm run dev
```

Backend-mode frontend:

```bash
npm run api:build
npm run api:start
```

In a second WSL terminal:

```bash
npm run dev:backend
```

Open:

```text
http://localhost:5173/
```

## Linux

Linux is the closest local match to the seed server path.

### Linux Docker Flow

Install Docker if needed:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in, then:

```bash
cd /path/to/jfagent
git pull
cp .env.caddy.example .env.caddy
# edit .env.caddy and set DOMAIN=:80 plus Caddy auth hashes
docker compose -f compose.seed.yml build
docker compose -f compose.seed.yml up -d
curl -u seeduser:SEED_PASSWORD http://localhost/api/health
```

### Linux Source Flow

Install Node.js 24+ and Python 3.10+, then:

```bash
cd /path/to/jfagent
git pull
bash scripts/setup-env.sh
npm run check
npm run api:smoke
npm run dev
```

Backend mode uses the same two-terminal flow:

```bash
npm run api:build
npm run api:start
```

Second terminal:

```bash
npm run dev:backend
```

Optional full visual DOCX QA:

```bash
sudo apt install -y libreoffice poppler-utils
bash scripts/setup-env.sh
npm run api:smoke
```

## macOS

Use Docker Desktop for seed-stack testing. Use Homebrew for source-mode
dependencies.

### macOS Docker Flow

```bash
cd /path/to/jfagent
git pull
docker run --rm caddy:2-alpine caddy hash-password --plaintext "SEED_PASSWORD"
docker run --rm caddy:2-alpine caddy hash-password --plaintext "ADMIN_PASSWORD"
cp .env.caddy.example .env.caddy
open -e .env.caddy
docker compose -f compose.seed.yml build
docker compose -f compose.seed.yml up -d
curl -u seeduser:SEED_PASSWORD http://localhost/api/health
```

If port 80 is already occupied, stop the conflicting local service or edit
`compose.seed.yml` temporarily to map another host port, for example
`8080:80`, then open `http://localhost:8080/`.

### macOS Source Flow

Install dependencies:

```bash
brew install node@24 python poppler
brew install --cask libreoffice
```

Then:

```bash
cd /path/to/jfagent
git pull
bash scripts/setup-env.sh
npm run check
npm run api:smoke
npm run dev
```

Backend mode:

```bash
npm run api:build
npm run api:start
```

Second terminal:

```bash
npm run dev:backend
```

## Troubleshooting

- `401 Unauthorized`: check the Basic Auth username/password and confirm hashes
  in `.env.caddy` match the plaintext passwords you are using.
- `ERR_UNKNOWN_BUILTIN_MODULE node:sqlite`: the source runtime is older than
  Node 24. Upgrade Node or use Docker.
- `npm run check` fails in DOCX export: run `bash scripts/setup-env.sh` first.
- `docx_pdf_rendered` or `docx_png_rendered` is `warning`: optional visual QA
  tools are missing or conversion failed. This should not fail the smoke gate.
- `docker compose pull` fails with `denied`: log in to GHCR with a token that has
  `read:packages`, or use `docker compose -f compose.seed.yml build`.
- Port 80 conflict: stop the conflicting service or temporarily map another
  host port in `compose.seed.yml`.
