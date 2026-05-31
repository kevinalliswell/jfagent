# Project Collaboration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-class backend project domain and bind chat/export state to `project_id` so project state becomes the first truth container for the future agent-centered workstation.

**Architecture:** Add a lightweight in-memory project domain beside the current session service, expose project create/list/detail endpoints, then make sessions optionally project-bound and have exports derive their display name from the project domain instead of from free-floating session heuristics. Keep the slice backend-only so it is fully testable with the existing smoke-test harness and does not overreach into knowledge, approval, or personal-memory work yet.

**Tech Stack:** TypeScript, Node.js built-in HTTP server, existing `server/` API skeleton, existing `server/smoke.ts` smoke test harness, existing npm quality gates

---

## Scope Split

The approved design spec spans several independent subsystems. Do **not** try to implement all of them in one pass.

This plan covers only:

- Project Collaboration Domain foundation
- project-scoped backend session binding
- project-derived export naming
- API/documentation changes needed to support the new domain

Follow-on plans should be written separately for:

1. Agent workstation orchestration and intent routing
2. Knowledge growth domain plus personal memory
3. Collaboration/approval plus identity/governance
4. Light integrations and operational observability

## Planned File Structure

- Create: `server/projectService.ts`
  - Owns in-memory project creation, listing, lookup, session linkage, and project snapshot sync.
- Modify: `server/types.ts`
  - Adds project domain contracts and project-bound session/request types.
- Modify: `server/http.ts`
  - Adds `/api/projects` routes and upgrades `/api/session` snapshot shape.
- Modify: `server/sessionService.ts`
  - Accepts optional `project_id`, binds sessions to projects, and syncs project state after chat/override.
- Modify: `server/exportPayload.ts`
  - Uses the project domain as the preferred source of export project name.
- Modify: `server/smoke.ts`
  - Verifies project CRUD, project-bound chat flow, and export naming.
- Modify: `server/README.md`
  - Documents the new project endpoints and project-scoped behavior.
- Modify: `docs/architecture.md`
  - Records that the backend now has a first-class project domain foundation.
- Modify: `docs/tasks.md`
  - Adds or updates the long-term task entry for project-domain groundwork.

## Task 1: Add Project Domain Contracts And Endpoints

**Files:**
- Create: `server/projectService.ts`
- Modify: `server/types.ts`
- Modify: `server/http.ts`
- Test: `server/smoke.ts`

- [ ] **Step 1: Write the failing smoke test**

Add this block near the top of `server/smoke.ts`, after the health and knowledge-status assertions but before the first `/api/session/chat` call:

```ts
  const createdProject = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "医院老机房改造一期"
    })
  });
  assert.equal(createdProject.status, 200);
  assert.equal(createdProject.body.ok, true);
  const createdProjectData = createdProject.body.data as {
    project: { project_id: string; project_name: string; stage: string };
  };
  assert.equal(createdProjectData.project.project_name, "医院老机房改造一期");
  assert.equal(createdProjectData.project.stage, "intake");
  const projectId = createdProjectData.project.project_id;

  const listedProjects = await requestJson("/api/projects");
  assert.equal(listedProjects.status, 200);
  const listedProjectsData = listedProjects.body.data as {
    projects: Array<{ project_id: string; project_name: string }>;
  };
  assert.ok(listedProjectsData.projects.some((project) => project.project_id === projectId));

  const fetchedProject = await requestJson(`/api/projects/${projectId}`);
  assert.equal(fetchedProject.status, 200);
  const fetchedProjectData = fetchedProject.body.data as {
    project: { project_id: string; project_name: string; primary_session_id: string | null };
  };
  assert.equal(fetchedProjectData.project.project_id, projectId);
  assert.equal(fetchedProjectData.project.project_name, "医院老机房改造一期");
  assert.equal(fetchedProjectData.project.primary_session_id, null);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run api:smoke
```

Expected: FAIL with a `404` response on `POST /api/projects` or `GET /api/projects`.

- [ ] **Step 3: Write minimal implementation**

Add the new project contracts to `server/types.ts`:

```ts
export type ProjectStage = "intake" | "clarifying" | "solution_ready";

export interface ProjectSummary {
  project_id: string;
  project_name: string;
  stage: ProjectStage;
  primary_session_id: string | null;
  updated_at: string;
}

export interface BackendProject extends ProjectSummary {
  created_at: string;
  dashboard_snapshot: Record<string, DashboardField>;
}

export interface CreateProjectRequest {
  name?: string;
}
```

