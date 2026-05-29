# Decisions

Record important technical and product decisions here.

## D-001: Start With A Frontend-First Local MVP

Status: accepted.

Decision:

Use a React/Vite local prototype with mock API behavior before building a backend.

Reason:

The most important early risk is product value: whether users understand and value the structured requirement sheet and paid export flow. A frontend-first MVP validates that quickly.

Consequences:

- Fast iteration.
- Backend complexity deferred.
- `src/mockApi.ts` will eventually need to be replaced by real API calls.

## D-002: Use Generated Local Knowledge Index Before Vector Search

Status: accepted.

Decision:

Use `scripts/build-knowledge-index.mjs` to generate `src/generatedKnowledge.ts` from local files.

Reason:

This keeps the first local RAG loop transparent, inspectable, and backend-free.

Consequences:

- Works for small and medium demo corpora.
- Not appropriate for very large knowledge bases.
- Future vector search should preserve source metadata and citation behavior.

## D-003: Support DOCX/PDF Extraction Through A Python Helper

Status: accepted.

Decision:

Use `scripts/extract-document-text.py` for Word and PDF text extraction.

Reason:

Python document parsing libraries are mature, and the helper keeps Node indexing code simple.

Consequences:

- Requires Python 3.
- Extraction quality depends on source document structure.
- Scanned PDFs still need OCR in a future phase.

## D-004: Treat 99 RMB As Payment-Willingness Validation For Now

Status: accepted.

Decision:

Keep the 99 RMB flow as a modal-based willingness check, not real payment.

Reason:

The current product needs to validate perceived value before adding billing infrastructure.

Consequences:

- UI can test paid intent.
- Do not add payment provider integration under the current plan.
- The export flow should record willingness state, not transaction state.

## D-005: Keep `agents.md` As Business Specification And `AGENTS.md` As Collaboration Rules

Status: accepted.

Decision:

Preserve the existing lowercase `agents.md` as the product/FSM specification and create uppercase `AGENTS.md` for Codex development instructions.

Reason:

The existing file contains valuable domain behavior details but is not optimized as an AI development workflow document.

Consequences:

- Future agents should read both files.
- Avoid renaming `agents.md` unless all references are updated.

## D-006: Long-Term Product Direction Is SaaS

Status: accepted.

Decision:

Design the project toward a future SaaS product, while keeping the current MVP local-first for speed.

Reason:

The product should eventually support multiple users, projects, knowledge spaces, audit trails, and centrally managed exports.

Consequences:

- Backend API boundaries should be introduced before the frontend grows too coupled to `mockApi.ts`.
- Future architecture must consider tenant isolation, document permissions, audit logs, and model/data privacy.
- Local-only shortcuts are acceptable for MVP validation but should not become hidden architecture assumptions.

## D-007: Next Implementation Priorities Are XLSX/BOQ Ingestion Then Backend API Skeleton

Status: accepted.

Decision:

Prioritize XLSX/CSV quotation and BOQ ingestion first, then introduce a backend API skeleton.

Reason:

Quotation and BOQ reuse strengthens the paid MVP value proposition, while the backend skeleton prepares the project for SaaS evolution.

Consequences:

- The next implementation task should focus on spreadsheet extraction and BOQ summary data.
- The following architecture task should move session endpoints toward the `api_spec.md` contract.
- Real Word export remains after the export payload and backend boundaries are clearer.

## D-008: Spreadsheet Ingestion Normalizes Quotation And BOQ Rows To Text Chunks

Status: accepted.

Decision:

Use a Python spreadsheet extractor to convert `.xlsx`, `.csv`, and `.tsv` quotation/BOQ rows into retrieval-friendly text chunks.

Reason:

Historical quotations and equipment lists are high-value pre-sales assets. Normalizing them into text chunks lets the current local RAG flow reuse them without introducing a full database or vector service yet.

Consequences:

- Spreadsheet rows keep source file and sheet context.
- Extracted rows include item name, category, brand, model/spec, quantity, unit, unit price, total price, and remark when available.
- Legacy `.xls` remains out of scope until there is a real need.

## D-009: First Backend Skeleton Uses Node.js And TypeScript

Status: accepted.

Decision:

Use a lightweight Node.js/TypeScript backend skeleton with the built-in HTTP server and in-memory sessions.

Reason:

The immediate goal is to establish SaaS-oriented API boundaries against `api_spec.md` without introducing framework or persistence decisions too early.

Consequences:

