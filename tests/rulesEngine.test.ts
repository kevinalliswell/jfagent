import assert from "node:assert/strict";
import test from "node:test";

const { evaluateProjectRules, buildSuggestionFromEvaluation } = await import("../server-dist/rulesEngine.js");

import type { DashboardField } from "../server/types.ts";

function field(code: string, value: string | number | null): DashboardField {
  return {
    code,
    label: code,
    value,
    displayValue: value === null ? "待确认" : String(value),
    source: value === null ? "pending" : "user_message",
    confidence: value === null ? 0 : 0.9,
    needs_confirmation: value === null
  };
}

function fields(values: Record<string, string | number | null>) {
  return Object.fromEntries(Object.entries(values).map(([code, value]) => [code, field(code, value)]));
}

test("UPS 引擎按规格计算并向上取整到标准容量（rules.md Case 4）", () => {
  const result = evaluateProjectRules(
    fields({ rack_count: 10, avg_power_per_rack_kw: 3, redundancy_mode: "N+1" })
  );
  assert.equal(result.ups.total_it_load_kw, 30);
  assert.equal(result.ups.required_ups_capacity_kva_raw, 37.5);
  assert.equal(result.ups.recommended_ups_capacity_kva, 40);
  assert.equal(result.ups.status, "confirmed");
});

test("UPS 引擎在缺机柜数时返回 blocked", () => {
  const result = evaluateProjectRules(fields({}));
  assert.equal(result.ups.status, "blocked");
  assert.equal(result.ups.error_code, "MISSING_RACK_COUNT");
  assert.equal(result.calculation_status, "blocked");
  assert.equal(buildSuggestionFromEvaluation(result), null);
});

test("UPS 引擎在 2N 模式下容量翻倍", () => {
  const result = evaluateProjectRules(
    fields({ rack_count: 10, avg_power_per_rack_kw: 4, redundancy_mode: "2N" })
  );
  assert.equal(result.ups.total_it_load_kw, 40);
  assert.equal(result.ups.required_ups_capacity_kva_raw, 80);
  assert.equal(result.ups.recommended_ups_capacity_kva, 80);
});

test("制冷引擎按面积热负荷+IT负荷×安全系数映射机型（rules.md Case 5）", () => {
  const result = evaluateProjectRules(
    fields({
      rack_count: 10,
      avg_power_per_rack_kw: 3,
      redundancy_mode: "N+1",
      cooling_redundancy: "N+1",
      room_area_m2: 40
    })
  );
  assert.equal(result.cooling.room_thermal_load_kw, 3.2);
  assert.equal(result.cooling.required_cooling_capacity_kw_raw, 38.18);
  assert.equal(result.cooling.recommended_precision_ac_model_kw, 40);
  assert.equal(result.cooling.running_unit_count, 1);
  assert.equal(result.cooling.total_unit_count, 2);
});

test("制冷引擎在缺面积时按机柜数暂估并标记 provisional", () => {
  const result = evaluateProjectRules(fields({ rack_count: 10 }));
  assert.equal(result.cooling.room_area_m2_used, 40);
  assert.equal(result.cooling.status, "provisional");
  assert.ok(
    result.audit_log.some(
      (event) => event.code === "DEFAULT_ASSUMPTION_USED" && event.field === "room_area_m2"
    )
  );
});

test("超出机型目录时按最大机型多台配置", () => {
  const result = evaluateProjectRules(
    fields({ rack_count: 60, avg_power_per_rack_kw: 4, room_area_m2: 300, cooling_redundancy: "N+1" })
  );
  assert.equal(result.cooling.recommended_precision_ac_model_kw, 100);
  assert.ok((result.cooling.running_unit_count ?? 0) >= 3);
  assert.equal(result.cooling.total_unit_count, (result.cooling.running_unit_count ?? 0) + 1);
});

test("电池引擎按后备时间估算串数与只数", () => {
  const result = evaluateProjectRules(
    fields({ rack_count: 10, avg_power_per_rack_kw: 3, ups_backup_time_minutes: 120 })
  );
  assert.equal(result.battery.string_count, 2);
  assert.equal(result.battery.battery_count, 64);
});