Create `server/projectService.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { BackendProject, DashboardField, ProjectSummary } from "./types.js";

const projects = new Map<string, BackendProject>();

function now() {
  return new Date().toISOString();
}

function defaultProjectName() {
  return `未命名项目 ${new Date().toISOString().slice(0, 10)}`;
}

function cloneFields(fields: Record<string, DashboardField>) {
  return Object.fromEntries(
    Object.entries(fields).map(([code, field]) => [code, { ...field }])
  );
}

function toSummary(project: BackendProject): ProjectSummary {
  return {
    project_id: project.project_id,
    project_name: project.project_name,
    stage: project.stage,
    primary_session_id: project.primary_session_id,
    updated_at: project.updated_at
  };
}

export function createProject(name?: string) {
  const timestamp = now();
  const project: BackendProject = {
    project_id: `proj_${randomUUID().slice(0, 8)}`,
    project_name: name?.trim() || defaultProjectName(),
    stage: "intake",
    primary_session_id: null,
    updated_at: timestamp,
    created_at: timestamp,
    dashboard_snapshot: {}
  };
  projects.set(project.project_id, project);
  return project;
}

export function listProjects() {
  return Array.from(projects.values())
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .map(toSummary);
}

export function getProject(projectId: string) {
  return projects.get(projectId) ?? null;
}

export function cloneProject(project: BackendProject) {
  return {
    ...project,
    dashboard_snapshot: cloneFields(project.dashboard_snapshot)
  };
}
```

Add routes to `server/http.ts`:

```ts
import { cloneProject, createProject, getProject, listProjects } from "./projectService.js";
```

```ts
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);

    if (request.method === "GET" && url.pathname === "/api/projects") {
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { projects: listProjects() }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/projects") {
      const body = await readJsonBody(request);
      const name =
        typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : undefined;
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { project: createProject(name) }
      });
      return;
    }

    if (request.method === "GET" && projectMatch) {
      const project = getProject(projectMatch[1]);
      if (!project) {
        sendError(response, requestId, 404, "PROJECT_NOT_FOUND", "The requested project does not exist.");
        return;
      }
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { project: cloneProject(project) }
      });
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run api:smoke
```

Expected: PASS on the new `/api/projects` assertions and keep the existing smoke flow green.

- [ ] **Step 5: Commit**

```bash
git add server/types.ts server/projectService.ts server/http.ts server/smoke.ts
git commit -m "feat: add project domain endpoints"
```

## Task 2: Bind Sessions And Export Payloads To Projects

**Files:**
- Modify: `server/types.ts`
- Modify: `server/projectService.ts`
- Modify: `server/sessionService.ts`
- Modify: `server/exportPayload.ts`
- Test: `server/smoke.ts`

- [ ] **Step 1: Write the failing smoke test**

Replace the existing first chat request in `server/smoke.ts` so it uses the created `projectId`, then add project assertions immediately after the chat and preview-export assertions:

```ts
  const chat = await requestJson("/api/session/chat", {
    method: "POST",
    body: JSON.stringify({
      session_id: "sess_smoke",
      project_id: projectId,
      message_type: "text",
      content: "某医院老机房改造，50平，3楼，10个机柜，UPS后备2小时，国产优先"
    })
  });
```

```ts
  const chatData = chat.body.data as {
    project?: { project_id: string; project_name: string; stage: string };
    state: { export_status: string };
    knowledge_hits: Array<{
      retrieval_method?: string;
      source_file?: string;
      vector_score?: number;
      keyword_score?: number;
    }>;
  };
  assert.equal(chatData.project?.project_id, projectId);
  assert.equal(chatData.project?.project_name, "医院老机房改造一期");
  assert.equal(chatData.project?.stage, "solution_ready");
```

```ts
  const updatedProject = await requestJson(`/api/projects/${projectId}`);
  assert.equal(updatedProject.status, 200);
  const updatedProjectData = updatedProject.body.data as {
    project: {
      primary_session_id: string | null;
      stage: string;
      dashboard_snapshot: Record<string, { value: string | number | null }>;
    };
  };
  assert.equal(updatedProjectData.project.primary_session_id, "sess_smoke");
  assert.equal(updatedProjectData.project.stage, "solution_ready");
  assert.equal(updatedProjectData.project.dashboard_snapshot.room_area_m2.value, 50);
  assert.equal(updatedProjectData.project.dashboard_snapshot.rack_count.value, 10);
```

```ts
  assert.equal(previewData.export_payload.project_name, "医院老机房改造一期");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run api:smoke
```

Expected: FAIL because `project_id` is ignored by `/api/session/chat`, the response has no `data.project`, and the export payload still uses the fallback project name.

- [ ] **Step 3: Write minimal implementation**

Extend `server/types.ts`:

