# GOAL — North Star for Goal Mode

This file is the single, overriding objective for the current development phase.
Every agent action must serve it. If a task does not move this objective forward,
do not do it — note it as future work instead. This file outranks every other
doc (see `AGENTS.md` §2).

Last set: 2026-06-12 · Owner: kevin（owner 指令：完成机房售前智能体构建，实现可商业落地）

---

## Current Phase: COMMERCIAL LAUNCH — operate & sell the v1 product

2026-06-12 the owner directed the project to skip ahead: deliver a commercially
deployable Data Center Pre-sales Agent, unconstrained by the previous
stabilize-then-pilot phasing. That build is now DONE in code (see below).
The active objective is to **deploy it, seed it with real knowledge, and run
real paid usage through the license-code loop**.

### Shipped in the commercial v1 (2026-06-12)

- [x] Deterministic expert engine (`server/rulesEngine.ts`): UPS sizing,
      precision-cooling sizing with model catalog + N+1/2N units, battery-bank
      estimation, internal reference BOM cost estimate, and the full
      P0/P1 risk ruleset from `docs/specs-future/rules.md` (floor loading,
      elevator transport, BOM×1.3 budget mismatch), with audit log and
      confirmed/provisional/blocked status.
- [x] Real account system: email+password (scrypt), JWT sessions, roles
      (admin/user), per-user project/session isolation, bootstrap admin via env,
      open/closed registration modes.
- [x] Commercial closure without a payment provider: export credits + license
      activation codes (`JF-XXXXX-XXXXX`). Free preview unlimited; formal DOCX
      export consumes 1 credit; admins generate/sell codes offline and users
      redeem in-app. All movements logged in `credit_transactions`.
- [x] Persistent multi-turn agent: chat history stored per session, replayed to
      the LLM (with engine outputs + required prompts injected), restored in the
      UI after reload.
- [x] Real PDF free preview (docx → LibreOffice → PDF with preview banner) and
      an upgraded formal DOCX (engine-backed chapters + internal estimate
      appendix marked 非正式报价).
- [x] Seed knowledge base expanded to 9 files / 71 chunks (GB50174 要点、UPS/
      电池、精密空调、消防动环布线装修、勘察清单、参考价格表 CSV …).
- [x] Admin surface (`?admin=1`): knowledge upload + license generation +
      runtime status. Deployment: SQLite volume added to compose; auth env
      documented in `.env.api.example`.
- [x] Quality gate green: `npm run check` (lint, format, build, kb:verify,
      19 unit tests incl. 14 engine tests) + `npm run api:smoke` end-to-end
      (auth, credits, licenses, isolation, PDF preview, DOCX export) +
      Playwright browser pass over login→chat→risk→estimate→export.

## Definition of done for THIS phase (owner-gated, in order)

- [ ] Deploy the stack (`compose.seed.yml`) with `.env.api` filled in:
      `ADMIN_EMAIL/ADMIN_PASSWORD`, `OPENAI_*`, `REGISTRATION_MODE`.
- [ ] Upload 10–20 cleaned internal docs via `?admin=1` so citations have real
      backing beyond the seed corpus.
- [ ] Run 3–5 real project descriptions through chat→cockpit→export; judge the
      DOCX against what you would hand a customer.
- [ ] Generate license codes, hand one to the first external user, and watch the
      register→redeem→export loop complete with real money offline.
- [ ] Collect what breaks / what's missing into `docs/tasks.md` as the next
      phase's backlog.

## Non-Goals for this phase

- Online payment provider integration (WeChat/Alipay) — license codes are the
  monetization path until volume justifies provider onboarding.
- Real embedding model / external vector DB (local hashed vectors stay).
- Multi-tenant orgs/workspaces, SSO, RBAC beyond admin/user.
- Streaming chat responses.
- Rewriting mock mode to mirror every new backend feature (mock = demo only;
  divergences are recorded in `docs/architecture.md`).

## Anti-Drift Rules

1. Before any task, state which checkbox above it advances. If none, stop and ask.
2. A red `npm run check` is guilty until proven a real code bug: run
   `scripts/setup-env.sh` first and re-check before "fixing" anything.
3. Grep the code before assuming a feature exists; specs may still be ahead of
   reality in places.
4. Smallest coherent change. No drive-by refactors, no scope creep into Non-Goals.
5. When you finish a checkbox, tick it here and reflect status in `docs/tasks.md`.
6. When this objective is met, do not invent the next one — bring it back to the
   owner to set the next `GOAL.md` phase.
