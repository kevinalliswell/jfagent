import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  ApiValidationError,
  getSessionCount,
  getSessionExport,
  getSessionSnapshot,
  postSessionChat,
  postSessionOverride
} from "./sessionService.js";
import type { CreateProjectRequest, ErrorEnvelope, PublicUser } from "./types.js";
import { createReadStream } from "node:fs";
import { getRenderedAsset } from "./exportDocument.js";
import { getKnowledgeAdminStatus, postKnowledgeUpload } from "./knowledgeAdmin.js";
import { getAgentRuntimeStatus } from "./llmClient.js";
import { canAccessProject, createProject, getProject, listProjects } from "./projectService.js";
import { getDatabasePath, getKnowledgeUploadDir, getOutputDir } from "./runtimePaths.js";
import {
  AuthError,
  ensureBootstrapAdmin,
  generateLicenses,
  getRegistrationMode,
  grantCredits,
  isAuthDisabled,
  listAllLicenses,
  listAllUsers,
  localAdminUser,
  loginUser,
  redeemLicense,
  registerUser,
  resolveUser,
  toPublicUser
} from "./auth.js";
import { getUserById } from "./persistence.js";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-request-id,idempotency-key"
};

function now() {
  return new Date().toISOString();
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
}

function sendError(
  response: ServerResponse,
  requestId: string,
  status: number,
  code: string,
  message: string
) {
  const envelope: ErrorEnvelope = {
    ok: false,
    error: {
      code,
      message,
      retryable: status >= 500
    },
    request_id: requestId,
    server_time: now()
  };
  sendJson(response, status, envelope);
}

