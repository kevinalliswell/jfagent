# Small-Scale Paid Pilot Closure Design

Date: 2026-05-30  
Status: Approved and execution-oriented  
Scope: Close the current MVP toward a paid pilot that serves one external sample customer while supporting internal daily use by presales staff, managers, and small-business owners.

## 1. Pilot End State

The chosen route is:

`B. 1 external paid sample customer + deep internal team usage`

This is the highest-value path because the repository already has:

- backend project/session persistence,
- knowledge upload and retrieval,
- first-pass Word export,
- seed deployment packaging,
- and an OpenAI-compatible agent path with smoke coverage.

The remaining gap is not basic feature existence. It is pilot closure: make the real-agent path operationally visible, tighten delivery expectations, and leave a clear runbook for internal and external trial usage.

## 2. Paid Pilot Target

The first paid pilot is considered ready when all of the following are true:

1. A presales engineer can create/select a project and continue work across sessions.
2. The backend can answer through an OpenAI-compatible provider when configured, and fall back safely when unavailable.
3. The system clearly exposes whether the latest answer came from the real LLM path or from deterministic fallback.
4. Knowledge upload, retrieval hits, and export flow can be verified end to end.
5. The repo contains an explicit pilot plan and updated operational docs for deployment and acceptance.

## 3. Product Boundaries For This Closure

Keep in scope:

- backend-mode trial flow,
- real-agent runtime visibility,
- project/session continuity,
- knowledge admin visibility,
- DOCX export readiness,
- deployment and acceptance guidance for a small paid pilot.

Keep out of scope:

- real billing,
- multi-tenant SaaS auth,
- full approval workflow,
- production-grade vector infrastructure,
- full proposal-system refactor.

## 4. Closure Strategy

The closure strategy is deliberately narrow:

### 4.1 Finish The Real-Agent Story

Treat `T-021` as done only when evidence shows:

- successful OpenAI-compatible chat path,
- JSON-mode retry compatibility,
- safe fallback on bad or missing provider responses,
- and visible runtime status in the product surface.

### 4.2 Add Pilot-Grade Runtime Visibility

The pilot team must be able to answer:

- Is the current environment using a real model or fallback?
- Which model/base URL is configured?
- Did the latest answer succeed through the real path or degrade gracefully?

This should be visible in both:

- the backend contract,
- and the frontend/admin operating surface.

### 4.3 Shift The Task Board To Pilot Closure

The task ledger should stop describing the repo as mainly waiting on real-agent wiring, and instead describe the current phase as small-scale paid pilot closure.

## 5. Technical Shape

### 5.1 Backend

Add an `agent_runtime` summary to backend chat/session responses so the frontend can tell whether the last assistant turn used:

- `real_llm`
- `fallback`

Also add an admin runtime-status endpoint for the current model configuration and local runtime paths.

### 5.2 Frontend

Surface the latest agent runtime mode in the workstation UI with a light operational banner, and show admin runtime status beside knowledge-upload controls.

The UI should stay quiet and work-focused. This is a presales tool, not a monitoring dashboard.

### 5.3 Documentation

Update:

- `docs/tasks.md`
- `docs/architecture.md`
- `docs/decisions.md`
- deployment/readme notes when needed

Add this design plus a new implementation plan.

## 6. Acceptance Evidence

The closure work is accepted when the repo shows:

- updated design and plan docs,
- passing `npm run api:smoke`,
- passing `npm run build`,
- smoke assertions for runtime visibility,
- updated architecture/task/decision docs,
- and an explicit narrative of what is ready for the paid pilot versus what remains out of scope.
