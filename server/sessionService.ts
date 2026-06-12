import type {
  AgentRuntimeSummary,
  BackendSession,
  ChatHistoryMessage,
  ChatRequest,
  ChatResponseData,
  DashboardField,
  ExportResponseData,
  ExportStatus,
  FieldPatch,
  FsmState,
  OverrideRequest,
  OverrideResponseData,
  PublicUser,
  SessionSnapshotData,
  SessionSnapshotSession,
  SuccessEnvelope,
  SuggestionSummary
} from "./types.js";
import { buildExportPayload } from "./exportPayload.js";
import { renderExportDocx, renderExportPreviewPdf } from "./exportDocument.js";
import { generateAgentLlmResult } from "./llmClient.js";
import { searchKnowledge } from "./localVectorSearch.js";
import { countSessions, loadSession, logRetrievalAudit, saveSession } from "./persistence.js";
import { buildSuggestionFromEvaluation, evaluateProjectRules, type EngineEvaluation } from "./rulesEngine.js";
import { debitExportCredit } from "./auth.js";
import {
  buildProjectContext,
  canAccessProject,
  getProject,
  linkSessionToProject,
  syncProjectFromSession
} from "./projectService.js";

const sessions = new Map<string, BackendSession>();
const MAX_PERSISTED_MESSAGES = 200;

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

const llmProtectedSources = new Set(["dashboard_edit", "user_message", "upload", "button_chip"]);

function now() {
  return new Date().toISOString();
}

function projectNotFoundError() {
  const error = new ApiValidationError("The requested project does not exist.");
  error.status = 404;
  error.code = "PROJECT_NOT_FOUND";
  return error;
}

function projectSessionBoundError() {
  const error = new ApiValidationError("The session is already bound to a different project.");
  error.status = 409;
  error.code = "PROJECT_SESSION_BOUND";
  return error;
}

function sessionNotFoundError() {
  const error = new ApiValidationError("session_id was not found.");
  error.status = 404;
  error.code = "SESSION_NOT_FOUND";
  return error;
}

function forbiddenError(message = "You do not have access to this resource.") {
  const error = new ApiValidationError(message);
  error.status = 403;
  error.code = "FORBIDDEN";
  return error;
}

function cloneDashboardFields(fields: Record<string, DashboardField>) {
  return Object.fromEntries(Object.entries(fields).map(([code, field]) => [code, { ...field }]));
}

function cloneKnowledgeHits(hits: BackendSession["knowledge_hits"]) {
  return hits.map((hit) => ({ ...hit }));
}

function cloneTriggeredRisks(risks: BackendSession["triggered_risks"]) {
  return risks.map((risk) => ({
    ...risk,
    trigger_fields: [...risk.trigger_fields]
  }));
}

function cloneSuggestion(suggestion: BackendSession["suggestion"]) {
  return suggestion ? { ...suggestion } : null;
}

function cloneAgentRuntime(agentRuntime: AgentRuntimeSummary | null | undefined) {
  return agentRuntime ? { ...agentRuntime } : null;
}

function cloneMessages(messages: ChatHistoryMessage[] | undefined) {
  return (messages ?? []).map((message) => ({ ...message }));
}

function toSessionSnapshotSession(session: BackendSession): SessionSnapshotSession {
  return {
    session_id: session.session_id,
    project_id: session.project_id,
    state_version: session.state_version,
    fsm_state: session.fsm_state,
    export_status: session.export_status,
    dashboard_fields: cloneDashboardFields(session.dashboard_fields),
    triggered_risks: cloneTriggeredRisks(session.triggered_risks),
    knowledge_hits: cloneKnowledgeHits(session.knowledge_hits),
    suggestion: cloneSuggestion(session.suggestion),
    agent_runtime: cloneAgentRuntime(session.agent_runtime),
    messages: cloneMessages(session.messages)
  };
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
  if (code === "server_count") return `${value} 台`;
  if (code === "avg_power_per_rack_kw") return `${value} kW`;
  if (code === "ups_backup_time_minutes") return `${value} 分钟`;
  if (code === "budget_range_low_rmb" && typeof value === "number") return `${Math.round(value / 10000)} 万`;
  if (code === "budget_range_high_rmb" && typeof value === "number") return `${Math.round(value / 10000)} 万`;
  if (code === "customer_industry" && value === "medical") return "医疗";
  if (code === "customer_industry" && value === "education") return "教育";
  if (code === "customer_industry" && value === "government") return "政务";
  return String(value);
}

