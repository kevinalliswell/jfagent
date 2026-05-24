import type {
  ChatResponseData,
  DashboardField,
  ExportResponseData,
  FieldPatch,
  FsmState,
  KnowledgeHit,
  OverrideResponseData,
  PaymentRequiredError,
  RiskFlag,
  SessionSnapshot,
  SuccessEnvelope
} from "./types";
import { searchKnowledge } from "./localVectorSearch";

const now = () => new Date().toISOString();
const wait = (ms = 420) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
      text: "没事，先把机房项目线索丢给我。我会按本地知识库先整理需求表预览，确认有价值后再走99元正式Word导出。",
      timestamp: now()
    }
  ],
  quick_replies: ["医院/50平/3楼/国产UPS延时2小时"],
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
  triggered_risks: [],
  suggestion: null,
  knowledge_hits: searchKnowledge("机房 UPS 精密空调 需求表", 3),
  export_asset: null
};

const riskFloorLoading: RiskFlag = {
  id: "RULE_FLOOR_LOADING",
  legacy_id: "ERR_LOAD",
  level: "P0_BLOCKER",
  text: "Structural Loading Deficit Risk：机房位于二层及以上，且UPS后备时间达到120分钟，必须复核楼板承重并强制纳入 Steel Structure Load加固 章节。",
  blocking: true,
  dismissible: false,
  trigger_fields: ["room_floor", "ups_backup_time_minutes"]
};

const riskElevatorHeight: RiskFlag = {
  id: "RULE_ELEVATOR_HEIGHT",
  level: "P1_HIGH",
  text: "Chassis Transport Risk：二层及以上机房需核实电梯高度、门洞和转弯半径，2米级精密空调可能需要预留吊装预算。",
  blocking: false,
  dismissible: false,
  trigger_fields: ["room_floor"]
};

const riskBudgetMismatch: RiskFlag = {
  id: "RULE_BUDGET_MISMATCH",
  level: "P1_HIGH",
  text: "Budget Mismatch Risk：当前预算可能低于设备BOM与施工综合成本安全线，建议输出可靠性优先和预算优先两档方案。",
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
    structuralNote: "三楼长延时电池方案已纳入 Steel Structure Load加固 与运输路线复核。",
    stale
  };
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
    const budgetWan = extractNumber(text, 30);
    const budgetRmb = budgetWan * 10000;
    const risk = budgetRmb < 450000 ? [riskBudgetMismatch] : [];
    const data: ChatResponseData = {
      ai_response:
        risk.length > 0
          ? "收到预算上限。这个金额可能压不住当前配置，我会在方案里准备可靠性优先和预算优先两档平替建议。"
          : "收到预算口径，右侧看板已锁定，后续导出会把预算约束带入方案说明。",
      quick_replies: ["生成Word需求表", "调整机柜/UPS/空调"],
      updated_fields: { budget_range_high_rmb: budgetRmb },
      field_patches: [patch("budget_range_high_rmb", null, budgetRmb, "user_message", 0.9)],
      triggered_risks: risk,
      knowledge_hits: session.knowledge_hits,
      state: {
        fsm_state: "S3_READY_MONETIZATION",
        export_status: "ready",
        calculation_status: "provisional"
      },
      suggestion: session.suggestion ? { ...session.suggestion, stale: true } : buildSuggestion(10, true)
    };
    return response(session.session_id, version, data);
  }

  if (isRackAnswer) {
    const rackCount = text.includes("20") || text.includes("30") || text.includes("服务器") ? 5 : 10;
    const data: ChatResponseData = {
      ai_response:
        "核心规模口径已对齐。我已经按当前机柜数量重算出40kVA级UPS、120分钟电池后备和N+1精密空调建议，现在可以生成Word技术方案。",
      quick_replies: ["生成Word需求表", "补充项目预算", "调整机柜/UPS/空调"],
      updated_fields: { rack_count: rackCount },
      field_patches: [patch("rack_count", null, rackCount, "button_chip", 0.95)],
      triggered_risks: [riskFloorLoading, riskElevatorHeight],
      knowledge_hits: session.knowledge_hits.length ? session.knowledge_hits : knowledgeHits,
      state: {
        fsm_state: "S3_READY_MONETIZATION",
        export_status: "ready",
        calculation_status: "provisional"
      },
      suggestion: buildSuggestion(rackCount)
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

    const risks = [
      ...(floor && floor >= 2 && backupMinutes && backupMinutes >= 120 ? [riskFloorLoading] : [])
    ];
    if (floor && floor >= 2) risks.push(riskElevatorHeight);
    const suggestion = inferredRackCount && backupMinutes ? buildSuggestion(inferredRackCount) : null;
    const stateReady = Boolean(inferredRackCount && hasMepSignal);
    const data: ChatResponseData = {
      ai_response: stateReady
        ? `我先按${customerName ?? "这个项目"}${projectType ? `/${projectTypeLabel(projectType)}` : ""}整理出一版可预览需求：面积${area ? `约${area}平方米` : "待确认"}，规模先按${inferredRackCount}台机柜口径，已命中${knowledgeHits.length}条内部资料。现在可以先看免费预览，也可以继续补预算。`
        : `收到，我先把能确定的线索整理进右侧看板，并从本地知识库命中了${knowledgeHits.length}条资料。现在还差最影响报价的规模口径：大概多少机柜或服务器？`,
      quick_replies: stateReady
        ? ["生成Word需求表", "补充项目预算", "调整机柜/UPS/空调"]
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
      state: {
        fsm_state: stateReady ? "S3_READY_MONETIZATION" : "S2_PROACTIVE_INQUIRIES",
        export_status: stateReady ? "ready" : "draft",
        calculation_status: "provisional"
      },
      suggestion
    };
    return response(session.session_id, version, data);
  }

  const data: ChatResponseData = {
    ai_response:
      "这个补充我已记入会话上下文。若它影响机柜、UPS、空调或预算，我会同步刷新右侧看板和最终导出参数。",
    quick_replies: session.quick_replies.length ? session.quick_replies : ["生成Word需求表", "补充项目预算"],
    updated_fields: {},
    field_patches: [],
    triggered_risks: session.triggered_risks,
    knowledge_hits: session.knowledge_hits,
    state: {
      fsm_state: session.fsm_state,
      export_status: session.export_status,
      calculation_status: "provisional"
    },
    suggestion: session.suggestion
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
    ["room_area_m2", "room_floor", "rack_count", "ups_backup_time_minutes", "budget_range_high_rmb"].includes(
      field_code
    )
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
  const suggestion = buildSuggestion(rackCount, true);
  const risks = [...session.triggered_risks];
  if (
    field_code === "budget_range_high_rmb" &&
    typeof normalized === "number" &&
    normalized < 450000 &&
    !risks.some((risk) => risk.id === riskBudgetMismatch.id)
  ) {
    risks.push(riskBudgetMismatch);
  }

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
    ai_notice: `已将 ${field_code} 手动修正为 ${value}，并同步到导出上下文。`,
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
        message: "99 RMB payment willingness verification is required before final docx export.",
        retryable: true
      },
      billing_check: {
        mode: "simulate_99_rmb",
        amount_rmb: 99,
        currency: "CNY",
        status: "payment_required",
        actions: [
          { id: "pay_99_rmb", label: "愿意，生成正式版" },
          { id: "free_preview", label: "先预览免费版" },
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
        ? "某市人民医院中心机房改造项目_预览版.pdf"
        : "某市人民医院中心机房改造项目_技术方案_v1.docx",
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
  if (code === "ups_backup_time_minutes") return `${value} 分钟`;
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
