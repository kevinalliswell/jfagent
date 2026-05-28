# Architecture

## Product Goal

JF Agent Workstation is a pre-sales assistant for data center and machine-room construction integration projects. The current implementation is a local-first MVP, while the long-term target is SaaS. Its job is to convert unstructured early-stage project information into a structured, editable, evidence-backed requirement sheet that can later become a Word proposal or quoting package.

## Primary Users

- Sales staff collecting vague customer requirements.
- Pre-sales engineers preparing scope, sizing, risk notes, and quote inputs.
- Integration company managers validating whether a lightweight paid export package has value.

## Current Architecture

```text
User
  -> React chat UI
  -> switchable session API in src/sessionApi.ts
  -> mock session API in src/mockApi.ts OR backend API in server/
  -> field extraction / risk mock / knowledge retrieval
  -> SessionSnapshot state
  -> right dashboard + knowledge hits + export gate
```

Local knowledge ingestion:

```text
knowledge/*.md|txt|docx|pdf|xlsx|csv|tsv
  -> scripts/extract-document-text.py
  -> scripts/extract-spreadsheet-text.py
  -> scripts/build-knowledge-index.mjs
  -> src/generatedKnowledge.ts, server/generatedKnowledge.ts, and server/generatedKnowledge.json with local hashed vectors
  -> browser-side retrieval in mock mode OR backend-side retrieval in API mode
```

Seed deployment:

```text
Seed user/admin
  -> Caddy container with HTTPS + Basic Auth
  -> static frontend from jfagent-web image
  -> /api/* reverse proxy to private API container
  -> jfagent-api image
  -> Docker volumes for uploads and generated exports
```

The frontend now calls through `src/sessionApi.ts`, which defaults to `src/mockApi.ts` and can be switched to the backend API skeleton with `VITE_SESSION_API_MODE=backend`. In backend mode, `/api/session/chat` is responsible for returning `knowledge_hits`; the browser only renders the citations it receives.

## Target Architecture

```text
Frontend Workstation
  -> Backend Session API
  -> Agent Orchestrator
  -> Expert Rule Engine
  -> RAG Retrieval Service
  -> Document Export Service
  -> Audit/Project Storage
```

The target architecture should support SaaS concerns:

- tenant and workspace isolation
- user/project permissions
- document access boundaries
- audit logs for ingestion, retrieval, field edits, and export intent
- provider-configurable model and embedding services

Expected backend responsibilities:

- Session state authority.
- Field precedence and conflict handling.
- LLM calls and tool orchestration.
- Expert rule execution.
- Knowledge ingestion jobs.
- Retrieval audit logs.
- Export payload generation.
- Word/PDF rendering.
- Payment-willingness event capture.

Under the current product decision, the 99 RMB flow records willingness only and should not call real payment providers.

### Backend API Skeleton

Location: `server/`

Current endpoints:

- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`
- `GET /api/session?session_id=<id>`
- `POST /api/session/chat`
- `POST /api/session/override`
- `GET /api/session/export`
- `GET /api/assets/{asset_id}/download`
- `GET /api/admin/knowledge/status`
- `POST /api/admin/knowledge/upload`

Current behavior:

- In-memory project store alongside in-memory session store.
- In backend mode, chat and export flows can bind a session to a project via `project_id`.
- In-memory session store.
- Mock field extraction and rule hints.
- Backend-side local hybrid knowledge retrieval for chat responses.
- Admin-only seed-trial knowledge upload, index rebuild, and backend retrieval hot reload.
- Manual override precedence.
- Export payload assembly for Word rendering.
- First-pass `.docx` rendering through `python-docx`.
- In-memory export asset registry and download route.
- 402 payment-willingness gate for final export.
- Free preview export response.
- Container entrypoint rebuilds the runtime knowledge index on API startup so persisted uploads are available after image upgrades.

The backend project domain provides lightweight CRUD-style project records that sit beside session state, giving the API a stable boundary for future tenant/project storage without forcing session documents to carry all project metadata. The current project service is in-memory and smoke-tested via:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`

The skeleton is verified by `npm run api:smoke`. The frontend can be run against it with `npm run dev:backend`.

## Core Modules

### Frontend

Location: `src/`

Responsibilities:

- Chat-style project intake.
- Quick reply chips.
- Editable dashboard fields.
- Risk and knowledge citation display.
- Export/payment intent UI.

Current important files:

- `src/App.tsx`: main UI and local state wiring.
- `src/sessionApi.ts`: switchable session API adapter, defaulting to mock mode.
- `src/mockApi.ts`: mock API behavior, extraction, retrieval, export simulation.
- `src/types.ts`: shared frontend/session types.
- `src/styles.css`: UI styling.
- `src/generatedKnowledge.ts`: generated local knowledge chunks.
- `src/localVectorSearch.ts`: browser-side hybrid keyword/vector retrieval for mock mode.

### Backend API

Location: `server/`

Responsibilities:

- Establish API envelopes and route boundaries.
- Provide local smoke-testable session endpoints.
- Build `ExportPayloadV1` from backend session state for Word rendering.
- Prepare the codebase for future SaaS session authority.

Current important files:

- `server/sessionService.ts`: in-memory session behavior and API response assembly.
- `server/projectService.ts`: in-memory project domain store and project summary cloning.
- `server/localVectorSearch.ts`: backend-side local hybrid keyword/vector retrieval for `/api/session/chat`.
- `server/generatedKnowledge.json`: generated runtime backend knowledge chunks.
- `server/exportPayload.ts`: frozen export payload schema, chapter plan builder, placeholder BOM, and schema-level validation.
- `server/exportDocument.ts`: DOCX rendering orchestration, asset persistence, and file metadata.
- `server/http.ts`: route handling and JSON envelopes.
- `scripts/render-export-docx.py`: Python `python-docx` renderer for `ExportPayloadV1`.

### Local Knowledge Index

Location: `scripts/`, `knowledge/`

Responsibilities:

- Extract text from local files.
- Chunk source documents.
- Preserve source metadata.
- Generate local fixed-dimension hashed vectors.
- Generate TypeScript indexes for frontend mock mode plus a runtime JSON index for backend API mode.
- Accept admin uploads under `knowledge/uploads/` during seed trials.

Current supported formats:

- Markdown
- TXT
- DOCX
- PDF
- XLSX
- CSV
- TSV

Spreadsheet extraction normalizes quotation/BOQ rows into retrieval text with item name, brand, model/spec, quantity, unit, unit price, total price, remark, and rough equipment category.

### Product Specifications

Location: root Markdown files.

- `agents.md`: FSM, persona, field model, UI behavior.
- `rules.md`: expert rules and calculation engines.
- `knowledge_base.md`: RAG ingestion, tagging, verification, retrieval policy.
- `templates.md`: proposal/Word rendering rules.
- `api_spec.md`: planned API contracts.

## Data Model

The central runtime object is `SessionSnapshot`.

It contains:

- `fsm_state`
- `export_status`
- `messages`
- `quick_replies`
- `dashboard_fields`
- `triggered_risks`
- `knowledge_hits`
- `suggestion`
- `export_asset`

Project state now exists alongside session state as a separate backend domain object. The shipped backend chat and export flows can bind a session to a project, and project records are synced from session state after chat and dashboard override updates. `/api/projects` can create, list, and fetch project records, and the project snapshot is the backend source of truth for current stage plus dashboard snapshot.

Dashboard fields carry:

- value
- display value
- source
- confidence
- needs-confirmation flag
- risk linkage

Field precedence follows the product specification:

```text
dashboard_edit > user_message > upload > button_chip > agent_inference > default
```

## Data Flow

1. User sends a messy project description.
2. Mock API extracts candidate fields and project signals.
3. Backend API mode runs local hybrid retrieval from the runtime JSON index and returns `knowledge_hits`; mock mode still uses `src/localVectorSearch.ts`.
4. Rule mock identifies risks and sizing suggestions.
5. UI updates chat, dashboard fields, risks, and knowledge hits.
6. User edits dashboard fields when needed.
7. Export button triggers 99 RMB payment-willingness modal.
8. Approved formal export builds `ExportPayloadV1`, renders a real `.docx`, stores it under `output/doc/`, and exposes a download URL.
9. Free preview still returns a simulated preview asset until PDF preview rendering is implemented.

## Key Boundaries

In scope for the current MVP:

- Local demo of user flow.
- Local knowledge citation and retrieval.
- Admin-only knowledge upload for controlled seed trials.
- Docker Compose seed deployment with private GHCR images and Caddy Basic Auth.
- Structured project field capture.
- Manual override behavior.
- Export value and willingness validation.
- First-pass Word requirement-sheet generation.
- SaaS-compatible module boundaries.

Out of scope until later phases:

- Production authentication.
- Real payment.
- True backend session authority.
- High-fidelity Word/PDF rendering pipeline.
- Production vector retrieval service and persistent vector database.
- Application-level authentication and admin permissions beyond Caddy Basic Auth.
- OCR/photo interpretation.
- Legal-grade calculation guarantees.

## Verification Strategy

Current commands:

```bash
npm run kb:build
npm run check
npm run build
npm run api:smoke
```

Use browser verification for user-facing flow changes:

- Chat input produces dashboard updates.
- Knowledge hits show source files.
- Export button opens payment-willingness modal.
- Mobile layout does not horizontally overflow.

## Architecture Risks

- Mock API may hide backend state complexity.
- Generated TypeScript knowledge indexes do not scale to large internal corpora.
- Local hashed vectors improve recall but are still not a substitute for a real embedding model or vector database.
- Formal Word export fidelity will need a dedicated rendering pipeline.
- Visual DOCX layout QA currently depends on installing LibreOffice/`soffice`.
- Future SaaS deployment requires tenant isolation, document permission controls, and clear model/data privacy policy.
