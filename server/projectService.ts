import { randomUUID } from "node:crypto";
import type {
  BackendProject,
  BackendSession,
  DashboardField,
  ProjectContext,
  ProjectStage,
  ProjectSummary
} from "./types.js";

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
  return cloneProject(project);
}

export function listProjects() {
  return Array.from(projects.values())
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .map(toSummary);
}

export function getProject(projectId: string) {
  const project = projects.get(projectId);
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

export function cloneProject(project: BackendProject) {
  return {
    ...project,
    dashboard_snapshot: cloneFields(project.dashboard_snapshot)
  };
}
