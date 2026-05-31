# Tasks

Working task ledger. The authority order is `GOAL.md` > this file > the rest
(see `AGENTS.md` §2). Update statuses here whenever they change.

## Current Objective

See `GOAL.md`. We are in **Phase A: Stabilize & Consolidate**, then Phase B
drives the small paid pilot (D-020). Do not start work outside the current
objective. Every active task below maps to a `GOAL.md` checkbox.

## Active Board — Phase A (Stabilize & Consolidate)

| ID    | Priority | Status      | Task                                                                 | GOAL link |
| ----- | -------- | ----------- | -------------------------------------------------------------------- | --------- |
| T-026 | P0       | Done        | One-command green gate: `requirements.txt` + `scripts/setup-env.sh` + SessionStart hook so `npm run check` (incl. DOCX export smoke) passes on a fresh container. | A1 |
| T-027 | P0       | Done        | Single source of truth: `GOAL.md` north star, `AGENTS.md` naming fix, doc status banners, consolidated ledger. | A2/A3/A4 |
| T-028 | P1       | Done        | Document mock-vs-backend parity in `docs/architecture.md` (intentional differences + 5 drift items to reconcile). | A5 |
| T-029 | P1       | NEXT        | Add tests for core deterministic logic: field extraction, risk triggering, export-payload assembly (beyond the 3 cockpit tests). | A6 |
| T-030 | P2       | Todo        | Cleanup follow-up: extract the FUTURE design specs (`rules.md`, `knowledge_base.md`, `templates.md`) out of RAG ingestion in `scripts/build-knowledge-index.mjs`, then physically move them under `docs/specs-future/`. Update the script + `docker/api.Dockerfile`; re-run `kb:build`/`kb:verify`. | A3 |

## Backlog — Phase B (Paid Pilot, AFTER Phase A is green)

| ID    | Priority | Status | Task                                                                 | GOAL link |
| ----- | -------- | ------ | -------------------------------------------------------------------- | --------- |
| T-031 | P0       | Todo   | Deploy backend-mode seed stack; confirm V2 first-screen signals (completeness, risk, evidence, delivery, `real_llm` vs `fallback`) stay reliable. | B1 |
| T-032 | P0       | Todo   | Upload 10–20 cleaned internal seed docs via `?admin=1` for real citation backing. | B2 |
| T-033 | P0       | Todo   | Run 3–5 real project descriptions through cockpit→chat→export; write a read on friction reduction. | B3 |
| T-034 | P0       | Todo   | Produce one external sample requirement sheet end-to-end, judged customer-ready. | B4 |
| T-035 | P2       | Todo   | Install LibreOffice/`soffice` to enable automated DOCX visual QA. | B (support) |

## Completed (history — condensed)

T-001…T-025 are done. They built: the React MVP and V2 three-column cockpit;
local knowledge index with MD/TXT/DOCX/PDF + XLSX/CSV/TSV ingestion; local hashed
vectors + hybrid retrieval; switchable mock/backend session API; Node/TS backend
with sessions, projects, SQLite persistence, export-payload schema + first-pass
`.docx` rendering; admin knowledge upload; Docker/GHCR/Caddy seed deployment;
OpenAI-compatible real-agent v1 with runtime visibility; and persisted-session
state reconciliation. Full detail lives in git history and `docs/decisions.md`
(D-001…D-023).

## Open Questions

- Which OpenAI-compatible provider/model is the long-term default after xingwan?
- Which internal documents are safe for the first seed/demo corpus?
- Which domain/server account and Basic Auth credentials host the seed trial?
- What tenant/document-permission model does SaaS eventually need?

## Verification Commands

```bash
bash scripts/setup-env.sh   # install Node + Python deps (makes the gate real)
npm run check               # lint + format:check + build + kb:verify + tests
npm run api:smoke           # backend end-to-end incl. DOCX export
npm run kb:build && npm run kb:verify   # after knowledge/ingestion changes
```

Backend-mode frontend build check:

```bash
VITE_SESSION_API_MODE=backend VITE_API_BASE_URL=http://localhost:3000 npm run build
```