function sendAssetDownload(response: ServerResponse, assetId: string) {
  const stored = getRenderedAsset(assetId);
  if (!stored) return false;
  response.writeHead(200, {
    ...jsonHeaders,
    "content-type": stored.asset.mime_type,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(stored.asset.file_name)}`
  });
  createReadStream(stored.file_path).pipe(response);
  return true;
}

async function readJsonBody(request: IncomingMessage, maxBytes = 1024 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new ApiValidationError("Request body is too large.");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ApiValidationError("Request body must be valid JSON.");
  }
}

function parseBoolean(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

function bearerToken(request: IncomingMessage) {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Resolve the request identity. When AUTH_DISABLED=1 every request acts as a
 * synthetic local admin (single-operator mode); otherwise a valid Bearer JWT
 * is required for product and admin routes.
 */
function resolveRequestUser(request: IncomingMessage): PublicUser | null {
  if (isAuthDisabled()) return localAdminUser();
  return resolveUser(bearerToken(request));
}

function refreshUser(user: PublicUser): PublicUser {
  if (user.user_id === "local_admin") return user;
  const fresh = getUserById(user.user_id);
  return fresh ? toPublicUser(fresh) : user;
}

const openRoutes = new Set(["/api/health", "/api/auth/register", "/api/auth/login", "/api/auth/mode"]);

async function route(request: IncomingMessage, response: ServerResponse) {
  const requestId = String(request.headers["x-request-id"] ?? randomUUID());
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "OPTIONS") {
    response.writeHead(204, jsonHeaders);
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "jfagent-api",
        status: "ok",
        sessions: getSessionCount(),
        auth_required: !isAuthDisabled(),
        server_time: now()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/mode") {
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: {
          auth_required: !isAuthDisabled(),
          registration_mode: getRegistrationMode()
        }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register") {
      const body = await readJsonBody(request);
      const result = registerUser({
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        display_name: typeof body.display_name === "string" ? body.display_name : undefined
      });
      sendJson(response, 200, { ok: true, server_time: now(), data: result });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJsonBody(request);
      const result = loginUser({
        email: String(body.email ?? ""),
        password: String(body.password ?? "")
      });
      sendJson(response, 200, { ok: true, server_time: now(), data: result });
      return;
    }

    // Asset downloads use unguessable capability URLs so <a href> works
    // without an Authorization header.
    const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/download$/);
    if (request.method === "GET" && assetMatch) {
      if (!sendAssetDownload(response, assetMatch[1])) {
        sendError(
          response,
          requestId,
          404,
          "ASSET_NOT_FOUND",
          "The requested export asset is not available."
        );
      }
      return;
    }

    const user = resolveRequestUser(request);
    if (!user && !openRoutes.has(url.pathname)) {
      sendError(response, requestId, 401, "UNAUTHORIZED", "请先登录后再访问。");
      return;
    }

    if (url.pathname.startsWith("/api/admin/") && user && user.role !== "admin") {
      sendError(response, requestId, 403, "FORBIDDEN", "需要管理员权限。");
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { user: refreshUser(user as PublicUser), auth_required: !isAuthDisabled() }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/redeem") {
      const body = await readJsonBody(request);
      const currentUser = user as PublicUser;
      if (currentUser.user_id === "local_admin") {
        throw new AuthError("本地模式无需兑换激活码。", 400, "LOCAL_MODE");
      }
      const result = redeemLicense(currentUser.user_id, String(body.code ?? ""));
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { ...result, user: refreshUser(currentUser) }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/knowledge/status") {
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: getKnowledgeAdminStatus()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/runtime/status") {
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: {
          agent: getAgentRuntimeStatus(),
          auth: {
            auth_required: !isAuthDisabled(),
            registration_mode: getRegistrationMode()
          },
          storage: {
            database_path: getDatabasePath(),
            upload_dir: getKnowledgeUploadDir(),
            output_dir: getOutputDir()
          }
        }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/knowledge/upload") {
      const body = await readJsonBody(request, 30 * 1024 * 1024);
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: postKnowledgeUpload(body)
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/users") {
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { users: listAllUsers() }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/users/grant") {
      const body = await readJsonBody(request);
      const userId = String(body.user_id ?? "");
      const credits = Number(body.credits ?? 0);
      const balance = grantCredits(userId, credits, "admin_panel");
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { user_id: userId, balance_after: balance }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/licenses") {
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { licenses: listAllLicenses() }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/licenses") {
      const body = await readJsonBody(request);
      const adminUser = user as PublicUser;
      const licenses = generateLicenses({
        count: Number(body.count ?? 1),
        credits: Number(body.credits ?? 1),
        note: typeof body.note === "string" ? body.note : undefined,
        created_by: adminUser.user_id
      });
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { licenses }
      });
      return;
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);

    if (request.method === "GET" && url.pathname === "/api/projects") {
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { projects: listProjects(user) }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/projects") {
      const body = (await readJsonBody(request)) as CreateProjectRequest | null;
      const projectRequest = body && typeof body === "object" ? body : {};
      const name =
        typeof projectRequest.name === "string" && projectRequest.name.trim().length > 0
          ? projectRequest.name.trim()
          : undefined;
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { project: createProject(name, user) }
      });
      return;
    }

    if (request.method === "GET" && projectMatch) {
      const project = getProject(projectMatch[1]);
      if (!project || (user && !canAccessProject(project, user))) {
        sendError(response, requestId, 404, "PROJECT_NOT_FOUND", "The requested project does not exist.");
        return;
      }
      sendJson(response, 200, {
        ok: true,
        server_time: now(),
        data: { project }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/session") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId) throw new ApiValidationError("session_id is required.");
      sendJson(response, 200, {
        ok: true,
        data: getSessionSnapshot(sessionId, user),
        server_time: now()
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/session/chat") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await postSessionChat(body as never, user));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/session/override") {
      const body = await readJsonBody(request);
      sendJson(response, 200, postSessionOverride(body as never, user));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/session/export") {
      const result = getSessionExport(
        {
          session_id: url.searchParams.get("session_id") ?? "",
          payment_mode: (url.searchParams.get("payment_mode") ?? undefined) as never,
          approved: parseBoolean(url.searchParams.get("approved"))
        },
        user ? refreshUser(user) : null
      );
      sendJson(response, result.status, result.body);
      return;
    }

    sendError(response, requestId, 404, "NOT_FOUND", `No route for ${request.method} ${url.pathname}`);
  } catch (error) {
    if (error instanceof AuthError) {
      sendError(response, requestId, error.status, error.code, error.message);
      return;
    }
    if (error instanceof ApiValidationError) {
      sendError(response, requestId, error.status, error.code, error.message);
      return;
    }
    sendError(
      response,
      requestId,
      500,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

export function createApiServer() {
  ensureBootstrapAdmin();
  return createServer((request, response) => {
    void route(request, response);
  });
}