- Backend contracts stay close to the existing TypeScript frontend.
- The skeleton is easy to smoke test locally.
- A framework, database, authentication, and tenant model remain future decisions.
- Frontend adoption is incremental through the switchable API adapter recorded in D-010.

## D-010: Frontend Uses A Switchable Session API Adapter

Status: accepted.

Decision:

Route frontend session calls through `src/sessionApi.ts`. Default mode uses the local mock API. Backend mode is enabled with `VITE_SESSION_API_MODE=backend` and `VITE_API_BASE_URL`.

Reason:

This allows incremental backend adoption while preserving the current local demo and avoiding a risky all-at-once frontend migration.

Consequences:

- `src/App.tsx` no longer imports `src/mockApi.ts` directly.
- Mock mode remains the default for product demos.
- Backend mode can be verified locally with `npm run api:start` and `npm run dev:backend`.

## D-011: Freeze Word Export Inputs As `ExportPayloadV1`

Status: accepted.

Decision:

Define a backend-side `ExportPayloadV1` schema and builder in `server/exportPayload.ts`. `GET /api/session/export` returns the payload alongside the simulated asset response.

Reason:

Real Word rendering should consume a deterministic, frozen payload instead of reconstructing document inputs from frontend UI state or loose mock fields. This keeps template rendering, risk-driven chapters, placeholder pricing, and future SaaS audit behavior aligned.

Consequences:

- T-010 `.docx` generation should use `ExportPayloadV1` as its input contract.
- Chapter inclusion is determined before rendering and follows `templates.md`.
- Price fields remain yellow manual placeholders unless an approved pricing-source decision is made later.
- The frontend may ignore `export_payload` until document preview or export QA needs it.

## D-012: First Word Export Uses A Python DOCX Renderer

Status: accepted.

Decision:

Use `scripts/render-export-docx.py` with `python-docx` to render `ExportPayloadV1` into a real `.docx` file. The backend calls this renderer from `server/exportDocument.ts`, stores generated files under `output/doc/`, and serves them through `/api/assets/{asset_id}/download`.

Reason:

`python-docx` is already aligned with the existing document-ingestion toolchain and gives the project a fast path from frozen export payload to a tangible Word artifact without introducing a larger document rendering service yet.

Consequences:

- Formal approved exports now produce a downloadable `.docx` asset.
- Free preview remains simulated until PDF preview rendering is intentionally implemented.
- The first renderer is deterministic and table-driven, but visual PNG QA requires LibreOffice/`soffice`.
- Future T-010 follow-up work should improve layout fidelity against `templates.md` once visual rendering is available.

## D-013: Use ESLint And Prettier As The First Quality Gate

Status: accepted.

Decision:

Add ESLint and Prettier with npm scripts for `lint`, `format`, `format:check`, `test`, and `check`.

Reason:

The project now has frontend, backend, generated knowledge, and document-export code. A small local quality gate reduces formatting drift and catches TypeScript/JavaScript mistakes before larger refactors or exporter improvements.

Consequences:

- `npm run check` is the default all-in-one local verification command.
- Generated and build output stay excluded from formatting and linting.
- `npm run test` currently maps to the backend smoke test; a fuller UI/API test runner remains future work.

## D-014: Start Vector Retrieval With Local Hashed Embeddings

Status: accepted.

Decision:

Generate fixed-dimension local hashed vectors during `npm run kb:build` and use browser-side hybrid keyword/vector retrieval in `src/localVectorSearch.ts`.

Reason:

The privacy and provider decision for real embedding models is still open. A local hashed vector baseline improves recall and validates vector-ranking behavior without sending internal documents to an external service or adding a vector database too early.

Consequences:

- `src/generatedKnowledge.ts` now includes `vector` arrays plus `localEmbeddingModel` and `localEmbeddingDimensions`.
- `npm run kb:verify` validates generated vector shape.
- Retrieval results can expose hybrid, vector, and keyword scoring metadata.
- This is not a semantic embedding model; future SaaS/RAG work can replace it with a managed or local embedding provider and vector store.

## D-015: Backend API Owns Retrieval In Backend Mode

Status: accepted.

Decision:

Move hybrid knowledge retrieval behind the backend session API boundary for backend mode. `npm run kb:build` now emits both `src/generatedKnowledge.ts` and `server/generatedKnowledge.ts`; `/api/session/chat` calls `server/localVectorSearch.ts` and returns `knowledge_hits` in the chat response. Frontend mock mode keeps `src/localVectorSearch.ts` so local product demos still work without starting the API server.

