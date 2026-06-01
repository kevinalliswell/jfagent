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
- Chapter inclusion is determined before rendering and follows `docs/specs-future/templates.md`.
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
- The first renderer is deterministic and table-driven; visual layout QA now runs through headless LibreOffice/`soffice` when available, producing PDF + PNG preview checks without blocking export if the dependency is absent.
- Future T-010 follow-up work should improve layout fidelity against `docs/specs-future/templates.md` once visual rendering is available.

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

## D-019: Persist Backend Runtime State In SQLite Before SaaS Database Work

Status: accepted.

Decision:

Keep the current built-in Node HTTP server and local-first MVP flow, but move backend runtime state from pure in-memory storage to a local SQLite file at `data/jfagent.sqlite`. Persist session snapshots, backend project records, generated export asset metadata, knowledge upload metadata, and upload job status there. Keep in-process Maps only as read caches.

Reason:

The project now needs restart-safe backend behavior for local testing, seed deployment, and future SaaS evolution, but it is still too early to introduce a larger database stack or ORM. SQLite gives the backend a durable source of truth with minimal new complexity and keeps TypeScript contracts intact.

Consequences:

- `server/sessionService.ts`, `server/projectService.ts`, `server/exportDocument.ts`, and `server/knowledgeAdmin.ts` now read/write through `server/persistence.ts`.
- Generated `.docx` download links can recover after API restart as long as the output file still exists on disk.
- Smoke coverage now includes cross-process restart recovery for project lookup, session snapshot lookup, and asset download.
- Project data is persistent, but frontend mock mode remains unchanged.
- This is still not the final SaaS storage model; tenant isolation, user auth, migrations, and remote backup remain future work.

## D-020: Small-Scale Paid Pilot Uses One External Sample Customer Plus Deep Internal Usage

Status: accepted.

Decision:

Treat the next closure target as `1 external paid sample customer + internal daily use by the team`, rather than broader external rollout or internal-only validation.

Reason:

The current repository is already beyond a toy demo: it has backend project/session continuity, knowledge upload, DOCX export, and a real-agent path. The highest-value next step is to prove repeatable delivery quality with one real external sample while letting internal users build muscle on daily usage.

Consequences:

- The repo should optimize for pilot stability and explainability before broader SaaS scope.
- Real payment, auth, and multi-tenant architecture remain out of scope for this closure.
- Documentation and task prioritization should speak in terms of paid-pilot readiness, not only raw feature completion.

## D-021: Paid Pilot Requires Visible Agent Runtime Mode

Status: accepted.

Decision:

Expose whether the latest backend answer used the real OpenAI-compatible LLM path or deterministic fallback, and surface current model/runtime configuration to admins.

Reason:

Without runtime visibility, the pilot team cannot reliably tell whether they are evaluating the real agent or silent fallback behavior. That creates ambiguity during external delivery, internal learning, and provider troubleshooting.

Consequences:

- `POST /api/session/chat` and `GET /api/session` should carry an `agent_runtime` summary.
- Backend admin routes should expose current model configuration and runtime paths.
- The frontend should show a quiet runtime-status banner in backend mode and a runtime status block in admin mode.
- Smoke coverage should verify fallback, retry, and successful real-model behavior through the new runtime metadata.

## D-022: Main Workstation Hides Explicit Payment Copy While Keeping Backend Willingness Validation

Status: accepted.

Decision:

In Presales Workstation V2, the main frontend workstation should not display obvious payment wording or the `99 RMB` price point in its default project cockpit UI. The backend export flow still keeps the payment-willingness validation logic and gating behavior already defined by the product.

Reason:

The V2 workstation is now optimized for presales execution by engineers, bosses, and internal collaborators. The first screen should communicate project progress, risk, evidence, and delivery readiness, not pricing friction. Hiding explicit payment copy in the main cockpit reduces distraction during internal and pilot use while preserving the underlying business-validation mechanism when users reach the formal export path.

Consequences:

- The first viewport and main action surfaces should read as a presales cockpit, not a payment funnel.
- Product and UI copy should avoid prominent `99 RMB` or similar payment-language exposure in the normal workstation flow.
- Backend export approval can continue to record willingness state and enforce the existing gate.
- This refines presentation, not business logic: real payment integration remains out of scope under D-004.

## D-023: Reloaded Sessions Must Rebuild Derived State From Dashboard Fields

Status: accepted.

Decision:

When the backend reloads a persisted session from SQLite, it should recompute suggestion, triggered risks, and FSM-derived progress state from the stored dashboard fields before returning that snapshot to the frontend.

Reason:

The workstation now treats dashboard fields as the highest-value durable project record, while suggestion/risk/progress are derived outputs that can evolve as product semantics change. Replaying old derived values verbatim causes the V2 product UI to surface stale wording and outdated cockpit signals after upgrades or restarts.

