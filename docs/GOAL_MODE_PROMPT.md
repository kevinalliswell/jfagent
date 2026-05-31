# Goal-Mode Prompt

Copy-paste the block below to start a goal-mode (autonomous) session on this repo.
It points the agent at the enforced north star and the anti-drift rules instead
of restating them, so it stays current as `GOAL.md` evolves.

---

```
You are working in goal mode on the jfagent repo (a data center pre-sales AI
agent). Work autonomously toward ONE objective and do not drift.

STEP 0 — Bootstrap (always, before anything else):
  Run: bash scripts/setup-env.sh
  Then read, in order: AGENTS.md, GOAL.md, docs/tasks.md.
  GOAL.md is the north star and outranks every other doc.

YOUR OBJECTIVE:
  Exactly the current objective defined in GOAL.md. Right now that is
  Phase A — Stabilize & Consolidate, then Phase B — drive the small paid pilot.
  Do not work on anything outside the current GOAL.md phase. The Non-Goals in
  GOAL.md (real payment, auth, multi-tenant, SaaS end-state, new RAG/rules
  engines, big refactors) are OUT OF SCOPE — log them, do not build them.

HOW TO WORK (loop until the GOAL.md phase is done):
  1. Pick the highest-priority unfinished task in docs/tasks.md that maps to a
     GOAL.md checkbox. State which checkbox it advances. If none does, STOP and
     ask the owner.
  2. Make the SMALLEST coherent change. No drive-by refactors. No scope creep.
  3. Verify to GREEN: `npm run check` (and `npm run api:smoke` for backend work).
     If the gate is red, first re-run scripts/setup-env.sh and re-check — a
     missing dependency is NOT a code bug. Only debug code after that.
  4. Treat the big root specs (api_spec.md, rules.md, knowledge_base.md,
     templates.md) as FUTURE design — grep the code before assuming a feature
     exists. Read each file's STATUS banner.
  5. Keep mock mode (src/mockApi.ts) and backend mode (server/) aligned, or
     document the divergence.
  6. When a task is done: tick its GOAL.md checkbox, update docs/tasks.md, and
     update docs/architecture.md / docs/decisions.md if the design changed.
  7. Commit with a clear message scoped to that task. Develop on the branch the
     owner specified; do not open a PR unless asked.

GUARDRAILS (from AGENTS.md — honor all):
  - Dashboard edits are highest-precedence truth; never overwrite dashboard_edit
    without explicit confirmation. Field precedence:
    dashboard_edit > user_message > upload > button_chip > agent_inference > default.
  - 99 RMB is willingness-only — never integrate real payment.
  - TypeScript types are the contracts. Don't hand-edit generated knowledge files.
  - Run kb:build after changing knowledge/ or the ingestion scripts.

STOP CONDITIONS — pause and ask the owner instead of guessing:
  - A task would touch a GOAL.md Non-Goal or require a large refactor.
  - Two specs/docs conflict in a way GOAL.md does not resolve.
  - The current GOAL.md phase is complete (do NOT invent the next objective).
  - You are about to do something irreversible or outward-facing (deploy, push to
    a different branch, send data to an external service).

Report after each task: what changed, which GOAL.md checkbox it advanced, how you
verified it (paste the gate result), and what remains.
```

---

## How to refresh the objective

When a phase in `GOAL.md` is complete, the owner edits `GOAL.md` to set the next
phase. The prompt above does not change — it always points at "the current
GOAL.md objective", so it stays correct across phases.
