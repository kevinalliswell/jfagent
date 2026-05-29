import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createApiServer } from "./http.js";
import { createProject, getProject } from "./projectService.js";
import { getSessionSnapshot } from "./sessionService.js";

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

  const unknownProjectChat = await requestJson("/api/session/chat", {
    method: "POST",
    body: JSON.stringify({
      session_id: "sess_unknown_project",
      project_id: "proj_missing",
      message_type: "text",
      content: "某医院老机房改造，50平，3楼，10个机柜，UPS后备2小时，国产优先"
    })
  });
  assert.equal(unknownProjectChat.status, 404);
  assert.equal((unknownProjectChat.body.error as { code: string }).code, "PROJECT_NOT_FOUND");

  const serviceProject = createProject("服务边界项目");
  const firstRead = getProject(serviceProject.project_id);
  assert.ok(firstRead);
  if (!firstRead) {
    throw new Error("Expected project to exist after creation.");
  }
  firstRead.project_name = "mutated locally";
  const secondRead = getProject(serviceProject.project_id);
  assert.ok(secondRead);
  if (!secondRead) {
    throw new Error("Expected project to exist on second read.");
  }
  assert.equal(secondRead.project_name, "服务边界项目");

  const missingProject = await requestJson("/api/projects/proj_missing");
  assert.equal(missingProject.status, 404);
  assert.equal((missingProject.body.error as { code: string }).code, "PROJECT_NOT_FOUND");

  const blankNameProject = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert.equal(blankNameProject.status, 200);
  const blankNameProjectData = blankNameProject.body.data as {
    project: { project_name: string };
  };
  assert.ok(blankNameProjectData.project.project_name.startsWith("未命名项目 "));

  const missingNameProject = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: ""
    })
  });
  assert.equal(missingNameProject.status, 200);
  const missingNameProjectData = missingNameProject.body.data as {
    project: { project_name: string };
  };
  assert.ok(missingNameProjectData.project.project_name.startsWith("未命名项目 "));

  const nullBodyProject = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify(null)
  });
  assert.equal(nullBodyProject.status, 200);
  assert.equal(nullBodyProject.body.ok, true);
  const nullBodyProjectData = nullBodyProject.body.data as {
    project: { project_name: string };
  };
  assert.ok(nullBodyProjectData.project.project_name.startsWith("未命名项目 "));

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
      project_id: projectId,
      message_type: "text",
      content: "某医院老机房改造，50平，3楼，10个机柜，UPS后备2小时，国产优先"
    })
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.ok, true);
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
  assert.equal(chatData.state.export_status, "ready");
  assert.ok(chatData.knowledge_hits.length > 0);
  assert.equal(chatData.knowledge_hits[0].retrieval_method, "hybrid");
  assert.ok(chatData.knowledge_hits[0].source_file);
  assert.equal(typeof chatData.knowledge_hits[0].vector_score, "number");
  assert.equal(typeof chatData.knowledge_hits[0].keyword_score, "number");

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
  assert.deepEqual(Object.keys(sessionSnapshotData.session).sort(), [
    "dashboard_fields",
    "export_status",
    "fsm_state",
    "knowledge_hits",
    "project_id",
    "session_id",
    "state_version",
    "suggestion",
    "triggered_risks"
  ]);
  assert.deepEqual(Object.keys(sessionSnapshotData.project ?? {}).sort(), [
    "project_id",
    "project_name",
    "stage"
  ]);
  assert.equal(
    (sessionSnapshotData.session as { payment_willingness_99_rmb?: unknown }).payment_willingness_99_rmb,
    undefined
  );
  assert.equal((sessionSnapshotData.session as { export_payload_stale?: unknown }).export_payload_stale, undefined);
  assert.equal((sessionSnapshotData.session as { created_at?: unknown }).created_at, undefined);
  assert.equal((sessionSnapshotData.session as { updated_at?: unknown }).updated_at, undefined);

  const healthBeforeMissingRead = await requestJson("/api/health");
  assert.equal(healthBeforeMissingRead.status, 200);
  const healthBeforeMissingReadData = healthBeforeMissingRead.body as {
    sessions: number;
  };

  const missingSessionSnapshot = await requestJson("/api/session?session_id=sess_missing");
  assert.equal(missingSessionSnapshot.status, 404);
  assert.equal((missingSessionSnapshot.body.error as { code: string }).code, "SESSION_NOT_FOUND");

  const healthAfterMissingRead = await requestJson("/api/health");
  assert.equal(healthAfterMissingRead.status, 200);
  const healthAfterMissingReadData = healthAfterMissingRead.body as {
    sessions: number;
  };
  assert.equal(healthAfterMissingReadData.sessions, healthBeforeMissingReadData.sessions);

  const snapshotBeforeMutation = getSessionSnapshot("sess_smoke");
  assert.ok(snapshotBeforeMutation.session.triggered_risks.length > 0);
  snapshotBeforeMutation.session.triggered_risks[0].trigger_fields.push("mutated_field");
  const snapshotAfterMutation = getSessionSnapshot("sess_smoke");
  assert.ok(snapshotAfterMutation.session.triggered_risks.length > 0);
  assert.ok(!snapshotAfterMutation.session.triggered_risks[0].trigger_fields.includes("mutated_field"));

  const reboundChat = await requestJson("/api/session/chat", {
    method: "POST",
    body: JSON.stringify({
      session_id: "sess_smoke",
      project_id: serviceProject.project_id,
      message_type: "text",
      content: "补充一次新的聊天内容"
    })
  });
  assert.equal(reboundChat.status, 409);
  assert.equal((reboundChat.body.error as { code: string }).code, "PROJECT_SESSION_BOUND");

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

  const stagedProject = await requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "阶段推进项目"
    })
  });
  assert.equal(stagedProject.status, 200);
  const stagedProjectData = stagedProject.body.data as {
    project: { project_id: string; project_name: string; stage: string };
  };
  const stagedProjectId = stagedProjectData.project.project_id;

  const stagedChat = await requestJson("/api/session/chat", {
    method: "POST",
    body: JSON.stringify({
      session_id: "sess_stage_progress",
      project_id: stagedProjectId,
      message_type: "text",
      content: "某医院老机房改造，面积50平方，国产优先"
    })
  });
  assert.equal(stagedChat.status, 200);
  const stagedChatData = stagedChat.body.data as {
    state: { export_status: string };
  };
  assert.equal(stagedChatData.state.export_status, "draft");

  const stagedRackOverride = await requestJson("/api/session/override", {
    method: "POST",
    body: JSON.stringify({
      session_id: "sess_stage_progress",
      field_code: "rack_count",
      value: "10"
    })
  });
  assert.equal(stagedRackOverride.status, 200);
  assert.equal((stagedRackOverride.body.data as { normalized_value: number }).normalized_value, 10);

  const stagedBackupOverride = await requestJson("/api/session/override", {
    method: "POST",
    body: JSON.stringify({
      session_id: "sess_stage_progress",
      field_code: "ups_backup_time_minutes",
      value: "120"
    })
  });
  assert.equal(stagedBackupOverride.status, 200);
  assert.equal((stagedBackupOverride.body.data as { normalized_value: number }).normalized_value, 120);

  const promotedProject = await requestJson(`/api/projects/${stagedProjectId}`);
  assert.equal(promotedProject.status, 200);
  const promotedProjectData = promotedProject.body.data as {
    project: { stage: string; dashboard_snapshot: Record<string, { value: string | number | null }> };
  };
  assert.equal(promotedProjectData.project.stage, "solution_ready");
  assert.equal(promotedProjectData.project.dashboard_snapshot.rack_count.value, 10);

  const promotedSession = await requestJson("/api/session?session_id=sess_stage_progress");
  assert.equal(promotedSession.status, 200);
  const promotedSessionData = (promotedSession.body.data as {
    session: {
      export_status: string;
      fsm_state: string;
    };
  }).session;
  assert.equal(promotedSessionData.export_status, "ready");
  assert.equal(promotedSessionData.fsm_state, "S3_READY_MONETIZATION");

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
  assert.equal(previewData.export_payload.project_name, "医院老机房改造一期");
  assert.equal(previewData.export_payload.commercial.pricing_mode, "manual_placeholder");
  assert.ok(
    previewData.export_payload.chapter_plan.some(
      (chapter) => chapter.id === "CHAPTER_7_COMMERCIAL_PLACEHOLDER_APPENDIX"
    )
  );

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
  assert.equal(updatedProjectData.project.dashboard_snapshot.rack_count.value, 12);

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