Consequences:

- `server/sessionService.ts` owns a reconciliation step for persisted sessions.
- Legacy persisted risk text cannot leak back into the normal workstation if the rule definitions change.
- Session reloads remain compatible across product iterations without forcing a manual database wipe.
- This does not change the precedence model: dashboard fields remain the authority, and derived outputs follow them.

## D-024: Declare Python Deps And A One-Command Env Bootstrap

Status: accepted.

Decision:

Add `requirements.txt` (`python-docx`, `openpyxl`, `pdfplumber`, `pypdf`) and an
idempotent `scripts/setup-env.sh` that installs Node + Python deps. Wire it into
the Claude Code SessionStart hook (`.claude/settings.json`) and reference it from
`AGENTS.md` as the first step of every session. The Codex environment setup
script should also run it.

Reason:

Previously the Python deps lived only inside the Docker images, so a fresh local
or web agent container ran `npm run check`, hit a 500 at the formal-export smoke
step (`No module named 'docx'`), and misread an environment gap as a code bug.
This is a primary source of agent drift.

Consequences:

- A fresh container reaches a green gate with `bash scripts/setup-env.sh && npm run check`.
- Agents are instructed to run setup before "fixing" a red gate.
- Docker images are unaffected (they still pip-install during build).

## D-025: `AGENTS.md` Is The Single Canonical Agent Contract

Status: accepted. Supersedes D-005.

Decision:

There is exactly one agents contract file: UPPERCASE `AGENTS.md`. The previous
lowercase `agents.md` (which actually held collaboration rules, not the
product/FSM spec the docs claimed) is removed.

Reason:

Codex auto-loads the UPPERCASE name, which never existed, so the collaboration
rules were not being auto-loaded. On case-insensitive filesystems `agents.md`
and `AGENTS.md` also collide. D-005's premise — that lowercase `agents.md` was
the product/FSM specification to preserve — was inaccurate; that file always
contained collaboration rules. Product/FSM behavior actually lives in the V2
specs and `api_spec.md`.

Consequences:

- `AGENTS.md` is the single entry contract and source-of-truth map.
- References that pointed to `agents.md` for "FSM/product behavior" are corrected
  to point at the real specs.
- Do not recreate a lowercase `agents.md`.

## D-026: Big Root Specs Are Marked FUTURE And Registered, Not Trusted As-Is

Status: accepted; superseded in part by D-028.

Decision:

`api_spec.md`, `rules.md`, `knowledge_base.md`, and `templates.md` each carry a
STATUS banner (FUTURE / PARTIAL) at the top and are catalogued in
`docs/specs-future/README.md` with how much is actually built. At the time of
this decision, `rules.md`, `knowledge_base.md`, and `templates.md` temporarily
stayed at the repo root because they were also RAG ingestion seeds and Docker
`COPY` inputs.

Reason:

~4900 lines of aspirational spec were being read as current contracts, sending
agents to build features the code does not have. Banners + a registry stop that
without destabilizing the build.

Consequences:

- Agents must check the banner and grep the code before relying on these specs.
- The later cleanup in D-028/T-030 removes the three future design specs from
  RAG ingestion and relocates them under `docs/specs-future/`.

## D-027: Goal-Mode Operating Model Anchored By `GOAL.md`

Status: accepted.

Decision:

Adopt a goal-mode operating model: a single `GOAL.md` north star defines the one
active objective, its definition of done, and explicit non-goals, and outranks
every other doc. The current phase is Stabilize & Consolidate, then drive the
small paid pilot (D-020).

Reason:

The task board was all "Done" with no defined next coding objective, so a fresh
agent invented work and drifted between competing visions (chat MVP vs V2 cockpit
vs SaaS end-state). A single enforced objective with anti-drift rules keeps long
autonomous runs aligned.

Consequences:

- `AGENTS.md` §0/§2 require reading `GOAL.md` first and forbid out-of-objective work.
- `docs/tasks.md` maps every active task to a `GOAL.md` checkbox.
- When the objective is met, the next phase is set by the owner, not invented by
  the agent.

## D-028: Future Design Specs Live Under `docs/specs-future/` And Are Not RAG Seeds

Status: accepted.

Decision:

Remove `rules.md`, `knowledge_base.md`, and `templates.md` from
`scripts/build-knowledge-index.mjs`, stop baking them into the API image, and
physically relocate them to `docs/specs-future/`.

Reason:

They are future design references, not operational knowledge. Keeping them in
the live RAG corpus and container runtime blurred the line between "what the app
knows" and "what the team hopes to build," which is exactly the drift Phase A is
meant to reduce.

Consequences:

- `npm run kb:build` now indexes only `knowledge/` plus admin uploads.
- The API container no longer copies the future spec files into `/app`.
- Agents must read future specs from `docs/specs-future/`, not assume root-level
  seed files exist.
