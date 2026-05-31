import type { BackendProject, BackendSession, DashboardField, RiskFlag, SuggestionSummary } from "./types.js";

export const EXPORT_PAYLOAD_VERSION = "v1";
export const EXPORT_TEMPLATE_VERSION = "2026.05";
export const PRICE_PLACEHOLDER = "[Please manually enter your local channel price here]";

export type ExportPayloadVersion = typeof EXPORT_PAYLOAD_VERSION;
export type ExportDocumentType = "docx_requirement_sheet" | "docx_technical_proposal" | "preview_pdf";
export type ExportPricingMode = "manual_placeholder" | "approved_price_source";
export type ExportCalculationStatus = "confirmed" | "provisional" | "blocked";
export type ExportCustomerIndustry =
  | "medical"
  | "government"
  | "education"
  | "enterprise"
  | "industrial"
  | "carrier"
  | "unknown";
export type ExportProjectType =
  | "new_build"
  | "renovation"
  | "expansion"
  | "migration"
  | "maintenance"
  | "unknown";
export type ExportRedundancyMode = "N" | "N+1" | "2N" | "unknown";
export type ExportChapterId =
  | "COVER_AND_CATALOG"
  | "CHAPTER_1_PROJECT_OVERVIEW"
  | "CHAPTER_2_CIVIL_STRUCTURAL_REINFORCEMENT"
  | "CHAPTER_3_POWER_UPS"
  | "CHAPTER_4_PRECISION_AC_FRESH_AIR"
  | "CHAPTER_5_MONITORING_FIRE_CABLING_FITOUT"
  | "CHAPTER_6_RISK_REGISTER"
  | "CHAPTER_7_COMMERCIAL_PLACEHOLDER_APPENDIX";

export interface ExportFieldSnapshot {
  field_code: string;
  label: string;
  value: string | number | null;
  display_value: string;
  source: DashboardField["source"];
  confidence: number;
  needs_confirmation: boolean;
  required_for_export: boolean;
}

export interface ExportCalculationOutputs {
  avg_power_per_rack_kw: number | null;
  total_it_load_kw: number | null;
  redundancy_factor: number | null;
  required_ups_capacity_kva_raw: number | null;
  recommended_ups_capacity_kva: number | null;
  room_thermal_density_kw_per_m2: number | null;
  room_thermal_load_kw: number | null;
  cooling_safety_margin_factor: number | null;
  required_cooling_capacity_kw_raw: number | null;
  recommended_precision_ac_model_kw: number | null;
  cooling_redundancy: ExportRedundancyMode;
}

export interface ExportRiskFlag extends RiskFlag {
  title: string;
  render_behavior: "must_show" | "show_if_unresolved" | "optional_summary";
}

export interface ForcedDocumentInjection {
  id: string;
  chapter_id: "STEEL_STRUCTURE_LOAD_REINFORCEMENT";
  chapter_title: "第二章 土建条件与 Steel Structure Load加固";
  risk_id: string;
  required: true;
  reason: string;
}

export interface ExportScope {
  civil_work: boolean;
  structural_reinforcement: boolean;
  power_distribution: boolean;
  ups: boolean;
  battery: boolean;
  pdu: boolean;
  cooling: boolean;
  precision_ac: boolean;
  fresh_air: boolean;
  monitoring: boolean;
  fire: boolean;
  cabling: boolean;
  fitout: boolean;
}

export interface ExportPriceCell {
  semantic_type:
    | "unit_price"
    | "subtotal_price"
    | "labor_price"
    | "transport_price"
    | "commissioning_price"
    | "tax_amount"
    | "total_project_price";
  value: number | null;
  currency: "CNY";
  rendering: "yellow_placeholder" | "approved_price";
  placeholder_text: string;
  highlight_color: "#FFF2CC";
  font_color: "#9C6500";
}

export interface ExportBomLine {
  id: string;
  category: "ups" | "battery" | "pdu" | "cooling" | "monitoring" | "fire" | "cabling" | "fitout" | "service";
  item_name: string;
  specification: string;
  quantity: number | string;
  unit: string;
  unit_price: ExportPriceCell;
  subtotal_price: ExportPriceCell;
  remark: string;
  source: "calculation_default" | "manual_placeholder" | "quotation_reference" | "dashboard_edit";
}

