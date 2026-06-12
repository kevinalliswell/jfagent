import type { DashboardField, RiskFlag, SuggestionSummary } from "./types.js";

/**
 * Deterministic pre-sales expert engine (implements docs/specs-future/rules.md).
 *
 * The engine consumes normalized dashboard fields and produces:
 * - UPS / cooling / battery sizing minima
 * - an internal reference BOM cost estimate (NOT a quotation)
 * - backend-enforced risk flags (P0-P2)
 * - prompts the conversational agent must surface
 *
 * The LLM may explain these outputs but can never lower or suppress them.
 */

export type EngineCalculationStatus = "confirmed" | "provisional" | "blocked";

export interface EngineInputs {
  rack_count: number | null;
  avg_power_per_rack_kw: number | null;
  redundancy_mode: "N" | "N+1" | "2N" | null;
  cooling_redundancy: "N" | "N+1" | "2N" | null;
  room_area_m2: number | null;
  room_floor: number | null;
  ups_backup_time_minutes: number | null;
  budget_range_low_rmb: number | null;
  budget_range_high_rmb: number | null;
}

export interface EngineAuditEvent {
  level: "info" | "warning";
  code: string;
  field?: string;
  value?: string | number;
  message: string;
}

export interface UpsEngineResult {
  status: EngineCalculationStatus;
  error_code: string | null;
  total_it_load_kw: number | null;
  redundancy_factor: number | null;
  required_ups_capacity_kva_raw: number | null;
  recommended_ups_capacity_kva: number | null;
}

export interface CoolingEngineResult {
  status: EngineCalculationStatus;
  error_code: string | null;
  room_area_m2_used: number | null;
  room_thermal_density_kw_per_m2: number | null;
  room_thermal_load_kw: number | null;
  total_thermal_load_kw: number | null;
  cooling_safety_margin_factor: number | null;
  required_cooling_capacity_kw_raw: number | null;
  recommended_precision_ac_model_kw: number | null;
  running_unit_count: number | null;
  total_unit_count: number | null;
  cooling_redundancy: "N" | "N+1" | "2N";
}

export interface BatteryEngineResult {
  status: EngineCalculationStatus;
  backup_minutes_used: number | null;
  battery_spec: string;
  string_count: number | null;
  battery_count: number | null;
  note: string;
}

export interface EstimateLine {
  id: string;
  category: "ups" | "battery" | "pdu" | "cooling" | "monitoring" | "fire" | "cabling" | "fitout" | "service";
  name: string;
  spec: string;
  quantity: number;
  unit: string;
  unit_price_rmb: number;
  subtotal_rmb: number;
}

export interface BomEstimate {
  status: EngineCalculationStatus;
  lines: EstimateLine[];
  equipment_subtotal_rmb: number | null;
  service_subtotal_rmb: number | null;
  total_rmb: number | null;
  low_rmb: number | null;
  high_rmb: number | null;
  budget_floor_rmb: number | null;
  disclaimer: string;
}

export interface EngineEvaluation {
  inputs: EngineInputs;
  calculation_status: EngineCalculationStatus;
  ups: UpsEngineResult;
  cooling: CoolingEngineResult;
  battery: BatteryEngineResult;
  bom_estimate: BomEstimate;
  risk_flags: RiskFlag[];
  agent_required_prompts: string[];
  audit_log: EngineAuditEvent[];
}

export const ENGINE_DEFAULTS = {
  avg_power_per_rack_kw: 3.0,
  redundancy_mode: "N+1" as const,
  cooling_redundancy: "N+1" as const,
  room_thermal_density_kw_per_m2: 0.08,
  cooling_safety_margin_factor: 1.15,
  budget_mismatch_factor: 1.3,
  assumed_area_per_rack_m2: 4,
  legacy_budget_floor_rmb: 450000
};

export const STANDARD_UPS_SIZES_KVA = [10, 20, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300, 400, 500];
export const COOLING_MODEL_CATALOG_KW = [25, 40, 60, 80, 100];

/**
 * Internal reference unit prices (CNY, tax-included, mid-market 2026).
 * Used ONLY for the budget-mismatch rule and internal estimate panel —
 * never rendered as a customer-facing quotation.
 */
