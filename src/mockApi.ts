import type {
  AgentRuntimeSummary,
  ChatResponseData,
  DashboardField,
  ExportResponseData,
  FieldPatch,
  FsmState,
  KnowledgeHit,
  OverrideResponseData,
  PaymentRequiredError,
  ProjectContext,
  ProjectDetail,
  ProjectSummary,
  RiskFlag,
  SessionSnapshotData,
  SessionSnapshot,
  SuccessEnvelope
} from "./types";
import { searchKnowledge } from "./localVectorSearch";
import { DEFAULT_STRUCTURAL_NOTE, evaluateRiskIds, inferStateFromFields } from "./mockSessionDerivation";

const now = () => new Date().toISOString();
const wait = (ms = 420) => new Promise((resolve) => window.setTimeout(resolve, ms));

const mockAgentRuntime: AgentRuntimeSummary = {
  response_mode: "fallback",
  llm_configured: false,
  provider_name: "mock",
  model: null,
  base_url: null,
  used_json_retry: false,
  fallback_reason: "not_configured",
  fallback_message: "当前为本地演示模式，尚未连接模型服务。",
  responded_at: now()
};

const field = (
  code: string,
  label: string,
  displayValue = "待确认",
  value: string | number | null = null
): DashboardField => ({
  code,
  label,
  value,
  displayValue,
  source: "pending",
  confidence: 0,
  needs_confirmation: true
});

const defaultMockProjects: ProjectSummary[] = [
  {
    project_id: "proj_seed_hospital",
    project_name: "某市人民医院机房建设项目",
    stage: "solution_ready",
    primary_session_id: "sess_seed_hospital",
    updated_at: now()
  },
  {
    project_id: "proj_seed_gov",
    project_name: "区政务云中心扩容项目",
    stage: "clarifying",
    primary_session_id: null,
    updated_at: now()
  },
  {
    project_id: "proj_seed_factory",
    project_name: "某工厂利旧改造项目",
    stage: "intake",
    primary_session_id: null,
    updated_at: now()
  }
];

let mockProjects = defaultMockProjects.map((project) => ({ ...project }));

export const initialSession: SessionSnapshot = {
  session_id: "sess_seed_hospital",
  state_version: 1,
  fsm_state: "S0_IDLE",
  export_status: "draft",
  completion: 40,
  messages: [
    {
      id: "msg_welcome",
      sender: "ai",
      text: "没事，先把机房项目线索丢给我。我会先按本地知识库整理需求预览，再根据完整度、风险和资料依据推进正式交付稿。",
      timestamp: now()
    }
  ],
  quick_replies: ["医院/50平/3楼/国产UPS延时2小时"],
  dashboard_fields: {
    customer_name: field("customer_name", "客户名称"),
    project_name: field("project_name", "项目名称"),
    customer_industry: field("customer_industry", "客户行业"),
    project_type: field("project_type", "项目类型"),
    room_area_m2: field("room_area_m2", "机房面积"),
    room_floor: field("room_floor", "所在楼层"),
    rack_count: field("rack_count", "计划机柜数"),
    server_count: field("server_count", "服务器数量"),
    avg_power_per_rack_kw: field("avg_power_per_rack_kw", "单柜平均功率"),
    redundancy_mode: field("redundancy_mode", "UPS冗余模式"),
    ups_backup_time_minutes: field("ups_backup_time_minutes", "UPS后备时间"),
    cooling_redundancy: field("cooling_redundancy", "制冷冗余模式"),
    budget_range_low_rmb: field("budget_range_low_rmb", "项目预算下限"),
    brand_preference: field("brand_preference", "品牌偏好"),
    budget_range_high_rmb: field("budget_range_high_rmb", "项目预算范围"),
    delivery_city: field("delivery_city", "交付城市"),
    expected_delivery_date: field("expected_delivery_date", "期望交付时间")
  },
  triggered_risks: [],
  suggestion: null,
  knowledge_hits: searchKnowledge("机房 UPS 精密空调 需求表", 3),
  export_asset: null,
  agent_runtime: { ...mockAgentRuntime },
  project: {
    project_id: "proj_seed_hospital",
    project_name: "某市人民医院机房建设项目",
    stage: "solution_ready"
  }
};

