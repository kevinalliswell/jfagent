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
import type { ErrorEnvelope } from "./types.js";
import { createReadStream } from "node:fs";
import { getRenderedAsset } from "./exportDocument.js";

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

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const size = chunks.reduce((sum, item) => sum + item.byteLength, 0);
    if (size > 1024 * 1024) {
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

async function route(request: IncomingMessage, response: ServerResponse) {
  const requestId = String(request.headers["x-request-id"] ?? randomUUID());
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "OPTIONS") {
    response.writeHead(204, jsonHeaders);
    response.end();
    return;
  }

  try {
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

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "jfagent-api",
        status: "ok",
        sessions: getSessionCount(),
        server_time: now()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/session") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId) throw new ApiValidationError("session_id is required.");
      sendJson(response, 200, {
        ok: true,
        session: getSessionSnapshot(sessionId),
        server_time: now()
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/session/chat") {
      const body = await readJsonBody(request);
      sendJson(response, 200, postSessionChat(body as never));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/session/override") {
      const body = await readJsonBody(request);
      sendJson(response, 200, postSessionOverride(body as never));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/session/export") {
      const result = getSessionExport({
        session_id: url.searchParams.get("session_id") ?? "",
        payment_mode: (url.searchParams.get("payment_mode") ?? undefined) as never,
        approved: parseBoolean(url.searchParams.get("approved"))
      });
      sendJson(response, result.status, result.body);
      return;
    }

    sendError(response, requestId, 404, "NOT_FOUND", `No route for ${request.method} ${url.pathname}`);
  } catch (error) {
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
  return createServer((request, response) => {
    void route(request, response);
  });
}
