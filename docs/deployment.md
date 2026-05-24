# Seed Server Deployment

This document describes the controlled seed-user deployment for the local-first MVP.

## Target Shape

- OS: Ubuntu 22.04/24.04 or Debian 12.
- Runtime: Node.js 20+, Python 3.10+, Nginx, Certbot.
- App directory: `/opt/jfagent`.
- Backend: `127.0.0.1:3000` through `systemd`.
- Frontend: static files from `/opt/jfagent/dist`.
- Public access: Nginx HTTPS with Basic Auth.
- Admin upload: `/api/admin/` protected by a separate Basic Auth file.

This is for seed validation only. It is not a production SaaS deployment.

## Install

```bash
sudo apt update
sudo apt install -y git nginx apache2-utils python3 python3-venv python3-pip certbot python3-certbot-nginx

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo mkdir -p /opt
sudo git clone https://github.com/kevinalliswell/jfagent.git /opt/jfagent
sudo chown -R "$USER":"$USER" /opt/jfagent
cd /opt/jfagent

npm ci
python3 -m venv .venv
. .venv/bin/activate
pip install python-docx openpyxl pdfplumber pypdf
```

## Build

```bash
cd /opt/jfagent
PYTHON_BIN=/opt/jfagent/.venv/bin/python npm run check
VITE_SESSION_API_MODE=backend VITE_API_BASE_URL=same-origin npm run build
PYTHON_BIN=/opt/jfagent/.venv/bin/python npm run api:build
```

## systemd

Create `/etc/systemd/system/jfagent.service`:

```ini
[Unit]
Description=JF Agent seed API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/jfagent
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=PYTHON_BIN=/opt/jfagent/.venv/bin/python
ExecStart=/usr/bin/node /opt/jfagent/server-dist/index.js
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Prepare writable directories:

```bash
sudo mkdir -p /opt/jfagent/knowledge/uploads /opt/jfagent/output/doc
sudo chown -R www-data:www-data /opt/jfagent/knowledge/uploads /opt/jfagent/output
sudo chown -R www-data:www-data /opt/jfagent/src/generatedKnowledge.ts /opt/jfagent/server/generatedKnowledge.ts /opt/jfagent/server/generatedKnowledge.json 2>/dev/null || true
```

Start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jfagent
sudo systemctl status jfagent
```

## Nginx And Auth

Create Basic Auth users:

```bash
sudo htpasswd -c /etc/nginx/.jfagent_seed_users seeduser
sudo htpasswd -c /etc/nginx/.jfagent_admin admin
```

Create `/etc/nginx/sites-available/jfagent`:

```nginx
server {
  listen 80;
  server_name DOMAIN;

  root /opt/jfagent/dist;
  index index.html;

  auth_basic "JF Agent seed trial";
  auth_basic_user_file /etc/nginx/.jfagent_seed_users;

  location /api/admin/ {
    auth_basic "JF Agent admin";
    auth_basic_user_file /etc/nginx/.jfagent_admin;
    proxy_pass http://127.0.0.1:3000/api/admin/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 180s;
    client_max_body_size 30m;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 180s;
  }

  location / {
    try_files $uri /index.html;
  }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/jfagent /etc/nginx/sites-enabled/jfagent
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d DOMAIN
```

## Admin Knowledge Upload

Open:

```text
https://DOMAIN/?admin=1
```

Use the admin Basic Auth account when the browser prompts for `/api/admin/`.

Supported files:

- `.md`
- `.txt`
- `.docx`
- `.pdf`
- `.xlsx`
- `.csv`
- `.tsv`

Upload behavior:

- Files are stored under `/opt/jfagent/knowledge/uploads/`.
- The backend runs `npm run kb:build`.
- Backend retrieval reloads the runtime JSON index.
- The frontend does not need to rebuild or refresh, but a new chat turn is needed to see new retrieval hits.

## Verify

```bash
curl -u seeduser:PASSWORD https://DOMAIN/api/health
curl -u admin:PASSWORD https://DOMAIN/api/admin/knowledge/status
sudo journalctl -u jfagent -f
```

Seed-user flow:

1. Log in with seed Basic Auth.
2. Paste a messy machine-room project description.
3. Confirm dashboard fields and risks update.
4. Check local knowledge hits show sources.
5. Trigger the Word export willingness flow.

Admin flow:

1. Log in to `https://DOMAIN/?admin=1`.
2. Upload cleaned internal documents.
3. Confirm chunk count increases.
4. Start a new chat using words from the uploaded document and check citations.

## Update And Rollback

Update:

```bash
cd /opt/jfagent
git pull
npm ci
PYTHON_BIN=/opt/jfagent/.venv/bin/python npm run check
VITE_SESSION_API_MODE=backend VITE_API_BASE_URL=same-origin npm run build
PYTHON_BIN=/opt/jfagent/.venv/bin/python npm run api:build
sudo systemctl restart jfagent
```

Rollback:

```bash
cd /opt/jfagent
git log --oneline -5
git checkout COMMIT_SHA
npm ci
VITE_SESSION_API_MODE=backend VITE_API_BASE_URL=same-origin npm run build
PYTHON_BIN=/opt/jfagent/.venv/bin/python npm run api:build
sudo systemctl restart jfagent
```

Uploaded files remain in `knowledge/uploads/` unless manually removed.
