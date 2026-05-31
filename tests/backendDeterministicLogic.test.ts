import assert from "node:assert/strict";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const testRoot = mkdtempSync(resolve(tmpdir(), "jfagent-deterministic-"));
process.env.JFAGENT_DATA_DIR = resolve(testRoot, "data");
process.env.JFAGENT_OUTPUT_DIR = resolve(testRoot, "output/doc");
process.env.JFAGENT_UPLOAD_DIR = resolve(testRoot, "knowledge/uploads");

process.on("exit", () => {
  rmSync(testRoot, { recursive: true, force: true });
});

const { postSessionChat } = await import("../server-dist/sessionService.js");
const { buildExportPayload } = await import("../server-dist/exportPayload.js");

import type { BackendProject, BackendSession, DashboardField, RiskFlag } from "../server/types.ts";

function field(
  code: string,
  label: string,
  value: string | number | null = null,
  displayValue = value === null ? "待确认" : String(value)
): DashboardField {
  return {
    code,
    label,
    value,
    displayValue,
    source: value === null ? "pending" : "user_message",
    confidence: value === null ? 0 : 0.9,
    needs_confirmation: value === null,
    riskLinked: false
  };
}

function makeSession(overrides: Partial<BackendSession> = {}): BackendSession {
  return {
    session_id: "sess_export_payload",
    project_id: "proj_export_payload",
    state_version: 2,
    fsm_state: "S3_READY_MONETIZATION",
    export_status: "ready",
    dashboard_fields: {
      customer_name: field("customer_name", "客户名称", "某市人民医院"),
      customer_industry: field("customer_industry", "客户行业", "medical", "医疗"),
      project_type: field("project_type", "项目类型", "renovation", "老机房改造"),
      room_area_m2: field("room_area_m2", "机房面积", 50, "50 m2"),
      room_floor: field("room_floor", "所在楼层", 3, "3 楼"),
      rack_count: field("rack_count", "计划机柜数", 10, "10 台"),
      ups_backup_time_minutes: field("ups_backup_time_minutes", "UPS后备时间", 120, "120 分钟")
    },
    triggered_risks: [],
    knowledge_hits: [],
    suggestion: {
      upsCapacityKva: 40,
      batteryRuntimeMinutes: 120,
      coolingModelKw: 40,
      coolingRedundancy: "N+1",
      pduNote: "建议 A/B 路 PDU。",
      structuralNote: "长延时电池方案需复核楼板承重与运输路线。",
      stale: false
    },
    agent_runtime: null,
    payment_willingness_99_rmb: null,
    export_payload_stale: false,
    created_at: "2026-05-31T00:00:00.000Z",
    updated_at: "2026-05-31T00:00:00.000Z",
    ...overrides
  };
}

function floorLoadingRisk(): RiskFlag {
  return {
    id: "RULE_FLOOR_LOADING",
    legacy_id: "ERR_LOAD",
    level: "P0_BLOCKER",
    text: "机房位于二层及以上，且 UPS 后备时间达到 120 分钟，需优先复核楼板承重、运输路线和加固方案。",
    blocking: true,
    dismissible: false,
    trigger_fields: ["room_floor", "ups_backup_time_minutes"]
  };
}

test("postSessionChat 应从项目简述中抽取核心工程字段", async () => {
  const result = await postSessionChat({
    session_id: "sess_extract_logic",
    message_type: "text",
    content: "某医院老机房改造，50平，3楼，UPS后备2小时，10个机柜，预算30万，国产优先"
  });

  assert.equal(result.data.updated_fields.customer_name, "某医院");
  assert.equal(result.data.updated_fields.customer_industry, "medical");
  assert.equal(result.data.updated_fields.project_type, "renovation");
  assert.equal(result.data.updated_fields.room_area_m2, 50);
  assert.equal(result.data.updated_fields.room_floor, 3);
  assert.equal(result.data.updated_fields.ups_backup_time_minutes, 120);
  assert.equal(result.data.updated_fields.rack_count, 10);
  assert.equal(result.data.updated_fields.budget_range_high_rmb, 300000);
  assert.equal(result.data.updated_fields.brand_preference, "国产优先");
});

test("postSessionChat 应在高楼层长延时场景触发承重和搬运风险", async () => {
  const result = await postSessionChat({
    session_id: "sess_risk_logic",
    message_type: "text",
    content: "某医院机房改造在3楼，UPS后备2小时，计划10个机柜"
  });

  assert.deepEqual(
    result.data.triggered_risks.map((risk) => risk.id),
    ["RULE_FLOOR_LOADING", "RULE_ELEVATOR_HEIGHT"]
  );
  assert.equal(result.data.state.fsm_state, "S2_PROACTIVE_INQUIRIES");
  assert.equal(result.data.state.export_status, "draft");
});

test("buildExportPayload 应将绑定项目名称视为已解决字段并生成结构加固章节", () => {
  const session = makeSession({
    triggered_risks: [floorLoadingRisk()]
  });
  const project: BackendProject = {
    project_id: "proj_export_payload",
    project_name: "人民医院机房改造一期",
    stage: "solution_ready",
    primary_session_id: session.session_id,
    updated_at: "2026-05-31T00:00:00.000Z",
    created_at: "2026-05-31T00:00:00.000Z",
    dashboard_snapshot: {}
  };

  const payload = buildExportPayload(session, project, {
    generated_at: "2026-05-31T10:00:00.000Z"
  });

  assert.equal(payload.project_name, "人民医院机房改造一期");
  assert.ok(!payload.validation.missing_required_fields.includes("project_name"));
  assert.ok(!payload.open_items.some((item) => item.field_code === "project_name"));
  assert.equal(payload.render_flags.chapter_2_required, true);
  assert.ok(
    payload.chapter_plan.some((chapter) => chapter.id === "CHAPTER_2_CIVIL_STRUCTURAL_REINFORCEMENT")
  );
});
