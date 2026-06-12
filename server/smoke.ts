import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const smokeRoot = mkdtempSync(resolve(tmpdir(), "jfagent-smoke-"));
process.env.JFAGENT_DATA_DIR = resolve(smokeRoot, "data");
process.env.JFAGENT_OUTPUT_DIR = resolve(smokeRoot, "output/doc");
process.env.JFAGENT_UPLOAD_DIR = resolve(smokeRoot, "knowledge/uploads");
// Legacy flow sections run in single-operator local mode; the dedicated auth
// section flips AUTH_DISABLED off to exercise the full account/credit flow.
process.env.AUTH_DISABLED = "1";
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_PASSWORD;

const { createApiServer } = await import("./http.js");
const { saveSession } = await import("./persistence.js");
const { createProject, getProject } = await import("./projectService.js");
const { getSessionSnapshot } = await import("./sessionService.js");

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

async function waitForHealth(url: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for external API server.");
}

async function startExternalApiServer() {
  const port = 3300 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, ["server-dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const output: string[] = [];
  child.stdout.on("data", (chunk) => {
    output.push(String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    output.push(String(chunk));
  });

  const baseChildUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseChildUrl);

  return {
    baseUrl: baseChildUrl,
    child,
    close: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolveClose) => {
        child.once("exit", () => resolveClose());
      });
    },
    output
  };
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

  const runtimeStatus = await requestJson("/api/admin/runtime/status");
  assert.equal(runtimeStatus.status, 200);
  const runtimeStatusData = runtimeStatus.body.data as {
    agent: {
      llm_configured: boolean;
      provider_name: string;
      base_url: string;
      model: string;
      timeout_ms: number;
    };
    storage: {
      database_path: string;
      upload_dir: string;
      output_dir: string;
    };
  };
  assert.equal(runtimeStatusData.agent.llm_configured, false);
  assert.equal(runtimeStatusData.agent.provider_name, "openai_compatible");
  assert.equal(runtimeStatusData.agent.base_url, "https://api.openai.com/v1");
  assert.equal(runtimeStatusData.agent.model, "gpt-4o-mini");
  assert.equal(runtimeStatusData.agent.timeout_ms, 25000);
  assert.equal(runtimeStatusData.storage.database_path, resolve(smokeRoot, "data", "jfagent.sqlite"));
  assert.equal(runtimeStatusData.storage.upload_dir, resolve(smokeRoot, "knowledge/uploads"));
  assert.equal(runtimeStatusData.storage.output_dir, resolve(smokeRoot, "output/doc"));

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

  const uploadMarkdown = Buffer.from(
    "# 上传验证\n\n这是一个用于持久化 smoke 的临时知识片段。",
    "utf8"
  ).toString("base64");
  const successfulKnowledgeUpload = await requestJson("/api/admin/knowledge/upload", {
    method: "POST",
    body: JSON.stringify({
      file_name: "验收资料.md",
      content_base64: uploadMarkdown
    })
  });
  assert.equal(successfulKnowledgeUpload.status, 200);
  const successfulKnowledgeUploadData = successfulKnowledgeUpload.body.data as {
    uploaded_file: { stored_file_name: string; original_file_name: string };
    job: { status: string; file_name: string };
  };
  assert.equal(successfulKnowledgeUploadData.uploaded_file.original_file_name, "验收资料.md");
  assert.equal(successfulKnowledgeUploadData.job.status, "completed");
  assert.equal(successfulKnowledgeUploadData.job.file_name, "验收资料.md");

  const uploadedKnowledgeStatus = await requestJson("/api/admin/knowledge/status");
  assert.equal(uploadedKnowledgeStatus.status, 200);
  const uploadedKnowledgeStatusData = uploadedKnowledgeStatus.body.data as {
    rebuild_status: string;
    uploaded_file_count: number;
    pending_job_count: number;
    last_uploaded_file: { original_file_name?: string; stored_file_name: string } | null;
    active_job: { status: string } | null;
    latest_job: { status: string; file_name: string } | null;
  };
  assert.equal(uploadedKnowledgeStatusData.rebuild_status, "idle");
  assert.ok(uploadedKnowledgeStatusData.uploaded_file_count >= 1);
  assert.equal(uploadedKnowledgeStatusData.pending_job_count, 0);
  assert.equal(uploadedKnowledgeStatusData.last_uploaded_file?.original_file_name, "验收资料.md");
  assert.equal(uploadedKnowledgeStatusData.active_job, null);
  assert.equal(uploadedKnowledgeStatusData.latest_job?.status, "completed");
  assert.equal(uploadedKnowledgeStatusData.latest_job?.file_name, "验收资料.md");

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
    agent_runtime: {
      response_mode: string;
      llm_configured: boolean;
      fallback_reason: string | null;
    };
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
  assert.equal(chatData.agent_runtime.response_mode, "fallback");
  assert.equal(chatData.agent_runtime.llm_configured, false);
  assert.equal(chatData.agent_runtime.fallback_reason, "not_configured");
  assert.ok(chatData.knowledge_hits.length > 0);
  assert.equal(chatData.knowledge_hits[0].retrieval_method, "hybrid");
  assert.ok(chatData.knowledge_hits[0].source_file);
  assert.equal(typeof chatData.knowledge_hits[0].vector_score, "number");
  assert.equal(typeof chatData.knowledge_hits[0].keyword_score, "number");

  const sessionSnapshot = await requestJson("/api/session?session_id=sess_smoke");
  assert.equal(sessionSnapshot.status, 200);
  const sessionSnapshotData = sessionSnapshot.body.data as {
    session: {
      session_id: string;
      project_id: string | null;
      state_version: number;
      agent_runtime: {
        response_mode: string;
        fallback_reason: string | null;
      } | null;
    };
    project: { project_id: string; project_name: string; stage: string } | null;
  };
  assert.equal(sessionSnapshotData.session.session_id, "sess_smoke");
  assert.equal(sessionSnapshotData.session.project_id, projectId);
  assert.equal(sessionSnapshotData.session.agent_runtime?.response_mode, "fallback");
  assert.equal(sessionSnapshotData.session.agent_runtime?.fallback_reason, "not_configured");
  assert.equal(sessionSnapshotData.project?.project_id, projectId);
  assert.equal(sessionSnapshotData.project?.project_name, "医院老机房改造一期");
  assert.equal(sessionSnapshotData.project?.stage, "solution_ready");
  assert.deepEqual(Object.keys(sessionSnapshotData.session).sort(), [
    "agent_runtime",
    "dashboard_fields",
    "export_status",
    "fsm_state",
    "knowledge_hits",
    "messages",
    "project_id",
    "session_id",
    "state_version",
    "suggestion",
    "triggered_risks"
  ]);
  const snapshotMessages = (
    sessionSnapshotData.session as unknown as {
      messages: Array<{ sender: string; text: string }>;
    }
  ).messages;
  assert.ok(snapshotMessages.length >= 2);
  assert.equal(snapshotMessages[0].sender, "user");
  assert.ok(snapshotMessages.some((message) => message.sender === "ai"));
  assert.deepEqual(Object.keys(sessionSnapshotData.project ?? {}).sort(), [
    "project_id",
    "project_name",
    "stage"
  ]);
  assert.equal(
    (sessionSnapshotData.session as { payment_willingness_99_rmb?: unknown }).payment_willingness_99_rmb,
    undefined
  );
  assert.equal(
    (sessionSnapshotData.session as { export_payload_stale?: unknown }).export_payload_stale,
    undefined
  );
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
  const promotedSessionData = (
    promotedSession.body.data as {
      session: {
        export_status: string;
        fsm_state: string;
      };
    }
  ).session;
  assert.equal(promotedSessionData.export_status, "ready");
  assert.equal(promotedSessionData.fsm_state, "S3_READY_MONETIZATION");

  const paymentGate = await requestJson("/api/session/export?session_id=sess_smoke");
  assert.equal(paymentGate.status, 402);
  assert.equal((paymentGate.body.error as { code: string }).code, "PAYMENT_REQUIRED");

  const preview = await requestJson("/api/session/export?session_id=sess_smoke&payment_mode=free_preview");
  assert.equal(preview.status, 200);
  assert.equal((preview.body.data as { export_status: string }).export_status, "preview_ready");
  const previewData = preview.body.data as {
    asset: { mime_type: string; download_url: string };
    export_payload: {
      version: string;
      project_name: string;
      commercial: { pricing_mode: string };
      internal_estimate: { total_rmb: number | null; lines: unknown[] };
      chapter_plan: Array<{ id: string }>;
    };
  };
  assert.equal(previewData.export_payload.version, "v1");
  assert.equal(previewData.export_payload.project_name, "医院老机房改造一期");
  assert.equal(previewData.export_payload.commercial.pricing_mode, "manual_placeholder");
  assert.ok(previewData.export_payload.internal_estimate.lines.length > 0);
  assert.ok((previewData.export_payload.internal_estimate.total_rmb ?? 0) > 100000);
  assert.ok(
    previewData.export_payload.chapter_plan.some(
      (chapter) => chapter.id === "CHAPTER_7_COMMERCIAL_PLACEHOLDER_APPENDIX"
    )
  );
  assert.equal(previewData.asset.mime_type, "application/pdf");
  if (previewData.asset.download_url.startsWith("/api/assets/")) {
    const previewPdf = await requestBytes(previewData.asset.download_url);
    assert.equal(previewPdf.status, 200);
    assert.equal(previewPdf.body.subarray(0, 4).toString("utf8"), "%PDF");
  }

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
  assert.ok(
    formalData.layout_validation.checks.includes("docx_soffice_available:passed") ||
      formalData.layout_validation.checks.includes("docx_soffice_available:warning")
  );
  assert.ok(
    formalData.layout_validation.checks.includes("docx_pdf_rendered:passed") ||
      formalData.layout_validation.checks.includes("docx_pdf_rendered:warning")
  );
  assert.ok(
    formalData.layout_validation.checks.includes("docx_png_pages_rendered:passed") ||
      formalData.layout_validation.checks.includes("docx_png_pages_rendered:warning")
  );

  const docx = await requestBytes(formalData.asset.download_url);
  assert.equal(docx.status, 200);
  assert.equal(
    docx.headers.get("content-type"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  assert.equal(docx.body.subarray(0, 2).toString("utf8"), "PK");

  const legacySnapshotSeed = getSessionSnapshot("sess_smoke");
  saveSession({
    session_id: "sess_legacy_recovery",
    project_id: null,
    state_version: 7,
    fsm_state: "S1_CORE_EXTRACTION",
    export_status: "draft",
    dashboard_fields: legacySnapshotSeed.session.dashboard_fields,
    triggered_risks: [
      {
        id: "RULE_FLOOR_LOADING",
        legacy_id: "ERR_LOAD",
        level: "P0_BLOCKER",
        text: "Structural Loading Deficit Risk: room is above the first floor and UPS backup time is at least 120 minutes.",
        blocking: true,
        dismissible: false,
        trigger_fields: ["room_floor", "ups_backup_time_minutes"]
      },
      {
        id: "RULE_ELEVATOR_HEIGHT",
        level: "P1_HIGH",
        text: "Chassis Transport Risk: room is above the first floor; verify elevator, door opening, and turn radius.",
        blocking: false,
        dismissible: false,
        trigger_fields: ["room_floor"]
      }
    ],
    knowledge_hits: [],
    suggestion: null,
    agent_runtime: null,
    payment_willingness_99_rmb: null,
    export_payload_stale: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  const restartedServer = await startExternalApiServer();
  try {
    const restartedProject = await fetch(`${restartedServer.baseUrl}/api/projects/${projectId}`);
    assert.equal(restartedProject.status, 200);
    const restartedProjectBody = (await restartedProject.json()) as {
      data: { project: { project_id: string; project_name: string } };
    };
    assert.equal(restartedProjectBody.data.project.project_id, projectId);
    assert.equal(restartedProjectBody.data.project.project_name, "医院老机房改造一期");

    const restartedSession = await fetch(
      `${restartedServer.baseUrl}/api/session?session_id=${encodeURIComponent("sess_smoke")}`
    );
    assert.equal(restartedSession.status, 200);
    const restartedSessionBody = (await restartedSession.json()) as {
      data: { session: { session_id: string; project_id: string | null } };
    };
    assert.equal(restartedSessionBody.data.session.session_id, "sess_smoke");
    assert.equal(restartedSessionBody.data.session.project_id, projectId);

    const restartedLegacySession = await fetch(
      `${restartedServer.baseUrl}/api/session?session_id=${encodeURIComponent("sess_legacy_recovery")}`
    );
    assert.equal(restartedLegacySession.status, 200);
    const restartedLegacySessionBody = (await restartedLegacySession.json()) as {
      data: {
        session: {
          fsm_state: string;
          export_status: string;
          suggestion: { upsCapacityKva: number | null } | null;
          triggered_risks: Array<{ id: string; text: string }>;
        };
      };
    };
    assert.equal(restartedLegacySessionBody.data.session.fsm_state, "S3_READY_MONETIZATION");
    assert.equal(restartedLegacySessionBody.data.session.export_status, "ready");
    assert.equal(restartedLegacySessionBody.data.session.suggestion?.upsCapacityKva, 60);
    assert.equal(
      restartedLegacySessionBody.data.session.triggered_risks[0]?.text,
      "机房位于二层及以上，且 UPS 后备时间达到 120 分钟，需优先复核楼板承重、运输路线和加固方案。"
    );
    assert.ok(
      restartedLegacySessionBody.data.session.triggered_risks.every(
        (risk) =>
          !risk.text.includes("Structural Loading Deficit Risk") &&
          !risk.text.includes("Chassis Transport Risk")
      )
    );

    const restartedDocx = await fetch(`${restartedServer.baseUrl}${formalData.asset.download_url}`);
    assert.equal(restartedDocx.status, 200);
    const restartedDocxBody = Buffer.from(await restartedDocx.arrayBuffer());
    assert.equal(restartedDocxBody.subarray(0, 2).toString("utf8"), "PK");

    const restartedKnowledgeStatus = await fetch(`${restartedServer.baseUrl}/api/admin/knowledge/status`);
    assert.equal(restartedKnowledgeStatus.status, 200);
    const restartedKnowledgeStatusBody = (await restartedKnowledgeStatus.json()) as {
      data: {
        uploaded_file_count: number;
        pending_job_count: number;
        last_uploaded_file: { original_file_name?: string } | null;
        latest_job: { status: string; file_name: string } | null;
      };
    };
    assert.ok(restartedKnowledgeStatusBody.data.uploaded_file_count >= 1);
    assert.equal(restartedKnowledgeStatusBody.data.pending_job_count, 0);
    assert.equal(restartedKnowledgeStatusBody.data.last_uploaded_file?.original_file_name, "验收资料.md");
    assert.equal(restartedKnowledgeStatusBody.data.latest_job?.status, "completed");
    assert.equal(restartedKnowledgeStatusBody.data.latest_job?.file_name, "验收资料.md");
  } finally {
    await restartedServer.close();
  }

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
      agent_runtime: {
        response_mode: string;
        model: string | null;
        used_json_retry: boolean;
      };
    };
    assert.ok(llmChatData.ai_response.startsWith("LLM售前回复"));
    assert.deepEqual(llmChatData.quick_replies, ["确认改造范围", "补充预算上限"]);
    assert.equal(llmChatData.updated_fields.project_type, "renovation");
    assert.equal(llmChatData.updated_fields.rack_count, 6);
    assert.equal(llmChatData.agent_runtime.response_mode, "real_llm");
    assert.equal(llmChatData.agent_runtime.model, "stub-model");
    assert.equal(llmChatData.agent_runtime.used_json_retry, false);
    assert.equal(
      llmChatData.field_patches.find((patch) => patch.field_code === "project_type")?.source,
      "agent_inference"
    );
    assert.equal(llmChatData.field_patches.find((patch) => patch.field_code === "rack_count")?.new_value, 6);
    assert.equal(llmStub.requests[0].model, "stub-model");
    assert.deepEqual(llmStub.requests[0].response_format, { type: "json_object" });

    const configuredRuntimeStatus = await requestJson("/api/admin/runtime/status");
    assert.equal(configuredRuntimeStatus.status, 200);
    const configuredRuntimeStatusData = configuredRuntimeStatus.body.data as {
      agent: { llm_configured: boolean; model: string; base_url: string };
    };
    assert.equal(configuredRuntimeStatusData.agent.llm_configured, true);
    assert.equal(configuredRuntimeStatusData.agent.model, "stub-model");
    assert.equal(configuredRuntimeStatusData.agent.base_url, llmStub.baseUrl);
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
    const retryChatData = retryChat.body.data as {
      ai_response: string;
      agent_runtime: { response_mode: string; used_json_retry: boolean };
    };
    assert.equal(retryChatData.ai_response, "JSON mode retry worked.");
    assert.equal(retryChatData.agent_runtime.response_mode, "real_llm");
    assert.equal(retryChatData.agent_runtime.used_json_retry, true);
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
    const fallbackChatData = fallbackChat.body.data as {
      ai_response: string;
      agent_runtime: {
        response_mode: string;
        llm_configured: boolean;
        fallback_reason: string | null;
      };
    };
    assert.ok(fallbackChatData.ai_response.includes("按当前口径初步测算"));
    assert.ok(fallbackChatData.ai_response.includes("UPS 建议 20kVA"));
    assert.equal(fallbackChatData.agent_runtime.response_mode, "fallback");
    assert.equal(fallbackChatData.agent_runtime.llm_configured, true);
    assert.equal(fallbackChatData.agent_runtime.fallback_reason, "invalid_json");
  } finally {
    await fallbackStub.close();
    process.env.OPENAI_API_KEY = previousApiKey;
    process.env.OPENAI_BASE_URL = previousBaseUrl;
    process.env.OPENAI_MODEL = previousModel;
  }

  // ---- Account, credit, and license flow (auth enabled) ----
  const previousAuthDisabled = process.env.AUTH_DISABLED;
  process.env.AUTH_DISABLED = "";
  process.env.FREE_EXPORT_CREDITS = "1";
  try {
    const unauthorized = await requestJson("/api/projects");
    assert.equal(unauthorized.status, 401);
    assert.equal((unauthorized.body.error as { code: string }).code, "UNAUTHORIZED");

    const authMode = await requestJson("/api/auth/mode");
    assert.equal(authMode.status, 200);
    assert.equal((authMode.body.data as { auth_required: boolean }).auth_required, true);

    const adminRegister = await requestJson("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "admin@smoke.test",
        password: "admin-pass-123",
        display_name: "烟测管理员"
      })
    });
    assert.equal(adminRegister.status, 200);
    const adminRegisterData = adminRegister.body.data as {
      token: string;
      user: { role: string; export_credits: number };
    };
    assert.equal(adminRegisterData.user.role, "admin");
    const adminAuth = { authorization: `Bearer ${adminRegisterData.token}` };

    const userRegister = await requestJson("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "seller@smoke.test",
        password: "seller-pass-123",
        display_name: "售前一号"
      })
    });
    assert.equal(userRegister.status, 200);
    const userRegisterData = userRegister.body.data as {
      token: string;
      user: { user_id: string; role: string; export_credits: number };
    };
    assert.equal(userRegisterData.user.role, "user");
    assert.equal(userRegisterData.user.export_credits, 1);
    const userAuth = { authorization: `Bearer ${userRegisterData.token}` };

    const weakPassword = await requestJson("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "weak@smoke.test", password: "123" })
    });
    assert.equal(weakPassword.status, 400);

    const badLogin = await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "seller@smoke.test", password: "wrong-password" })
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await requestJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "seller@smoke.test", password: "seller-pass-123" })
    });
    assert.equal(goodLogin.status, 200);

    const me = await requestJson("/api/auth/me", { headers: userAuth });
    assert.equal(me.status, 200);
    assert.equal((me.body.data as { user: { email: string } }).user.email, "seller@smoke.test");

    const userProject = await requestJson("/api/projects", {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ name: "售前一号的项目" })
    });
    assert.equal(userProject.status, 200);
    const userProjectId = (userProject.body.data as { project: { project_id: string } }).project.project_id;

    const userChat = await requestJson("/api/session/chat", {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({
        session_id: "sess_auth_user",
        project_id: userProjectId,
        message_type: "text",
        content: "某物流公司新建机房，60平，1楼，12个机柜，UPS后备30分钟，预算100万"
      })
    });
    assert.equal(userChat.status, 200);
    const userChatData = userChat.body.data as {
      suggestion: { estimatedBomCostRmb: number | null; upsCapacityKva: number | null } | null;
      state: { export_status: string };
    };
    assert.equal(userChatData.state.export_status, "ready");
    assert.ok((userChatData.suggestion?.estimatedBomCostRmb ?? 0) > 100000);
    assert.equal(userChatData.suggestion?.upsCapacityKva, 60);

    // Cross-user isolation: the admin-created legacy projects stay invisible.
    const userProjects = await requestJson("/api/projects", { headers: userAuth });
    const userProjectList = (userProjects.body.data as { projects: Array<{ project_id: string }> }).projects;
    assert.ok(userProjectList.some((project) => project.project_id === userProjectId));
    assert.ok(!userProjectList.some((project) => project.project_id === projectId));

    const foreignProject = await requestJson(`/api/projects/${projectId}`, { headers: userAuth });
    assert.equal(foreignProject.status, 404);

    const foreignSnapshot = await requestJson("/api/session?session_id=sess_smoke", {
      headers: userAuth
    });
    assert.equal(foreignSnapshot.status, 403);

    const adminSnapshot = await requestJson("/api/session?session_id=sess_auth_user", {
      headers: adminAuth
    });
    assert.equal(adminSnapshot.status, 200);

    // Credit gate: confirmation first, then the single free credit, then 402.
    const gate = await requestJson("/api/session/export?session_id=sess_auth_user", {
      headers: userAuth
    });
    assert.equal(gate.status, 402);
    const gateBilling = (gate.body as { billing_check: { status: string; credits_balance: number } })
      .billing_check;
    assert.equal(gateBilling.status, "payment_required");
    assert.equal(gateBilling.credits_balance, 1);

    const firstExport = await requestJson("/api/session/export?session_id=sess_auth_user&approved=true", {
      headers: userAuth
    });
    assert.equal(firstExport.status, 200);
    const firstExportData = firstExport.body.data as {
      billing_check: { mode: string; credits_balance: number | null };
      asset: { mime_type: string };
    };
    assert.equal(firstExportData.billing_check.mode, "credit");
    assert.equal(firstExportData.billing_check.credits_balance, 0);
    assert.equal(
      firstExportData.asset.mime_type,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    const exhausted = await requestJson("/api/session/export?session_id=sess_auth_user&approved=true", {
      headers: userAuth
    });
    assert.equal(exhausted.status, 402);
    assert.equal((exhausted.body.error as { code: string }).code, "NO_CREDITS");

    const previewStillFree = await requestJson(
      "/api/session/export?session_id=sess_auth_user&payment_mode=free_preview",
      { headers: userAuth }
    );
    assert.equal(previewStillFree.status, 200);

    const badRedeem = await requestJson("/api/auth/redeem", {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ code: "JF-XXXXX-XXXXX" })
    });
    assert.equal(badRedeem.status, 404);

    const forbiddenLicense = await requestJson("/api/admin/licenses", {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ count: 1, credits: 5 })
    });
    assert.equal(forbiddenLicense.status, 403);

    const licenseCreate = await requestJson("/api/admin/licenses", {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({ count: 2, credits: 5, note: "smoke 渠道包" })
    });
    assert.equal(licenseCreate.status, 200);
    const licenses = (licenseCreate.body.data as { licenses: Array<{ code: string; credits: number }> })
      .licenses;
    assert.equal(licenses.length, 2);
    assert.ok(licenses[0].code.startsWith("JF-"));

    const redeem = await requestJson("/api/auth/redeem", {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ code: licenses[0].code })
    });
    assert.equal(redeem.status, 200);
    const redeemData = redeem.body.data as {
      credits_added: number;
      balance_after: number;
      user: { export_credits: number };
    };
    assert.equal(redeemData.credits_added, 5);
    assert.equal(redeemData.balance_after, 5);
    assert.equal(redeemData.user.export_credits, 5);

    const reusedRedeem = await requestJson("/api/auth/redeem", {
      method: "POST",
      headers: userAuth,
      body: JSON.stringify({ code: licenses[0].code })
    });
    assert.equal(reusedRedeem.status, 409);

    const paidExport = await requestJson("/api/session/export?session_id=sess_auth_user&approved=true", {
      headers: userAuth
    });
    assert.equal(paidExport.status, 200);
    assert.equal(
      (paidExport.body.data as { billing_check: { credits_balance: number | null } }).billing_check
        .credits_balance,
      4
    );

    const grant = await requestJson("/api/admin/users/grant", {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({ user_id: userRegisterData.user.user_id, credits: 3 })
    });
    assert.equal(grant.status, 200);
    assert.equal((grant.body.data as { balance_after: number }).balance_after, 7);

    const adminUsers = await requestJson("/api/admin/users", { headers: adminAuth });
    assert.equal(adminUsers.status, 200);
    const adminUserList = (adminUsers.body.data as { users: Array<{ email: string }> }).users;
    assert.ok(adminUserList.some((entry) => entry.email === "admin@smoke.test"));
    assert.ok(adminUserList.some((entry) => entry.email === "seller@smoke.test"));

    const adminLicenses = await requestJson("/api/admin/licenses", { headers: adminAuth });
    assert.equal(adminLicenses.status, 200);
    const adminLicenseList = (
      adminLicenses.body.data as { licenses: Array<{ code: string; status: string }> }
    ).licenses;
    assert.equal(adminLicenseList.find((entry) => entry.code === licenses[0].code)?.status, "redeemed");

    // Admin exports bypass the credit debit but still pass the approval gate.
    const adminProject = await requestJson("/api/projects", {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({ name: "管理员验证项目" })
    });
    const adminProjectId = (adminProject.body.data as { project: { project_id: string } }).project.project_id;
    await requestJson("/api/session/chat", {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        session_id: "sess_auth_admin",
        project_id: adminProjectId,
        message_type: "text",
        content: "某园区机房，40平，1楼，8个机柜，UPS后备15分钟"
      })
    });
    const adminExport = await requestJson("/api/session/export?session_id=sess_auth_admin&approved=true", {
      headers: adminAuth
    });
    assert.equal(adminExport.status, 200);
  } finally {
    process.env.AUTH_DISABLED = previousAuthDisabled;
    delete process.env.FREE_EXPORT_CREDITS;
  }

  console.log("API smoke test passed.");
} finally {
  server.close();
  rmSync(smokeRoot, { recursive: true, force: true });
}
