import assert from "node:assert/strict";
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

  console.log("API smoke test passed.");
} finally {
  server.close();
}
