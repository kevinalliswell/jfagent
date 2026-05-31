# Presales Workstation V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current frontend from a chat-led MVP into a project-led presales workstation V2 that feels clearly different, supports daily internal use, and removes obvious payment wording such as `99` from the main UI.

**Architecture:** Keep the existing backend contracts and session/project model, but recompose the frontend into a left project pool, center project cockpit, and right presales operations panel. Reuse current project, session, risk, knowledge, suggestion, and export data rather than introducing a new backend protocol.

**Tech Stack:** React 19, TypeScript, Vite, plain CSS, existing backend/session API adapter, existing local verification commands

---

## Planned File Structure

- Modify: `src/App.tsx`
  - Rebuild the main workstation layout, center-cockpit hierarchy, empty-project state, right-side operations panel, and neutral delivery wording.
- Modify: `src/styles.css`
  - Add the V2 cockpit layout, card system, empty-state styling, grouped operations layout, and revised action styling.
- Modify: `src/types.ts`
  - Add any small frontend-only display structures needed for grouped cockpit rendering, if required.
- Modify: `src/sessionApi.ts`
  - Keep adapter-compatible behavior while supporting any additional V2 action flows.
- Modify: `docs/tasks.md`
  - Record that Presales Workstation V2 is in progress/done as the new frontend priority.
- Modify: `docs/architecture.md`
  - Record that the frontend is now a project-cockpit workstation rather than a chat-led page.
- Modify: `docs/decisions.md`
  - Record the UI/product decision to remove obvious payment wording from the main workstation surface.

## Task 1: Build The V2 Cockpit Layout

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `npm run build`

- [ ] **Step 1: Write the failing layout assertion target**

Define the target behavior before coding:

- Empty project state is no longer an empty chat area.
- Selected project state shows a project-cockpit summary above the chat area.
- The right column is an operations panel, not the old dashboard stack.

- [ ] **Step 2: Run the current build as a baseline**

Run:

```bash
npm run build
```

Expected: PASS on the old UI before the V2 refactor begins.

- [ ] **Step 3: Recompose the top-level workstation**

Implement in `src/App.tsx`:

- left rail remains project-first,
- center becomes a cockpit surface with empty-project and active-project states,
- right rail becomes grouped operations,
- chat moves below the cockpit summary instead of defining the page.

- [ ] **Step 4: Add V2 layout styles**

Implement in `src/styles.css`:

- cockpit grid,
- summary cards,
- requirement completeness styling,
- delivery-state styling,
- empty-project state styling,
- revised operations panel spacing and hierarchy.

- [ ] **Step 5: Run the build again**

Run:

```bash
npm run build
```

Expected: PASS with the new V2 layout.

## Task 2: Shift Information Hierarchy From Chat To Project State

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `npm run build`

- [ ] **Step 1: Add cockpit summary logic**

In `src/App.tsx`, compute and render:

- next recommended action,
- grouped completeness,
- key blocker/risk summary,
- evidence/material summary,
- deliverable readiness summary.

- [ ] **Step 2: Move detailed field editing to the right rail**

Keep manual edits and existing field behavior intact, but render them as grouped operations rather than as the main page story.

- [ ] **Step 3: Keep chat functional but visually subordinate**

Chat must remain usable for:

- sending project signals,
- quick replies,
- seeing assistant responses,
- continuing backend-mode workflow.

But it should sit under the project cockpit rather than above everything else.

- [ ] **Step 4: Verify no state regression in the build**

Run:

```bash
npm run build
```

Expected: PASS after hierarchy changes.

## Task 3: Remove Obvious Payment Language From The Workstation Surface

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `rg -n "99|¥99|RMB" src/App.tsx src/styles.css`

- [ ] **Step 1: Replace main action wording**

Replace primary workstation text such as:

- `生成 Word 需求表 ¥99`

with neutral operational wording such as:

- `生成正式需求表`
- `整理交付稿`
- `输出方案文档`

- [ ] **Step 2: Neutralize the confirmation modal copy**

Keep the export gate behavior if needed, but remove obvious price-led wording from the visible modal surface.

- [ ] **Step 3: Search for remaining obvious payment text**

Run:

```bash
rg -n "99|¥99|RMB" src/App.tsx src/styles.css
```

Expected: no visible workstation/button/modal copy still uses those strings.

## Task 4: Document And Verify V2

**Files:**
- Modify: `docs/tasks.md`
- Modify: `docs/architecture.md`
- Modify: `docs/decisions.md`

- [ ] **Step 1: Update task ledger**

Record Presales Workstation V2 as the current frontend priority or as completed when verification is done.

- [ ] **Step 2: Update architecture memory**

Document the shift from chat-led page to project cockpit frontend.

- [ ] **Step 3: Record the wording/product decision**

Document that the workstation main surface should not expose obvious payment wording even if willingness validation remains behind the flow.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run check
```

Expected: PASS across lint, formatting, build, knowledge verification, and smoke tests.

- [ ] **Step 5: Start local inspection servers**

Run:

```bash
PORT=3001 npm run api:start
VITE_SESSION_API_MODE=backend VITE_API_BASE_URL=http://127.0.0.1:3001 npm run dev -- --port 5173
```

Expected:

- backend available on `http://127.0.0.1:3001`
- frontend available on `http://127.0.0.1:5173`