const riskFloorLoading: RiskFlag = {
  id: "RULE_FLOOR_LOADING",
  legacy_id: "ERR_LOAD",
  level: "P0_BLOCKER",
  text: "机房位于二层及以上，且 UPS 后备时间达到 120 分钟，需优先复核楼板承重、运输路线和加固方案。",
  blocking: true,
  dismissible: false,
  trigger_fields: ["room_floor", "ups_backup_time_minutes"]
};

const riskElevatorHeight: RiskFlag = {
  id: "RULE_ELEVATOR_HEIGHT",
  level: "P1_HIGH",
  text: "二层及以上机房需核实电梯高度、门洞尺寸和转弯半径，必要时提前规划吊装与搬运方案。",
  blocking: false,
  dismissible: false,
  trigger_fields: ["room_floor"]
};

const riskBudgetMismatch: RiskFlag = {
  id: "RULE_BUDGET_MISMATCH",
  level: "P1_HIGH",
  text: "当前预算可能低于设备与施工综合成本安全线，建议同时准备可靠性优先和预算优先两档方案。",
  blocking: false,
  dismissible: false,
  trigger_fields: ["budget_range_high_rmb"]
};

const patch = (
  field_code: string,
  old_value: string | number | null,
  new_value: string | number | null,
  source: FieldPatch["source"],
  confidence = 0.92,
  needs_confirmation = false
): FieldPatch => ({
  field_code,
  old_value,
  new_value,
  source,
  confidence,
  needs_confirmation
});

const extractNumber = (input: string, fallback: number) => {
  const match = input.match(/\d+/);
  return match ? Number(match[0]) : fallback;
};

const formatMoney = (value: number) => `${Math.round(value / 10000)} 万`;

function firstNumberAfter(text: string, keywords: string[]) {
  for (const keyword of keywords) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const beforeKeyword = text.match(new RegExp(`(\\d+)\\s*${escapedKeyword}`));
    if (beforeKeyword) return Number(beforeKeyword[1]);
    const afterKeyword = text.match(new RegExp(`${escapedKeyword}\\s*(\\d+)`));
    if (afterKeyword) return Number(afterKeyword[1]);
    const index = text.indexOf(keyword);
    if (index >= 0) {
      const windowText = text.slice(Math.max(0, index - 6), index + keyword.length + 10);
      const match = windowText.match(/\d+/);
      if (match) return Number(match[0]);
    }
  }
  return null;
}

function extractProjectType(text: string) {
  if (/改造|升级|老机房|利旧/.test(text)) return "renovation";
  if (/新建|新做|建设|从零/.test(text)) return "new_build";
  if (/扩容|增加|加几台/.test(text)) return "expansion";
  if (/搬迁|迁移/.test(text)) return "migration";
  return null;
}

function projectTypeLabel(value: string | number | null) {
  const map: Record<string, string> = {
    renovation: "老机房改造",
    new_build: "新建机房",
    expansion: "扩容改造",
    migration: "搬迁迁移"
  };
  return value ? (map[String(value)] ?? String(value)) : "待确认";
}

function inferKnowledgeHits(text: string): KnowledgeHit[] {
  return searchKnowledge(text, 3);
}

function inferRackCountFromArea(area: number | null) {
  if (!area) return null;
  if (area < 15) return 3;
  if (area <= 30) return 6;
  if (area <= 60) return 10;
  if (area <= 120) return 20;
  return null;
}

function buildSuggestion(rackCount: number, stale = false) {
  const itLoad = rackCount * 3;
  const upsRaw = itLoad * 1.25;
  const upsCapacityKva = upsRaw <= 40 ? 40 : Math.ceil(upsRaw / 20) * 20;
  const coolingModelKw = rackCount <= 12 ? 40 : 60;

  return {
    upsCapacityKva,
    batteryRuntimeMinutes: 120,
    coolingModelKw,
    coolingRedundancy: "N+1",
    pduNote: `${rackCount}台机柜建议按A/B路PDU预留，配电柜输出回路待深化。`,
    structuralNote: DEFAULT_STRUCTURAL_NOTE,
    stale
  };
}

function evaluateRisks(session: SessionSnapshot, patches: FieldPatch[] = []) {
  return evaluateRiskIds(session.dashboard_fields, patches).map((riskId) => {
    if (riskId === riskFloorLoading.id) return riskFloorLoading;
    if (riskId === riskElevatorHeight.id) return riskElevatorHeight;
    return riskBudgetMismatch;
  });
}