const REFERENCE_PRICES = {
  ups_per_kva_small: 1100,
  ups_per_kva_large: 950,
  battery_12v100ah: 680,
  battery_cabinet_per_string: 9000,
  cooling_per_kw: 2800,
  rack_42u: 3200,
  pdu_32a: 750,
  distribution_cabinet: 28000,
  fire_per_m2: 420,
  fire_min: 30000,
  monitoring_base: 35000,
  monitoring_per_rack: 600,
  floor_per_m2: 320,
  fitout_per_m2: 850,
  cabling_base: 9000,
  cabling_per_rack: 1200,
  grounding_lightning: 15000,
  install_factor: 0.1
};

export const ESTIMATE_DISCLAIMER =
  "内部参考估算口径：按行业中位参考单价测算，仅用于预算匹配判断与售前沟通，不构成正式报价。正式报价需按品牌选型、渠道价、税费、运输与现场施工条件人工确认。";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function roundUpToStandardUpsSize(requiredKva: number) {
  for (const size of STANDARD_UPS_SIZES_KVA) {
    if (size >= requiredKva) return size;
  }
  return Math.ceil(requiredKva / 100) * 100;
}

function readNumber(fields: Record<string, DashboardField>, code: string) {
  const value = fields[code]?.value ?? null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function readRedundancy(fields: Record<string, DashboardField>, code: string): "N" | "N+1" | "2N" | null {
  const value = fields[code]?.value;
  if (value === "N" || value === "N+1" || value === "2N") return value;
  if (typeof value === "string") {
    const upper = value.toUpperCase().replace(/\s/g, "");
    if (upper === "N" || upper === "N+1" || upper === "2N") return upper as "N" | "N+1" | "2N";
  }
  return null;
}

export function normalizeEngineInputs(fields: Record<string, DashboardField>): EngineInputs {
  return {
    rack_count: readNumber(fields, "rack_count"),
    avg_power_per_rack_kw: readNumber(fields, "avg_power_per_rack_kw"),
    redundancy_mode: readRedundancy(fields, "redundancy_mode"),
    cooling_redundancy: readRedundancy(fields, "cooling_redundancy"),
    room_area_m2: readNumber(fields, "room_area_m2"),
    room_floor: readNumber(fields, "room_floor"),
    ups_backup_time_minutes: readNumber(fields, "ups_backup_time_minutes"),
    budget_range_low_rmb: readNumber(fields, "budget_range_low_rmb"),
    budget_range_high_rmb: readNumber(fields, "budget_range_high_rmb")
  };
}

function redundancyFactor(mode: "N" | "N+1" | "2N") {
  if (mode === "N") return 1;
  if (mode === "2N") return 2;
  return 1.25;
}

function calculateUps(inputs: EngineInputs, audit: EngineAuditEvent[]): UpsEngineResult {
  if (!inputs.rack_count || inputs.rack_count <= 0) {
    return {
      status: "blocked",
      error_code: "MISSING_RACK_COUNT",
      total_it_load_kw: null,
      redundancy_factor: null,
      required_ups_capacity_kva_raw: null,
      recommended_ups_capacity_kva: null
    };
  }

  let provisional = false;
  let avgPower = inputs.avg_power_per_rack_kw;
  if (!avgPower || avgPower <= 0) {
    avgPower = ENGINE_DEFAULTS.avg_power_per_rack_kw;
    provisional = true;
    audit.push({
      level: "info",
      code: "DEFAULT_ASSUMPTION_USED",
      field: "avg_power_per_rack_kw",
      value: avgPower,
      message: "单柜平均功率未确认，按默认 3.0kW/柜 暂估。"
    });
  }

  let mode = inputs.redundancy_mode;
  if (!mode) {
    mode = ENGINE_DEFAULTS.redundancy_mode;
    provisional = true;
    audit.push({
      level: "info",
      code: "DEFAULT_ASSUMPTION_USED",
      field: "redundancy_mode",
      value: mode,
      message: "UPS冗余模式未确认，按 N+1 暂估。"
    });
  }

  const factor = redundancyFactor(mode);
  const totalItLoad = round2(inputs.rack_count * avgPower);
  const requiredRaw = round2(totalItLoad * factor);
  const recommended = roundUpToStandardUpsSize(requiredRaw);

  return {
    status: provisional ? "provisional" : "confirmed",
    error_code: null,
    total_it_load_kw: totalItLoad,
    redundancy_factor: factor,
    required_ups_capacity_kva_raw: requiredRaw,
    recommended_ups_capacity_kva: recommended
  };
}

function calculateCooling(
  inputs: EngineInputs,
  ups: UpsEngineResult,
  audit: EngineAuditEvent[]
): CoolingEngineResult {
  const coolingRedundancy = inputs.cooling_redundancy ?? ENGINE_DEFAULTS.cooling_redundancy;
  const blockedResult = (errorCode: string): CoolingEngineResult => ({
    status: "blocked",
    error_code: errorCode,
    room_area_m2_used: null,
    room_thermal_density_kw_per_m2: null,
    room_thermal_load_kw: null,
    total_thermal_load_kw: null,
    cooling_safety_margin_factor: null,
    required_cooling_capacity_kw_raw: null,
    recommended_precision_ac_model_kw: null,
    running_unit_count: null,
    total_unit_count: null,
    cooling_redundancy: coolingRedundancy
  });

  if (ups.total_it_load_kw === null) {
    return blockedResult("MISSING_IT_LOAD_ANCHOR");
  }

  let provisional = ups.status === "provisional";
  let area = inputs.room_area_m2;
  if (!area || area <= 0) {
    if (!inputs.rack_count) return blockedResult("MISSING_ROOM_AREA");
    area = inputs.rack_count * ENGINE_DEFAULTS.assumed_area_per_rack_m2;
    provisional = true;
    audit.push({
      level: "info",
      code: "DEFAULT_ASSUMPTION_USED",
      field: "room_area_m2",
      value: area,
      message: `机房面积未确认，按 ${ENGINE_DEFAULTS.assumed_area_per_rack_m2}㎡/柜 暂估为 ${area}㎡。`
    });
  }

  if (!inputs.cooling_redundancy) {
    provisional = true;
    audit.push({
      level: "info",
      code: "DEFAULT_ASSUMPTION_USED",
      field: "cooling_redundancy",
      value: coolingRedundancy,
      message: "制冷冗余模式未确认，按 N+1 暂估。"
    });
  }

  const density = ENGINE_DEFAULTS.room_thermal_density_kw_per_m2;
  const margin = ENGINE_DEFAULTS.cooling_safety_margin_factor;
  const roomThermalLoad = round2(area * density);
  const totalThermalLoad = round2(roomThermalLoad + ups.total_it_load_kw);
  const requiredRaw = round2(totalThermalLoad * margin);

  const catalog = [...COOLING_MODEL_CATALOG_KW].sort((left, right) => left - right);
  let model: number | null = null;
  let runningUnits = 1;
  for (const candidate of catalog) {
    if (candidate >= requiredRaw) {
      model = candidate;
      break;
    }
  }
  if (model === null) {
    const largest = catalog[catalog.length - 1];
    runningUnits = Math.ceil(requiredRaw / largest);
    model = largest;
  }

  const totalUnits =
    coolingRedundancy === "2N"
      ? runningUnits * 2
      : coolingRedundancy === "N+1"
        ? runningUnits + 1
        : runningUnits;

  return {
    status: provisional ? "provisional" : "confirmed",
    error_code: null,
    room_area_m2_used: area,
    room_thermal_density_kw_per_m2: density,
    room_thermal_load_kw: roomThermalLoad,
    total_thermal_load_kw: totalThermalLoad,
    cooling_safety_margin_factor: margin,
    required_cooling_capacity_kw_raw: requiredRaw,
    recommended_precision_ac_model_kw: model,
    running_unit_count: runningUnits,
    total_unit_count: totalUnits,
    cooling_redundancy: coolingRedundancy
  };
}

const BATTERY_SPEC = "12V/100Ah 阀控式铅酸";
const BATTERY_STRING_CELLS = 32;
const BATTERY_STRING_USABLE_KWH = (384 * 100 * 0.8) / 1000;

function calculateBattery(inputs: EngineInputs, ups: UpsEngineResult): BatteryEngineResult {
  if (ups.total_it_load_kw === null || !inputs.ups_backup_time_minutes) {
    return {
      status: "blocked",
      backup_minutes_used: inputs.ups_backup_time_minutes,
      battery_spec: BATTERY_SPEC,
      string_count: null,
      battery_count: null,
      note: "电池规模需先确认 IT 负载与 UPS 后备时间。"
    };
  }

  const energyKwh = (ups.total_it_load_kw * inputs.ups_backup_time_minutes) / 60;
  const strings = Math.max(1, Math.ceil(energyKwh / BATTERY_STRING_USABLE_KWH));
  const count = strings * BATTERY_STRING_CELLS;

  return {
    status: ups.status,
    backup_minutes_used: inputs.ups_backup_time_minutes,
    battery_spec: BATTERY_SPEC,
    string_count: strings,
    battery_count: count,
    note: `按 ${BATTERY_SPEC}、384V 直流母线、80% 放电深度估算约 ${strings} 串共 ${count} 只，正式配置需按 UPS 品牌放电曲线复核。`
  };
}

function estimateLine(
  id: string,
  category: EstimateLine["category"],
  name: string,
  spec: string,
  quantity: number,
  unit: string,
  unitPrice: number
): EstimateLine {
  return {
    id,
    category,
    name,
    spec,
    quantity,
    unit,
    unit_price_rmb: Math.round(unitPrice),
    subtotal_rmb: Math.round(quantity * unitPrice)
  };
}

function buildBomEstimate(
  inputs: EngineInputs,
  ups: UpsEngineResult,
  cooling: CoolingEngineResult,
  battery: BatteryEngineResult
): BomEstimate {
  if (
    !inputs.rack_count ||
    ups.recommended_ups_capacity_kva === null ||
    cooling.recommended_precision_ac_model_kw === null
  ) {
    return {
      status: "blocked",
      lines: [],
      equipment_subtotal_rmb: null,
      service_subtotal_rmb: null,
      total_rmb: null,
      low_rmb: null,
      high_rmb: null,
      budget_floor_rmb: null,
      disclaimer: ESTIMATE_DISCLAIMER
    };
  }

  const rackCount = inputs.rack_count;
  const area = cooling.room_area_m2_used ?? rackCount * ENGINE_DEFAULTS.assumed_area_per_rack_m2;
  const upsKva = ups.recommended_ups_capacity_kva;
  const upsUnitPrice = upsKva <= 60 ? REFERENCE_PRICES.ups_per_kva_small : REFERENCE_PRICES.ups_per_kva_large;
  const coolingUnits = cooling.total_unit_count ?? 1;
  const coolingKw = cooling.recommended_precision_ac_model_kw;

  const lines: EstimateLine[] = [
    estimateLine("est_ups", "ups", "UPS主机", `${upsKva}kVA 在线式（含旁路）`, upsKva, "kVA", upsUnitPrice),
    ...(battery.battery_count
      ? [
          estimateLine(
            "est_battery",
            "battery",
            "蓄电池组",
            BATTERY_SPEC,
            battery.battery_count,
            "只",
            REFERENCE_PRICES.battery_12v100ah
          ),
          estimateLine(
            "est_battery_cabinet",
            "battery",
            "电池柜/支架及连接附件",
            "按电池串配置",
            battery.string_count ?? 1,
            "套",
            REFERENCE_PRICES.battery_cabinet_per_string
          )
        ]
      : []),
    estimateLine(
      "est_cooling",
      "cooling",
      "精密空调",
      `${coolingKw}kW 风冷型（含室外机）`,
      coolingUnits * coolingKw,
      "kW",
      REFERENCE_PRICES.cooling_per_kw
    ),
    estimateLine(
      "est_rack",
      "fitout",
      "服务器机柜",
      "42U 600×1100 标准柜",
      rackCount,
      "台",
      REFERENCE_PRICES.rack_42u
    ),
    estimateLine("est_pdu", "pdu", "机柜PDU", "32A A/B路", rackCount * 2, "条", REFERENCE_PRICES.pdu_32a),
    estimateLine(
      "est_distribution",
      "pdu",
      "配电柜/列头柜",
      "按UPS输出与机柜回路配置",
      Math.max(1, Math.ceil(rackCount / 20)),
      "台",
      REFERENCE_PRICES.distribution_cabinet
    ),
    estimateLine(
      "est_fire",
      "fire",
      "气体消防系统",
      "柜式七氟丙烷及探测联动",
      1,
      "套",
      Math.max(REFERENCE_PRICES.fire_min, area * REFERENCE_PRICES.fire_per_m2)
    ),
    estimateLine(
      "est_monitoring",
      "monitoring",
      "动环监控系统",
      "供配电/温湿度/漏水/门禁监测",
      1,
      "套",
      REFERENCE_PRICES.monitoring_base + rackCount * REFERENCE_PRICES.monitoring_per_rack
    ),
    estimateLine(
      "est_floor",
      "fitout",
      "防静电地板",
      "全钢架空 600×600",
      area,
      "㎡",
      REFERENCE_PRICES.floor_per_m2
    ),
    estimateLine(
      "est_fitout",
      "fitout",
      "机房装修",
      "墙顶面、保温、防尘、防火门",
      area,
      "㎡",
      REFERENCE_PRICES.fitout_per_m2
    ),
    estimateLine(
      "est_cabling",
      "cabling",
      "桥架与综合布线",
      "强弱电桥架、机柜间布线",
      1,
      "项",
      REFERENCE_PRICES.cabling_base + rackCount * REFERENCE_PRICES.cabling_per_rack
    ),
    estimateLine(
      "est_grounding",
      "cabling",
      "接地与防雷",
      "等电位联结、浪涌保护",
      1,
      "项",
      REFERENCE_PRICES.grounding_lightning
    )
  ];

  const equipmentSubtotal = lines.reduce((sum, line) => sum + line.subtotal_rmb, 0);
  const serviceSubtotal = Math.round(equipmentSubtotal * REFERENCE_PRICES.install_factor);
  lines.push(
    estimateLine(
      "est_install",
      "service",
      "安装调试与运输",
      "安装、调试、运输及成品保护",
      1,
      "项",
      serviceSubtotal
    )
  );

  const total = equipmentSubtotal + serviceSubtotal;
  const status: EngineCalculationStatus =
    ups.status === "provisional" || cooling.status === "provisional" || battery.status !== "confirmed"
      ? "provisional"
      : "confirmed";

  return {
    status,
    lines,
    equipment_subtotal_rmb: equipmentSubtotal,
    service_subtotal_rmb: serviceSubtotal,
    total_rmb: total,
    low_rmb: Math.round(total * 0.85),
    high_rmb: Math.round(total * 1.15),
    budget_floor_rmb: Math.round(total * ENGINE_DEFAULTS.budget_mismatch_factor),
    disclaimer: ESTIMATE_DISCLAIMER
  };
}

function formatWan(value: number) {
  const wan = value / 10000;
  return wan >= 100 ? String(Math.round(wan)) : String(Math.round(wan * 10) / 10);
}

function buildRiskFlags(inputs: EngineInputs, bom: BomEstimate, prompts: string[]): RiskFlag[] {
  const risks: RiskFlag[] = [];
  const floor = inputs.room_floor ?? 0;
  const backup = inputs.ups_backup_time_minutes ?? 0;
  const budget = inputs.budget_range_high_rmb ?? 0;

  if (floor >= 2 && backup >= 120) {
    risks.push({
      id: "RULE_FLOOR_LOADING",
      legacy_id: "ERR_LOAD",
      level: "P0_BLOCKER",
      text: "机房位于二层及以上，且 UPS 后备时间达到 120 分钟，需优先复核楼板承重、运输路线和加固方案。",
      blocking: true,
      dismissible: false,
      trigger_fields: ["room_floor", "ups_backup_time_minutes"]
    });
    prompts.push(
      "这个项目在二层及以上，且 UPS 后备时间达到 120 分钟，电池重量可能带来楼板承重风险，正式方案会强制加入结构加固复核章节。"
    );
  }

  if (floor >= 2) {
    risks.push({
      id: "RULE_ELEVATOR_HEIGHT",
      level: "P1_HIGH",
      text: "二层及以上机房需核实电梯高度、门洞尺寸和转弯半径，必要时提前规划吊装与搬运方案。",
      blocking: false,
      dismissible: false,
      trigger_fields: ["room_floor"]
    });
  }

  if (budget > 0) {
    if (bom.budget_floor_rmb !== null) {
      if (budget < bom.budget_floor_rmb) {
        const gap = bom.budget_floor_rmb - budget;
        risks.push({
          id: "RULE_BUDGET_MISMATCH",
          level: "P1_HIGH",
          text: `当前预算上限约 ${formatWan(budget)} 万，低于参考估算成本安全线约 ${formatWan(bom.budget_floor_rmb)} 万（参考估算 ${formatWan(bom.total_rmb ?? 0)} 万 × 1.3，缺口约 ${formatWan(gap)} 万），建议同时准备可靠性优先和预算优先两档方案。`,
          blocking: false,
          dismissible: false,
          trigger_fields: ["budget_range_high_rmb"]
        });
        prompts.push(
          "当前预算可能压不住这个配置，建议给客户两档方案：一档保留核心可靠性，另一档预算优先但明确风险边界。"
        );
      }
    } else if (budget < ENGINE_DEFAULTS.legacy_budget_floor_rmb) {
      risks.push({
        id: "RULE_BUDGET_MISMATCH",
        level: "P1_HIGH",
        text: "当前预算可能低于设备与施工综合成本安全线，建议同时准备可靠性优先和预算优先两档方案。",
        blocking: false,
        dismissible: false,
        trigger_fields: ["budget_range_high_rmb"]
      });
    }
  }

  return risks;
}

function buildMissingDataPrompts(inputs: EngineInputs, prompts: string[]) {
  if (inputs.room_floor === null) {
    prompts.push("请确认机房在几楼，这会影响电池承重和设备运输风险判断。");
  }
  if (inputs.ups_backup_time_minutes === null) {
    prompts.push("请确认 UPS 后备时间，若达到 120 分钟及以上，需要额外做楼板承重风险判断。");
  }
  if (inputs.rack_count === null) {
    prompts.push("请确认机柜或服务器规模，这是 UPS、制冷和造价测算的锚点。");
  }
  if (inputs.budget_range_high_rmb === null && inputs.rack_count !== null) {
    prompts.push("如果方便的话，给一个预算上限，可以帮客户判断当前配置是否压得住。");
  }
}

function aggregateStatus(statuses: EngineCalculationStatus[]): EngineCalculationStatus {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("provisional")) return "provisional";
  return "confirmed";
}