Reason:

Retrieval is a SaaS backend responsibility because it will later need tenant isolation, document permissions, audit logs, provider choice, and vector-store replacement. Moving the boundary now lets the frontend render citations without knowing whether hits came from local hashed vectors, a local model, or a managed vector service.

Consequences:

- Backend mode no longer depends on browser-side RAG execution.
- Generated knowledge remains local and duplicated only as a temporary MVP artifact.
- `npm run kb:verify` validates both generated indexes stay aligned.
- Future RAG work should replace `server/localVectorSearch.ts` behind the same API response shape instead of changing frontend citation rendering first.

## D-016: Seed Trial Uses Nginx Basic Auth And Admin Upload

Status: superseded by D-017 for deployment; admin upload remains accepted.

Decision:

Use a single-server seed deployment with Nginx serving the built frontend, proxying `/api/` to the Node backend, and protecting access with Basic Auth. Add an admin-only hidden upload panel at `?admin=1`; it sends base64 JSON to `/api/admin/knowledge/upload`, stores files under `knowledge/uploads/`, runs `npm run kb:build`, and hot-reloads the backend runtime retrieval index.

Reason:

The immediate goal is controlled seed-user validation, not production SaaS infrastructure. Basic Auth plus an admin upload path lets users experience the product without command-line knowledge ingestion while avoiding premature account, tenant, and database work.

Consequences:

- Seed users can try the app through a normal HTTPS URL.
- Admins can upload cleaned internal materials from the browser.
- `server/generatedKnowledge.json` is the backend runtime retrieval source in API mode.
- Uploaded knowledge files are operational data and are ignored by git.
- Production authentication, tenant isolation, document permissions, and persistent vector storage remain future work.

## D-017: Seed Trial Deployment Uses GHCR Images, Docker Compose, And Caddy

Status: accepted.

Decision:

Package the seed-trial app into two private GHCR images: `jfagent-api` for the Node/Python backend and `jfagent-web` for the Vite static frontend served by Caddy. Run them with `compose.seed.yml`; keep the API on the private Compose network and expose only the Caddy container on ports `80` and `443`. Caddy handles HTTPS, seed-user Basic Auth for the app and non-admin API routes, and separate admin Basic Auth for `/api/admin/`.

Reason:

The seed server should not clone or build the source repository. Private images keep deployment repeatable, make upgrades and rollbacks tag-based, and keep Caddy/HTTPS/auth configuration inside the same Compose boundary instead of relying on host Nginx/systemd setup.

Consequences:

- The server needs Docker, Compose, a GHCR read token, `compose.seed.yml`, and `.env.caddy`.
- Uploaded knowledge files and generated exports persist in Docker named volumes.
- API startup rebuilds the runtime knowledge index from baked-in seed files plus persisted uploads.
- GitHub Actions becomes the image build and publish path.
- Nginx/systemd deployment remains only a fallback for environments where Docker is unavailable.
- This does not introduce production SaaS auth, tenant isolation, database persistence, or real billing.

## D-018: First Real Agent Uses OpenAI-Compatible Chat Completions

Status: accepted.

Decision:

Add the first real LLM path behind the backend session API using an OpenAI-compatible `/v1/chat/completions` client implemented with Node `fetch`. Configure it with `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_TIMEOUT_MS`. Support third-party New API style relay platforms such as `xingwan.store` through `OPENAI_BASE_URL=https://xingwan.store/v1`. Keep existing rule extraction, RAG retrieval, risk evaluation, and fixed mock response as fallbacks.

Reason:

The seed trial needs answers that feel closer to a real senior pre-sales expert, but the project should not depend on one model provider or destabilize dashboard state. OpenAI-compatible Chat Completions is the broadest shared interface across OpenAI and relay platforms, while the current deterministic rules protect the product workflow.

Consequences:

- Backend chat can produce LLM-generated `ai_response`, `quick_replies`, and field candidates when a key is configured.
- LLM field candidates use `agent_inference` and cannot overwrite `dashboard_edit`, `user_message`, `upload`, or `button_chip` values.
- If no key is configured, the platform rejects JSON mode, the call times out, or the model returns invalid JSON, the API still returns the current rule/mock behavior.
- The first version avoids streaming, tools/function calling, Responses API, and strict JSON schema to maximize third-party relay compatibility.
- Secrets stay in runtime `.env.api`, not in GHCR images.