function response<T>(sessionId: string, version: number, data: T): SuccessEnvelope<T> {
  return {
    ok: true,
    session_id: sessionId,
    state_version: version,
    server_time: now(),
    data
  };
}

function cloneProjectContext(project: ProjectContext | null) {
  return project ? { ...project } : null;
}

function cloneDashboardFields(fields: SessionSnapshot["dashboard_fields"]) {
  return Object.fromEntries(Object.entries(fields).map(([code, field]) => [code, { ...field }]));
}

function cloneKnowledgeHits(hits: KnowledgeHit[]) {
  return hits.map((hit) => ({ ...hit }));
}

function cloneTriggeredRisks(risks: RiskFlag[]) {
  return risks.map((risk) => ({
    ...risk,
    trigger_fields: [...risk.trigger_fields]
  }));
}

function cloneSuggestion(suggestion: SessionSnapshot["suggestion"]) {
  return suggestion ? { ...suggestion } : null;
}

function cloneAgentRuntime(agentRuntime: AgentRuntimeSummary | null) {
  return agentRuntime ? { ...agentRuntime } : null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await wait(120);
  return mockProjects
    .slice()
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .map((project) => ({ ...project }));
}

export async function createProject(name?: string): Promise<ProjectSummary> {
  await wait(160);
  const project: ProjectSummary = {
    project_id: `proj_mock_${Math.random().toString(16).slice(2, 10)}`,
    project_name: name?.trim() || `未命名项目 ${new Date().toISOString().slice(0, 10)}`,
    stage: "intake",
    primary_session_id: null,
    updated_at: now()
  };
  mockProjects = [project, ...mockProjects];
  return { ...project };
}

export async function getSessionSnapshot(sessionId: string): Promise<SessionSnapshotData> {
  await wait(120);
  if (sessionId !== initialSession.session_id) {
    throw new Error("当前示例项目还没有可恢复的项目资料。");
  }

  return {
    session: {
      session_id: initialSession.session_id,
      project_id: initialSession.project?.project_id ?? null,
      state_version: initialSession.state_version,
      fsm_state: initialSession.fsm_state,
      export_status: initialSession.export_status,
      dashboard_fields: cloneDashboardFields(initialSession.dashboard_fields),
      triggered_risks: cloneTriggeredRisks(initialSession.triggered_risks),
      knowledge_hits: cloneKnowledgeHits(initialSession.knowledge_hits),
      suggestion: cloneSuggestion(initialSession.suggestion),
      agent_runtime: cloneAgentRuntime(initialSession.agent_runtime)
    },
    project: cloneProjectContext(initialSession.project)
  };
}

export async function getProjectDetail(projectId: string): Promise<ProjectDetail> {
  await wait(120);
  const project = mockProjects.find((item) => item.project_id === projectId);
  if (!project) {
    throw new Error("当前示例项目不存在。");
  }

  return {
    ...project,
    created_at: project.updated_at,
    dashboard_snapshot:
      initialSession.project?.project_id === projectId
        ? cloneDashboardFields(initialSession.dashboard_fields)
        : {}
  };
}