export interface ExportBom {
  ups: ExportBomLine[];
  battery: ExportBomLine[];
  pdu: ExportBomLine[];
  cooling: ExportBomLine[];
  auxiliary: ExportBomLine[];
}

export interface ExportCommercial {
  pricing_mode: ExportPricingMode;
  currency: "CNY";
  price_placeholder_text: string;
  quotation_references: Array<{
    source_file: string;
    item_name: string;
    note: string;
  }>;
  disclaimer: string;
}

export interface ExportOpenItem {
  field_code: string;
  label: string;
  current_value: string | number | null;
  reason: "missing_required_field" | "needs_confirmation" | "risk_followup";
  suggested_followup: string;
}

export interface ExportChapterPlanItem {
  id: ExportChapterId;
  order: number;
  title: string;
  required: boolean;
  inclusion_reason: string;
  source_paths: string[];
}

export interface ExportRenderFlags {
  preserve_requested_chapter_numbers: true;
  price_cells_must_use_placeholders: boolean;
  chapter_2_required: boolean;
  visible_draft_warning_required: boolean;
}

export interface ExportMetadata {
  generated_at: string;
  generated_by: "Data Center Pre-sales AI Agent";
  document_type: "technical_proposal";
  export_type: ExportDocumentType;
  pricing_mode: ExportPricingMode;
  template_version: typeof EXPORT_TEMPLATE_VERSION;
  calculation_status: ExportCalculationStatus;
  render_mode: "deterministic_template_with_llm_blocks";
}

export interface ExportPayloadValidation {
  status: "passed" | "warning" | "blocked";
  missing_required_fields: string[];
  checks: Array<{
    id: string;
    status: "passed" | "warning" | "blocked";
    message: string;
  }>;
}

export interface ExportPayloadV1 {
  version: ExportPayloadVersion;
  session_id: string;
  state_version: number;
  customer_name: string;
  project_name: string;
  customer_industry: ExportCustomerIndustry;
  project_type: ExportProjectType;
  room_area_m2: number | null;
  room_floor: number | null;
  rack_count: number | null;
  server_count: number | null;
  redundancy_mode: ExportRedundancyMode;
  ups_backup_time_minutes: number | null;
  calculation_outputs: ExportCalculationOutputs;
  risk_flags: ExportRiskFlag[];
  forced_document_injections: ForcedDocumentInjection[];
  bom: ExportBom;
  scope: ExportScope;
  commercial: ExportCommercial;
  field_metadata: ExportFieldSnapshot[];
  open_items: ExportOpenItem[];
  chapter_plan: ExportChapterPlanItem[];
  render_flags: ExportRenderFlags;
  export_metadata: ExportMetadata;
  validation: ExportPayloadValidation;
}

const fieldOrder = [
  ["customer_name", "客户名称", true],
  ["project_name", "项目名称", true],
  ["customer_industry", "客户行业", true],
  ["project_type", "项目类型", true],
  ["room_area_m2", "机房面积", true],
  ["room_floor", "所在楼层", true],
  ["rack_count", "计划机柜数", true],
  ["server_count", "服务器数量", false],
  ["avg_power_per_rack_kw", "单柜平均功率", false],
  ["redundancy_mode", "UPS冗余模式", false],
  ["ups_backup_time_minutes", "UPS后备时间", true],
  ["cooling_redundancy", "制冷冗余模式", false],
  ["brand_preference", "品牌偏好", false],
  ["budget_range_high_rmb", "项目预算范围", false]
] as const;

