import type { LicenseRecord, PublicUser } from "./types";

const TOKEN_STORAGE_KEY = "jfagent_auth_token";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const apiBaseUrl =
  !configuredApiBaseUrl || configuredApiBaseUrl === "same-origin"
    ? ""
    : configuredApiBaseUrl.replace(/\/$/, "");

export function readAuthToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeAuthToken(token: string) {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage unavailable (private mode); session continues in-memory.
  }
}

export function clearAuthToken() {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function authHeaders(): Record<string, string> {
  const token = readAuthToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

async function requestAuthJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
      ...(init?.headers ?? {})
    }
  });
  const raw = await response.text();
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new AuthApiError(`服务响应异常（${response.status}）`, response.status, "BAD_RESPONSE");
  }
  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: string } }).error;
    throw new AuthApiError(
      error?.message ?? `请求失败（${response.status}）`,
      response.status,
      error?.code ?? "REQUEST_FAILED"
    );
  }
  return body as T;
}

export interface AuthModeInfo {
  auth_required: boolean;
  registration_mode: "open" | "closed";
}

export async function getAuthMode(): Promise<AuthModeInfo> {
  const result = await requestAuthJson<{ data: AuthModeInfo }>("/api/auth/mode");
  return result.data;
}

export async function postRegister(params: {
  email: string;
  password: string;
  display_name?: string;
}): Promise<{ token: string; user: PublicUser }> {
  const result = await requestAuthJson<{ data: { token: string; user: PublicUser } }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(params)
  });
  return result.data;
}

export async function postLogin(params: {
  email: string;
  password: string;
}): Promise<{ token: string; user: PublicUser }> {
  const result = await requestAuthJson<{ data: { token: string; user: PublicUser } }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(params)
  });
  return result.data;
}

export async function getMe(): Promise<{ user: PublicUser; auth_required: boolean }> {
  const result = await requestAuthJson<{ data: { user: PublicUser; auth_required: boolean } }>(
    "/api/auth/me"
  );
  return result.data;
}

export async function postRedeem(code: string): Promise<{
  credits_added: number;
  balance_after: number;
  user: PublicUser;
}> {
  const result = await requestAuthJson<{
    data: { credits_added: number; balance_after: number; user: PublicUser };
  }>("/api/auth/redeem", { method: "POST", body: JSON.stringify({ code }) });
  return result.data;
}

export async function adminListUsers(): Promise<PublicUser[]> {
  const result = await requestAuthJson<{ data: { users: PublicUser[] } }>("/api/admin/users");
  return result.data.users;
}

export async function adminGenerateLicenses(params: {
  count: number;
  credits: number;
  note?: string;
}): Promise<LicenseRecord[]> {
  const result = await requestAuthJson<{ data: { licenses: LicenseRecord[] } }>("/api/admin/licenses", {
    method: "POST",
    body: JSON.stringify(params)
  });
  return result.data.licenses;
}

export async function adminListLicenses(): Promise<LicenseRecord[]> {
  const result = await requestAuthJson<{ data: { licenses: LicenseRecord[] } }>("/api/admin/licenses");
  return result.data.licenses;
}