export async function postSessionChat(params: {
  session: SessionSnapshot;
  message_type: "text" | "voice" | "file";
  content: string;
}): Promise<SuccessEnvelope<ChatResponseData>> {
  await wait();
  const { session, content } = params;
  const text = content.trim();
  const version = session.state_version + 1;
  const area = firstNumberAfter(text, ["平方", "平", "m2", "㎡"]);
  const floor = firstNumberAfter(text, ["楼", "层"]);
  const backupHours = firstNumberAfter(text, ["小时", "h"]);
  const backupMinutes = backupHours ? backupHours * 60 : firstNumberAfter(text, ["分钟", "后备", "延时"]);
  const rackMention = firstNumberAfter(text, ["机柜", "柜子", "rack"]);
  const projectType = extractProjectType(text);
  const customerMatch = text.match(/某?[\u4e00-\u9fa5A-Za-z0-9]{1,12}(医院|学校|中心|公司|工厂|园区)/);
  const customerName = customerMatch?.[0] ?? null;
  const industry = text.includes("医院") ? "medical" : text.includes("学校") ? "education" : null;
  const hasMepSignal = /UPS|后备|电池|电瓶|空调|冷机|精密空调|动环|消防|配电/i.test(text);
  const isProjectSignal =
    Boolean(projectType || area || customerName || rackMention || hasMepSignal) ||
    text.includes("机房") ||
    text.includes("数据中心");
  const isRackAnswer = text.includes("机柜") || text.includes("服务器");
  const isBudget = text.includes("预算") || text.includes("万") || text.includes("钱");
  const knowledgeHits = inferKnowledgeHits(text);

  if (isBudget) {
    const budgetWan = firstNumberAfter(text, ["预算", "万", "钱"]) ?? 30;
    const budgetRmb = budgetWan * 10000;
    const fieldPatches = [patch("budget_range_high_rmb", null, budgetRmb, "user_message", 0.9)];
    const risks = evaluateRisks(session, fieldPatches);
    const nextState = inferStateFromFields(session.dashboard_fields, fieldPatches);
    const data: ChatResponseData = {
      ai_response: risks.some((risk) => risk.id === riskBudgetMismatch.id)
        ? "收到预算上限。这个金额可能压不住当前配置，我会在方案里准备可靠性优先和预算优先两档平替建议。"
        : "收到预算口径，我会把预算约束带入后续方案说明。",
      quick_replies: ["整理交付稿", "调整机柜/UPS/空调"],
      updated_fields: { budget_range_high_rmb: budgetRmb },
      field_patches: fieldPatches,
      triggered_risks: risks,
      knowledge_hits: session.knowledge_hits,
      project: cloneProjectContext(session.project),
      state: {
        fsm_state: nextState.fsm_state,
        export_status: nextState.export_status,
        calculation_status: "provisional"
      },
      suggestion: session.suggestion ? { ...session.suggestion, stale: true } : buildSuggestion(10, true),
      agent_runtime: { ...mockAgentRuntime, responded_at: now() }
    };
    return response(session.session_id, version, data);
  }

  if (isRackAnswer) {
    const rackCount = text.includes("20") || text.includes("30") || text.includes("服务器") ? 5 : 10;
    const fieldPatches = [patch("rack_count", null, rackCount, "button_chip", 0.95)];
    const nextState = inferStateFromFields(session.dashboard_fields, fieldPatches);
    const data: ChatResponseData = {
      ai_response:
        "核心规模口径已对齐。我已经按当前机柜数量重算出 UPS、电池后备和精密空调建议，现在可以开始整理交付稿。",
      quick_replies: ["整理交付稿", "补充项目预算", "调整机柜/UPS/空调"],
      updated_fields: { rack_count: rackCount },
      field_patches: fieldPatches,
      triggered_risks: evaluateRisks(session, fieldPatches),
      knowledge_hits: session.knowledge_hits.length ? session.knowledge_hits : knowledgeHits,
      project: cloneProjectContext(session.project),
      state: {
        fsm_state: nextState.fsm_state,
        export_status: nextState.export_status,
        calculation_status: "provisional"
      },
      suggestion: buildSuggestion(rackCount),
      agent_runtime: { ...mockAgentRuntime, responded_at: now() }
    };
    return response(session.session_id, version, data);
  }

  if (isProjectSignal) {
    const inferredRackCount = rackMention ?? inferRackCountFromArea(area);
    const patches: FieldPatch[] = [];
    if (customerName) patches.push(patch("customer_name", null, customerName, "user_message", 0.86));
    if (industry) patches.push(patch("customer_industry", null, industry, "user_message", 0.88));
    if (projectType) patches.push(patch("project_type", null, projectType, "user_message", 0.9));
    if (area) patches.push(patch("room_area_m2", null, area, "user_message", 0.94));
    if (floor) patches.push(patch("room_floor", null, floor, "user_message", 0.94));
    if (backupMinutes) {
      patches.push(patch("ups_backup_time_minutes", null, backupMinutes, "user_message", 0.95));
    }
    if (/国产/.test(text)) patches.push(patch("brand_preference", null, "国产优先", "user_message", 0.88));
    if (rackMention) {
      patches.push(patch("rack_count", null, rackMention, "user_message", 0.9));
    } else if (inferredRackCount) {
      patches.push(patch("rack_count", null, inferredRackCount, "agent_inference", 0.55, true));
    } else {
      patches.push(patch("rack_count", null, null, "agent_inference", 0.2, true));
    }

    const risks = evaluateRisks(session, patches);
    const suggestion = inferredRackCount && backupMinutes ? buildSuggestion(inferredRackCount) : null;
    const nextState = inferStateFromFields(session.dashboard_fields, patches);
    const stateReady = nextState.fsm_state === "S3_READY_MONETIZATION";
    const data: ChatResponseData = {
      ai_response: stateReady
        ? `我先按${customerName ?? "这个项目"}${projectType ? `/${projectTypeLabel(projectType)}` : ""}整理出一版可预览需求：面积${area ? `约${area}平方米` : "待确认"}，规模先按${inferredRackCount}台机柜口径，已命中${knowledgeHits.length}条内部资料。现在可以先看预览稿，也可以继续补预算。`
        : `收到，我先把能确定的线索整理进项目资料，并从本地知识库命中了${knowledgeHits.length}条资料。现在还差最影响报价的规模口径：大概多少机柜或服务器？`,
      quick_replies: stateReady
        ? ["整理交付稿", "补充项目预算", "调整机柜/UPS/空调"]
        : ["计划放置 10 个标准机柜", "大约 20~30 台服务器", "不确定，按面积估算"],
      updated_fields: {
        customer_name: customerName,
        customer_industry: industry,
        project_type: projectType,
        room_area_m2: area,
        room_floor: floor,
        ups_backup_time_minutes: backupMinutes,
        brand_preference: /国产/.test(text) ? "国产优先" : null,
        rack_count: inferredRackCount
      },
      field_patches: patches,
      triggered_risks: risks,
      knowledge_hits: knowledgeHits,
      project: cloneProjectContext(session.project),
      state: {
        fsm_state: nextState.fsm_state,
        export_status: nextState.export_status,
        calculation_status: "provisional"
      },
      suggestion,
      agent_runtime: { ...mockAgentRuntime, responded_at: now() }
    };
    return response(session.session_id, version, data);
  }

  const data: ChatResponseData = {
    ai_response: "这个补充已记入项目资料。若它影响机柜、UPS、空调或预算，我会同步刷新方案建议和交付内容。",
    quick_replies: session.quick_replies.length ? session.quick_replies : ["整理交付稿", "补充项目预算"],
    updated_fields: {},
    field_patches: [],
    triggered_risks: session.triggered_risks,
    knowledge_hits: session.knowledge_hits,
    project: cloneProjectContext(session.project),
    state: {
      fsm_state: session.fsm_state,
      export_status: session.export_status,
      calculation_status: "provisional"
    },
    suggestion: session.suggestion,
    agent_runtime: { ...mockAgentRuntime, responded_at: now() }
  };
  return response(session.session_id, version, data);
}

