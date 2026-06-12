import { randomUUID } from "node:crypto";
import type {
  BackendProject,
  BackendSession,
  DashboardField,
  ProjectContext,
  ProjectStage,
  ProjectSummary,
  PublicUser
} from "./types.js";
import { loadProject, loadProjects, saveProject } from "./persistence.js";

const projects = new Map<string, BackendProject>();

function now() {
  return new Date().toISOString();
}

function defaultProjectName() {
  return `未命名项目 ${new Date().toISOString().slice(0, 10)}`;
}

function cloneFields(fields: Record<string, DashboardField>) {
  return Object.fromEntries(Object.entries(fields).map(([code, field]) => [code, { ...field }]));
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

function stageFromSession(session: BackendSession): ProjectStage {
  if (session.fsm_state === "S3_READY_MONETIZATION") return "solution_ready";
  if (session.fsm_state === "S2_PROACTIVE_INQUIRIES") return "clarifying";
  return "intake";
}

export function canAccessProject(project: BackendProject, user: PublicUser | null) {
  if (!user) return true;
  if (user.role === "admin") return true;
  if (!project.user_id) return true;
  return project.user_id === user.user_id;
}

export function createProject(name?: string, user?: PublicUser | null) {
  const timestamp = now();
  const project: BackendProject = {
    project_id: `proj_${randomUUID().slice(0, 8)}`,
    project_name: name?.trim() || defaultProjectName(),
    stage: "intake",
    primary_session_id: null,
    user_id: user?.user_id ?? null,
    updated_at: timestamp,
    created_at: timestamp,
    dashboard_snapshot: {}
  };
  projects.set(project.project_id, project);
  saveProject(project);
  return cloneProject(project);
}

function hydrateProjectsCache() {
  if (projects.size === 0) {
    for (const project of loadProjects()) {
      projects.set(project.project_id, project);
    }
  }
}

export function listProjects(user?: PublicUser | null) {
  hydrateProjectsCache();
  return Array.from(projects.values())
    .filter((project) => canAccessProject(project, user ?? null))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .map(toSummary);
}

export function getProject(projectId: string) {
  let project = projects.get(projectId);
  if (!project) {
    const persisted = loadProject(projectId);
    if (persisted) {
      projects.set(projectId, persisted);
      project = persisted;
    }
  }
  return project ? cloneProject(project) : null;
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
  saveProject(project);
  return project;
}

export function syncProjectFromSession(projectId: string, session: BackendSession) {
  const project = projects.get(projectId);
  if (!project) return null;
  project.primary_session_id = session.session_id;
  project.stage = stageFromSession(session);
  project.dashboard_snapshot = cloneFields(session.dashboard_fields);
  if (!project.user_id && session.user_id) {
    project.user_id = session.user_id;
  }
  project.updated_at = now();
  saveProject(project);
  return project;
}

export function cloneProject(project: BackendProject) {
  return {
    ...project,
    dashboard_snapshot: cloneFields(project.dashboard_snapshot)
  };
}