```ts
export interface ProjectContext {
  project_id: string;
  project_name: string;
  stage: ProjectStage;
}
```

```ts
export interface ChatRequest {
  session_id: string;
  project_id?: string;
  message_type: MessageType;
  content: string;
  client_state_version?: number;
  client_message_id?: string;
  locale?: string;
  timezone?: string;
}
```

```ts
export interface ChatResponseData {
  ai_response: string;
  quick_replies: string[];
  updated_fields: Record<string, string | number | null>;
  field_patches: FieldPatch[];
  triggered_risks: RiskFlag[];
  knowledge_hits: KnowledgeHit[];
  project: ProjectContext | null;
  state: {
    fsm_state: FsmState;
    export_status: ExportStatus;
    calculation_status: "confirmed" | "provisional" | "blocked";
  };
  suggestion: SuggestionSummary | null;
}
```

```ts
export interface BackendSession {
  session_id: string;
  project_id: string | null;
  state_version: number;
  fsm_state: FsmState;
  export_status: ExportStatus;
  dashboard_fields: Record<string, DashboardField>;
  triggered_risks: RiskFlag[];
  knowledge_hits: KnowledgeHit[];
  suggestion: SuggestionSummary | null;
  payment_willingness_99_rmb: boolean | "maybe_preview_first" | null;
  export_payload_stale: boolean;
  created_at: string;
  updated_at: string;
}
```

Extend `server/projectService.ts`:

```ts
import type { BackendProject, BackendSession, DashboardField, ProjectContext, ProjectStage, ProjectSummary } from "./types.js";
```

```ts
function stageFromSession(session: BackendSession): ProjectStage {
  if (session.fsm_state === "S3_READY_MONETIZATION") return "solution_ready";
  if (session.fsm_state === "S2_PROACTIVE_INQUIRIES") return "clarifying";
  return "intake";
}

export function buildProjectContext(projectId: string | null): ProjectContext | null {
  if (!projectId) return null;
  const project = projects.get(projectId);
  if (!project) return null;
  return {
    project_id: project.project_id,
    project_name: project.project_name,
    stage: project.stage
  };
}

export function linkSessionToProject(projectId: string, sessionId: string) {
  const project = projects.get(projectId);
  if (!project) return null;
  project.primary_session_id = sessionId;
  project.updated_at = now();
  return project;
}

export function syncProjectFromSession(projectId: string, session: BackendSession) {
  const project = projects.get(projectId);
  if (!project) return null;
  project.primary_session_id = session.session_id;
  project.stage = stageFromSession(session);
  project.dashboard_snapshot = cloneFields(session.dashboard_fields);
  project.updated_at = now();
  return project;
}
```

Update `server/sessionService.ts`:

```ts
import { buildProjectContext, getProject, linkSessionToProject, syncProjectFromSession } from "./projectService.js";
```

```ts
function loadOrCreateSession(sessionId: string, projectId: string | null = null) {
  const existing = sessions.get(sessionId);
  if (existing) {
    if (projectId && existing.project_id !== projectId) {
      existing.project_id = projectId;
      linkSessionToProject(projectId, existing.session_id);
    }
    return existing;
  }
  const session: BackendSession = {
    session_id: sessionId,
    project_id: projectId,
    state_version: 1,
    fsm_state: "S0_IDLE",
    export_status: "draft",
    dashboard_fields: initialFields(),
    triggered_risks: [],
    knowledge_hits: [],
    suggestion: null,
    payment_willingness_99_rmb: null,
    export_payload_stale: false,
    created_at: now(),
    updated_at: now()
  };
  sessions.set(sessionId, session);
  if (projectId) linkSessionToProject(projectId, sessionId);
  return session;
}
```

```ts
  const session = loadOrCreateSession(request.session_id, request.project_id ?? null);
```

```ts
  if (session.project_id) {
    syncProjectFromSession(session.project_id, session);
  }
```

```ts
    project: buildProjectContext(session.project_id),
```

Update the `ChatResponseData` construction so `project` sits beside `knowledge_hits` and before `state`.

Update `server/exportPayload.ts` to accept a project:

```ts
import type { BackendProject, BackendSession, DashboardField, RiskFlag, SuggestionSummary } from "./types.js";
```

```ts
export function buildExportPayload(session: BackendSession, project: BackendProject | null): ExportPayloadV1 {
  const projectName =
    project?.project_name ??
    readString(session, "project_name") ??
    `${readString(session, "customer_name") ?? "默认"}机房建设项目`;
```

Keep the rest of the function unchanged, but replace the old inline `project_name` fallback with the new `projectName` constant.

Update `server/sessionService.ts` export path:

```ts
import { buildProjectContext, getProject, linkSessionToProject, syncProjectFromSession } from "./projectService.js";
```

```ts
  const project = session.project_id ? getProject(session.project_id) : null;
  const exportPayload = buildExportPayload(session, project);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run api:smoke
```

Expected: PASS with project-bound chat data, project snapshot field sync, and preview export using the created project name.

- [ ] **Step 5: Commit**

```bash
git add server/types.ts server/projectService.ts server/sessionService.ts server/exportPayload.ts server/smoke.ts
git commit -m "feat: bind sessions to project domain"
```

## Task 3: Expose Project-Bound Session Snapshots And Update Docs

**Files:**
- Modify: `server/types.ts`
- Modify: `server/http.ts`
- Modify: `server/sessionService.ts`
- Modify: `server/smoke.ts`
- Modify: `server/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/tasks.md`

- [ ] **Step 1: Write the failing smoke test**

Add this block to `server/smoke.ts` after the project-bound chat assertions:

```ts
  const sessionSnapshot = await requestJson("/api/session?session_id=sess_smoke");
  assert.equal(sessionSnapshot.status, 200);
  const sessionSnapshotData = sessionSnapshot.body.data as {
    session: { session_id: string; project_id: string | null; state_version: number };
    project: { project_id: string; project_name: string; stage: string } | null;
  };
  assert.equal(sessionSnapshotData.session.session_id, "sess_smoke");
  assert.equal(sessionSnapshotData.session.project_id, projectId);
  assert.equal(sessionSnapshotData.project?.project_id, projectId);
  assert.equal(sessionSnapshotData.project?.project_name, "医院老机房改造一期");
  assert.equal(sessionSnapshotData.project?.stage, "solution_ready");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run api:smoke
```

Expected: FAIL because `GET /api/session` still returns the old `{ ok, session, server_time }` shape with no `data.project`.

- [ ] **Step 3: Write minimal implementation**

Extend `server/types.ts`:

```ts
export interface SessionSnapshotData {
  session: BackendSession;
  project: ProjectSummary | null;
}
```

Add a snapshot helper to `server/sessionService.ts`:

```ts
import { buildProjectContext, getProject, linkSessionToProject, syncProjectFromSession } from "./projectService.js";
```

```ts
export function getSessionSnapshot(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new ApiValidationError("session_id was not found.", 404, "NOT_FOUND");
  }
  const project = session.project_id ? getProject(session.project_id) : null;
  return {
    session,
    project: project
      ? {
          project_id: project.project_id,
          project_name: project.project_name,
          stage: project.stage,
          primary_session_id: project.primary_session_id,
          updated_at: project.updated_at
        }
      : null
  };
}
```

Update the route in `server/http.ts`:

```ts
    if (request.method === "GET" && url.pathname === "/api/session") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId) throw new ApiValidationError("session_id is required.");
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: getSessionSnapshot(sessionId)
      });
      return;
    }
```

Update `server/README.md` endpoint list and current-boundary section:

```md
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`
```

```md
The backend now has a first-class in-memory project domain. In backend mode, chat sessions can be bound to a `project_id`, and project snapshots become the preferred source for export naming and future domain expansion.
```

Update `docs/architecture.md` in the `Backend API Skeleton` and `Current Architecture` sections:

```md
- First-class in-memory project domain with create/list/detail routes.
- Backend sessions can now bind to `project_id`, and project state becomes the first truth container for future SaaS project collaboration.
```

Update `docs/tasks.md` by adding a new next-step task entry or marking the foundation task done. Use this exact row:

```md
| T-018 | P1 | Done | Add project collaboration domain foundation | Adds `/api/projects` create/list/detail routes, project-bound sessions, and project-derived export naming as the first SaaS-aligned truth container beyond raw session ids. |
```

- [ ] **Step 4: Run verification**

Run:

```bash
npm run api:smoke
npm run build
```

Expected:

- `npm run api:smoke` prints `API smoke test passed.`
- `npm run build` finishes with Vite build output and no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add server/types.ts server/http.ts server/sessionService.ts server/smoke.ts server/README.md docs/architecture.md docs/tasks.md
git commit -m "docs: record project collaboration foundation"
```

## Self-Review Checklist

- Spec coverage: this plan covers the first required truth container from the approved design by making project state explicit and project-bound.
- Placeholder scan: no unfinished markers or unnamed helper references should remain.
- Type consistency:
  - use `project_id` in API contracts and payloads
  - use `ProjectStage` values exactly: `intake`, `clarifying`, `solution_ready`
  - use `buildProjectContext`, `linkSessionToProject`, and `syncProjectFromSession` consistently

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-project-collaboration-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