export async function postSessionOverride(params: {
  session: SessionSnapshot;
  field_code: string;
  value: string;
}): Promise<SuccessEnvelope<OverrideResponseData>> {
  await wait(320);
  const { session, field_code, value } = params;
  const version = session.state_version + 1;
  const oldValue = session.dashboard_fields[field_code]?.value ?? null;
  let normalized: string | number | null = value.trim() || null;

  if (
    [
      "room_area_m2",
      "room_floor",
      "rack_count",
      "server_count",
      "avg_power_per_rack_kw",
      "ups_backup_time_minutes",
      "budget_range_low_rmb",
      "budget_range_high_rmb"
    ].includes(field_code)
  ) {
    normalized = normalized ? extractNumber(String(normalized), 0) : null;
    if (field_code === "budget_range_high_rmb" && normalized && normalized < 1000) {
      normalized = Number(normalized) * 10000;
    }
  }

  const rackCount =
    field_code === "rack_count" && typeof normalized === "number"
      ? normalized
      : Number(session.dashboard_fields.rack_count?.value || 10);
  const fieldLabel = session.dashboard_fields[field_code]?.label ?? field_code;
  const suggestion = buildSuggestion(rackCount, true);
  const risks = evaluateRisks(session, [patch(field_code, oldValue, normalized, "dashboard_edit", 1, false)]);

  const data: OverrideResponseData = {
    sync_status: "synced",
    field_code,
    normalized_value: normalized,
    old_value: oldValue,
    source: "dashboard_edit",
    confidence: 1,
    llm_context_injected: true,
    llm_context_injection_id: `ctxinj_${Date.now()}`,
    export_payload_stale: true,
    recomputed_outputs: {
      total_it_load_kw: rackCount * 3,
      recommended_ups_capacity_kva: suggestion.upsCapacityKva,
      recommended_precision_ac_model_kw: suggestion.coolingModelKw
    },
    triggered_risks: risks,
    agent_silent_event: {
      event: "onDashboardFieldCommit",
      field_code,
      old_value: oldValue,
      new_value: normalized
    },
    ai_notice: `已更新「${fieldLabel}」，并同步到项目资料。`,
    suggestion
  };

  return response(session.session_id, version, data);
}

