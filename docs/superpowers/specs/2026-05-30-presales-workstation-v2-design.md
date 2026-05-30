# Presales Workstation V2 Design

Date: 2026-05-30  
Status: Draft for review  
Scope: Frontend experience upgrade from the current chat-led MVP into a project-led presales workstation for daily internal use and small-scale paid pilot delivery.

## 1. Purpose

The current product is functionally useful but still reads like a chat page with supporting panels. That is not strong enough for the next phase.

The V2 goal is to turn the frontend into a real presales workstation for:

- presales engineers doing daily project work,
- bosses or managers checking project status and delivery readiness,
- internal collaborators who need to understand progress without reading a long conversation first.

The workstation must feel clearly different from the old version at first glance.

## 2. Design Goal

V2 should shift the product center from `conversation-first` to `project-first`.

That means:

- the page is defined by project state, not by message flow,
- chat remains important but becomes a project-push tool,
- risk, completeness, knowledge basis, and deliverable readiness become first-viewport signals,
- export/hand-off actions use neutral operational language and do not show obvious payment text such as `99`.

## 3. Non-Goals

This V2 upgrade does **not** include:

- redesigning backend contracts,
- introducing real billing,
- adding SaaS auth or permissions,
- building a separate learning workspace,
- rebuilding the document export system.

The focus is frontend experience, information hierarchy, and daily workflow ergonomics.

## 4. Chosen Direction

The selected route is:

`A. Project Cockpit`

Reason:

- It most clearly separates V2 from the old chat-led layout.
- It fits presales engineers’ daily work better than a pure chat center.
- It lets managers understand project maturity, blockers, and output readiness quickly.
- It reuses the current project/session backend boundary without forcing a new backend domain.

## 5. Primary Users And Their First-View Needs

### 5.1 Presales Engineer

Needs to know:

- what project is active,
- what information is still missing,
- what risks are blocking progress,
- what references or prior materials support the next step,
- whether a formal output can be prepared.

### 5.2 Boss / Manager

Needs to know:

- project stage,
- current progress,
- risk level,
- whether the team can output something formal,
- what should happen next.

### 5.3 Internal Collaborator

Needs to know:

- current project context,
- what has already been captured,
- which materials or assumptions the team is using,
- where to continue the work without decoding the full message history.

## 6. Frontend Structure

V2 keeps a single main workstation, but its composition changes to a three-column layout.

### 6.1 Left Rail: Project Pool

Responsibilities:

- project list,
- stage tags,
- latest activity,
- queue or pending signals,
- quick project creation,
- fast switching between active opportunities.

This rail is the entry point for work. Users should feel they are entering a project system, not just opening a chat.

### 6.2 Center: Project Cockpit

Responsibilities:

- project summary,
- current stage,
- next recommended action,
- completeness and blockers,
- recent evidence and deliverable state,
- chat-based project advancement.

This is the main reading surface and should be the first thing users understand.

### 6.3 Right Rail: Presales Operations Panel

Responsibilities:

- grouped requirement fields,
- technical suggestions,
- evidence/citation panel,
- delivery actions,
- lightweight operator controls.

This side is where presales engineers act while keeping the center focused on project understanding.

## 7. Main States

The workstation should naturally express three project-facing states without becoming a complicated multi-page app.

### 7.1 Empty Project State

When no project is selected:

- the center should show recent projects, suggested next steps, and creation entry,
- not an empty chat area.

### 7.2 Project Advancement State

This is the default daily-use state.

The cockpit shows:

- project summary,
- completeness,
- blockers,
- evidence,
- active chat work area.

### 7.3 Delivery Closure State

When the project is mature enough:

- the cockpit visually increases the weight of formal-output readiness,
- the right rail highlights document-generation and review actions,
- the page reads like a closing workflow, not a discovery workflow.

The system can infer this state from existing `fsm_state`, `export_status`, and field completeness rather than adding a new backend contract.

## 8. Core Cards In The Center Column

The center column should use operational cards, not decorative marketing panels.

### 8.1 Project Summary Bar

Shows:

- project name,
- stage,
- last activity time,
- current primary session,
- one recommended next action.

