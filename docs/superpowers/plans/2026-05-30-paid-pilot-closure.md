# Small-Scale Paid Pilot Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the current MVP toward a small paid pilot by making the real-agent path operationally visible, updating pilot-facing documentation, and verifying the full backend/frontend trial loop.

**Architecture:** Keep the current local-first MVP and backend session boundary intact. Add runtime visibility as a thin layer across backend contracts, admin status, and the frontend workstation so the pilot team can trust what mode the system is using without expanding into premature SaaS infrastructure.

**Tech Stack:** TypeScript, Node.js built-in HTTP server, React, Vite, existing backend smoke harness, existing seed deployment docs

---

## Planned File Structure

- Modify: `server/llmClient.ts`
  - Return structured runtime outcome for each agent turn and expose current OpenAI-compatible config status.
- Modify: `server/types.ts`
  - Add runtime-visibility contracts for chat/session/admin status.
- Modify: `server/sessionService.ts`
  - Persist the latest agent runtime summary on each backend chat turn.
- Modify: `server/http.ts`
  - Expose admin runtime status.
- Modify: `server/smoke.ts`
  - Verify fallback, real LLM, retry, and admin runtime status.
- Modify: `src/types.ts`
  - Mirror runtime-visibility types for frontend state.
- Modify: `src/sessionApi.ts`
  - Fetch admin runtime status and pass runtime metadata through backend mode.
- Modify: `src/App.tsx`
  - Show runtime status in the chat workbench and admin surface.
- Modify: `src/mockApi.ts`
  - Keep mock mode contracts aligned.
- Modify: `src/styles.css`
  - Add quiet styles for runtime visibility.
- Modify: `docs/tasks.md`, `docs/architecture.md`, `docs/decisions.md`, `README.md`, `docs/deployment.md`
  - Reframe the repo around paid-pilot closure and document runtime visibility.

## Task 1: Add Backend Runtime Visibility

**Files:**
- Modify: `server/types.ts`
- Modify: `server/llmClient.ts`
- Modify: `server/sessionService.ts`
- Modify: `server/http.ts`
- Test: `server/smoke.ts`

- [ ] **Step 1: Extend backend contracts for agent runtime**
- [ ] **Step 2: Return structured success/fallback runtime results from the OpenAI-compatible client**
- [ ] **Step 3: Persist the latest runtime summary onto the backend session snapshot**
- [ ] **Step 4: Expose admin runtime status for model config and runtime paths**
- [ ] **Step 5: Prove fallback, retry, and real-LLM behavior in smoke tests**

## Task 2: Surface Runtime Status In The Frontend

**Files:**
- Modify: `src/types.ts`
- Modify: `src/sessionApi.ts`
- Modify: `src/App.tsx`
- Modify: `src/mockApi.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Mirror the new runtime contracts in frontend types**
- [ ] **Step 2: Store runtime metadata in draft and restored sessions**
- [ ] **Step 3: Add a light runtime banner to the chat surface**
- [ ] **Step 4: Show admin runtime status beside the knowledge-upload controls**
- [ ] **Step 5: Keep mock mode compatible without changing the default demo flow**

## Task 3: Reframe The Repo Around Paid Pilot Closure

**Files:**
- Modify: `docs/tasks.md`
- Modify: `docs/architecture.md`
- Modify: `docs/decisions.md`
- Modify: `README.md`
- Modify: `docs/deployment.md`
- Create: `docs/superpowers/specs/2026-05-30-paid-pilot-closure-design.md`

- [ ] **Step 1: Mark the OpenAI-compatible agent branch as complete once verified**
- [ ] **Step 2: Add a task/decision narrative for paid-pilot closure**
- [ ] **Step 3: Document how to verify real-model mode versus fallback mode during deployment**
- [ ] **Step 4: Leave clear statements of what is still out of scope for the pilot**

## Task 4: Verify The Pilot Baseline

**Files:**
- No code changes required beyond the tasks above.

- [ ] **Step 1: Run `npm run api:smoke`**
- [ ] **Step 2: Run `npm run build`**
- [ ] **Step 3: Summarize what is now pilot-ready, what still needs operator action, and what remains intentionally out of scope**
