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
  -> React project-led cockpit UI
  -> switchable session API in src/sessionApi.ts
  -> mock session API in src/mockApi.ts OR backend API in server/
  -> field extraction / risk mock / knowledge retrieval / optional OpenAI-compatible LLM
  -> SessionSnapshot state
  -> left project pool + center cockpit + right presales operations rail
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

The frontend now calls through `src/sessionApi.ts`, which defaults to `src/mockApi.ts` and can be switched to the backend API skeleton with `VITE_SESSION_API_MODE=backend`. In backend mode, the frontend also consumes `/api/projects`, `GET /api/session`, and `GET /api/projects/{project_id}` so the left sidebar can create/select projects, restore bound session snapshots, surface project snapshot summaries, and keep chat/export flows anchored to a chosen project. `/api/session/chat` remains responsible for returning `knowledge_hits`; the browser only renders the citations it receives.

The shipped workstation experience is now Presales Workstation V2, not the original chat-led MVP shell. The first viewport is designed to answer four presales questions before the user scrolls or opens chat: project completeness, current risk level, evidence basis, and delivery/export status. Chat still exists, but it is subordinate to the project cockpit and acts as a work-advancement surface rather than the primary information architecture.
Runtime diagnostics, model status, and storage details are intentionally kept off the normal product surface and remain available only through the hidden admin entry (`?admin=1`).

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
- `GET /api/admin/runtime/status`

Current behavior:

- SQLite-backed session, project, export-asset, and knowledge-upload metadata persistence under `data/jfagent.sqlite`.
- In-memory caches still exist inside the current Node process, but SQLite is now the runtime source of truth for persisted backend records.
- When a persisted session is reloaded, the backend rebuilds suggestion, triggered-risk, and FSM-derived state from current dashboard fields before returning the snapshot. This keeps dashboard fields as the durable source of truth and prevents legacy persisted wording or stale derived state from leaking into the V2 workstation.
- In backend mode, chat and export flows can bind a session to a project via `project_id`.
- `GET /api/session` returns a read-only session snapshot under `data` and includes the bound project summary when one exists.
- Mock field extraction and rule hints.
- Backend-side local hybrid knowledge retrieval for chat responses.
- Optional OpenAI-compatible chat completion for expert response and low-precedence field candidates.
- Chat/session runtime visibility that reports whether the latest answer used `real_llm` or deterministic fallback.
- Admin-only seed-trial knowledge upload, upload-job status persistence, index rebuild, and backend retrieval hot reload.
- Admin runtime status for current model config plus local storage/runtime paths.
- Manual override precedence.
- Export payload assembly for Word rendering.
- First-pass `.docx` rendering through `python-docx`.
- Export asset registry persisted so generated `.docx` files remain downloadable after API restarts as long as files still exist on disk.
- 402 payment-willingness gate for final export.
- Free preview export response.
- Container entrypoint rebuilds the runtime knowledge index on API startup so persisted uploads are available after image upgrades.

