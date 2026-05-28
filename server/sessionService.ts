import type {
  BackendSession,
  ChatRequest,
  ChatResponseData,
  DashboardField,
  ExportResponseData,
  ExportStatus,
  FieldPatch,
  FsmState,
  OverrideRequest,
  OverrideResponseData,
  RiskFlag,
  SuggestionSummary,
  SuccessEnvelope
} from "./types.js";
import { buildExportPayload } from "./exportPayload.js";
import { renderExportDocx } from "./exportDocument.js";
import { searchKnowledge } from "./localVectorSearch.js";
import {
  buildProjectContext,
  getProject,
  linkSessionToProject,
  syncProjectFromSession
} from "./projectService.js";

const sessions = new Map<string, BackendSession>();

const numericFields = new Set([
  "room_area_m2",
  "room_floor",
  "rack_count",
  "server_count",
  "avg_power_per_rack_kw",
  "ups_backup_time_minutes",
  "budget_range_low_rmb",
  "budget_range_high_rmb"
]);

const editableFields = new Set([
  "customer_name",
  "project_name",
  "customer_industry",
  "project_type",
  "room_area_m2",
  "room_floor",
  "rack_count",
  "server_count",
  "avg_power_per_rack_kw",
  "redundancy_mode",
  "ups_backup_time_minutes",
  "cooling_redundancy",
  "budget_range_low_rmb",
  "budget_range_high_rmb",
  "delivery_city",
  "expected_delivery_date",
  "brand_preference"
]);

const riskFloorLoading: RiskFlag = {
  id: "RULE_FLOOR_LOADING",
  legacy_id: "ERR_LOAD",
  level: "P0_BLOCKER",
  text: "Structural Loading Deficit Risk: room is above the first floor and UPS backup time is at least 120 minutes.",
  blocking: true,
  dismissible: false,
  trigger_fields: ["room_floor", "ups_backup_time_minutes"]
};

const riskElevatorHeight: RiskFlag = {
  id: "RULE_ELEVATOR_HEIGHT",
  level: "P1_HIGH",
  text: "Chassis Transport Risk: room is above the first floor; verify elevator, door opening, and turn radius.",
  blocking: false,
  dismissible: false,
  trigger_fields: ["room_floor"]
};

function now() {
  return new Date().toISOString();
}

function response<T>(session: BackendSession, data: T): SuccessEnvelope<T> {
  return {
    ok: true,
    session_id: session.session_id,
    state_version: session.state_version,
    server_time: now(),
    data
  };
}

function field(code: string, label: string): DashboardField {
  return {
    code,
    label,
    value: null,
    displayValue: "待确认",
    source: "pending",
    confidence: 0,
    needs_confirmation: true
  };
}

function initialFields() {
  return {
    customer_name: field("customer_name", "客户名称"),
    customer_industry: field("customer_industry", "客户行业"),
    project_type: field("project_type", "项目类型"),
    room_area_m2: field("room_area_m2", "机房面积"),
    room_floor: field("room_floor", "所在楼层"),
    rack_count: field("rack_count", "计划机柜数"),
    ups_backup_time_minutes: field("ups_backup_time_minutes", "UPS后备时间"),
    brand_preference: field("brand_preference", "品牌偏好"),
    budget_range_high_rmb: field("budget_range_high_rmb", "项目预算范围")
  };
}

function displayForField(code: string, value: string | number | null) {
  if (value === null || value === "") return "待确认";
  if (code === "project_type") {
    const map: Record<string, string> = {
      renovation: "老机房改造",
      new_build: "新建机房",
      expansion: "扩容改造",
      migration: "搬迁迁移"
    };
    return map[String(value)] ?? String(value);
  }
  if (code === "room_area_m2") return `${value} m2`;
  if (code === "room_floor") return `${value} 楼`;
  if (code === "rack_count") return `${value} 台`;
  if (code === "ups_backup_time_minutes") return `${value} 分钟`;
  if (code === "budget_range_high_rmb" && typeof value === "number") return `${Math.round(value / 10000)} 万`;
  if (code === "customer_industry" && value === "medical") return "医疗";
  if (code === "customer_industry" && value === "education") return "教育";
  return String(value);
}

