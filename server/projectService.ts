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
  return projects.get(projectId) ?? null;
}

export function cloneProject(project: BackendProject) {
  return {
    ...project,
    dashboard_snapshot: cloneFields(project.dashboard_snapshot)
  };
}
