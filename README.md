# JF Agent Workstation

Local-first MVP for a future SaaS Data Center Pre-sales AI Agent. It helps construction integration teams convert messy machine-room project notes into structured pre-sales requirements, local knowledge citations, risk prompts, configuration suggestions, and a 99 RMB Word-export willingness flow.

## Current Status

This repository is currently a local-first MVP with a React workstation, switchable mock/backend session API adapter, a lightweight backend skeleton, and a local knowledge index.

Long-term direction: SaaS.

Implemented:

- React/Vite chat and dashboard workstation.
- FSM-style project intake flow.
- Dashboard field extraction and manual override simulation.
- Local knowledge ingestion for `.md`, `.txt`, `.docx`, and `.pdf`.
- Quotation/BOQ ingestion for `.xlsx`, `.csv`, and `.tsv`.
- Hybrid keyword/vector retrieval from generated knowledge chunks: browser-side in mock mode, backend-side in API mode.
- Admin-only seed-trial knowledge upload through `?admin=1` in backend mode.
- Local hashed vectors for knowledge chunks; no external embedding API.
- BOQ/quotation summary panel in the dashboard.
- Switchable frontend API client: default local mock mode, optional backend API mode.
- Node/TypeScript backend API skeleton for session chat, dashboard override, export, and health checks.
- `ExportPayloadV1` schema used by Word requirement-sheet rendering.
- Real first-pass `.docx` generation from approved backend exports.
- Risk and configuration suggestion mock logic.
- 99 RMB payment-willingness modal for formal Word export. This is not real payment.

Not implemented yet:

- Production backend service with persistence.
- Real LLM integration.
- Embedding/vector database retrieval.
- Automated visual DOCX render QA without LibreOffice/`soffice`.
- Real free-preview PDF generation.
- Authentication, permissions, audit storage, and production billing.

## Quick Start

Install dependencies:

```bash
npm install
```

Run the local development server:

```bash
npm run dev
```

The app runs at:

```text
http://localhost:5173/
```

Build:

```bash
npm run build
```

Run the local quality gate:

```bash
npm run check
```

Useful focused checks:

```bash
npm run lint
npm run format:check
npm run test
```

Build and smoke-test the backend API skeleton:

```bash
npm run api:smoke
```

The smoke test now verifies formal export creates a downloadable `.docx` asset.

Start the backend API after building:

```bash
npm run api:start
```

Run the frontend against the backend API skeleton:

```bash
npm run api:build
npm run api:start
```

In another terminal:

```bash
npm run dev:backend
```

Default frontend mode remains local mock API.

Rebuild the local knowledge index:

```bash
npm run kb:build
```

Verify generated local vectors:

```bash
npm run kb:verify
```

For seed server deployment, see `docs/deployment.md`. For seed-user trial guidance, see `docs/seed-user-trial.md`.

## Directory Structure

```text
.
├── AGENTS.md                  # Codex/AI collaboration rules
├── README.md                  # Project entry point
├── LOCAL_RAG.md               # Current local RAG usage notes
├── agents.md                  # Product/FSM behavior specification
├── api_spec.md                # Planned backend API specification
├── knowledge_base.md          # RAG ingestion and taxonomy specification
├── rules.md                   # Expert system and calculation rules
├── templates.md               # Word/proposal template rules
├── docs/
│   ├── architecture.md
│   ├── export-payload-schema.md
│   ├── deployment.md
│   ├── seed-user-trial.md
│   ├── tech-stack.md
│   ├── roadmap.md
│   ├── tasks.md
│   └── decisions.md
├── knowledge/                 # Local seed knowledge documents
├── server/                    # Node/TypeScript backend API skeleton
├── scripts/                   # Knowledge ingestion utilities
├── output/doc/                 # Generated local DOCX assets
├── src/                       # React frontend prototype
└── dist/                      # Build output
```

## Knowledge Workflow

Put local knowledge files under:

```text
knowledge/
```

Supported now:

- `.md`
- `.txt`
- `.docx`
- `.pdf`
- `.xlsx`
- `.csv`
- `.tsv`

Then run:

```bash
npm run kb:build
```

This generates `src/generatedKnowledge.ts`, `server/generatedKnowledge.ts`, and `server/generatedKnowledge.json`, including local hashed vectors used by the mock-mode browser retriever and backend-mode API retriever. Do not edit generated knowledge files by hand.

In backend mode, administrators can also open:

```text
/?admin=1
```

The hidden admin upload panel saves files under `knowledge/uploads/`, rebuilds the index, and hot-reloads backend retrieval.

## Development Notes

Before starting a new development task, read `AGENTS.md`, `docs/tasks.md`, `docs/architecture.md`, and `docs/decisions.md`.

For current plans and priorities, see `docs/tasks.md` and `docs/roadmap.md`.