export function evaluateProjectRules(fields: Record<string, DashboardField>): EngineEvaluation {
  const inputs = normalizeEngineInputs(fields);
  const audit: EngineAuditEvent[] = [];
  const prompts: string[] = [];

  const ups = calculateUps(inputs, audit);
  const cooling = calculateCooling(inputs, ups, audit);
  const battery = calculateBattery(inputs, ups);
  const bom = buildBomEstimate(inputs, ups, cooling, battery);
  const risks = buildRiskFlags(inputs, bom, prompts);
  buildMissingDataPrompts(inputs, prompts);

  for (const risk of risks) {
    audit.push({
      level: risk.level === "P0_BLOCKER" ? "warning" : "info",
      code: "RISK_TRIGGERED",
      field: risk.trigger_fields[0],
      message: `${risk.id}: ${risk.text}`
    });
  }

  return {
    inputs,
    calculation_status: aggregateStatus([ups.status, cooling.status]),
    ups,
    cooling,
    battery,
    bom_estimate: bom,
    risk_flags: risks,
    agent_required_prompts: prompts,
    audit_log: audit
  };
}

export function buildSuggestionFromEvaluation(
  evaluation: EngineEvaluation,
  stale = false
): SuggestionSummary | null {
  const { ups, cooling, battery, bom_estimate: bom, inputs } = evaluation;
  if (ups.recommended_ups_capacity_kva === null) return null;

  const rackCount = inputs.rack_count ?? 0;
  return {
    upsCapacityKva: ups.recommended_ups_capacity_kva,
    batteryRuntimeMinutes: inputs.ups_backup_time_minutes ?? 120,
    coolingModelKw: cooling.recommended_precision_ac_model_kw,
    coolingRedundancy: cooling.cooling_redundancy,
    pduNote: `${rackCount}台机柜建议按A/B路PDU预留，配电柜输出回路待深化。`,
    structuralNote: "长延时电池方案需复核楼板承重与运输路线。",
    stale,
    totalItLoadKw: ups.total_it_load_kw,
    coolingUnitCount: cooling.total_unit_count,
    batteryCount: battery.battery_count,
    batteryNote: battery.battery_count ? battery.note : null,
    estimatedBomCostRmb: bom.total_rmb,
    estimatedCostLowRmb: bom.low_rmb,
    estimatedCostHighRmb: bom.high_rmb,
    estimatedBudgetFloorRmb: bom.budget_floor_rmb,
    calculationStatus: evaluation.calculation_status
  };
}
