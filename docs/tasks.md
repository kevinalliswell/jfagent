# Tasks

Working task ledger. The authority order is `GOAL.md` > this file > the rest
(see `AGENTS.md` §2). Update statuses here whenever they change.

## Current Objective

See `GOAL.md`. We are in **COMMERCIAL LAUNCH**: the commercial v1 build landed
2026-06-12 on owner direction (skip-ahead past the old Phase A/B sequencing).
The remaining work is owner-gated deployment and first real paid usage.

## Active Board — Commercial Launch (2026-06-12)

| ID    | Priority | Status | Task                                                                 | GOAL link |
| ----- | -------- | ------ | -------------------------------------------------------------------- | --------- |
| T-040 | P0       | Done   | Deterministic expert engine (`server/rulesEngine.ts`): UPS/cooling/battery sizing, internal BOM cost estimate, P0/P1 risk rules (BOM×1.3 budget mismatch), audit log; engine now drives risks/suggestion/export numbers. 14 spec-matrix tests in `tests/rulesEngine.test.ts`. | Shipped v1 |
| T-041 | P0       | Done   | Account system: scrypt+JWT auth, admin/user roles, per-user session/project isolation, bootstrap admin via env, `REGISTRATION_MODE`, `AUTH_DISABLED` local mode. Smoke covers 401/403/cross-user isolation. | Shipped v1 |
| T-042 | P0       | Done   | Monetization loop: export credits, license codes (admin generate / user redeem), `credit_transactions` audit, 402 `NO_CREDITS` gate, admin grant endpoint, frontend credits badge + redeem modal + in-modal redeem-and-retry. | Shipped v1 |
| T-043 | P1       | Done   | Multi-turn agent: session `messages` persisted/restored/replayed (last 12) to the LLM with engine outputs + required prompts; richer extraction (quantifier fix for "12个机柜", 2N/N+1, 单柜功率, 预算区间, 服务器台数); upgraded售前总监 system prompt. | Shipped v1 |
| T-044 | P1       | Done   | Real watermarked PDF free preview (docx→soffice→PDF) with simulated fallback; internal estimate appendix (7.2, 非正式报价) in formal DOCX; preview no longer flips export status. | Shipped v1 |
| T-045 | P1       | Done   | Seed knowledge expanded to 9 files / 71 chunks: GB50174 要点、UPS/电池配置、精密空调选型、消防动环布线装修、现场勘察清单、设备参考价格表 CSV. | Shipped v1 |
| T-046 | P1       | Done   | Deployment hardening: `jfagent_data` SQLite volume in compose, `.env.api.example` auth/billing variables, admin license panel under `?admin=1`. | Shipped v1 |
| T-047 | P0       | Open   | OWNER: deploy the stack, fill `.env.api` (`ADMIN_*`, `OPENAI_*`), upload 10–20 internal docs, generate codes, run the first external register→redeem→export loop with real money offline. | Phase DoD |
| T-048 | P2       | Open   | Next-phase backlog candidates (pick AFTER first real usage): streaming chat, real embeddings/vector DB, online payment provider, org-level multi-tenant, OCR. | Next phase |

## Completed (history — condensed)

T-001…T-036 are done. They built: the React MVP and V2 three-column cockpit;
local knowledge index with MD/TXT/DOCX/PDF + XLSX/CSV/TSV ingestion; local hashed
vectors + hybrid retrieval; switchable mock/backend session API; Node/TS backend
with sessions, projects, SQLite persistence, export-payload schema + first-pass
`.docx` rendering; admin knowledge upload; Docker/GHCR/Caddy seed deployment;
OpenAI-compatible real-agent v1 with runtime visibility; persisted-session
state reconciliation; the Phase A stabilization pass; and mock/backend drift
reconciliation. T-040…T-046 (2026-06-12) shipped the commercial v1: expert
engine, accounts, credits/licenses, multi-turn persistence, real PDF preview,
knowledge expansion, deployment hardening. Full detail lives in git history and
`docs/decisions.md` (D-001…D-035).

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
