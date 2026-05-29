# Tasks

This file is the working task ledger. Update it whenever priorities or statuses change.

## Current Focus

OpenAI-Compatible Agent V1 is the current focus: add a real LLM behind the backend chat boundary, keep rule/RAG fallback, and preserve seed-trial deployment stability.

## Task Board

| ID    | Priority | Status | Task                                                                 | Notes                                                                                                                                                                                             |
| ----- | -------- | ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-001 | P0       | Done   | Build frontend MVP for chat, dashboard, risk, and 99 RMB export gate | Existing prototype in `src/`.                                                                                                                                                                     |
| T-002 | P0       | Done   | Add local knowledge index for Markdown/TXT                           | Implemented via `scripts/build-knowledge-index.mjs`.                                                                                                                                              |
| T-003 | P0       | Done   | Add DOCX/PDF text extraction for local knowledge                     | Implemented via `scripts/extract-document-text.py`.                                                                                                                                               |
| T-004 | P0       | Done   | Initialize project documentation and long-term Codex memory          | Created `AGENTS.md`, `README.md`, and core `docs/` files.                                                                                                                                         |
| T-005 | P0       | Done   | Add XLSX/CSV quotation and BOQ ingestion                             | Supports `.xlsx`, `.csv`, `.tsv`, quotation/BOQ row extraction, and source type tagging.                                                                                                          |
| T-006 | P1       | Done   | Add BOQ/quotation summary panel                                      | Shows source count, row count, equipment categories, representative quotation line, and price-review disclaimer.                                                                                  |
| T-007 | P1       | Done   | Define export payload schema for formal Word requirement sheet       | Implemented as `server/exportPayload.ts`, documented in `docs/export-payload-schema.md`, and returned by `GET /api/session/export`.                                                               |
| T-008 | P0       | Done   | Replace mock API with backend session API skeleton                   | Adds Node/TypeScript API skeleton with chat, override, export, health, and smoke test.                                                                                                            |
| T-009 | P2       | Done   | Add embedding/vector retrieval                                       | Adds privacy-first local hashed vectors in `src/generatedKnowledge.ts` and hybrid retrieval in `src/localVectorSearch.ts`; no external embedding API.                                             |
| T-010 | P2       | Done   | Generate real `.docx` output                                         | Uses `ExportPayloadV1`, `scripts/render-export-docx.py`, and `/api/assets/{asset_id}/download`; visual PNG QA is blocked until LibreOffice/`soffice` is available.                                |
| T-011 | P2       | Done   | Add test/lint/format baseline                                        | Adds ESLint, Prettier, `npm run test`, and `npm run check`.                                                                                                                                       |
| T-012 | P0       | Done   | Add switchable frontend API client                                   | Default mock mode is preserved; backend mode is enabled with `VITE_SESSION_API_MODE=backend` and `VITE_API_BASE_URL`.                                                                             |
| T-013 | P1       | Done   | Move retrieval to backend API boundary                               | `kb:build` now emits frontend and backend knowledge indexes; backend chat returns hybrid `knowledge_hits` through `/api/session/chat` while mock mode keeps browser retrieval.                    |
| T-014 | P0       | Done   | Add admin knowledge upload for seed trial                            | Hidden `?admin=1` upload panel calls `/api/admin/knowledge/upload`, stores files under `knowledge/uploads/`, rebuilds the local index, and hot-reloads backend retrieval.                         |
| T-015 | P0       | Done   | Prepare seed server deployment docs                                  | Documents seed-user trial deployment and keeps systemd/Nginx as a legacy fallback.                                                                                                                |
| T-016 | P0       | Done   | Containerize seed deployment with GHCR, Docker Compose, and Caddy    | Adds API/Web Dockerfiles, Compose, Caddy Basic Auth/HTTPS routing, GHCR publish workflow, and volume-backed uploads/exports.                                                                      |
| T-017 | P0       | Done   | Prepare VPS Codex deployment handoff                                 | Adds `docs/vps-codex-deployment-handoff.md` with a copy-paste Codex CLI prompt for image-only VPS deployment.                                                                                     |
| T-018 | P0       | Done   | Add project domain contracts and endpoints                           | Adds `/api/projects` list/create/fetch routes plus in-memory project service and smoke coverage.                                                                                                  |
| T-019 | P0       | Done   | Bind sessions and export payloads to projects                        | Backend chat/export can bind a session to a project, sync project snapshots, and use project name in export payloads.                                                                             |
| T-020 | P1       | Done   | Expose project-bound session snapshots                               | `GET /api/session` now returns a read-only session snapshot with the bound project summary under `data`, and the frontend uses that snapshot plus project detail reads to restore selected context and surface project snapshot summaries in backend mode. |
| T-021 | P0       | In Progress | Add OpenAI-compatible real agent v1                               | Backend chat should call an OpenAI-compatible `/v1/chat/completions` provider, accept `xingwan.store` via `OPENAI_BASE_URL`, and fall back cleanly when unavailable.                             |

## Immediate Next Steps

1. Finish the OpenAI-compatible backend agent branch and validate it with the new smoke stub.
2. Keep the VPS deployment path available via `docs/vps-codex-deployment-handoff.md`.
3. Upload 10-20 cleaned internal seed documents through `?admin=1`.
4. Run seed-user interviews and collect whether the requirement-sheet/export workflow is worth paying for.
5. Add LibreOffice/`soffice` later so DOCX visual rendering can run.

## Open Questions

- Which documents will be used for initial internal testing?
- Which OpenAI-compatible provider/model should be the first production default after xingwan trialing?
- Should screenshots and generated demo artifacts be kept in the repo root or moved to `docs/assets/`?
- What tenant/document permission model is required for SaaS?
- Which domain and server account will host the seed trial?
- Which seed/admin Basic Auth usernames and passwords should be used for the first invite group?

## Verification Commands

For frontend and ingestion changes:

```bash
npm run build
```

For the full local quality gate:

```bash
npm run check
```

For backend API skeleton and adapter changes:

```bash
npm run api:smoke
VITE_SESSION_API_MODE=backend VITE_API_BASE_URL=http://localhost:3000 npm run build
```

For knowledge-only changes:

```bash
npm run kb:build
npm run kb:verify
```

For seed deployment builds:

```bash
VITE_SESSION_API_MODE=backend VITE_API_BASE_URL=same-origin npm run build
npm run api:smoke
docker compose -f compose.seed.yml build
```

For OpenAI-compatible agent work:

```bash
npm run api:smoke
npm run check
```
