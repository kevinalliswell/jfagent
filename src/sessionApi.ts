import {
  completionForState,
  displayForField,
  getSessionExport as getMockSessionExport,
  initialSession,
  postSessionChat as postMockSessionChat,
  postSessionOverride as postMockSessionOverride,
  sourceLabel
} from "./mockApi";
import type {
  ChatResponseData,
  ExportResponseData,
  OverrideResponseData,
  PaymentRequiredError,
  SessionSnapshot,
  SuccessEnvelope
} from "./types";

type SessionApiMode = "mock" | "backend";

const configuredMode = import.meta.env.VITE_SESSION_API_MODE;
export const sessionApiMode: SessionApiMode = configuredMode === "backend" ? "backend" : "mock";
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = (await response.json()) as T;
  if (!response.ok && response.status !== 402) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : `API request failed with ${response.status}`;
    throw new Error(message);
  }
  return body;
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

export { completionForState, displayForField, initialSession, sourceLabel };