function loadOrCreateSession(sessionId: string, projectId: string | null = null) {
  const existing = sessions.get(sessionId);
  if (existing) {
    if (projectId && existing.project_id !== projectId) {
      existing.project_id = projectId;
      linkSessionToProject(projectId, existing.session_id);
    }
    return existing;
  }
  const session: BackendSession = {
    session_id: sessionId,
    project_id: projectId,
    state_version: 1,
    fsm_state: "S0_IDLE",
    export_status: "draft",
    dashboard_fields: initialFields(),
    triggered_risks: [],
    knowledge_hits: [],
    suggestion: null,
    payment_willingness_99_rmb: null,
    export_payload_stale: false,
    created_at: now(),
    updated_at: now()
  };
  sessions.set(sessionId, session);
  if (projectId) linkSessionToProject(projectId, sessionId);
  return session;
}

function extractNumber(input: string, fallback: number | null = null) {
  const match = input.match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

function firstNumberNear(text: string, keywords: string[]) {
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

function makePatch(
  session: BackendSession,
  fieldCode: string,
  newValue: string | number | null,
  source: FieldPatch["source"],
  confidence = 0.9,
  needsConfirmation = false
): FieldPatch {
  const current = session.dashboard_fields[fieldCode];
  if (!current) {
    throw new Error(`Unknown field ${fieldCode}`);
  }
  const oldValue = current.value;
  current.value = newValue;
  current.displayValue = displayForField(fieldCode, newValue);
  current.source = source;
  current.confidence = confidence;
  current.needs_confirmation = needsConfirmation;
  return {
    field_code: fieldCode,
    old_value: oldValue,
    new_value: newValue,
    source,
    confidence,
    needs_confirmation: needsConfirmation
  };
}

function buildSuggestion(rackCount: number, stale = false): SuggestionSummary {
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
    structuralNote: "长延时电池方案需复核楼板承重与运输路线。",
    stale
  };
}

function evaluateRisks(session: BackendSession) {
  const floor = Number(session.dashboard_fields.room_floor?.value ?? 0);
  const backup = Number(session.dashboard_fields.ups_backup_time_minutes?.value ?? 0);
  const risks: RiskFlag[] = [];
  if (floor >= 2 && backup >= 120) risks.push(riskFloorLoading);
  if (floor >= 2) risks.push(riskElevatorHeight);
  session.triggered_risks = risks;
}

function inferState(session: BackendSession): { fsm_state: FsmState; export_status: ExportStatus } {
  const hasArea = Boolean(session.dashboard_fields.room_area_m2?.value);
  const hasRack = Boolean(session.dashboard_fields.rack_count?.value);
  const hasBackup = Boolean(session.dashboard_fields.ups_backup_time_minutes?.value);
  if (hasArea && hasRack && hasBackup) return { fsm_state: "S3_READY_MONETIZATION", export_status: "ready" };
  if (hasArea || hasRack || hasBackup) return { fsm_state: "S2_PROACTIVE_INQUIRIES", export_status: "draft" };
  return { fsm_state: "S1_CORE_EXTRACTION", export_status: "draft" };
}

export function postSessionChat(request: ChatRequest) {
  if (!request.session_id) throw new ApiValidationError("session_id is required.");
  if (!request.content?.trim()) throw new ApiValidationError("content is required.");
  if (!["text", "voice", "file"].includes(request.message_type)) {
    throw new ApiValidationError("message_type must be text, voice, or file.");
  }

  const session = loadOrCreateSession(request.session_id, request.project_id ?? null);
  const text = request.content.trim();
  const patches: FieldPatch[] = [];
  const knowledgeHits = searchKnowledge(text, 3);

  const customerMatch = text.match(/某?[\u4e00-\u9fa5A-Za-z0-9]{1,12}(医院|学校|中心|公司|工厂|园区)/);
  if (customerMatch)
    patches.push(makePatch(session, "customer_name", customerMatch[0], "user_message", 0.86));
  if (/医院/.test(text))
    patches.push(makePatch(session, "customer_industry", "medical", "user_message", 0.88));
  if (/学校/.test(text))
    patches.push(makePatch(session, "customer_industry", "education", "user_message", 0.88));

  const projectType = extractProjectType(text);
  if (projectType) patches.push(makePatch(session, "project_type", projectType, "user_message", 0.9));

  const area = firstNumberNear(text, ["平方", "平", "m2", "㎡"]);
  if (area) patches.push(makePatch(session, "room_area_m2", area, "user_message", 0.94));

  const floor = firstNumberNear(text, ["楼", "层"]);
  if (floor) patches.push(makePatch(session, "room_floor", floor, "user_message", 0.94));

  const backupHours = firstNumberNear(text, ["小时", "h"]);
  const backupMinutes = backupHours ? backupHours * 60 : firstNumberNear(text, ["分钟", "后备", "延时"]);
  if (backupMinutes) {
    patches.push(makePatch(session, "ups_backup_time_minutes", backupMinutes, "user_message", 0.95));
  }

  const rackCount = firstNumberNear(text, ["机柜", "柜子", "rack"]);
  if (rackCount) patches.push(makePatch(session, "rack_count", rackCount, "user_message", 0.9));
  if (/国产/.test(text))
    patches.push(makePatch(session, "brand_preference", "国产优先", "user_message", 0.88));

  const budgetWan = /预算|万|钱/.test(text) ? extractNumber(text, null) : null;
  if (budgetWan)
    patches.push(makePatch(session, "budget_range_high_rmb", budgetWan * 10000, "user_message", 0.85));

  const finalRackCount = Number(session.dashboard_fields.rack_count?.value || 0);
  session.suggestion = finalRackCount ? buildSuggestion(finalRackCount) : null;
  evaluateRisks(session);
  const state = inferState(session);
  session.fsm_state = state.fsm_state;
  session.export_status = state.export_status;
  session.knowledge_hits = knowledgeHits;
  session.state_version += 1;
  session.updated_at = now();
  if (session.project_id) {
    syncProjectFromSession(session.project_id, session);
  }

  const hasScale = Boolean(session.dashboard_fields.rack_count?.value);
  const aiResponse = hasScale
    ? "已收到项目线索并同步到后端会话状态。当前已具备初步规模口径，可继续补充预算或触发导出意愿验证。"
    : "已收到项目线索并同步到后端会话状态。现在还差一个最影响报价的规模口径：大概多少机柜或服务器？";

  const data: ChatResponseData = {
    ai_response: aiResponse,
    quick_replies: hasScale
      ? ["生成Word需求表", "补充项目预算"]
      : ["计划放置 10 个标准机柜", "不确定，按面积估算"],
    updated_fields: Object.fromEntries(patches.map((patch) => [patch.field_code, patch.new_value])),
    field_patches: patches,
    triggered_risks: session.triggered_risks,
    knowledge_hits: session.knowledge_hits,
    project: buildProjectContext(session.project_id),
    state: {
      fsm_state: session.fsm_state,
      export_status: session.export_status,
      calculation_status: "provisional"
    },
    suggestion: session.suggestion
  };

  return response(session, data);
}

export function postSessionOverride(request: OverrideRequest) {
  if (!request.session_id) throw new ApiValidationError("session_id is required.");
  if (!request.field_code) throw new ApiValidationError("field_code is required.");
  if (!editableFields.has(request.field_code)) {
    throw new ApiValidationError(`field_code is not editable: ${request.field_code}`);
  }

  const session = loadOrCreateSession(request.session_id);
  const oldValue = session.dashboard_fields[request.field_code]?.value ?? null;
  let normalizedValue: string | number | null = request.value.trim() || null;

  if (numericFields.has(request.field_code)) {
    normalizedValue = normalizedValue === null ? null : Number(extractNumber(String(normalizedValue), 0));
    if (request.field_code === "budget_range_high_rmb" && normalizedValue && normalizedValue < 1000) {
      normalizedValue = normalizedValue * 10000;
    }
  }

  makePatch(session, request.field_code, normalizedValue, "dashboard_edit", 1, false);
  const rackCount = Number(session.dashboard_fields.rack_count?.value || 10);
  session.suggestion = buildSuggestion(rackCount, true);
  session.export_payload_stale = true;
  evaluateRisks(session);
  session.state_version += 1;
  session.updated_at = now();
  if (session.project_id) {
    syncProjectFromSession(session.project_id, session);
  }

  const data: OverrideResponseData = {
    sync_status: "synced",
    field_code: request.field_code,
    normalized_value: normalizedValue,
    old_value: oldValue,
    source: "dashboard_edit",
    confidence: 1,
    llm_context_injected: true,
    llm_context_injection_id: `ctxinj_${Date.now()}`,
    export_payload_stale: true,
    recomputed_outputs: {
      total_it_load_kw: rackCount * 3,
      recommended_ups_capacity_kva: session.suggestion.upsCapacityKva,
      recommended_precision_ac_model_kw: session.suggestion.coolingModelKw
    },
    triggered_risks: session.triggered_risks,
    agent_silent_event: {
      event: "onDashboardFieldCommit",
      field_code: request.field_code,
      old_value: oldValue,
      new_value: normalizedValue
    },
    ai_notice: `已将 ${request.field_code} 手动修正为 ${request.value}，并同步到后端会话上下文。`,
    suggestion: session.suggestion
  };

  return response(session, data);
}

export function getSessionExport(params: {
  session_id: string;
  payment_mode?: "simulate_99_rmb" | "credit" | "free_preview";
  approved?: boolean;
}) {
  if (!params.session_id) throw new ApiValidationError("session_id is required.");
  const session = loadOrCreateSession(params.session_id);
  const paymentMode = params.payment_mode ?? "simulate_99_rmb";
  const approved = params.approved ?? false;

  if (paymentMode === "simulate_99_rmb" && !approved) {
    return {
      status: 402,
      body: {
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
      }
    };
  }

  const isPreview = paymentMode === "free_preview";
  session.payment_willingness_99_rmb = isPreview ? "maybe_preview_first" : true;
  session.export_status = "exported";
  session.export_payload_stale = false;
  session.state_version += 1;
  session.updated_at = now();
  const project = session.project_id ? getProject(session.project_id) : null;
  const exportPayload = buildExportPayload(session, project, {
    export_type: isPreview ? "preview_pdf" : "docx_requirement_sheet"
  });
  const renderedDocument = isPreview ? null : renderExportDocx(exportPayload);

  const data: ExportResponseData = {
    export_status: isPreview ? "preview_ready" : "ready",
    asset: renderedDocument?.asset ?? {
      asset_id: "asset_preview_api_001",
      file_name: `${exportPayload.project_name}_预览版.pdf`,
      mime_type: "application/pdf",
      download_url: "#api-skeleton-preview",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    },
    billing_check: {
      mode: paymentMode,
      amount_rmb: isPreview ? 0 : 99,
      currency: "CNY",
      status: isPreview ? "free_preview" : "approved",
      transaction_id: `intent_${Date.now()}`
    },
    included_chapters: exportPayload.chapter_plan.map((chapter) => chapter.title),
    export_payload: exportPayload,
    triggered_risks: session.triggered_risks,
    layout_validation: {
      status: renderedDocument?.layout_validation.status ?? exportPayload.validation.status,
      checks: [
        "api_skeleton_payload",
        "payment_willingness_recorded",
        ...(renderedDocument?.layout_validation.checks ?? []),
        ...exportPayload.validation.checks.map((check) => `${check.id}:${check.status}`)
      ]
    }
  };

  return {
    status: 200,
    body: response(session, data)
  };
}

export function getSessionSnapshot(sessionId: string) {
  return loadOrCreateSession(sessionId);
}

export function getSessionCount() {
  return sessions.size;
}

export class ApiValidationError extends Error {
  status = 400;
  code = "VALIDATION_ERROR";
  retryable = false;
}
