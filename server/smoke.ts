import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createApiServer } from "./http.js";

const server = createApiServer();

await new Promise<void>((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Could not allocate smoke test port.");
}

const baseUrl = `http://127.0.0.1:${address.port}`;

type StubHandler = (
  body: Record<string, unknown>,
  response: ServerResponse,
  requestIndex: number
) => void | Promise<void>;

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function startOpenAiStub(handler: StubHandler) {
  const requests: Record<string, unknown>[] = [];
  const stub = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not found" }));
        return;
      }
      const body = await readRequestBody(request);
      requests.push(body);
      await handler(body, response, requests.length);
    })();
  });
  await new Promise<void>((resolve) => {
    stub.listen(0, "127.0.0.1", resolve);
  });
  const stubAddress = stub.address();
  if (!stubAddress || typeof stubAddress === "string") {
    throw new Error("Could not allocate OpenAI stub port.");
  }
  return {
    baseUrl: `http://127.0.0.1:${stubAddress.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => stub.close(() => resolve()))
  };
}

function sendStubChatContent(response: ServerResponse, content: unknown) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: typeof content === "string" ? content : JSON.stringify(content)
          }
        }
      ]
    })
  );
}

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

async function requestBytes(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body };
}

try {
  const health = await requestJson("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const knowledgeStatus = await requestJson("/api/admin/knowledge/status");
  assert.equal(knowledgeStatus.status, 200);
  const knowledgeStatusData = knowledgeStatus.body.data as {
    index: { chunk_count: number; index_file: string };
  };
  assert.ok(knowledgeStatusData.index.chunk_count > 0);
  assert.ok(knowledgeStatusData.index.index_file.endsWith("server/generatedKnowledge.json"));

  const invalidKnowledgeUpload = await requestJson("/api/admin/knowledge/upload", {
    method: "POST",
    body: JSON.stringify({
      file_name: "bad.exe",
      content_base64: Buffer.from("invalid").toString("base64")
    })
  });
  assert.equal(invalidKnowledgeUpload.status, 400);
  assert.equal((invalidKnowledgeUpload.body.error as { code: string }).code, "VALIDATION_ERROR");

  const chat = await requestJson("/api/session/chat", {
    method: "POST",
    body: JSON.stringify({
      session_id: "sess_smoke",
      message_type: "text",
      content: "某医院老机房改造，50平，3楼，10个机柜，UPS后备2小时，国产优先"
    })
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.ok, true);
  const chatData = chat.body.data as {
    state: { export_status: string };
    knowledge_hits: Array<{
      retrieval_method?: string;
      source_file?: string;
      vector_score?: number;
      keyword_score?: number;
    }>;
  };
  assert.equal(chatData.state.export_status, "ready");
  assert.ok(chatData.knowledge_hits.length > 0);
  assert.equal(chatData.knowledge_hits[0].retrieval_method, "hybrid");
  assert.ok(chatData.knowledge_hits[0].source_file);
  assert.equal(typeof chatData.knowledge_hits[0].vector_score, "number");
  assert.equal(typeof chatData.knowledge_hits[0].keyword_score, "number");

  const override = await requestJson("/api/session/override", {
    method: "POST",
    body: JSON.stringify({
      session_id: "sess_smoke",
      field_code: "rack_count",
      value: "12"
    })
  });
  assert.equal(override.status, 200);
  assert.equal((override.body.data as { normalized_value: number }).normalized_value, 12);

  const paymentGate = await requestJson("/api/session/export?session_id=sess_smoke");
  assert.equal(paymentGate.status, 402);
  assert.equal((paymentGate.body.error as { code: string }).code, "PAYMENT_REQUIRED");

  const preview = await requestJson("/api/session/export?session_id=sess_smoke&payment_mode=free_preview");
  assert.equal(preview.status, 200);
  assert.equal((preview.body.data as { export_status: string }).export_status, "preview_ready");
  const previewData = preview.body.data as {
    export_payload: {
      version: string;
      project_name: string;
      commercial: { pricing_mode: string };
      chapter_plan: Array<{ id: string }>;
    };
  };
  assert.equal(previewData.export_payload.version, "v1");
  assert.equal(previewData.export_payload.commercial.pricing_mode, "manual_placeholder");
  assert.ok(previewData.export_payload.project_name.includes("机房建设项目"));
  assert.ok(
    previewData.export_payload.chapter_plan.some(
      (chapter) => chapter.id === "CHAPTER_7_COMMERCIAL_PLACEHOLDER_APPENDIX"
    )
  );

  const formal = await requestJson("/api/session/export?session_id=sess_smoke&approved=true");
  assert.equal(formal.status, 200);
  const formalData = formal.body.data as {
    asset: { download_url: string; mime_type: string; sha256?: string; size_bytes?: number };
    layout_validation: { checks: string[] };
  };
  assert.equal(
    formalData.asset.mime_type,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  assert.ok(formalData.asset.download_url.startsWith("/api/assets/"));
  assert.ok(formalData.asset.sha256);
  assert.ok((formalData.asset.size_bytes ?? 0) > 1000);
  assert.ok(formalData.layout_validation.checks.some((check) => check.startsWith("docx_zip_opened:passed")));

  const docx = await requestBytes(formalData.asset.download_url);
  assert.equal(docx.status, 200);
  assert.equal(
    docx.headers.get("content-type"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  assert.equal(docx.body.subarray(0, 2).toString("utf8"), "PK");

  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  const previousModel = process.env.OPENAI_MODEL;

  const llmStub = await startOpenAiStub((_body, response) => {
    sendStubChatContent(response, {
      ai_response: "LLM售前回复：先按医疗机房场景整理，规模口径我已补齐，报价仍需人工确认。",
      quick_replies: ["确认改造范围", "补充预算上限"],
      field_candidates: [
        {
          field_code: "project_type",
          value: "renovation",
          confidence: 0.82,
          needs_confirmation: true
        },
        {
          field_code: "rack_count",
          value: 99,
          confidence: 0.88,
          needs_confirmation: false
        }
      ]
    });
  });

  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = llmStub.baseUrl;
    process.env.OPENAI_MODEL = "stub-model";

    const llmChat = await requestJson("/api/session/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: "sess_llm",
        message_type: "text",
        content: "某医院机房，计划6个机柜，国产优先"
      })
    });
    assert.equal(llmChat.status, 200);
    const llmChatData = llmChat.body.data as {
      ai_response: string;
      quick_replies: string[];
      updated_fields: Record<string, unknown>;
      field_patches: Array<{ field_code: string; new_value: unknown; source: string }>;
    };
    assert.ok(llmChatData.ai_response.startsWith("LLM售前回复"));
    assert.deepEqual(llmChatData.quick_replies, ["确认改造范围", "补充预算上限"]);
    assert.equal(llmChatData.updated_fields.project_type, "renovation");
    assert.equal(llmChatData.updated_fields.rack_count, 6);
    assert.equal(
      llmChatData.field_patches.find((patch) => patch.field_code === "project_type")?.source,
      "agent_inference"
    );
    assert.equal(llmChatData.field_patches.find((patch) => patch.field_code === "rack_count")?.new_value, 6);
    assert.equal(llmStub.requests[0].model, "stub-model");
    assert.deepEqual(llmStub.requests[0].response_format, { type: "json_object" });
  } finally {
    await llmStub.close();
    process.env.OPENAI_API_KEY = previousApiKey;
    process.env.OPENAI_BASE_URL = previousBaseUrl;
    process.env.OPENAI_MODEL = previousModel;
  }

  const retryStub = await startOpenAiStub((_body, response, requestIndex) => {
    if (requestIndex === 1) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "response_format is unsupported" } }));
      return;
    }
    sendStubChatContent(response, {
      ai_response: "JSON mode retry worked.",
      quick_replies: ["继续"],
      field_candidates: []
    });
  });

  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = retryStub.baseUrl;

    const retryChat = await requestJson("/api/session/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: "sess_llm_retry",
        message_type: "text",
        content: "某中心机房，8个机柜"
      })
    });
    assert.equal(retryChat.status, 200);
    assert.equal((retryChat.body.data as { ai_response: string }).ai_response, "JSON mode retry worked.");
    assert.equal(retryStub.requests.length, 2);
    assert.ok("response_format" in retryStub.requests[0]);
    assert.ok(!("response_format" in retryStub.requests[1]));
  } finally {
    await retryStub.close();
    process.env.OPENAI_API_KEY = previousApiKey;
    process.env.OPENAI_BASE_URL = previousBaseUrl;
    process.env.OPENAI_MODEL = previousModel;
  }

  const fallbackStub = await startOpenAiStub((_body, response) => {
    sendStubChatContent(response, "not-json");
  });

  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = fallbackStub.baseUrl;

    const fallbackChat = await requestJson("/api/session/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: "sess_llm_fallback",
        message_type: "text",
        content: "某工厂机房，5个机柜"
      })
    });
    assert.equal(fallbackChat.status, 200);
    assert.equal(
      (fallbackChat.body.data as { ai_response: string }).ai_response,
      "已收到项目线索并同步到后端会话状态。当前已具备初步规模口径，可继续补充预算或触发导出意愿验证。"
    );
  } finally {
    await fallbackStub.close();
    process.env.OPENAI_API_KEY = previousApiKey;
    process.env.OPENAI_BASE_URL = previousBaseUrl;
    process.env.OPENAI_MODEL = previousModel;
  }

  console.log("API smoke test passed.");
} finally {
  server.close();
}