This is the manager-friendly orientation layer.

### 8.2 Requirement Completeness Card

Fields should be grouped by work meaning, not dumped as a flat wall:

- basic project info,
- scale signals,
- key constraints,
- output readiness.

This lets the engineer see “what class of information is missing” rather than scanning raw fields one by one.

### 8.3 Key Risks Card

Risks should read like project blockers and confirmations:

- blocker level,
- high-priority confirmations,
- suggested follow-up items.

The presentation should be more operational than purely rule-centric.

### 8.4 Evidence And Materials Card

Shows:

- knowledge hit count,
- latest cited materials,
- case/reference entry,
- quotation/BOQ relevance when available.

This reinforces that the assistant is grounded in internal material rather than speaking from nowhere.

### 8.5 Deliverable Status Card

Shows:

- whether a formal requirement sheet can be produced,
- latest output state,
- review/refresh actions,
- recent document status if one exists.

This replaces the old “charge-looking” action emphasis with delivery-readiness language.

## 9. Chat Role In V2

Chat remains important, but its role changes.

In V2, chat is used to:

- push the project forward,
- fill missing inputs,
- explain risks,
- clarify assumptions,
- trigger structured updates.

Chat is no longer the page identity. The project cockpit is the page identity.

## 10. Right Rail Design

The right rail should be split into four stable operational zones.

### 10.1 Requirement Fields

- grouped and prioritized,
- topmost missing items surfaced first,
- manual edits remain highest-precedence truth.

### 10.2 Technical Suggestion Zone

- UPS,
- cooling,
- redundancy,
- structural notes,
- engineering suggestion summary.

This should remain clearly advisory and not imply final commercial commitment.

### 10.3 Evidence Zone

- latest citations,
- supporting files,
- source visibility for current recommendation.

### 10.4 Delivery Action Zone

- formal requirement sheet generation,
- delivery draft action,
- export history / latest output.

This zone should feel like operational delivery tooling rather than a payment funnel.

## 11. Wording Rules

This upgrade must remove obvious paid-language cues from primary UI actions.

### Required wording behavior

- Do not show `99` in primary action buttons.
- Do not use purchase-like language as the main CTA on the workstation.
- Keep the paid-intent logic, if still required, behind the operational flow rather than in the button label.

### Recommended action labels

- `生成正式需求表`
- `整理交付稿`
- `输出方案文档`
- `查看导出记录`

### Labels to remove from main CTA surface

- `生成 Word 需求表 ¥99`
- other direct price-attached button labels on the main workstation surface

## 12. Data Reuse Strategy

V2 should reuse current backend contracts as much as possible.

Reuse directly:

- `/api/projects`
- `/api/session`
- `/api/session/chat`
- `/api/session/export`
- current risk payloads,
- current knowledge hits,
- current suggestion summary,
- current project/session snapshot model.

This keeps the V2 slice frontend-heavy and lowers implementation risk.

## 13. Implementation Boundary

The main implementation should concentrate in:

- `src/App.tsx`
- `src/styles.css`
- `src/types.ts`
- `src/sessionApi.ts`

Secondary documentation updates:

- `docs/tasks.md`
- `docs/architecture.md`
- `docs/decisions.md`

No major backend redesign should be introduced for V2 unless a blocker is discovered during implementation.

## 14. Acceptance Criteria

V2 is considered complete when all of the following are true:

1. The first screen is recognizably a project cockpit rather than the old chat-led layout.
2. Project state, completeness, risk, evidence, and delivery readiness are first-viewport signals.
3. Chat is visually and functionally repositioned as a project advancement workspace.
4. Primary buttons and main flows do not display obvious payment text such as `99`.
5. Existing project/session/risk/knowledge/export data still work through the upgraded UI.
6. `npm run build` passes.
7. `npm run check` passes.
8. The local frontend/backend workflow can be started for inspection.

## 15. Open Implementation Notes

- The current backend runtime visibility can stay in the V2 surface, but it should be visually subordinate to project operations.
- Admin knowledge upload remains useful, but it should not dominate the main workstation hierarchy.
- If any old MVP wording still exposes price-like language on the main page, V2 implementation should remove or neutralize it.
