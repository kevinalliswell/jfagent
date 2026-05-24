# Roadmap

## Phase 0: Project Alignment

Goal: establish stable project memory and collaboration process.

Status: complete.

Milestones:

- Create `AGENTS.md`.
- Create project README.
- Create architecture, tech stack, roadmap, tasks, and decisions docs.
- Record user-confirmed direction: future SaaS, XLSX/BOQ first, backend API second, 99 RMB as willingness validation.

## Phase 1: Paid MVP Validation

Goal: prove that users see value in a structured machine-room requirement preview and 99 RMB formal export prompt.

Current MVP includes:

- Chat intake.
- Dashboard extraction.
- Local knowledge hits.
- BOQ/quotation summary panel.
- Risk prompts.
- Export/payment-willingness modal.

Next milestones:

- Generate a draft quote-item checklist before export.
- Improve free preview copy so users understand what the paid document contains.

## Phase 1.5: SaaS-Oriented API Skeleton

Goal: introduce backend boundaries before the frontend and mock API become too coupled.

Milestones:

- Choose backend stack. Done: Node.js/TypeScript skeleton.
- Implement session API skeleton against `api_spec.md`. Done.
- Add switchable frontend API adapter while keeping mock mode as the default. Done.
- Move retrieval behind the backend API boundary for backend mode. Done.
- Define `ExportPayloadV1` for formal Word requirement-sheet inputs. Done.
- Add placeholder persistence suitable for later tenant/project storage.
- Add admin-only upload for seed-trial knowledge refresh. Done.

## Phase 2: Real Knowledge Workflow

Goal: make internal documents genuinely reusable.

Milestones:

- Add metadata tagging for knowledge documents.
- Add ingestion quality warnings.
- Add source type filters.
- Add local embeddings and vector search. Done: first local hashed-vector baseline.
- Share generated local vector indexes with frontend mock mode and backend API mode. Done.
- Add backend runtime JSON index and hot reload after admin upload. Done.
- Add retrieval audit information.

## Phase 2.5: Seed Trial Release

Goal: deploy the MVP behind controlled access and let seed users test the workflow.

Milestones:

- Document single-server Nginx/systemd deployment. Done.
- Add Basic Auth deployment guidance for seed users and admins. Done.
- Provide seed-user trial instructions and feedback questions. Done.
- Deploy to the target server after domain and SSH details are available.

## Phase 3: Backend Foundation

Goal: move session authority out of `mockApi.ts`.

Milestones:

- Implement `/api/session/chat`.
- Implement `/api/session/override`.
- Implement `/api/session/export`.
- Persist sessions and dashboard fields.
- Preserve field source precedence.
- Add conflict detection when chat contradicts manual edits.

## Phase 4: Formal Export

Goal: produce a real Word requirement sheet or proposal package.

Milestones:

- Build export payload schema. Done.
- Generate `.docx` from project context and template rules. Done: first-pass renderer exists.
- Include citations, risk notes, and pending confirmation fields.
- Render and visually QA sample documents.
- Separate free preview from paid formal export.

## Phase 5: Production Readiness

Goal: prepare for future SaaS deployment.

Milestones:

- Add authentication and project permissions.
- Add tenant isolation and document workspace boundaries.
- Add audit logs.
- Add secure storage for internal documents.
- Add model/provider configuration.
- Add backups and operational monitoring.

## Open Product Questions

- Who is the first paying/internal pilot user: sales, pre-sales, manager, or supplier coordinator?
- Is the first paid artifact a demand sheet, a technical proposal, a BOQ draft, or a supplier inquiry package?
- What internal documents can be safely used in a local demo?