The backend project domain provides lightweight CRUD-style project records that sit beside session state, giving the API a stable boundary for future tenant/project storage without forcing session documents to carry all project metadata. The current project service persists through SQLite and is smoke-tested via:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`

The skeleton is verified by `npm run api:smoke`. The frontend can be run against it with `npm run dev:backend`.

## Core Modules

### Frontend

Location: `src/`

Responsibilities:

- Project-led workstation shell with a three-column cockpit layout.
- Project creation, selection, snapshot hydration, and project snapshot summary display from the backend project domain.
- First-viewport project signals for completeness, risk, evidence basis, and delivery/export status.
- Editable cockpit fields and project facts as the highest-precedence visible state.
- Right-side presales operations rail for actions, evidence handling, export progression, and operational nudges.
- Hidden admin-only diagnostics and knowledge-upload tools under `?admin=1`, separate from the normal operator surface.
- Subordinate chat workspace for advancing the project after the cockpit context is visible.
- Quick reply chips, risk display, knowledge citation display, and export/payment-intent UI.

Current workstation shape:

- Left column: project pool, project switching, and summary cues for active work.
- Center column: project cockpit, structured facts, progress state, risk/evidence/delivery signals, and the chat workspace below the main project view.
- Right column: presales operations rail for next actions, knowledge-backed assistance, and export progression.

This structure intentionally promotes project state above conversation state. Users should understand the project situation from the first screen even if they never expand the chat history. The chat area remains important for extraction, clarification, and collaboration, but it is no longer the page's dominant frame.

Current important files:

- `src/App.tsx`: main UI, project sidebar, project snapshot overview cards, snapshot hydration, and local state wiring.
- `src/sessionApi.ts`: switchable session API adapter for chat, export, project CRUD, project detail reads, and session snapshot fetches.
- `src/mockApi.ts`: mock API behavior, extraction, retrieval, export simulation, local project list fallbacks, and project detail fallbacks.
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

- `server/sessionService.ts`: session behavior, API response assembly, and SQLite-backed session persistence wiring.
- `server/projectService.ts`: project domain store, summary cloning, and SQLite-backed project persistence wiring.
- `server/persistence.ts`: SQLite persistence helpers for sessions, projects, export assets, knowledge uploads, upload jobs, and retrieval audit rows.
- `server/runtimePaths.ts`: central runtime path resolution for `data/`, `output/doc/`, and `knowledge/uploads/`.
- `server/llmClient.ts`: OpenAI-compatible Chat Completions client with JSON-mode retry and safe fallback.
- `server/localVectorSearch.ts`: backend-side local hybrid keyword/vector retrieval for `/api/session/chat`.
- `server/generatedKnowledge.json`: generated runtime backend knowledge chunks.
- `server/exportPayload.ts`: frozen export payload schema, chapter plan builder, placeholder BOM, and schema-level validation.
- `server/exportDocument.ts`: DOCX rendering orchestration plus persisted asset lookup/recovery.
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

Location: root Markdown files. Most are FUTURE/aspirational design — read each
file's STATUS banner and `docs/specs-future/README.md` before relying on them.
FSM/persona/field-model/UI behavior is described across the V2 design specs in
`docs/superpowers/specs/` and `api_spec.md`, not in a standalone `agents.md`
(that file was removed; see D-025).

- `rules.md`: expert rules and calculation engines (FUTURE).
- `knowledge_base.md`: RAG ingestion, tagging, verification, retrieval policy (FUTURE).
- `templates.md`: proposal/Word rendering rules (PARTIAL).
- `api_spec.md`: API contracts (PARTIAL/FUTURE).

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
- `agent_runtime`

Project state now exists alongside session state as a separate backend domain object. The shipped backend chat and export flows can bind a session to a project, and project records are synced from session state after chat and dashboard override updates. `/api/session` exposes a read-only snapshot under `data`, including the bound project summary, and `/api/projects` can create, list, and fetch project records. The project snapshot is the backend source of truth for current stage plus dashboard snapshot.

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
2. Backend mode first applies deterministic field extraction and local hybrid retrieval; mock mode still uses the browser mock path.
3. If `OPENAI_API_KEY` is configured, backend mode asks an OpenAI-compatible model for a Chinese pre-sales response, quick replies, and `agent_inference` field candidates.
4. The backend records whether the turn used `real_llm` or fallback and exposes that runtime summary to the workstation UI.
5. LLM candidates can only fill existing dashboard fields and cannot overwrite manual edits or values already extracted from user/upload/chip sources.
6. Rule mock identifies risks and sizing suggestions after field updates.
7. UI updates chat, dashboard fields, risks, knowledge hits, and latest agent runtime state.
8. User edits dashboard fields when needed.
9. Main workstation actions keep payment copy quiet; when the user reaches formal export, backend-gated payment-willingness logic still governs the approval path.
10. Approved formal export builds `ExportPayloadV1`, renders a real `.docx`, stores it under `output/doc/`, and exposes a download URL.
11. Free preview still returns a simulated preview asset until PDF preview rendering is implemented.
12. Session/project/export/upload metadata survive API restarts because the backend reloads them from SQLite-backed storage.
13. On reload, the backend re-derives suggestion, risk, and FSM status from dashboard fields so the project cockpit always reflects current product semantics instead of stale persisted copy.

## Key Boundaries

In scope for the current MVP:

- Local demo of user flow.
- Local knowledge citation and retrieval.
- Admin-only knowledge upload for controlled seed trials.
- Docker Compose seed deployment with private GHCR images and Caddy Basic Auth.
- Optional OpenAI-compatible LLM response generation in backend mode.
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
