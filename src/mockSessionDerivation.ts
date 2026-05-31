import type { FieldPatch, SessionSnapshot } from "./types";

function fieldValueAfterPatches(
  fields: SessionSnapshot["dashboard_fields"],
  fieldCode: string,
  patches: FieldPatch[] = []
) {
  for (let index = patches.length - 1; index >= 0; index -= 1) {
    const nextPatch = patches[index];
    if (nextPatch?.field_code === fieldCode) {
      return nextPatch.new_value;
    }
  }
  return fields[fieldCode]?.value ?? null;
}

export function evaluateRiskIds(fields: SessionSnapshot["dashboard_fields"], patches: FieldPatch[] = []) {
  const floor = Number(fieldValueAfterPatches(fields, "room_floor", patches) ?? 0);
  const backup = Number(fieldValueAfterPatches(fields, "ups_backup_time_minutes", patches) ?? 0);
  const budget = Number(fieldValueAfterPatches(fields, "budget_range_high_rmb", patches) ?? 0);
  const riskIds: string[] = [];

  if (floor >= 2 && backup >= 120) riskIds.push("RULE_FLOOR_LOADING");
  if (floor >= 2) riskIds.push("RULE_ELEVATOR_HEIGHT");
  if (budget > 0 && budget < 450000) riskIds.push("RULE_BUDGET_MISMATCH");

  return riskIds;
}
