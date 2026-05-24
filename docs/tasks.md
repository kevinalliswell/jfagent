# Tasks

This file is the working task ledger. Update it whenever priorities or statuses change.

## Current Focus

Backend API skeleton, switchable frontend API client, `ExportPayloadV1`, first real `.docx` output, quality baseline, local vector retrieval, and backend retrieval boundary are complete. The next recommended milestone is to improve DOCX visual QA and exporter fidelity.

## Task Board

| ID | Priority | Status | Task | Notes |
| --- | --- | --- | --- | --- |
| T-001 | P0 | Done | Build frontend MVP for chat, dashboard, risk, and 99 RMB export gate | Existing prototype in `src/`. |
| T-002 | P0 | Done | Add local knowledge index for Markdown/TXT | Implemented via `scripts/build-knowledge-index.mjs`. |
| T-003 | P0 | Done | Add DOCX/PDF text extraction for local knowledge | Implemented via `scripts/extract-document-text.py`. |
| T-004 | P0 | Done | Initialize project documentation and long-term Codex memory | Created `AGENTS.md`, `README.md`, and core `docs/` files. |
| T-005 | P0 | Done | Add XLSX/CSV quotation and BOQ ingestion | Supports `.xlsx`, `.csv`, `.tsv`, quotation/BOQ row extraction, and source type tagging. |
| T-006 | P1 | Done | Add BOQ/quotation summary panel | Shows source count, row count, equipment categories, representative quotation line, and price-review disclaimer. |
| T-007 | P1 | Done | Define export payload schema for formal Word requirement sheet | Implemented as `server/exportPayload.ts`, documented in `docs/export-payload-schema.md`, and returned by `GET /api/session/export`. |
| T-008 | P0 | Done | Replace mock API with backend session API skeleton | Adds Node/TypeScript API skeleton with chat, override, export, health, and smoke test. |
| T-009 | P2 | Done | Add embedding/vector retrieval | Adds privacy-first local hashed vectors in `src/generatedKnowledge.ts` and hybrid retrieval in `src/localVectorSearch.ts`; no external embedding API. |
| T-010 | P2 | Done | Generate real `.docx` output | Uses `ExportPayloadV1`, `scripts/render-export-docx.py`, and `/api/assets/{asset_id}/download`; visual PNG QA is blocked until LibreOffice/`soffice` is available. |
| T-011 | P2 | Done | Add test/lint/format baseline | Adds ESLint, Prettier, `npm run test`, and `npm run check`. |
| T-012 | P0 | Done | Add switchable frontend API client | Default mock mode is preserved; backend mode is enabled with `VITE_SESSION_API_MODE=backend` and `VITE_API_BASE_URL`. |
| T-013 | P1 | Done | Move retrieval to backend API boundary | `kb:build` now emits frontend and backend knowledge indexes; backend chat returns hybrid `knowledge_hits` through `/api/session/chat` while mock mode keeps browser retrieval. |

## Immediate Next Steps

1. Add LibreOffice/`soffice` to the local QA environment so DOCX visual rendering can run.
2. Improve the exporter toward higher-fidelity `templates.md` layout after visual QA is available.
3. Add retrieval audit metadata and provider abstraction before replacing `local-hash-v1` with a real embedding/vector store.

## Open Questions

- Which documents will be used for initial internal testing?
- Should screenshots and generated demo artifacts be kept in the repo root or moved to `docs/assets/`?
- What tenant/document permission model is required for SaaS?

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