function now() {
  return new Date().toISOString();
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function readValue(session: BackendSession, code: string) {
  return session.dashboard_fields[code]?.value ?? null;
}

function readString(session: BackendSession, code: string) {
  const value = readValue(session, code);
  if (value === null || value === "") return null;
  return String(value);
}

function readNumber(session: BackendSession, code: string) {
  const value = readValue(session, code);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function canonicalIndustry(value: string | null): ExportCustomerIndustry {
  if (
    value === "medical" ||
    value === "government" ||
    value === "education" ||
    value === "enterprise" ||
    value === "industrial" ||
    value === "carrier"
  ) {
    return value;
  }
  return "unknown";
}

function canonicalProjectType(value: string | null): ExportProjectType {
  if (
    value === "new_build" ||
    value === "renovation" ||
    value === "expansion" ||
    value === "migration" ||
    value === "maintenance"
  ) {
    return value;
  }
  return "unknown";
}

function canonicalRedundancy(value: string | null): ExportRedundancyMode {
  if (value === "N" || value === "N+1" || value === "2N") return value;
  return "unknown";
}

function fieldSnapshot(
  session: BackendSession,
  code: string,
  label: string,
  required: boolean
): ExportFieldSnapshot {
  const existing = session.dashboard_fields[code];
  return {
    field_code: code,
    label: existing?.label ?? label,
    value: existing?.value ?? null,
    display_value: existing?.displayValue ?? "待确认",
    source: existing?.source ?? "pending",
    confidence: existing?.confidence ?? 0,
    needs_confirmation: existing?.needs_confirmation ?? true,
    required_for_export: required
  };
}

function buildFieldMetadata(session: BackendSession) {
  const known = new Set<string>(fieldOrder.map(([code]) => code));
  const snapshots = fieldOrder.map(([code, label, required]) =>
    fieldSnapshot(session, code, label, required)
  );
  const extraSnapshots = Object.keys(session.dashboard_fields)
    .filter((code) => !known.has(code))
    .sort()
    .map((code) => {
      const existing = session.dashboard_fields[code];
      return fieldSnapshot(session, code, existing?.label ?? code, false);
    });
  return [...snapshots, ...extraSnapshots];
}

function riskTitle(risk: RiskFlag) {
  if (risk.id === "RULE_FLOOR_LOADING") return "Structural Loading Deficit Risk";
  if (risk.id === "RULE_ELEVATOR_HEIGHT") return "Chassis Transport Risk";
  return risk.id;
}

function riskRenderBehavior(risk: RiskFlag): ExportRiskFlag["render_behavior"] {
  if (risk.level === "P0_BLOCKER" || risk.level === "P1_HIGH") return "must_show";
  if (risk.level === "P2_MEDIUM") return "show_if_unresolved";
  return "optional_summary";
}

function buildRiskFlags(risks: RiskFlag[]) {
  return risks.map((risk) => ({
    ...risk,
    title: riskTitle(risk),
    render_behavior: riskRenderBehavior(risk)
  }));
}

function buildForcedDocumentInjections(risks: ExportRiskFlag[]): ForcedDocumentInjection[] {
  return risks
    .filter((risk) => risk.id === "RULE_FLOOR_LOADING")
    .map((risk) => ({
      id: "inj_steel_structure_load_reinforcement",
      chapter_id: "STEEL_STRUCTURE_LOAD_REINFORCEMENT",
      chapter_title: "第二章 土建条件与 Steel Structure Load加固",
      risk_id: risk.id,
      required: true,
      reason: risk.text
    }));
}

function redundancyFactor(mode: ExportRedundancyMode) {
  if (mode === "N") return 1;
  if (mode === "N+1") return 1.25;
  if (mode === "2N") return 2;
  return null;
}

function buildCalculationOutputs(
  session: BackendSession,
  redundancy_mode: ExportRedundancyMode,
  cooling_redundancy: ExportRedundancyMode
): ExportCalculationOutputs {
  const rackCount = readNumber(session, "rack_count");
  const roomArea = readNumber(session, "room_area_m2");
  const avgPower = readNumber(session, "avg_power_per_rack_kw") ?? (rackCount ? 3 : null);
  const totalItLoad = rackCount && avgPower ? round2(rackCount * avgPower) : null;
  const factor = redundancyFactor(redundancy_mode) ?? 1.25;
  const requiredUpsRaw = totalItLoad ? round2(totalItLoad * factor) : null;
  const roomThermalDensity = roomArea ? 0.35 : null;
  const roomThermalLoad = roomArea && roomThermalDensity ? round2(roomArea * roomThermalDensity) : null;
  const coolingSafety = totalItLoad || roomThermalLoad ? 1.15 : null;
  const requiredCoolingRaw =
    coolingSafety && (totalItLoad || roomThermalLoad)
      ? round2(Math.max(totalItLoad ?? 0, roomThermalLoad ?? 0) * coolingSafety)
      : null;

  return {
    avg_power_per_rack_kw: avgPower,
    total_it_load_kw: totalItLoad,
    redundancy_factor: factor,
    required_ups_capacity_kva_raw: requiredUpsRaw,
    recommended_ups_capacity_kva: session.suggestion?.upsCapacityKva ?? requiredUpsRaw,
    room_thermal_density_kw_per_m2: roomThermalDensity,
    room_thermal_load_kw: roomThermalLoad,
    cooling_safety_margin_factor: coolingSafety,
    required_cooling_capacity_kw_raw: requiredCoolingRaw,
    recommended_precision_ac_model_kw: session.suggestion?.coolingModelKw ?? requiredCoolingRaw,
    cooling_redundancy
  };
}

function buildScope(
  session: BackendSession,
  calculation_outputs: ExportCalculationOutputs,
  risks: ExportRiskFlag[]
): ExportScope {
  const hasRackScale = Boolean(readNumber(session, "rack_count"));
  const hasRoomArea = Boolean(readNumber(session, "room_area_m2"));
  const hasBackup = Boolean(readNumber(session, "ups_backup_time_minutes"));
  const hasStructuralRisk = risks.some((risk) => risk.id === "RULE_FLOOR_LOADING");
  const hasUps = hasBackup || Boolean(calculation_outputs.recommended_ups_capacity_kva);
  const hasCooling = hasRoomArea || Boolean(calculation_outputs.recommended_precision_ac_model_kw);

  return {
    civil_work: hasRoomArea || hasStructuralRisk,
    structural_reinforcement: hasStructuralRisk,
    power_distribution: hasRackScale || hasUps,
    ups: hasUps,
    battery: hasBackup,
    pdu: hasRackScale,
    cooling: hasCooling,
    precision_ac: hasCooling,
    fresh_air: hasRoomArea,
    monitoring: false,
    fire: false,
    cabling: hasRackScale,
    fitout: hasRoomArea
  };
}

function priceCell(semantic_type: ExportPriceCell["semantic_type"]): ExportPriceCell {
  return {
    semantic_type,
    value: null,
    currency: "CNY",
    rendering: "yellow_placeholder",
    placeholder_text: PRICE_PLACEHOLDER,
    highlight_color: "#FFF2CC",
    font_color: "#9C6500"
  };
}

function bomLine(
  id: string,
  category: ExportBomLine["category"],
  item_name: string,
  specification: string,
  quantity: number | string,
  unit: string,
  remark: string,
  source: ExportBomLine["source"] = "calculation_default"
): ExportBomLine {
  return {
    id,
    category,
    item_name,
    specification,
    quantity,
    unit,
    unit_price: priceCell("unit_price"),
    subtotal_price: priceCell("subtotal_price"),
    remark,
    source
  };
}

function buildBom(
  session: BackendSession,
  calculation_outputs: ExportCalculationOutputs,
  scope: ExportScope
): ExportBom {
  const recommendedUps = calculation_outputs.recommended_ups_capacity_kva;
  const coolingModel = calculation_outputs.recommended_precision_ac_model_kw;
  const rackCount = readNumber(session, "rack_count");
  const backupMinutes = readNumber(session, "ups_backup_time_minutes");
  const coolingQuantity = calculation_outputs.cooling_redundancy === "N+1" ? 2 : 1;
  const suggestion = session.suggestion as SuggestionSummary | null;

  return {
    ups: scope.ups
      ? [
          bomLine(
            "ups_frame",
            "ups",
            "模块化UPS主机框架",
            `${recommendedUps ?? "待确认"}kVA级模块化UPS机框`,
            1,
            "套",
            "含监控显示与基础通讯接口"
          ),
          bomLine(
            "ups_module",
            "ups",
            "UPS功率模块",
            recommendedUps === 40 ? "20kVA功率模块" : "按推荐容量配置",
            recommendedUps === 40 ? 2 : "待深化",
            "块",
            "最终数量以品牌选型为准"
          ),
          bomLine(
            "ups_distribution",
            "ups",
            "UPS输入输出配电",
            "输入、输出、维修旁路配套",
            1,
            "项",
            "以现场深化为准"
          ),
          bomLine(
            "ups_commissioning",
            "service",
            "UPS安装调试",
            "安装、接线、基础调试",
            1,
            "项",
            "不含特殊搬运"
          )
        ]
      : [],
    battery: scope.battery
      ? [
          bomLine(
            "battery_bank",
            "battery",
            "UPS Battery Bank",
            "电池规格待深化",
            "待深化",
            "组",
            `后备时间按 ${backupMinutes ?? suggestion?.batteryRuntimeMinutes ?? "待确认"} 分钟口径记录，需结合UPS品牌、电池规格和放电曲线复核`
          )
        ]
      : [],
    pdu: scope.pdu
      ? [
          bomLine(
            "rack_pdu",
            "pdu",
            "机柜PDU",
            "32A / 220V 或按现场深化",
            rackCount ?? "按机柜数量配置",
            "条",
            "建议A/B路分配"
          ),
          bomLine(
            "output_circuit",
            "pdu",
            "配电柜输出回路",
            "按UPS输出容量深化",
            1,
            "项",
            "需结合最终配电系统图"
          )
        ]
      : [],
    cooling: scope.precision_ac
      ? [
          bomLine(
            "precision_ac_indoor",
            "cooling",
            "精密空调室内机",
            `${coolingModel ?? "待确认"}kW级`,
            coolingQuantity,
            "台",
            "含控制器及基础告警接口"
          ),
          bomLine(
            "precision_ac_outdoor",
            "cooling",
            "室外机/冷凝器",
            "与室内机匹配",
            coolingQuantity,
            "台",
            "以品牌选型为准"
          ),
          bomLine(
            "cooling_copper_pipe",
            "cooling",
            "铜管及保温",
            "按现场距离深化",
            1,
            "项",
            "暂按标准距离估算"
          ),
          bomLine("cooling_drain", "cooling", "排水与加湿补水", "按现场条件深化", 1, "项", "需现场确认路由"),
          bomLine(
            "cooling_commissioning",
            "service",
            "安装调试",
            "设备安装、抽真空、调试",
            1,
            "项",
            "不含特殊吊装"
          )
        ]
      : [],
    auxiliary: [
      ...(scope.cabling
        ? [
            bomLine(
              "cabling_placeholder",
              "cabling",
              "综合布线与桥架",
              "按机柜数量和路由深化",
              1,
              "项",
              "用于导出占位，正式方案需现场确认"
            )
          ]
        : []),
      ...(scope.fitout
        ? [
            bomLine(
              "fitout_placeholder",
              "fitout",
              "机房装修配套",
              "防静电地板、接地、防雷等",
              1,
              "项",
              "根据现场条件深化"
            )
          ]
        : [])
    ]
  };
}

function buildCommercial(): ExportCommercial {
  return {
    pricing_mode: "manual_placeholder",
    currency: "CNY",
    price_placeholder_text: PRICE_PLACEHOLDER,
    quotation_references: [],
    disclaimer:
      "本文件由售前辅助系统根据当前会话信息自动整理生成，设备价格、施工费用、税费、运输费用及服务费用需由授权渠道或项目负责人结合当地供货、施工和现场条件人工确认。本文件中的价格占位符不构成正式报价或合同承诺。"
  };
}

function buildOpenItems(fields: ExportFieldSnapshot[], risks: ExportRiskFlag[]) {
  const items: ExportOpenItem[] = fields
    .filter(
      (field) =>
        field.required_for_export && (field.value === null || field.value === "" || field.needs_confirmation)
    )
    .map((field) => ({
      field_code: field.field_code,
      label: field.label,
      current_value: field.value,
      reason: field.value === null || field.value === "" ? "missing_required_field" : "needs_confirmation",
      suggested_followup: `请确认${field.label}，以便正式需求表口径一致。`
    }));

  risks
    .filter((risk) => risk.render_behavior === "must_show")
    .forEach((risk) => {
      items.push({
        field_code: risk.id,
        label: risk.title,
        current_value: risk.text,
        reason: "risk_followup",
        suggested_followup: "请在导出前确认该风险的责任边界、复核动作和是否需要专项章节。"
      });
    });

  return items;
}

export function buildChapterPlan(
  payload: Pick<
    ExportPayloadV1,
    "risk_flags" | "forced_document_injections" | "scope" | "calculation_outputs" | "open_items"
  >
): ExportChapterPlanItem[] {
  const chapters: ExportChapterPlanItem[] = [];
  const add = (
    id: ExportChapterId,
    title: string,
    required: boolean,
    inclusion_reason: string,
    source_paths: string[]
  ) => {
    chapters.push({
      id,
      order: chapters.length,
      title,
      required,
      inclusion_reason,
      source_paths
    });
  };

  add("COVER_AND_CATALOG", "Cover Page & Catalog", true, "templates.md always renders cover and catalog.", [
    "customer_name",
    "project_name",
    "export_metadata.generated_at"
  ]);
  add(
    "CHAPTER_1_PROJECT_OVERVIEW",
    "Project Overview & Medical/Gov Industry Background",
    true,
    "templates.md always renders project overview.",
    ["customer_industry", "project_type", "room_area_m2", "scope"]
  );

  if (
    payload.forced_document_injections.some(
      (item) => item.chapter_id === "STEEL_STRUCTURE_LOAD_REINFORCEMENT"
    )
  ) {
    add(
      "CHAPTER_2_CIVIL_STRUCTURAL_REINFORCEMENT",
      "Civil Works & Structural Reinforcement",
      true,
      "RULE_FLOOR_LOADING forced document injection is present.",
      ["risk_flags", "forced_document_injections", "room_floor", "ups_backup_time_minutes"]
    );
  }

  if (
    payload.scope.ups ||
    payload.scope.power_distribution ||
    payload.calculation_outputs.recommended_ups_capacity_kva
  ) {
    add(
      "CHAPTER_3_POWER_UPS",
      "Power Distribution & UPS Engineering",
      true,
      "UPS scope or calculation output exists.",
      ["calculation_outputs", "bom.ups", "bom.battery", "bom.pdu"]
    );
  }

  if (
    payload.scope.cooling ||
    payload.scope.precision_ac ||
    payload.calculation_outputs.recommended_precision_ac_model_kw
  ) {
    add(
      "CHAPTER_4_PRECISION_AC_FRESH_AIR",
      "Precision Air Conditioning & Fresh Air Systems",
      true,
      "Cooling scope or calculation output exists.",
      ["calculation_outputs", "bom.cooling", "scope.fresh_air"]
    );
  }

  if (payload.scope.monitoring || payload.scope.fire || payload.scope.cabling || payload.scope.fitout) {
    add(
      "CHAPTER_5_MONITORING_FIRE_CABLING_FITOUT",
      "Integrated Monitoring, Fire, Cabling & Fitout Scope",
      false,
      "Auxiliary machine-room scope exists.",
      ["scope", "bom.auxiliary"]
    );
  }

  if (payload.risk_flags.length > 0 || payload.open_items.length > 0) {
    add("CHAPTER_6_RISK_REGISTER", "Risk Register & Open Items", true, "Risks or provisional fields exist.", [
      "risk_flags",
      "field_metadata",
      "open_items"
    ]);
  }

  add(
    "CHAPTER_7_COMMERCIAL_PLACEHOLDER_APPENDIX",
    "Commercial Placeholder Appendix",
    true,
    "templates.md always renders commercial appendix.",
    ["bom", "commercial", "commercial.pricing_mode"]
  );

  return chapters;
}

export function validateExportPayload(payload: ExportPayloadV1): ExportPayloadValidation {
  const missingRequiredFields = payload.field_metadata
    .filter((field) => field.required_for_export && (field.value === null || field.value === ""))
    .map((field) => field.field_code);
  const checks: ExportPayloadValidation["checks"] = [];

  checks.push({
    id: "cover_fields_resolved_or_marked_pending",
    status: payload.customer_name && payload.project_name ? "passed" : "warning",
    message: "Cover page fields have fallbacks when source values are missing."
  });
  checks.push({
    id: "chapter_2_requires_floor_loading_risk",
    status:
      payload.render_flags.chapter_2_required ===
      payload.risk_flags.some((risk) => risk.id === "RULE_FLOOR_LOADING")
        ? "passed"
        : "blocked",
    message: "Structural reinforcement chapter is controlled by RULE_FLOOR_LOADING."
  });
  checks.push({
    id: "price_placeholders_required",
    status: payload.commercial.pricing_mode === "manual_placeholder" ? "passed" : "warning",
    message: "Manual placeholder pricing must render yellow price cells."
  });
  checks.push({
    id: "commercial_disclaimer_present",
    status: payload.commercial.disclaimer.length > 20 ? "passed" : "blocked",
    message: "Commercial appendix disclaimer is present."
  });

  const hasBlocked = checks.some((check) => check.status === "blocked");
  return {
    status: hasBlocked ? "blocked" : missingRequiredFields.length ? "warning" : "passed",
    missing_required_fields: missingRequiredFields,
    checks
  };
}

export function buildExportPayload(
  session: BackendSession,
  project: BackendProject | null,
  options: { export_type?: ExportDocumentType; generated_at?: string } = {}
): ExportPayloadV1 {
  const generatedAt = options.generated_at ?? now();
  const customerName = readString(session, "customer_name") ?? "客户名称待确认";
  const projectName =
    project?.project_name ??
    readString(session, "project_name") ??
    `${customerName === "客户名称待确认" ? "客户" : customerName}数据中心机房建设项目`;
  const customerIndustry = canonicalIndustry(readString(session, "customer_industry"));
  const projectType = canonicalProjectType(readString(session, "project_type"));
  const redundancyMode = canonicalRedundancy(readString(session, "redundancy_mode"));
  const coolingRedundancy = canonicalRedundancy(
    readString(session, "cooling_redundancy") ?? session.suggestion?.coolingRedundancy ?? null
  );
  const calculationOutputs = buildCalculationOutputs(session, redundancyMode, coolingRedundancy);
  const riskFlags = buildRiskFlags(session.triggered_risks);
  const forcedDocumentInjections = buildForcedDocumentInjections(riskFlags);
  const scope = buildScope(session, calculationOutputs, riskFlags);
  const fieldMetadata = buildFieldMetadata(session);
  const openItems = buildOpenItems(fieldMetadata, riskFlags);
  const calculationStatus: ExportCalculationStatus =
    !readNumber(session, "room_area_m2") && !readNumber(session, "rack_count")
      ? "blocked"
      : openItems.some(
            (item) => item.reason === "missing_required_field" || item.reason === "needs_confirmation"
          )
        ? "provisional"
        : "confirmed";

  const payload: ExportPayloadV1 = {
    version: EXPORT_PAYLOAD_VERSION,
    session_id: session.session_id,
    state_version: session.state_version,
    customer_name: customerName,
    project_name: projectName,
    customer_industry: customerIndustry,
    project_type: projectType,
    room_area_m2: readNumber(session, "room_area_m2"),
    room_floor: readNumber(session, "room_floor"),
    rack_count: readNumber(session, "rack_count"),
    server_count: readNumber(session, "server_count"),
    redundancy_mode: redundancyMode,
    ups_backup_time_minutes: readNumber(session, "ups_backup_time_minutes"),
    calculation_outputs: calculationOutputs,
    risk_flags: riskFlags,
    forced_document_injections: forcedDocumentInjections,
    bom: buildBom(session, calculationOutputs, scope),
    scope,
    commercial: buildCommercial(),
    field_metadata: fieldMetadata,
    open_items: openItems,
    chapter_plan: [],
    render_flags: {
      preserve_requested_chapter_numbers: true,
      price_cells_must_use_placeholders: true,
      chapter_2_required: forcedDocumentInjections.length > 0,
      visible_draft_warning_required: calculationStatus === "blocked"
    },
    export_metadata: {
      generated_at: generatedAt,
      generated_by: "Data Center Pre-sales AI Agent",
      document_type: "technical_proposal",
      export_type: options.export_type ?? "docx_requirement_sheet",
      pricing_mode: "manual_placeholder",
      template_version: EXPORT_TEMPLATE_VERSION,
      calculation_status: calculationStatus,
      render_mode: "deterministic_template_with_llm_blocks"
    },
    validation: {
      status: "passed",
      missing_required_fields: [],
      checks: []
    }
  };

  payload.chapter_plan = buildChapterPlan(payload);
  payload.validation = validateExportPayload(payload);
  return payload;
}
