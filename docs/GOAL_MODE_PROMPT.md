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
  4. Treat `api_spec.md` plus the future specs under `docs/specs-future/`
     (`rules.md`, `knowledge_base.md`, `templates.md`) as FUTURE design — grep
     the code before assuming a feature exists. Read each file's STATUS banner.
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

---

## Task kickoff prompts (paste after the goal-mode prompt)

These narrow the agent to one task without changing the operating rules above.

### T-036 — Reconcile mock vs backend drift (Phase B coding, do this first)

```
Task: T-036. Read docs/architecture.md "Mock vs Backend Parity" — the 5 logged
drift items. Reconcile them one at a time, smallest coherent change each, in this
order:
  1. Backend evaluateRisks is missing the budget risk that mock has
     (src/mockApi.ts riskBudgetMismatch). Add the equivalent to
     server/sessionService.ts so the demo and product agree, OR, if we decide the
     demo is wrong, remove it from mock — pick one and say why.
  2. Backend override 500: editableFields/numericFields list field codes that
     initialFields() never creates, so makePatch throws. Make override safe for
     listed-but-uninitialized fields (or align the field sets).
  3. Risk-trigger shape: mock's isRackAnswer pushes floor/elevator risks
     unconditionally; align mock to derive risks from fields like the backend.
  4. buildSuggestion.structuralNote wording differs between the two files —
     unify it.
  5. FSM/state derivation differs (mock branch heuristic vs backend inferState);
     align mock to the field-derived logic where reasonable.
For EACH item: change both paths or document why they intentionally differ in the
parity section; run `npm run check` (and `npm run api:smoke`) to green; commit
per item with a clear message. If any item turns out to be an intentional product
difference, leave it and update the parity doc instead. Do NOT touch GOAL.md
Non-Goals. When all 5 are resolved, tick nothing in GOAL.md (this is a Phase B
reliability task) but mark T-036 Done in docs/tasks.md and report.
```

### Deploy preflight (Codex prep for owner-gated T-031)

```
Task: pre-deploy readiness only — do NOT deploy (no server/creds yet).
Read docs/deployment.md and docs/vps-codex-deployment-handoff.md. Then:
  - verify `docker compose -f compose.seed.yml build` succeeds locally (or report
    exactly what is missing),
  - sanity-check .env.caddy.example / .env.api.example against what
    compose.seed.yml actually consumes,
  - produce/refresh a single copy-paste deploy runbook in docs/deployment.md if
    anything is stale.
Report a checklist of what the owner still must supply (server, domain, GHCR
token, Caddy hashes, OpenAI creds). Stop there — deployment itself is an owner
action item (T-031).
```