test("楼层承重风险在 2 楼及以上且后备≥120 分钟时触发（rules.md Case 1）", () => {
  const result = evaluateProjectRules(fields({ room_floor: 3, ups_backup_time_minutes: 120 }));
  const risk = result.risk_flags.find((item) => item.id === "RULE_FLOOR_LOADING");
  assert.ok(risk);
  assert.equal(risk?.level, "P0_BLOCKER");
  assert.equal(risk?.blocking, true);
});

test("电梯运输风险在 2 楼及以上触发（rules.md Case 2）", () => {
  const result = evaluateProjectRules(fields({ room_floor: 2 }));
  const risk = result.risk_flags.find((item) => item.id === "RULE_ELEVATOR_HEIGHT");
  assert.ok(risk);
  assert.equal(risk?.level, "P1_HIGH");
});

test("一楼短延时不触发楼层类风险", () => {
  const result = evaluateProjectRules(
    fields({ room_floor: 1, ups_backup_time_minutes: 240, rack_count: 10 })
  );
  assert.ok(!result.risk_flags.some((item) => item.id === "RULE_FLOOR_LOADING"));
  assert.ok(!result.risk_flags.some((item) => item.id === "RULE_ELEVATOR_HEIGHT"));
});

test("预算风险在可估算 BOM 时按 估算×1.3 判定（rules.md Case 3）", () => {
  const base = fields({
    rack_count: 10,
    avg_power_per_rack_kw: 3,
    room_area_m2: 50,
    ups_backup_time_minutes: 120,
    budget_range_high_rmb: 300000
  });
  const result = evaluateProjectRules(base);
  const floor = result.bom_estimate.budget_floor_rmb ?? 0;
  assert.ok(floor > 300000);
  const risk = result.risk_flags.find((item) => item.id === "RULE_BUDGET_MISMATCH");
  assert.ok(risk);
  assert.ok(risk?.text.includes("万"));

  const richBudget = evaluateProjectRules({
    ...base,
    budget_range_high_rmb: field("budget_range_high_rmb", floor + 100000)
  });
  assert.ok(!richBudget.risk_flags.some((item) => item.id === "RULE_BUDGET_MISMATCH"));
});

test("预算风险在 BOM 不可估算时退回 45 万启发式判定", () => {
  const lowBudget = evaluateProjectRules(fields({ budget_range_high_rmb: 300000 }));
  assert.ok(lowBudget.risk_flags.some((item) => item.id === "RULE_BUDGET_MISMATCH"));

  const okBudget = evaluateProjectRules(fields({ budget_range_high_rmb: 500000 }));
  assert.ok(!okBudget.risk_flags.some((item) => item.id === "RULE_BUDGET_MISMATCH"));
});

test("BOM 估算覆盖核心设备并给出区间与安全线", () => {
  const result = evaluateProjectRules(
    fields({
      rack_count: 10,
      avg_power_per_rack_kw: 3,
      room_area_m2: 50,
      ups_backup_time_minutes: 120
    })
  );
  const categories = new Set(result.bom_estimate.lines.map((line) => line.category));
  for (const expected of ["ups", "battery", "cooling", "pdu", "fire", "monitoring", "fitout", "service"]) {
    assert.ok(categories.has(expected as never), `BOM 估算缺少类别 ${expected}`);
  }
  const total = result.bom_estimate.total_rmb ?? 0;
  assert.ok(total > 400000 && total < 1200000, `估算合计 ${total} 超出合理区间`);
  assert.equal(result.bom_estimate.budget_floor_rmb, Math.round(total * 1.3));
  assert.ok((result.bom_estimate.low_rmb ?? 0) < total);
  assert.ok((result.bom_estimate.high_rmb ?? 0) > total);
});

test("建议摘要继承引擎输出并保持既有文案契约", () => {
  const result = evaluateProjectRules(
    fields({
      rack_count: 10,
      avg_power_per_rack_kw: 3,
      room_area_m2: 50,
      ups_backup_time_minutes: 120
    })
  );
  const suggestion = buildSuggestionFromEvaluation(result);
  assert.ok(suggestion);
  assert.equal(suggestion?.upsCapacityKva, 40);
  assert.equal(suggestion?.batteryRuntimeMinutes, 120);
  assert.equal(suggestion?.structuralNote, "长延时电池方案需复核楼板承重与运输路线。");
  assert.equal(suggestion?.pduNote, "10台机柜建议按A/B路PDU预留，配电柜输出回路待深化。");
  assert.equal(suggestion?.batteryCount, 64);
  assert.equal(suggestion?.calculationStatus, "provisional");
});
