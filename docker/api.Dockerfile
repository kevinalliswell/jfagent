FROM node:24-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/jfagent-venv \
  && /opt/jfagent-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/jfagent-venv/bin/pip install --no-cache-dir python-docx openpyxl pdfplumber pypdf

ENV PATH="/opt/jfagent-venv/bin:${PATH}"
ENV PYTHON_BIN="/opt/jfagent-venv/bin/python"

FROM base AS build

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run api:build

FROM base AS runtime

ENV NODE_ENV="production"
ENV HOST="0.0.0.0"
ENV PORT="3000"

COPY package.json ./
RUN mkdir -p /app/knowledge/uploads /app/output/doc /app/src /app/server

COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/server/generatedKnowledge.ts ./server/generatedKnowledge.ts
COPY --from=build /app/server/generatedKnowledge.json ./server/generatedKnowledge.json
COPY --from=build /app/src/generatedKnowledge.ts ./src/generatedKnowledge.ts
COPY scripts ./scripts
COPY knowledge ./knowledge
COPY docker/api-entrypoint.sh /usr/local/bin/jfagent-api-entrypoint

RUN chmod +x /usr/local/bin/jfagent-api-entrypoint

EXPOSE 3000

ENTRYPOINT ["jfagent-api-entrypoint"]
