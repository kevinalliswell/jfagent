# Tasks

This file is the working task ledger. Update it whenever priorities or statuses change.

## Current Focus

Presales Workstation V2 has shifted the product into a project-led cockpit phase. The current focus is small-scope pilot closure: stabilize the V2 workstation for `1 external paid sample + internal deep usage`, verify that the project cockpit supports real collaboration, keep backend-mode agent/runtime visibility trustworthy, and keep all runtime/diagnostic details behind the hidden admin surface instead of the normal product UI.

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
| T-018 | P0       | Done   | Add project domain contracts and endpoints                           | Adds `/api/projects` list/create/fetch routes plus a backend project domain with smoke coverage.                                                                                                  |
| T-019 | P0       | Done   | Bind sessions and export payloads to projects                        | Backend chat/export can bind a session to a project, sync project snapshots, and use project name in export payloads.                                                                             |
| T-020 | P1       | Done   | Expose project-bound session snapshots                               | `GET /api/session` now returns a read-only session snapshot with the bound project summary under `data`, and the frontend uses that snapshot plus project detail reads to restore selected context and surface project snapshot summaries in backend mode. |
| T-021 | P0       | Done   | Add OpenAI-compatible real agent v1                                  | Backend chat now calls an OpenAI-compatible `/v1/chat/completions` provider, supports `xingwan.store`-style `OPENAI_BASE_URL`, retries when JSON mode is unsupported, and falls back cleanly when unavailable or invalid. |
| T-022 | P0       | Done        | Add SQLite persistence for backend runtime state                  | Session snapshots, project records, export asset registry, knowledge upload metadata, and upload job status now persist under `data/jfagent.sqlite`, with smoke coverage for cross-process recovery. |
| T-023 | P0       | Done   | Close the MVP toward a small paid pilot                               | Adds a paid-pilot closure spec/plan, exposes backend/frontend agent runtime visibility, and reframes repo docs around the `1 external sample + internal deep use` route. |
| T-024 | P0       | Done   | Upgrade frontend to Presales Workstation V2                           | Frontend is now a project-led cockpit: left project pool, center project cockpit, right presales operations rail, with chat demoted into the work-advancement area, no obvious payment copy in the main viewport, and runtime/admin diagnostics hidden from the normal product surface. |
| T-025 | P0       | Done   | Normalize persisted session-derived state and time-line the work area | Backend now rebuilds suggestion/risk/FSM-derived state from dashboard fields when loading persisted sessions, preventing old risk wording from leaking back into the UI; the center activity surface is further framed as a project timeline instead of a chat feed. |

## Immediate Next Steps

1. Pick the first external sample customer plus one internal presales owner and one manager/reviewer to test the V2 cockpit collaboration loop.
2. Deploy the backend-mode seed stack and confirm the V2 first-screen signals stay reliable: completeness, risk, evidence basis, delivery/export status, and `real_llm` versus `fallback`.
3. Upload 10-20 cleaned internal seed documents through `?admin=1` so the right-side presales operations rail has usable citation backing during pilot projects.
4. Run 3-5 real project descriptions through the V2 workstation flow, then review whether the cockpit-to-chat-to-export path reduces back-and-forth versus the old chat-led MVP.
5. Add LibreOffice/`soffice` later so DOCX visual rendering can run before expanding beyond the first small pilot.

## Open Questions

- Which documents will be used for initial internal testing?
- Which OpenAI-compatible provider/model should be the first long-term default after xingwan trialing?
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