function canAccessSession(session: BackendSession, user: PublicUser | null) {
  if (!user) return true;
  if (user.role === "admin") return true;
  if (!session.user_id) return true;
  return session.user_id === user.user_id;
}

function loadOrCreateSession(
  sessionId: string,
  projectId: string | null = null,
  user: PublicUser | null = null
) {
  if (projectId) {
    const project = getProject(projectId);
    if (!project) throw projectNotFoundError();
    if (user && !canAccessProject(project, user)) throw forbiddenError();
  }
  let existing = sessions.get(sessionId);
  if (!existing) {
    const persisted = loadSession(sessionId);
    if (persisted) {
      const normalized = reconcileDerivedSessionState(persisted);
      sessions.set(sessionId, persisted);
      existing = persisted;
      if (normalized) {
        saveSession(existing);
      }
    }
  }
  if (existing) {
    if (!canAccessSession(existing, user)) throw forbiddenError();
    const normalized = reconcileDerivedSessionState(existing);
    if (existing.project_id && projectId && existing.project_id !== projectId) {
      throw projectSessionBoundError();
    }
    let changed = normalized;
    if (!existing.user_id && user) {
      existing.user_id = user.user_id;
      changed = true;
    }
    if (!existing.project_id && projectId) {
      existing.project_id = projectId;
      linkSessionToProject(projectId, existing.session_id);
      existing.updated_at = now();
      changed = true;
    }
    if (changed) {
      saveSession(existing);
    }
    return existing;
  }
  const session: BackendSession = {
    session_id: sessionId,
    project_id: projectId,
    user_id: user?.user_id ?? null,
    state_version: 1,
    fsm_state: "S0_IDLE",
    export_status: "draft",
    dashboard_fields: initialFields(),
    triggered_risks: [],
    knowledge_hits: [],
    suggestion: null,
    agent_runtime: null,
    messages: [],
    payment_willingness_99_rmb: null,
    export_payload_stale: false,
    created_at: now(),
    updated_at: now()
  };
  sessions.set(sessionId, session);
  if (projectId) linkSessionToProject(projectId, sessionId);
  saveSession(session);
  return session;
}

function extractNumber(input: string, fallback: number | null = null) {
  const match = input.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : fallback;
}

