import {
  completionForState,
  createProject as createMockProject,
  displayForField,
  getProjectDetail as getMockProjectDetail,
  getSessionSnapshot as getMockSessionSnapshot,
  getSessionExport as getMockSessionExport,
  initialSession,
  listProjects as listMockProjects,
  postSessionChat as postMockSessionChat,
  postSessionOverride as postMockSessionOverride,
  sourceLabel
} from "./mockApi";
import type {
  ChatResponseData,
  ExportResponseData,
  KnowledgeIndexStatus,
  KnowledgeUploadResponseData,
  OverrideResponseData,
  PaymentRequiredError,
  ProjectDetail,
  ProjectSummary,
  SessionSnapshotData,
  SessionSnapshot,
  SuccessEnvelope
} from "./types";

type SessionApiMode = "mock" | "backend";

const configuredMode = import.meta.env.VITE_SESSION_API_MODE;
export const sessionApiMode: SessionApiMode = configuredMode === "backend" ? "backend" : "mock";
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const apiBaseUrl =
  !configuredApiBaseUrl || configuredApiBaseUrl === "same-origin"
    ? ""
    : configuredApiBaseUrl.replace(/\/$/, "");

let adminAuthHeader: string | null = null;

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const rawBody = await response.text();
  let body: T;
  try {
    body = rawBody ? (JSON.parse(rawBody) as T) : ({} as T);
  } catch {
    if (!response.ok) {
      throw new ApiRequestError(`API request failed with ${response.status}`, response.status);
    }
    throw new Error("API response was not valid JSON.");
  }
  if (!response.ok && response.status !== 402) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : `API request failed with ${response.status}`;
    throw new ApiRequestError(message, response.status);
  }
  return body;
}

function promptAdminAuthHeader() {
  const username = window.prompt("请输入管理员账号");
  if (!username) return null;
  const password = window.prompt("请输入管理员密码");
  if (password === null) return null;
  return `Basic ${window.btoa(`${username}:${password}`)}`;
}

async function requestAdminJson<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await requestJson<T>(path, {
      ...init,
      headers: {
        ...(adminAuthHeader ? { authorization: adminAuthHeader } : {}),
        ...(init?.headers ?? {})
      }
    });
  } catch (error) {
    if (!(error instanceof ApiRequestError) || (error.status !== 401 && error.status !== 403)) {
      throw error;
    }
  }

  adminAuthHeader = promptAdminAuthHeader();
  if (!adminAuthHeader) {
    throw new Error("已取消管理员认证。");
  }

  try {
    return await requestJson<T>(path, {
      ...init,
      headers: {
        authorization: adminAuthHeader,
        ...(init?.headers ?? {})
      }
    });
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
      adminAuthHeader = null;
      error.message = "管理员账号或密码未通过 Basic Auth。";
      throw error;
    }
    throw error;
  }
}

export async function postSessionChat(params: {
  session: SessionSnapshot;
  message_type: "text" | "voice" | "file";
  content: string;
}): Promise<SuccessEnvelope<ChatResponseData>> {
  if (sessionApiMode === "mock") return postMockSessionChat(params);

  return requestJson<SuccessEnvelope<ChatResponseData>>("/api/session/chat", {
    method: "POST",
    body: JSON.stringify({
      session_id: params.session.session_id,
      project_id: params.session.project?.project_id,
      message_type: params.message_type,
      content: params.content,
      client_state_version: params.session.state_version,
      locale: "zh-CN",
      timezone: "Asia/Shanghai"
    })
  });
}

export async function postSessionOverride(params: {
  session: SessionSnapshot;
  field_code: string;
  value: string;
}): Promise<SuccessEnvelope<OverrideResponseData>> {
  if (sessionApiMode === "mock") return postMockSessionOverride(params);

  return requestJson<SuccessEnvelope<OverrideResponseData>>("/api/session/override", {
    method: "POST",
    body: JSON.stringify({
      session_id: params.session.session_id,
      field_code: params.field_code,
      value: params.value,
      client_state_version: params.session.state_version,
      commit_mode: "enter"
    })
  });
}

export async function getSessionExport(params: {
  session: SessionSnapshot;
  payment_mode?: "simulate_99_rmb" | "credit" | "free_preview";
  approved?: boolean;
}): Promise<SuccessEnvelope<ExportResponseData> | PaymentRequiredError> {
  if (sessionApiMode === "mock") return getMockSessionExport(params);

  const query = new URLSearchParams({
    session_id: params.session.session_id,
    payment_mode: params.payment_mode ?? "simulate_99_rmb",
    approved: params.approved ? "true" : "false"
  });
  const result = await requestJson<SuccessEnvelope<ExportResponseData> | PaymentRequiredError>(
    `/api/session/export?${query}`
  );
  if (result.ok && result.data.asset.download_url.startsWith("/")) {
    result.data.asset.download_url = `${apiBaseUrl}${result.data.asset.download_url}`;
  }
  return result;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (sessionApiMode === "mock") return listMockProjects();

  const result = await requestJson<{
    ok: true;
    server_time: string;
    data: { projects: ProjectSummary[] };
  }>("/api/projects");
  return result.data.projects;
}

export async function createProject(name?: string): Promise<ProjectSummary> {
  if (sessionApiMode === "mock") return createMockProject(name);

  const result = await requestJson<{
    ok: true;
    server_time: string;
    data: { project: ProjectDetail };
  }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(name?.trim() ? { name } : {})
  });

  const { project } = result.data;
  return {
    project_id: project.project_id,
    project_name: project.project_name,
    stage: project.stage,
    primary_session_id: project.primary_session_id,
    updated_at: project.updated_at
  };
}

export async function getSessionSnapshot(sessionId: string): Promise<SessionSnapshotData> {
  if (sessionApiMode === "mock") return getMockSessionSnapshot(sessionId);

  const result = await requestJson<{
    ok: true;
    server_time: string;
    data: SessionSnapshotData;
  }>(`/api/session?session_id=${encodeURIComponent(sessionId)}`);
  return result.data;
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetail> {
  if (sessionApiMode === "mock") return getMockProjectDetail(projectId);

  const result = await requestJson<{
    ok: true;
    server_time: string;
    data: { project: ProjectDetail };
  }>(`/api/projects/${encodeURIComponent(projectId)}`);
  return result.data.project;
}

export async function getKnowledgeStatus(): Promise<{
  ok: true;
  server_time: string;
  data: KnowledgeIndexStatus;
}> {
  return requestAdminJson<{ ok: true; server_time: string; data: KnowledgeIndexStatus }>(
    "/api/admin/knowledge/status"
  );
}

export async function uploadKnowledgeFile(params: {
  file_name: string;
  content_base64: string;
}): Promise<{ ok: true; server_time: string; data: KnowledgeUploadResponseData }> {
  return requestAdminJson<{ ok: true; server_time: string; data: KnowledgeUploadResponseData }>(
    "/api/admin/knowledge/upload",
    {
      method: "POST",
      body: JSON.stringify(params)
    }
  );
}

export { completionForState, displayForField, initialSession, sourceLabel };
