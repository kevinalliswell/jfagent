# JF Agent Workstation

Commercial-ready Data Center Pre-sales AI Agent（机房售前智能体）. It helps construction integration teams convert messy machine-room project notes into structured pre-sales requirements, deterministic engineering calculations, internal cost estimates, risk prompts, knowledge citations, and exportable Word/PDF deliverables — with real accounts and a license-code monetization loop.

## Current Status

A deployable commercial v1: React workstation + Node/TypeScript API + SQLite, with app-level auth, export-credit billing, a deterministic expert engine, and real document generation. Mock mode remains as a browser-only demo.

Implemented:

- Account system: email+password registration/login (scrypt + JWT), admin/user roles, per-user project and session isolation, env-configurable bootstrap admin, open/closed registration modes, optional `AUTH_DISABLED=1` single-operator mode.
- Monetization loop: free unlimited PDF preview; formal Word export consumes 1 export credit; admins generate single-use license codes (`JF-XXXXX-XXXXX`) in the admin panel and users redeem them in-app; all credit movements audited.
- Deterministic expert engine (rules.md implemented): UPS capacity (redundancy factors + standard sizes), precision cooling (thermal density + safety margin + model catalog + N+1/2N units), battery-bank estimation, internal reference BOM cost estimate, and P0/P1 risk rules (floor loading, elevator transport, BOM×1.3 budget mismatch) with audit log and confirmed/provisional/blocked status.
- Persistent multi-turn agent: chat history stored per session, restored in the UI after reload, and replayed (last 12 turns) to the OpenAI-compatible LLM together with engine outputs and required prompts.
- Real first-pass `.docx` generation (cover, TOC, engine-backed chapters, risk register, BOM placeholders, internal estimate appendix) and real watermarked PDF free preview via LibreOffice.
- React/Vite three-column presales cockpit with completeness/risk/evidence/delivery signals, calculation & estimate card, login screen, credits display, and redeem flow.
- Local knowledge ingestion for `.md`, `.txt`, `.docx`, `.pdf`, `.xlsx`, `.csv`, `.tsv` with hybrid keyword/vector retrieval (9 seed files / 71 chunks covering GB50174 要点、UPS/电池、精密空调、消防动环布线装修、勘察清单、参考价格表).
- Admin surface (`?admin=1`): knowledge upload + index rebuild, license generation, user/credit administration APIs, runtime status.
- SQLite persistence for users, licenses, credit transactions, sessions (incl. messages), projects, export assets, knowledge uploads, and retrieval audit; Docker volume for `data/` so upgrades keep state.
- Docker Compose deployment with private GHCR images and Caddy HTTPS.

Not implemented yet (future phases):

- Online payment provider integration (WeChat Pay/Alipay) — license codes are the current monetization path.
- Real embedding model / external vector database (local hashed vectors stay).
- Multi-tenant organizations, SSO, fine-grained RBAC.
- Streaming chat responses.
- OCR for scanned documents.

## Quick Start

Install dependencies (Node + Python, in one step):

```bash
bash scripts/setup-env.sh
```

This installs Node dependencies and the Python deps (`python-docx`, `openpyxl`,
…) that the DOCX-export path and `npm run check` need. Running only `npm install`
will leave the formal-export smoke test failing with a misleading `500`.

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

Default frontend mode remains local mock API (demo, no login). Backend mode is the real product and shows a login screen; the first registered account becomes admin.

Configure the backend (LLM + auth + billing):

```bash
cp .env.api.example .env.api
```

Key variables (see the example file for full comments):

- `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` — any OpenAI-compatible provider; xingwan/New API relays use `OPENAI_BASE_URL=https://xingwan.store/v1`.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — bootstrap admin created at startup.
- `REGISTRATION_MODE` — `open` (default) or `closed`.
- `FREE_EXPORT_CREDITS` — credits granted to each new user (default 1).
- `AUTH_DISABLED=1` — single-operator local mode without login (do not use in production).

Rebuild the local knowledge index:

```bash
npm run kb:build
```

Verify generated local vectors:

```bash
npm run kb:verify
```

For seed server deployment, see `docs/deployment.md`. For Windows/Linux/macOS
local deployment and testing, see `docs/local-deployment.md`. For seed-user
trial guidance, see `docs/seed-user-trial.md`.
For a VPS-side Codex CLI handoff prompt, see `docs/vps-codex-deployment-handoff.md`.

Build seed-trial containers locally:

```bash
docker compose -f compose.seed.yml build
```

## Directory Structure

```text
.
├── AGENTS.md                  # Single canonical agent contract (Codex auto-loads this)
├── GOAL.md                    # North star: the one active objective + non-goals
├── README.md                  # Project entry point
├── requirements.txt           # Python deps for ingestion + DOCX export
├── LOCAL_RAG.md               # Current local RAG usage notes (IMPLEMENTED)
├── api_spec.md                # Backend API spec (PARTIAL/FUTURE — see banner)
├── docs/
│   ├── architecture.md
│   ├── specs-future/          # Registry + status of FUTURE/aspirational specs
│   │   ├── knowledge_base.md
│   │   ├── rules.md
│   │   └── templates.md
│   ├── GOAL_MODE_PROMPT.md     # Copy-paste prompt to start a goal-mode session
│   ├── export-payload-schema.md
│   ├── deployment.md
│   ├── seed-user-trial.md
│   ├── vps-codex-deployment-handoff.md
│   ├── tech-stack.md
│   ├── roadmap.md
│   ├── tasks.md
│   └── decisions.md
├── docker/                    # Seed deployment Dockerfiles, Caddyfile, entrypoint
├── compose.seed.yml           # Docker Compose seed deployment
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

Administrators can also inspect the current runtime status, including model config and data-path wiring, through the backend admin surface.

## Development Notes

Before starting a new development task, read `AGENTS.md` and `GOAL.md` first,
then `docs/tasks.md`, `docs/architecture.md`, and `docs/decisions.md`.

`GOAL.md` is the single active objective and outranks every other doc. For
current plans and priorities, see `docs/tasks.md` and `docs/roadmap.md`.