function firstNumberNear(text: string, keywords: string[]) {
  for (const keyword of keywords) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const beforeKeyword = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[个台套位]?\\s*${escapedKeyword}`));
    if (beforeKeyword) return Number(beforeKeyword[1]);
    const afterKeyword = text.match(new RegExp(`${escapedKeyword}\\s*(\\d+(?:\\.\\d+)?)`));
    if (afterKeyword) return Number(afterKeyword[1]);
    const index = text.indexOf(keyword);
    if (index >= 0) {
      const windowText = text.slice(Math.max(0, index - 6), index + keyword.length + 10);
      const match = windowText.match(/\d+(?:\.\d+)?/);
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

function normalizeAgentCandidateValue(fieldCode: string, value: string | number | null) {
  if (value === null || value === "") return null;
  if (!numericFields.has(fieldCode)) return value;

  const normalized = typeof value === "number" ? value : extractNumber(String(value), null);
  if (normalized === null) return null;
  if ((fieldCode === "budget_range_high_rmb" || fieldCode === "budget_range_low_rmb") && normalized < 1000) {
    return normalized * 10000;
  }
  return normalized;
}

function evaluateSessionRules(session: BackendSession): EngineEvaluation {
  return evaluateProjectRules(session.dashboard_fields);
}

function buildSuggestionForSession(session: BackendSession, evaluation?: EngineEvaluation) {
  const result = evaluation ?? evaluateSessionRules(session);
  return buildSuggestionFromEvaluation(result, Boolean(session.export_payload_stale));
}

function inferState(session: BackendSession): { fsm_state: FsmState; export_status: ExportStatus } {
  const hasArea = Boolean(session.dashboard_fields.room_area_m2?.value);
  const hasRack = Boolean(session.dashboard_fields.rack_count?.value);
  const hasBackup = Boolean(session.dashboard_fields.ups_backup_time_minutes?.value);
  if (hasArea && hasRack && hasBackup) return { fsm_state: "S3_READY_MONETIZATION", export_status: "ready" };
  if (hasArea || hasRack || hasBackup) return { fsm_state: "S2_PROACTIVE_INQUIRIES", export_status: "draft" };
  return { fsm_state: "S1_CORE_EXTRACTION", export_status: "draft" };
}

function signature(value: unknown) {
  return JSON.stringify(value);
}

function backfillDashboardFields(session: BackendSession) {
  let changed = false;
  for (const [code, nextField] of Object.entries(initialFields())) {
    if (!session.dashboard_fields[code]) {
      session.dashboard_fields[code] = nextField;
      changed = true;
    }
  }
  return changed;
}

function reconcileDerivedSessionState(session: BackendSession) {
  let changed = false;

  if (backfillDashboardFields(session)) {
    changed = true;
  }

  if (typeof session.export_payload_stale !== "boolean") {
    session.export_payload_stale = false;
    changed = true;
  }

  if (!Array.isArray(session.messages)) {
    session.messages = [];
    changed = true;
  }

  const evaluation = evaluateSessionRules(session);

  const nextSuggestion = buildSuggestionForSession(session, evaluation);
  if (signature(session.suggestion) !== signature(nextSuggestion)) {
    session.suggestion = nextSuggestion;
    changed = true;
  }

  const nextRisks = evaluation.risk_flags;
  if (signature(session.triggered_risks) !== signature(nextRisks)) {
    session.triggered_risks = nextRisks;
    changed = true;
  }

  const inferredState = inferState(session);
  if (session.fsm_state !== inferredState.fsm_state) {
    session.fsm_state = inferredState.fsm_state;
    changed = true;
  }

  const nextExportStatus = session.export_status === "exported" ? "exported" : inferredState.export_status;
  if (session.export_status !== nextExportStatus) {
    session.export_status = nextExportStatus;
    changed = true;
  }

  return changed;
}

function appendSessionMessage(session: BackendSession, sender: "user" | "ai", text: string) {
  if (!Array.isArray(session.messages)) session.messages = [];
  session.messages.push({
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    sender,
    text,
    timestamp: now()
  });
  if (session.messages.length > MAX_PERSISTED_MESSAGES) {
    session.messages = session.messages.slice(-MAX_PERSISTED_MESSAGES);
  }
}

function fallbackAgentResponse(session: BackendSession, evaluation: EngineEvaluation) {
  const hasScale = Boolean(session.dashboard_fields.rack_count?.value);
  const promptHint = evaluation.agent_required_prompts[0];
  if (!hasScale) {
    return {
      aiResponse: "已收到项目线索。现在还差一个最影响方案和报价的规模口径：大概多少机柜或服务器？",
      quickReplies: ["计划放置 10 个标准机柜", "不确定，按面积估算"]
    };
  }
  const suggestion = session.suggestion;
  const sizingLine = suggestion
    ? `按当前口径初步测算：总IT负载约 ${suggestion.totalItLoadKw ?? "-"}kW，UPS 建议 ${suggestion.upsCapacityKva}kVA，精密空调按 ${suggestion.coolingModelKw}kW 机型 ${suggestion.coolingUnitCount ?? "-"} 台（${suggestion.coolingRedundancy}）。`
    : "当前已经形成初步规模口径。";
  const estimateLine = suggestion?.estimatedCostLowRmb
    ? `内部参考估算区间约 ${Math.round((suggestion.estimatedCostLowRmb ?? 0) / 10000)}-${Math.round((suggestion.estimatedCostHighRmb ?? 0) / 10000)} 万（非正式报价）。`
    : "";
  return {
    aiResponse: [sizingLine, estimateLine, promptHint ?? "接下来建议补充预算、品牌偏好或交付时间。"]
      .filter(Boolean)
      .join(""),
    quickReplies: ["整理交付稿", "补充项目预算"]
  };
}

function applyAgentFieldCandidates(
  session: BackendSession,
  candidates: Array<{
    field_code: string;
    value: string | number | null;
    confidence: number;
    needs_confirmation: boolean;
  }>
) {
  const patches: FieldPatch[] = [];
  for (const candidate of candidates) {
    const current = session.dashboard_fields[candidate.field_code];
    if (!current) continue;
    if (llmProtectedSources.has(current.source)) continue;

    const normalizedValue = normalizeAgentCandidateValue(candidate.field_code, candidate.value);
    if (normalizedValue === null) continue;
    patches.push(
      makePatch(
        session,
        candidate.field_code,
        normalizedValue,
        "agent_inference",
        candidate.confidence,
        candidate.needs_confirmation
      )
    );
  }
  return patches;
}

function applyDeterministicExtraction(session: BackendSession, text: string) {
  const patches: FieldPatch[] = [];

  const customerMatch = text.match(/某?[一-龥A-Za-z0-9]{1,12}(医院|学校|中心|公司|工厂|园区)/);
  if (customerMatch)
    patches.push(makePatch(session, "customer_name", customerMatch[0], "user_message", 0.86));
  if (/医院/.test(text))
    patches.push(makePatch(session, "customer_industry", "medical", "user_message", 0.88));
  if (/学校|大学|学院/.test(text))
    patches.push(makePatch(session, "customer_industry", "education", "user_message", 0.88));
  if (/政务|政府|机关/.test(text))
    patches.push(makePatch(session, "customer_industry", "government", "user_message", 0.88));

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

  const serverMatch = text.match(/(\d+)\s*台(?:服务器)/);
  if (serverMatch)
    patches.push(makePatch(session, "server_count", Number(serverMatch[1]), "user_message", 0.9));

  const avgPowerMatch = text.match(/(?:每柜|单柜|每个机柜)[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(?:kw|千瓦)/i);
  if (avgPowerMatch) {
    patches.push(makePatch(session, "avg_power_per_rack_kw", Number(avgPowerMatch[1]), "user_message", 0.92));
  }

  if (/2N/i.test(text)) {
    patches.push(makePatch(session, "redundancy_mode", "2N", "user_message", 0.9));
  } else if (/N\s*\+\s*1/i.test(text)) {
    patches.push(makePatch(session, "redundancy_mode", "N+1", "user_message", 0.9));
  }

  if (/国产/.test(text))
    patches.push(makePatch(session, "brand_preference", "国产优先", "user_message", 0.88));

  const budgetRangeMatch = text.match(/预算[^0-9]{0,6}(\d+)\s*[-~到至]\s*(\d+)\s*万/);
  if (budgetRangeMatch) {
    patches.push(
      makePatch(session, "budget_range_low_rmb", Number(budgetRangeMatch[1]) * 10000, "user_message", 0.88)
    );
    patches.push(
      makePatch(session, "budget_range_high_rmb", Number(budgetRangeMatch[2]) * 10000, "user_message", 0.88)
    );
  } else {
    const budgetWan = /预算|万|钱/.test(text) ? firstNumberNear(text, ["预算", "万", "钱"]) : null;
    if (budgetWan)
      patches.push(makePatch(session, "budget_range_high_rmb", budgetWan * 10000, "user_message", 0.85));
  }

  return patches;
}

function engineSummaryForLlm(evaluation: EngineEvaluation) {
  return {
    calculation_status: evaluation.calculation_status,
    total_it_load_kw: evaluation.ups.total_it_load_kw,
    recommended_ups_capacity_kva: evaluation.ups.recommended_ups_capacity_kva,
    recommended_precision_ac: evaluation.cooling.recommended_precision_ac_model_kw
      ? `${evaluation.cooling.recommended_precision_ac_model_kw}kW × ${evaluation.cooling.total_unit_count} 台（${evaluation.cooling.cooling_redundancy}）`
      : null,
    battery_estimate: evaluation.battery.battery_count
      ? `${evaluation.battery.battery_spec} 约 ${evaluation.battery.battery_count} 只`
      : null,
    internal_estimate_range_rmb:
      evaluation.bom_estimate.low_rmb && evaluation.bom_estimate.high_rmb
        ? `${evaluation.bom_estimate.low_rmb}-${evaluation.bom_estimate.high_rmb}`
        : null,
    estimate_disclaimer: "内部参考估算，非正式报价",
    budget_floor_rmb: evaluation.bom_estimate.budget_floor_rmb
  };
}

export async function postSessionChat(request: ChatRequest, user: PublicUser | null = null) {
  if (!request.session_id) throw new ApiValidationError("session_id is required.");
  if (!request.content?.trim()) throw new ApiValidationError("content is required.");
  if (!["text", "voice", "file"].includes(request.message_type)) {
    throw new ApiValidationError("message_type must be text, voice, or file.");
  }

  const session = loadOrCreateSession(request.session_id, request.project_id ?? null, user);
  const text = request.content.trim();
  const knowledgeHits = searchKnowledge(text, 3);

  appendSessionMessage(session, "user", text);
  const historyBeforeReply = (session.messages ?? []).slice(0, -1).slice(-12);

  const patches = applyDeterministicExtraction(session, text);

  session.knowledge_hits = knowledgeHits;
  logRetrievalAudit(session.session_id, text, knowledgeHits);
  reconcileDerivedSessionState(session);

  const evaluation = evaluateSessionRules(session);
  const fallback = fallbackAgentResponse(session, evaluation);
  const llmResult = await generateAgentLlmResult({
    userText: text,
    session,
    patches,
    knowledgeHits,
    risks: session.triggered_risks,
    history: historyBeforeReply.map((message) => ({ sender: message.sender, text: message.text })),
    engineSummary: engineSummaryForLlm(evaluation),
    requiredPrompts: evaluation.agent_required_prompts
  });
  session.agent_runtime = cloneAgentRuntime(llmResult.runtime);
  const llmPatches = llmResult.output
    ? applyAgentFieldCandidates(session, llmResult.output.field_candidates)
    : [];
  patches.push(...llmPatches);

  reconcileDerivedSessionState(session);
  const aiResponse = llmResult.output?.ai_response ?? fallback.aiResponse;
  appendSessionMessage(session, "ai", aiResponse);
  session.state_version += 1;
  session.updated_at = now();
  if (session.project_id) {
    syncProjectFromSession(session.project_id, session);
  }
  saveSession(session);

  const data: ChatResponseData = {
    ai_response: aiResponse,
    quick_replies: llmResult.output?.quick_replies.length
      ? llmResult.output.quick_replies
      : fallback.quickReplies,
    updated_fields: Object.fromEntries(patches.map((patch) => [patch.field_code, patch.new_value])),
    field_patches: patches,
    triggered_risks: session.triggered_risks,
    knowledge_hits: session.knowledge_hits,
    project: buildProjectContext(session.project_id),
    state: {
      fsm_state: session.fsm_state,
      export_status: session.export_status,
      calculation_status: session.suggestion?.calculationStatus ?? "provisional"
    },
    suggestion: session.suggestion,
    agent_runtime: cloneAgentRuntime(session.agent_runtime) ?? llmResult.runtime
  };

  return response(session, data);
}

export function postSessionOverride(request: OverrideRequest, user: PublicUser | null = null) {
  if (!request.session_id) throw new ApiValidationError("session_id is required.");
  if (!request.field_code) throw new ApiValidationError("field_code is required.");
  if (!editableFields.has(request.field_code)) {
    throw new ApiValidationError(`field_code is not editable: ${request.field_code}`);
  }

  const session = loadOrCreateSession(request.session_id, null, user);
  const oldValue = session.dashboard_fields[request.field_code]?.value ?? null;
  let normalizedValue: string | number | null = request.value.trim() || null;

  if (numericFields.has(request.field_code)) {
    normalizedValue = normalizedValue === null ? null : Number(extractNumber(String(normalizedValue), 0));
    if (
      (request.field_code === "budget_range_high_rmb" || request.field_code === "budget_range_low_rmb") &&
      normalizedValue &&
      normalizedValue < 1000
    ) {
      normalizedValue = normalizedValue * 10000;
    }
  }

  makePatch(session, request.field_code, normalizedValue, "dashboard_edit", 1, false);
  session.export_payload_stale = true;
  reconcileDerivedSessionState(session);
  const fieldLabel = session.dashboard_fields[request.field_code]?.label ?? request.field_code;
  appendSessionMessage(session, "ai", `已更新「${fieldLabel}」，后续方案建议和交付整理会按这个口径继续。`);
  session.state_version += 1;
  session.updated_at = now();
  if (session.project_id) {
    syncProjectFromSession(session.project_id, session);
  }
  saveSession(session);

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
      total_it_load_kw: session.suggestion?.totalItLoadKw ?? null,
      recommended_ups_capacity_kva: session.suggestion?.upsCapacityKva ?? null,
      recommended_precision_ac_model_kw: session.suggestion?.coolingModelKw ?? null,
      estimated_bom_cost_rmb: session.suggestion?.estimatedBomCostRmb ?? null
    },
    triggered_risks: session.triggered_risks,
    agent_silent_event: {
      event: "onDashboardFieldCommit",
      field_code: request.field_code,
      old_value: oldValue,
      new_value: normalizedValue
    },
    ai_notice: `已更新「${fieldLabel}」，并同步到项目资料。`,
    suggestion: session.suggestion
  };

  return response(session, data);
}

export interface ExportGateOptions {
  session_id: string;
  payment_mode?: "simulate_99_rmb" | "credit" | "free_preview";
  approved?: boolean;
}

export function getSessionExport(params: ExportGateOptions, user: PublicUser | null = null) {
  if (!params.session_id) throw new ApiValidationError("session_id is required.");
  const session = loadOrCreateSession(params.session_id, null, user);
  const paymentMode = params.payment_mode ?? "credit";
  const approved = params.approved ?? false;
  const isPreview = paymentMode === "free_preview";
  const creditsBalance = user?.export_credits ?? null;
  const adminBypass = !user || user.role === "admin";

  if (!isPreview && !approved) {
    return {
      status: 402,
      body: {
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
          mode: "credit",
          amount_rmb: 99,
          currency: "CNY",
          status: "payment_required",
          credits_required: 1,
          credits_balance: creditsBalance,
          admin_bypass: adminBypass,
          actions: [
            { id: "pay_99_rmb", label: "确认生成正式稿" },
            { id: "free_preview", label: "先看预览稿" },
            { id: "cancel", label: "暂时不用" }
          ]
        }
      }
    };
  }

  if (!isPreview && !adminBypass && user && user.export_credits < 1) {
    return {
      status: 402,
      body: {
        ok: false,
        session_id: session.session_id,
        state_version: session.state_version,
        server_time: now(),
        error: {
          code: "NO_CREDITS",
          message: "导出额度不足，请先兑换激活码。",
          retryable: true
        },
        billing_check: {
          mode: "credit",
          amount_rmb: 99,
          currency: "CNY",
          status: "no_credits",
          credits_required: 1,
          credits_balance: user.export_credits,
          admin_bypass: false,
          actions: [
            { id: "redeem_code", label: "兑换激活码" },
            { id: "free_preview", label: "先看预览稿" },
            { id: "cancel", label: "暂时不用" }
          ]
        }
      }
    };
  }

  let creditsAfter = creditsBalance;
  let transactionId = `intent_${Date.now()}`;
  if (!isPreview && !adminBypass && user) {
    creditsAfter = debitExportCredit(user.user_id, session.session_id);
    transactionId = `credit_${Date.now()}`;
  }

  session.payment_willingness_99_rmb = isPreview ? "maybe_preview_first" : true;
  if (!isPreview) {
    session.export_status = "exported";
  }
  session.export_payload_stale = false;
  session.state_version += 1;
  session.updated_at = now();
  const project = session.project_id ? getProject(session.project_id) : null;
  const exportPayload = buildExportPayload(session, project, {
    export_type: isPreview ? "preview_pdf" : "docx_requirement_sheet"
  });
  const renderedDocument = isPreview
    ? renderExportPreviewPdf(exportPayload)
    : renderExportDocx(exportPayload);
  saveSession(session);

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
      mode: isPreview ? "free_preview" : "credit",
      amount_rmb: isPreview ? 0 : 99,
      currency: "CNY",
      status: isPreview ? "free_preview" : "approved",
      credits_balance: creditsAfter,
      transaction_id: transactionId
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

export function getSessionSnapshot(sessionId: string, user: PublicUser | null = null) {
  const session = sessions.get(sessionId) ?? loadSession(sessionId);
  if (!session) {
    throw sessionNotFoundError();
  }
  if (!canAccessSession(session, user)) {
    throw forbiddenError();
  }
  if (reconcileDerivedSessionState(session)) {
    saveSession(session);
  }
  sessions.set(sessionId, session);
  const project = session.project_id ? getProject(session.project_id) : null;
  return {
    session: toSessionSnapshotSession(session),
    project: project
      ? {
          project_id: project.project_id,
          project_name: project.project_name,
          stage: project.stage
        }
      : null
  } satisfies SessionSnapshotData;
}

export function getSessionCount() {
  return countSessions();
}

export type { SuggestionSummary };

export class ApiValidationError extends Error {
  status = 400;
  code = "VALIDATION_ERROR";
  retryable = false;
}
