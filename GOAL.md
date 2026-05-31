# GOAL — North Star for Goal Mode

This file is the single, overriding objective for the current development phase.
Every agent action must serve it. If a task does not move this objective forward,
do not do it — note it as future work instead. This file outranks every other
doc (see `AGENTS.md` §2).

Last set: 2026-05-31 · Owner: kevin

---

## Current Phase: STABILIZE & CONSOLIDATE → then drive the paid pilot

The codebase is healthier than it feels. The chaos lives in the scaffolding
around the code (reproducibility, doc sprawl, no single source of truth), not in
the code itself. So **Phase A is to make the project boringly stable and
unambiguous**, and only then **Phase B drives the small paid pilot** (D-020:
`1 external paid sample customer + internal daily deep use`).

Do NOT jump ahead to new product features, SaaS infrastructure, the
agent-centered end-state, real payment, or auth. Those are explicitly out of
scope for this phase (see Non-Goals).

---

## Phase A — Stabilize & Consolidate (DO THIS FIRST)

Definition of done (all must be true):

- [x] A fresh container reaches a GREEN gate with one command:
      `bash scripts/setup-env.sh && npm run check` passes end-to-end, including
      the DOCX-export smoke step. (Root cause of the old red gate: missing
      `python-docx`, now declared in `requirements.txt`.) — done 2026-05-31.
- [x] Single source of truth is in place and accurate: `GOAL.md`,
      `docs/tasks.md`, `docs/decisions.md`, `docs/architecture.md` agree with the
      running code. No doc claims a feature the code does not have. — done 2026-05-31.
- [x] The big root specs (`api_spec.md`, `rules.md`, `knowledge_base.md`,
      `templates.md`) each carry a STATUS banner and are registered in
      `docs/specs-future/README.md`, so no agent mistakes design for reality.
      — done 2026-05-31 (physical de-RAG + relocation tracked as T-030).
- [x] The `AGENTS.md` naming bug is resolved (one uppercase contract file).
      — done 2026-05-31 (D-025).
- [x] Mock-vs-backend parity is documented: where `src/mockApi.ts` and
      `server/` intentionally differ is written down, so the demo and the real
      product do not silently drift. — done 2026-05-31 (T-028); see
      `docs/architecture.md` "Mock vs Backend Parity". Logged 5 drift items to
      reconcile (next agent should pick these up under the pilot phase).
- [ ] Test coverage for the core deterministic logic (field extraction, risk
      triggering, export-payload assembly) exists beyond the 3 cockpit tests, so
      regressions are caught. — T-029.

## Phase B — Drive the small paid pilot (AFTER Phase A is green)

Target (D-020): one external paid sample customer + internal daily deep use.

Definition of done (revisit/refine when Phase A closes):

- [ ] Backend-mode seed stack deploys and the V2 first-screen signals stay
      reliable: completeness, risk, evidence basis, delivery/export status, and
      `real_llm` vs `fallback`.
- [ ] 10–20 cleaned internal seed docs uploaded via `?admin=1` so the right-rail
      citations have real backing.
- [ ] 3–5 real project descriptions run through the V2 cockpit→chat→export path,
      with a written read on whether it reduces back-and-forth vs the old MVP.
- [ ] One real external sample requirement sheet produced end-to-end and judged
      good enough to hand a customer.

---

## Non-Goals for this phase (do NOT build these now)

- Real payment / billing integration (99 RMB stays willingness-only — D-004).
- Authentication, multi-tenant isolation, RBAC, audit storage.
- The agent-centered SaaS end-state (the 2026-05-28 design spec).
- A real embedding model / vector database (local hashed vectors stay).
- Large refactors of `App.tsx` or backend structure unless a task is blocked.
- Implementing the FUTURE specs (`rules.md` multi-tier engine, full
  `api_spec.md`, full `knowledge_base.md` RAG, full `templates.md`).

---

## Anti-Drift Rules

1. Before any task, state which checkbox above it advances. If none, stop and ask.
2. A red `npm run check` is guilty until proven a real code bug: run
   `scripts/setup-env.sh` first and re-check before "fixing" anything.
3. Treat every root big spec as FUTURE design unless its STATUS banner says
   otherwise. Grep the code before assuming a feature exists.
4. Smallest coherent change. No drive-by refactors, no scope creep into Non-Goals.
5. When you finish a checkbox, tick it here and reflect status in `docs/tasks.md`.
6. When this objective is met, do not invent the next one — bring it back to the
   owner to set the next `GOAL.md` phase.
