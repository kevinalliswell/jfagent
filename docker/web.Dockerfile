FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/jfagent-venv \
  && /opt/jfagent-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/jfagent-venv/bin/pip install --no-cache-dir python-docx openpyxl pdfplumber pypdf

ENV PATH="/opt/jfagent-venv/bin:${PATH}"
ENV PYTHON_BIN="/opt/jfagent-venv/bin/python"

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_SESSION_API_MODE=backend
ARG VITE_API_BASE_URL=same-origin
ENV VITE_SESSION_API_MODE="${VITE_SESSION_API_MODE}"
ENV VITE_API_BASE_URL="${VITE_API_BASE_URL}"

RUN npm run build

FROM caddy:2-alpine

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80 443
