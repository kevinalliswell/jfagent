import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STRUCTURAL_NOTE,
  evaluateRiskIds,
  inferStateFromFields
} from "../src/mockSessionDerivation.ts";
import { buildPresalesCockpit } from "../src/presalesCockpit.ts";
import type {
  DashboardField,
  FieldPatch,
  KnowledgeHit,
  ProjectContext,
  RiskFlag,
  SessionSnapshot,
  SuggestionSummary
} from "../src/types";

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

function makeSession({
  project = null,
  risks = [],
  hits = [],
  suggestion = null,
  exportStatus = "draft"
}: {
  project?: ProjectContext | null;
  risks?: RiskFlag[];
  hits?: KnowledgeHit[];
  suggestion?: SuggestionSummary | null;
  exportStatus?: SessionSnapshot["export_status"];
} = {}): SessionSnapshot {
  return {
    session_id: "sess_test",
    state_version: 2,
    fsm_state: "S2_PROACTIVE_INQUIRIES",
    export_status: exportStatus,
    completion: 65,
    messages: [],
    quick_replies: [],
    dashboard_fields: {
      customer_name: field("customer_name", "客户名称"),
      customer_industry: field("customer_industry", "客户行业"),
      project_type: field("project_type", "项目类型"),
      room_area_m2: field("room_area_m2", "机房面积"),
      room_floor: field("room_floor", "所在楼层"),
      rack_count: field("rack_count", "计划机柜数"),
      ups_backup_time_minutes: field("ups_backup_time_minutes", "UPS后备时间"),
      brand_preference: field("brand_preference", "品牌偏好"),
      budget_range_high_rmb: field("budget_range_high_rmb", "项目预算范围")
    },
    triggered_risks: risks,
    suggestion,
    knowledge_hits: hits,
    export_asset: null,
    project,
    agent_runtime: null
  };
}

test("没有项目时驾驶舱应提示先进入项目上下文", () => {
  const cockpit = buildPresalesCockpit(makeSession());

  assert.equal(cockpit.hasProject, false);
  assert.equal(cockpit.nextAction, "先创建或选择项目，再录入客户原话。");
  assert.equal(cockpit.deliverable.tone, "blocked");
  assert.equal(cockpit.completenessGroups[0]?.missing[0], "客户名称");
});

test("存在阻塞风险时驾驶舱应优先提示清障", () => {
  const session = makeSession({
    project: {
      project_id: "proj_test",
      project_name: "测试项目",
      stage: "clarifying"
    },
    risks: [
      {
        id: "RULE_FLOOR_LOADING",
        level: "P0_BLOCKER",
        text: "必须先复核楼板承重。",
        blocking: true,
        dismissible: false,
        trigger_fields: ["room_floor", "ups_backup_time_minutes"]
      }
    ]
  });

  session.dashboard_fields.customer_name = field("customer_name", "客户名称", "测试医院");
  session.dashboard_fields.project_type = field("project_type", "项目类型", "老机房改造");
  session.dashboard_fields.room_floor = field("room_floor", "所在楼层", 3, "3 楼");
  session.dashboard_fields.ups_backup_time_minutes = field(
    "ups_backup_time_minutes",
    "UPS后备时间",
    120,
    "120 分钟"
  );

  const cockpit = buildPresalesCockpit(session);

  assert.equal(cockpit.riskSummary.blockingCount, 1);
  assert.equal(cockpit.nextAction, "先清掉阻塞风险，再决定是否进入正式交付整理。");
  assert.equal(cockpit.deliverable.tone, "blocked");
});

test("核心字段齐备且无阻塞时应进入可整理交付状态", () => {
  const session = makeSession({
    project: {
      project_id: "proj_ready",
      project_name: "人民医院扩容",
      stage: "solution_ready"
    },
    hits: [
      {
        id: "hit_1",
        title: "UPS 方案模板",
        source_type: "template",
        score: 0.92,
        excerpt: "双路供电 + N+1 UPS",
        retrieval_method: "hybrid"
      },
      {
        id: "hit_2",
        title: "历史报价",
        source_type: "quotation",
        score: 0.88,
        excerpt: "40kVA UPS 及电池包",
        retrieval_method: "keyword"
      }
    ],
    suggestion: {
      upsCapacityKva: 40,
      batteryRuntimeMinutes: 120,
      coolingModelKw: 40,
      coolingRedundancy: "N+1",
      pduNote: "建议 A/B 路 PDU。",
      structuralNote: "楼板与运输路线已纳入复核。",
      stale: false
    },
    exportStatus: "ready"
  });

  session.dashboard_fields.customer_name = field("customer_name", "客户名称", "某市人民医院");
  session.dashboard_fields.customer_industry = field("customer_industry", "客户行业", "医疗");
  session.dashboard_fields.project_type = field("project_type", "项目类型", "扩容改造");
  session.dashboard_fields.room_area_m2 = field("room_area_m2", "机房面积", 60, "60 平");
  session.dashboard_fields.room_floor = field("room_floor", "所在楼层", 1, "1 楼");
  session.dashboard_fields.rack_count = field("rack_count", "计划机柜数", 10, "10 柜");
  session.dashboard_fields.ups_backup_time_minutes = field(
    "ups_backup_time_minutes",
    "UPS后备时间",
    120,
    "120 分钟"
  );
  session.dashboard_fields.brand_preference = field("brand_preference", "品牌偏好", "维谛");

  const cockpit = buildPresalesCockpit(session);

  assert.equal(cockpit.deliverable.tone, "ready");
  assert.equal(cockpit.deliverable.label, "可整理交付稿");
  assert.equal(cockpit.evidenceSummary.commercialHitCount, 1);
  assert.equal(cockpit.completenessGroups[0]?.captured, 3);
  assert.equal(cockpit.completenessGroups[1]?.captured, 3);
});

test("mock 风险推导在仅补机柜数量时不应无条件触发楼层相关风险", () => {
  const patches: FieldPatch[] = [
    {
      field_code: "rack_count",
      old_value: null,
      new_value: 10,
      source: "button_chip",
      confidence: 0.95,
      needs_confirmation: false
    }
  ];

  assert.deepEqual(evaluateRiskIds(makeSession().dashboard_fields, patches), []);
});

test("mock 默认结构说明文案应与 backend 保持一致", () => {
  assert.equal(DEFAULT_STRUCTURAL_NOTE, "长延时电池方案需复核楼板承重与运输路线。");
});

test("mock 状态推导在仅补预算时应保持核心抽取草稿态", () => {
  const patches: FieldPatch[] = [
    {
      field_code: "budget_range_high_rmb",
      old_value: null,
      new_value: 300000,
      source: "user_message",
      confidence: 0.9,
      needs_confirmation: false
    }
  ];

  assert.deepEqual(inferStateFromFields(makeSession().dashboard_fields, patches), {
    fsm_state: "S1_CORE_EXTRACTION",
    export_status: "draft"
  });
});

test("mock 状态推导在仅补机柜数量时应进入主动澄清草稿态", () => {
  const patches: FieldPatch[] = [
    {
      field_code: "rack_count",
      old_value: null,
      new_value: 10,
      source: "button_chip",
      confidence: 0.95,
      needs_confirmation: false
    }
  ];

  assert.deepEqual(inferStateFromFields(makeSession().dashboard_fields, patches), {
    fsm_state: "S2_PROACTIVE_INQUIRIES",
    export_status: "draft"
  });
});