export async function getSessionExport(params: {
  session: SessionSnapshot;
  payment_mode?: "simulate_99_rmb" | "credit" | "free_preview";
  approved?: boolean;
}): Promise<SuccessEnvelope<ExportResponseData> | PaymentRequiredError> {
  await wait(380);
  const { session, payment_mode = "simulate_99_rmb", approved = false } = params;

  if (!approved && payment_mode === "simulate_99_rmb") {
    return {
      ok: false,
      session_id: session.session_id,
      state_version: session.state_version,
      server_time: now(),
      error: {
        code: "PAYMENT_REQUIRED",
        message: "Confirmation is required before final docx export.",
        retryable: true
      },
      billing_check: {
        mode: "simulate_99_rmb",
        amount_rmb: 99,
        currency: "CNY",
        status: "payment_required",
        actions: [
          { id: "pay_99_rmb", label: "继续整理正式稿" },
          { id: "free_preview", label: "先看预览稿" },
          { id: "cancel", label: "暂时不用" }
        ]
      }
    };
  }

  const isPreview = payment_mode === "free_preview";
  const data: ExportResponseData = {
    export_status: isPreview ? "preview_ready" : "ready",
    asset: {
      asset_id: isPreview ? "asset_preview_001" : "asset_docx_001",
      file_name: isPreview
        ? `${session.project?.project_name ?? "某市人民医院中心机房改造项目"}_预览版.pdf`
        : `${session.project?.project_name ?? "某市人民医院中心机房改造项目"}_技术方案_v1.docx`,
      mime_type: isPreview
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      download_url: "#mock-download",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    },
    billing_check: {
      mode: payment_mode,
      amount_rmb: isPreview ? 0 : 99,
      currency: "CNY",
      status: isPreview ? "free_preview" : "approved",
      transaction_id: `pay_sim_${Date.now()}`
    },
    included_chapters: [
      "Cover Page & Catalog",
      "Project Overview & Medical/Gov Industry Background",
      "Civil Works & Structural Reinforcement",
      "Power Distribution & UPS Engineering",
      "Precision Air Conditioning & Fresh Air Systems"
    ],
    triggered_risks: session.triggered_risks,
    layout_validation: {
      status: "passed",
      checks: [
        "fixed_width_tables",
        "price_placeholders_highlighted",
        "forced_chapters_locked",
        "toc_updated"
      ]
    }
  };

  return response(session.session_id, session.state_version + 1, data);
}

export function displayForField(code: string, value: string | number | null) {
  if (value === null || value === "") return "待确认";
  if (code === "project_type") return projectTypeLabel(value);
  if (code === "room_area_m2") return `${value} m2`;
  if (code === "room_floor") return `${value} 楼`;
  if (code === "rack_count") return `${value} 台`;
  if (code === "server_count") return `${value} 台`;
  if (code === "avg_power_per_rack_kw") return `${value} kW`;
  if (code === "ups_backup_time_minutes") return `${value} 分钟`;
  if (code === "budget_range_low_rmb" && typeof value === "number") return formatMoney(value);
  if (code === "budget_range_high_rmb" && typeof value === "number") return formatMoney(value);
  if (code === "customer_industry" && value === "medical") return "医疗";
  if (code === "customer_industry" && value === "education") return "教育";
  return String(value);
}

export function sourceLabel(source: DashboardField["source"]) {
  const map: Record<DashboardField["source"], string> = {
    user_message: "AI提取",
    voice: "语音",
    upload: "上传",
    button_chip: "快捷选择",
    dashboard_edit: "手动修改",
    agent_inference: "AI推断",
    default: "默认",
    pending: "待确认"
  };
  return map[source];
}

export function completionForState(state: FsmState, fields: Record<string, DashboardField>) {
  if (state === "S0_IDLE") return 40;
  if (state === "S2_PROACTIVE_INQUIRIES") return 75;
  if (state === "S3_READY_MONETIZATION") return fields.budget_range_high_rmb.value ? 100 : 95;
  return 60;
}
