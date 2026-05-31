# Backend Expert System Rules

> **STATUS: FUTURE / ASPIRATIONAL — NOT current behavior.** The real engine
> triggers only ~2 hardcoded risks in `server/sessionService.ts`. There is no
> multi-tier P0–P3 engine, no data-driven rules, and no remediation workflow.
> Do not assume any rule here exists in code. See `docs/specs-future/README.md`
> and `GOAL.md`.

## Purpose

This document defines rigid backend engineering logic for a data center room construction expert system. It bridges LLM semantic flexibility with deterministic calculation engines and non-negotiable physical, safety, transport, and commercial constraints.

The LLM may interpret user intent, normalize slang, and ask follow-up questions. It must not override, soften, hide, or reinterpret the rules in this document. These rules are evaluated by backend logic and have higher priority than conversational flow, user preference, proposal style, and monetization logic.

---

## Rule Authority

### Precedence Order

```text
hard_safety_rule > hard_calculation_engine > expert_risk_trigger > manual_user_input > LLM_inference > default_assumption
```

### Non-Negotiable Constraints

1. The LLM cannot suppress a triggered risk warning.
2. The LLM cannot delete an auto-injected risk chapter from the final specification document.
3. The LLM cannot reduce calculated UPS or cooling capacity below the deterministic minimum without a qualified engineering override.
4. The LLM cannot treat missing physical constraints as safe.
5. When inputs are incomplete, the backend must return `calculation_status = "blocked"` or `calculation_status = "provisional"` rather than fabricating confirmed values.

### Output Contract

Every backend evaluation returns:

```json
{
  "calculation_outputs": {},
  "risk_flags": [],
  "forced_document_injections": [],
  "ui_highlights": [],
  "agent_required_prompts": [],
  "alternative_plan_requirements": [],
  "calculation_status": "confirmed | provisional | blocked",
  "audit_log": []
}
```

---

## Canonical Input Schema

The backend rules consume normalized project context. All values must be unit-normalized before evaluation.

```json
{
  "rack_count": null,
  "avg_power_per_rack_kw": null,
  "redundancy_mode": "N | N+1 | 2N",
  "room_area_m2": null,
  "room_floor": 1,
  "ups_backup_time_minutes": null,
  "budget_range_low_rmb": null,
  "budget_range_high_rmb": null,
  "estimated_bom_cost_rmb": null,
  "cooling_model_catalog_kw": [25, 40, 60, 80, 100]
}
```

### Required Units

| Field | Unit | Validation |
| --- | --- | --- |
| `rack_count` | count | Integer, `>= 0` |
| `avg_power_per_rack_kw` | kW/rack | Decimal, `> 0` when rack_count is known |
| `room_area_m2` | square meters | Decimal, `> 0` |
| `room_floor` | floor number | Integer, `>= 1` |
| `ups_backup_time_minutes` | minutes | Integer, `>= 0` |
| `budget_range_low_rmb` | RMB | Decimal or null |
| `budget_range_high_rmb` | RMB | Decimal or null |
| `estimated_bom_cost_rmb` | RMB | Decimal or null |

### Default Assumptions

Defaults may be used only when the field is missing and the UI clearly marks the result as provisional.

```json
{
  "avg_power_per_rack_kw_default": 3.0,
  "redundancy_mode_default": "N+1",
  "room_thermal_density_kw_per_m2_default": 0.08,
  "cooling_safety_margin_factor": 1.15,
  "budget_mismatch_factor": 1.3
}
```

If a default is used, append to audit log:

```json
{
  "level": "info",
  "code": "DEFAULT_ASSUMPTION_USED",
  "field": "avg_power_per_rack_kw",
  "value": 3.0,
  "message": "Default average rack power used; result is provisional."
}
```

---

## Section 1: Hard-Coded Calculation Engines

Calculation engines produce deterministic minimum engineering outputs. They do not ask conversational questions. They return outputs, warnings, and status flags that the conversational agent must respect.

---

## Engine 1: UPS Capacity Calculation

### Objective

Calculate required UPS capacity in kVA from rack count, average rack power, and redundancy mode.

### Formula

```text
Total IT Load (kW) = Rack Count * Avg Power per Rack (kW)
Required UPS Capacity (kVA) = Total IT Load (kW) * Redundancy Factor
```

### Redundancy Factor Mapping

| Redundancy Mode | Factor | Logic |
| --- | ---: | --- |
| `N` | `1.00` | Base capacity only |
| `N+1` | `1.25` | Base capacity plus one-module reserve approximation |
| `2N` | `2.00` | Fully duplicated UPS path |

### Required Input Validation

```pseudo
FUNCTION validate_ups_inputs(context):
  IF context.rack_count IS NULL:
    RETURN blocked("MISSING_RACK_COUNT")

  IF context.rack_count <= 0:
    RETURN blocked("INVALID_RACK_COUNT")

  IF context.avg_power_per_rack_kw IS NULL:
    context.avg_power_per_rack_kw = DEFAULT.avg_power_per_rack_kw_default
    mark_provisional("avg_power_per_rack_kw")

  IF context.avg_power_per_rack_kw <= 0:
    RETURN blocked("INVALID_AVG_POWER_PER_RACK")

  IF context.redundancy_mode IS NULL:
    context.redundancy_mode = DEFAULT.redundancy_mode_default
    mark_provisional("redundancy_mode")

  IF context.redundancy_mode NOT IN ["N", "N+1", "2N"]:
    RETURN blocked("INVALID_REDUNDANCY_MODE")

  RETURN valid()
```

### Calculation Pseudo-code

```pseudo
FUNCTION calculate_ups_capacity(context):
  validation = validate_ups_inputs(context)

  IF validation.status == "blocked":
    RETURN {
      "engine": "UPS_CAPACITY",
      "calculation_status": "blocked",
      "error_code": validation.error_code,
      "required_fields": validation.required_fields
    }

  redundancy_factor = get_redundancy_factor(context.redundancy_mode)

  total_it_load_kw =
    context.rack_count *
    context.avg_power_per_rack_kw

  required_ups_capacity_kva =
    total_it_load_kw *
    redundancy_factor

  rounded_ups_capacity_kva =
    round_up_to_standard_ups_size(required_ups_capacity_kva)

  RETURN {
    "engine": "UPS_CAPACITY",
    "calculation_status": validation.has_defaults ? "provisional" : "confirmed",
    "inputs": {
      "rack_count": context.rack_count,
      "avg_power_per_rack_kw": context.avg_power_per_rack_kw,
      "redundancy_mode": context.redundancy_mode,
      "redundancy_factor": redundancy_factor
    },
    "outputs": {
      "total_it_load_kw": total_it_load_kw,
      "required_ups_capacity_kva_raw": required_ups_capacity_kva,
      "recommended_ups_capacity_kva": rounded_ups_capacity_kva
    }
  }
```

### Standard UPS Size Rounding

```pseudo
STANDARD_UPS_SIZES_KVA = [10, 20, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300, 400, 500]

FUNCTION round_up_to_standard_ups_size(required_kva):
  FOR size IN STANDARD_UPS_SIZES_KVA:
    IF size >= required_kva:
      RETURN size

  RETURN ceil(required_kva / 100) * 100
```

### Example

```text
rack_count = 10
avg_power_per_rack_kw = 3
redundancy_mode = N+1

total_it_load_kw = 10 * 3 = 30 kW
required_ups_capacity_kva = 30 * 1.25 = 37.5 kVA
recommended_ups_capacity_kva = 40 kVA
```

---

## Engine 2: Precision AC Cooling Capacity Calculation

### Objective

Calculate required precision AC cooling capacity in kW from room thermal load and total IT load, then map it to discrete manufacturer model sizes.

### Formula

```text
Room Thermal Load (kW) = Room Area (m2) * Room Thermal Density (kW/m2)
Total IT Load (kW) = Rack Count * Avg Power per Rack (kW)
Required Cooling Capacity (kW) = (Room Thermal Load + Total IT Load) * Cooling Safety Margin
Recommended Precision AC Model (kW) = Smallest catalog model >= Required Cooling Capacity
```

### Manufacturer Model Catalog

Default catalog:

```json
[25, 40, 60, 80, 100]
```

The catalog may be overridden by project-specific manufacturer data, but the backend must always round up to the next available model.

### Required Input Validation

```pseudo
FUNCTION validate_cooling_inputs(context):
  IF context.room_area_m2 IS NULL:
    RETURN blocked("MISSING_ROOM_AREA")

  IF context.room_area_m2 <= 0:
    RETURN blocked("INVALID_ROOM_AREA")

  IF context.rack_count IS NULL AND context.total_it_load_kw IS NULL:
    RETURN blocked("MISSING_IT_LOAD_ANCHOR")

  IF context.total_it_load_kw IS NULL:
    IF context.avg_power_per_rack_kw IS NULL:
      context.avg_power_per_rack_kw = DEFAULT.avg_power_per_rack_kw_default
      mark_provisional("avg_power_per_rack_kw")

    context.total_it_load_kw =
      context.rack_count *
      context.avg_power_per_rack_kw

  IF context.total_it_load_kw <= 0:
    RETURN blocked("INVALID_TOTAL_IT_LOAD")

  IF context.room_thermal_density_kw_per_m2 IS NULL:
    context.room_thermal_density_kw_per_m2 =
      DEFAULT.room_thermal_density_kw_per_m2_default
    mark_provisional("room_thermal_density_kw_per_m2")

  IF context.cooling_safety_margin_factor IS NULL:
    context.cooling_safety_margin_factor =
      DEFAULT.cooling_safety_margin_factor
    mark_provisional("cooling_safety_margin_factor")

  IF context.cooling_model_catalog_kw IS NULL OR EMPTY:
    context.cooling_model_catalog_kw = [25, 40, 60, 80, 100]
    mark_provisional("cooling_model_catalog_kw")

  RETURN valid()
```

### Calculation Pseudo-code

```pseudo
FUNCTION calculate_precision_ac_capacity(context):
  validation = validate_cooling_inputs(context)

  IF validation.status == "blocked":
    RETURN {
      "engine": "PRECISION_AC_COOLING",
      "calculation_status": "blocked",
      "error_code": validation.error_code,
      "required_fields": validation.required_fields
    }

  room_thermal_load_kw =
    context.room_area_m2 *
    context.room_thermal_density_kw_per_m2

  total_thermal_load_kw =
    room_thermal_load_kw +
    context.total_it_load_kw

  required_cooling_capacity_kw =
    total_thermal_load_kw *
    context.cooling_safety_margin_factor

  recommended_model_kw =
    map_to_manufacturer_model(
      required_cooling_capacity_kw,
      context.cooling_model_catalog_kw
    )

  RETURN {
    "engine": "PRECISION_AC_COOLING",
    "calculation_status": validation.has_defaults ? "provisional" : "confirmed",
    "inputs": {
      "room_area_m2": context.room_area_m2,
      "room_thermal_density_kw_per_m2": context.room_thermal_density_kw_per_m2,
      "total_it_load_kw": context.total_it_load_kw,
      "cooling_safety_margin_factor": context.cooling_safety_margin_factor,
      "cooling_model_catalog_kw": context.cooling_model_catalog_kw
    },
    "outputs": {
      "room_thermal_load_kw": room_thermal_load_kw,
      "total_thermal_load_kw": total_thermal_load_kw,
      "required_cooling_capacity_kw_raw": required_cooling_capacity_kw,
      "recommended_precision_ac_model_kw": recommended_model_kw
    }
  }
```

### Manufacturer Model Mapping

```pseudo
FUNCTION map_to_manufacturer_model(required_kw, catalog_kw):
  sorted_catalog = sort_ascending(catalog_kw)

  FOR model_kw IN sorted_catalog:
    IF model_kw >= required_kw:
      RETURN model_kw

  largest_model = max(sorted_catalog)
  unit_count = ceil(required_kw / largest_model)

  RETURN {
    "single_unit_model_kw": largest_model,
    "unit_count": unit_count,
    "combined_capacity_kw": largest_model * unit_count
  }
```

### Example

```text
room_area_m2 = 40
room_thermal_density_kw_per_m2 = 0.08
rack_count = 10
avg_power_per_rack_kw = 3
cooling_safety_margin_factor = 1.15
catalog = [25, 40, 60, 80, 100]

room_thermal_load_kw = 40 * 0.08 = 3.2 kW
total_it_load_kw = 10 * 3 = 30 kW
required_cooling_capacity_kw = (3.2 + 30) * 1.15 = 38.18 kW
recommended_precision_ac_model_kw = 40 kW
```

---

## Section 2: Expert Risk Trigger Engine

The Expert Risk Trigger Engine evaluates bright red flags that must be surfaced to the user, highlighted in the UI, and injected into the final specification document when applicable.

Risk triggers are not advisory text. They are backend-enforced outputs.

---

## Risk Evaluation Pipeline

### Global Risk Evaluation Pseudo-code

```pseudo
FUNCTION evaluate_expert_risks(context, calculation_outputs):
  risk_flags = []
  forced_document_injections = []
  ui_highlights = []
  agent_required_prompts = []
  alternative_plan_requirements = []

  APPLY Rule_Floor_Loading
  APPLY Rule_Elevator_Height
  APPLY Rule_Budget_Mismatch

  RETURN {
    "risk_flags": risk_flags,
    "forced_document_injections": forced_document_injections,
    "ui_highlights": ui_highlights,
    "agent_required_prompts": agent_required_prompts,
    "alternative_plan_requirements": alternative_plan_requirements
  }
```

### Risk Severity Levels

| Severity | Meaning | UI Treatment |
| --- | --- | --- |
| `P0_BLOCKER` | Potential physical/safety blocker | Bright red banner, cannot hide |
| `P1_HIGH` | High engineering or delivery risk | Red warning card |
| `P2_MEDIUM` | Requires clarification or budget reserve | Amber warning |
| `P3_LOW` | Informational engineering note | Gray note |

---

## Rule_Floor_Loading

### Trigger Condition

```pseudo
IF context.room_floor > 1
AND context.ups_backup_time_minutes >= 120
THEN trigger Rule_Floor_Loading
```

### Risk Rationale

Long UPS backup time usually implies a large UPS Battery Bank. When the machine room is above the first floor, battery cabinet weight may exceed the floor's allowable live load or concentrated load capacity. This creates structural loading risk and must be verified before proposal finalization.

### Required Action

Forcibly push high-risk warning:

```text
Structural Loading Deficit Risk
```

Auto-inject chapter into final specification document template:

```text
Steel Structure Load加固
```

### Strict Evaluation Logic

```pseudo
RULE Rule_Floor_Loading:
  id = "RULE_FLOOR_LOADING"
  severity = "P0_BLOCKER"

  WHEN:
    context.room_floor IS NOT NULL
    AND context.ups_backup_time_minutes IS NOT NULL
    AND context.room_floor > 1
    AND context.ups_backup_time_minutes >= 120

  THEN:
    risk_flags.ADD({
      "id": "RULE_FLOOR_LOADING",
      "severity": "P0_BLOCKER",
      "title": "Structural Loading Deficit Risk",
      "message": "Room is above the first floor and UPS backup time is at least 120 minutes. Battery bank weight may exceed structural floor loading capacity.",
      "trigger_fields": ["room_floor", "ups_backup_time_minutes"],
      "blocking": true,
      "dismissible": false
    })

    forced_document_injections.ADD({
      "chapter_id": "STEEL_STRUCTURE_LOAD_REINFORCEMENT",
      "chapter_title": "Steel Structure Load加固",
      "placement": "before_equipment_installation_chapter",
      "mandatory": true,
      "removable_by_llm": false,
      "content_requirements": [
        "Verify original structural design load.",
        "Calculate UPS and battery cabinet point loads.",
        "Provide steel structure reinforcement scheme when required.",
        "Require owner or qualified structural engineer confirmation before construction."
      ]
    })

    ui_highlights.ADD({
      "field": "ups_backup_time_minutes",
      "style": "bright_red",
      "message": "120 minutes or longer backup on upper floor triggers structural loading review."
    })

    ui_highlights.ADD({
      "field": "room_floor",
      "style": "bright_red",
      "message": "Upper-floor machine room requires load verification for heavy battery systems."
    })

    agent_required_prompts.ADD({
      "priority": "immediate",
      "prompt": "这个项目在二层及以上，并且UPS后备时间达到120分钟，电池重量可能带来楼板承重风险。我已强制加入 Steel Structure Load加固 章节，后续需要确认楼板荷载或结构加固方案。"
    })
```

### Missing Data Handling

```pseudo
IF context.room_floor IS NULL:
  agent_required_prompts.ADD("请确认机房在几楼，这会影响电池承重和运输风险判断。")

IF context.ups_backup_time_minutes IS NULL:
  agent_required_prompts.ADD("请确认UPS后备时间，若达到120分钟及以上，需要额外做楼板承重风险判断。")
```

Missing data does not trigger the rule, but it must keep risk status as `unknown_pending_input`.

---

## Rule_Elevator_Height

### Trigger Condition

```pseudo
IF context.room_floor > 1
THEN trigger Rule_Elevator_Height
```

### Risk Rationale

Upper-floor machine rooms require transport path verification. Precision AC units are commonly near or above 2 meters tall. Elevator cabin height, door height, turning radius, and route clearance can block delivery. If elevator transport is impossible, mobile crane or dismantling costs may be required.

### Required Action

Push warning:

```text
Chassis Transport Risk. Verify elevator height for 2-meter tall AC units; allocate potential mobile crane budget.
```

### Strict Evaluation Logic

```pseudo
RULE Rule_Elevator_Height:
  id = "RULE_ELEVATOR_HEIGHT"
  severity = "P1_HIGH"

  WHEN:
    context.room_floor IS NOT NULL
    AND context.room_floor > 1

  THEN:
    risk_flags.ADD({
      "id": "RULE_ELEVATOR_HEIGHT",
      "severity": "P1_HIGH",
      "title": "Chassis Transport Risk",
      "message": "Verify elevator height for 2-meter tall AC units; allocate potential mobile crane budget.",
      "trigger_fields": ["room_floor"],
      "blocking": false,
      "dismissible": false
    })

    forced_document_injections.ADD({
      "chapter_id": "TRANSPORT_ROUTE_VERIFICATION",
      "chapter_title": "Equipment Transport Route Verification",
      "placement": "before_construction_conditions_chapter",
      "mandatory": true,
      "removable_by_llm": false,
      "content_requirements": [
        "Verify elevator cabin height and door height.",
        "Verify transport route width and turning radius.",
        "Check whether 2-meter precision AC chassis can enter the room upright.",
        "Reserve mobile crane or special handling budget if elevator transport is not feasible."
      ]
    })

    ui_highlights.ADD({
      "field": "room_floor",
      "style": "red",
      "message": "Upper-floor room requires equipment transport route verification."
    })

    agent_required_prompts.ADD({
      "priority": "high",
      "prompt": "机房在二层及以上，需要确认电梯高度和运输通道。精密空调常见机身接近2米，建议预留吊装或特殊搬运预算。"
    })
```

### Missing Data Handling

```pseudo
IF context.room_floor IS NULL:
  risk_flags.ADD({
    "id": "RULE_ELEVATOR_HEIGHT_UNKNOWN",
    "severity": "P2_MEDIUM",
    "title": "Transport Risk Unknown",
    "message": "Room floor is unknown; elevator and chassis transport risk cannot be evaluated.",
    "trigger_fields": ["room_floor"],
    "blocking": false,
    "dismissible": true
  })
```

---

## Rule_Budget_Mismatch

### Trigger Condition

```pseudo
IF context.budget_range_high_rmb < calculation_outputs.estimated_bom_cost_rmb * 1.3
THEN trigger Rule_Budget_Mismatch
```

### Risk Rationale

Construction integration projects need room for equipment, accessories, labor, transport, installation, commissioning, taxes, management, and contingency. If the user's stated budget is lower than estimated BOM cost multiplied by 1.3, the project is commercially misaligned.

### Required Action

Highlight the budget field and prompt the conversational agent to suggest lower-tier alternatives.

### Strict Evaluation Logic

```pseudo
RULE Rule_Budget_Mismatch:
  id = "RULE_BUDGET_MISMATCH"
  severity = "P1_HIGH"

  WHEN:
    context.budget_range_high_rmb IS NOT NULL
    AND calculation_outputs.estimated_bom_cost_rmb IS NOT NULL
    AND context.budget_range_high_rmb <
      calculation_outputs.estimated_bom_cost_rmb * DEFAULT.budget_mismatch_factor

  THEN:
    required_budget_floor_rmb =
      calculation_outputs.estimated_bom_cost_rmb *
      DEFAULT.budget_mismatch_factor

    budget_gap_rmb =
      required_budget_floor_rmb -
      context.budget_range_high_rmb

    budget_gap_percent =
      budget_gap_rmb / required_budget_floor_rmb

    risk_flags.ADD({
      "id": "RULE_BUDGET_MISMATCH",
      "severity": "P1_HIGH",
      "title": "Budget Mismatch Risk",
      "message": "User budget is lower than estimated BOM cost multiplied by 1.3. Current budget may not cover equipment, construction, delivery, commissioning, taxes, management, and contingency.",
      "trigger_fields": ["budget_range_high_rmb", "estimated_bom_cost_rmb"],
      "blocking": false,
      "dismissible": false,
      "required_budget_floor_rmb": required_budget_floor_rmb,
      "budget_gap_rmb": budget_gap_rmb,
      "budget_gap_percent": budget_gap_percent
    })

    ui_highlights.ADD({
      "field": "budget_range_high_rmb",
      "style": "red",
      "message": "Budget lower than estimated BOM cost * 1.3."
    })

    agent_required_prompts.ADD({
      "priority": "high",
      "prompt": "当前预算可能压不住这个配置。我建议给你两档降配方案：一档保留核心可靠性，另一档预算优先但明确风险。"
    })

    alternative_plan_requirements.ADD({
      "plan_type": "lower_tier_alternatives",
      "required_options": [
        "Reliability-first cost reduction",
        "Budget-first minimum viable configuration"
      ],
      "must_preserve": [
        "electrical safety",
        "minimum cooling capacity",
        "fire and grounding compliance"
      ],
      "may_adjust": [
        "redundancy level",
        "backup time",
        "brand tier",
        "monitoring scope",
        "non-critical fitout scope"
      ]
    })
```

### Missing Data Handling

```pseudo
IF context.budget_range_high_rmb IS NULL:
  agent_required_prompts.ADD({
    "priority": "normal",
    "prompt": "如果方便的话，给我一个预算上限，我可以帮你判断当前配置是否压得住。"
  })

IF calculation_outputs.estimated_bom_cost_rmb IS NULL:
  RETURN {
    "rule": "RULE_BUDGET_MISMATCH",
    "status": "not_evaluable",
    "reason": "MISSING_ESTIMATED_BOM_COST"
  }
```

---

## Combined Evaluation Function

The backend should run all calculation engines before risk triggers so commercial and risk rules can consume computed values.

```pseudo
FUNCTION evaluate_project_backend_rules(context):
  normalized_context = normalize_units(context)
  audit_log = []

  ups_result = calculate_ups_capacity(normalized_context)
  cooling_result = calculate_precision_ac_capacity(normalized_context)

  calculation_outputs = merge_outputs([
    ups_result.outputs,
    cooling_result.outputs,
    {
      "estimated_bom_cost_rmb": context.estimated_bom_cost_rmb
    }
  ])

  risk_result = evaluate_expert_risks(
    normalized_context,
    calculation_outputs
  )

  calculation_status = aggregate_status([
    ups_result.calculation_status,
    cooling_result.calculation_status
  ])

  RETURN {
    "calculation_outputs": calculation_outputs,
    "risk_flags": risk_result.risk_flags,
    "forced_document_injections": risk_result.forced_document_injections,
    "ui_highlights": risk_result.ui_highlights,
    "agent_required_prompts": risk_result.agent_required_prompts,
    "alternative_plan_requirements": risk_result.alternative_plan_requirements,
    "calculation_status": calculation_status,
    "audit_log": audit_log
  }
```

### Aggregate Status Logic

```pseudo
FUNCTION aggregate_status(statuses):
  IF any(status == "blocked" FOR status IN statuses):
    RETURN "blocked"

  IF any(status == "provisional" FOR status IN statuses):
    RETURN "provisional"

  RETURN "confirmed"
```

---

## LLM Integration Rules

### The LLM Must

- Use backend calculation outputs as authoritative engineering minima.
- Surface all backend risk flags in chat and UI.
- Use the exact risk titles returned by the backend.
- Preserve forced document injections during Word export.
- Ask for missing fields when the backend returns `blocked`.
- Label provisional results clearly when defaults were used.
- Offer lower-tier alternatives when `RULE_BUDGET_MISMATCH` triggers.

### The LLM Must Not

- Say a triggered risk is "probably fine" without qualified confirmation.
- Remove "Steel Structure Load加固" when `RULE_FLOOR_LOADING` triggers.
- Round UPS or cooling capacity downward.
- Hide transport risk because the user wants a fast quote.
- Replace backend calculations with pure semantic estimates.
- Treat a user-provided low budget as permission to violate minimum safety logic.

### Required Agent Behavior on P0 Risk

```pseudo
IF any(risk.severity == "P0_BLOCKER"):
  agent_reply MUST:
    include risk.title
    explain trigger_fields
    state required verification
    state document injection chapter
    avoid finalizing construction-safe claim
```

Example:

```text
这里有一个强制高风险项：Structural Loading Deficit Risk。

触发原因是机房在二层及以上，并且UPS后备时间达到120分钟。这个组合会显著增加电池重量，必须确认楼板荷载或结构加固方案。我会把 Steel Structure Load加固 章节强制加入最终规格书。
```

---

## Document Template Injection Rules

### Forced Injection Schema

```json
{
  "chapter_id": "string",
  "chapter_title": "string",
  "placement": "string",
  "mandatory": true,
  "removable_by_llm": false,
  "content_requirements": []
}
```

### Merge Behavior

```pseudo
FUNCTION merge_forced_injections(template, forced_document_injections):
  FOR injection IN forced_document_injections:
    IF template.has_chapter(injection.chapter_id):
      template.update_chapter_requirements(
        injection.chapter_id,
        injection.content_requirements
      )
    ELSE:
      template.insert_chapter(
        chapter_id = injection.chapter_id,
        title = injection.chapter_title,
        placement = injection.placement,
        content_requirements = injection.content_requirements
      )

    template.lock_chapter(injection.chapter_id)

  RETURN template
```

### Locked Chapter Rule

```pseudo
IF chapter.mandatory == true
AND chapter.removable_by_llm == false:
  hide_delete_action()
  disable_llm_delete_tool()
  record_audit_log("MANDATORY_CHAPTER_LOCKED", chapter.chapter_id)
```

---

## UI Enforcement Rules

### Risk Display

```pseudo
FOR risk IN risk_flags:
  IF risk.severity == "P0_BLOCKER":
    render_bright_red_banner(risk.title, risk.message)
    require_acknowledgement_checkbox()

  IF risk.severity == "P1_HIGH":
    render_red_warning_card(risk.title, risk.message)

  IF risk.severity == "P2_MEDIUM":
    render_amber_warning(risk.title, risk.message)
```

### Field Highlighting

```pseudo
FOR highlight IN ui_highlights:
  apply_field_style(
    field = highlight.field,
    style = highlight.style,
    tooltip = highlight.message
  )
```

### Export Blocking

```pseudo
IF any(risk.severity == "P0_BLOCKER" AND risk.blocking == true):
  allow_export = true
  export_label = "Export With High-Risk Warning"
  require_risk_acknowledgement = true
  document_must_include_forced_injections = true
```

P0 risk does not necessarily block document export, but it blocks any export that claims the project is construction-safe without verification.

---

## Audit Requirements

Every calculation and risk trigger must be auditable.

### Audit Event Schema

```json
{
  "timestamp": "ISO-8601",
  "event_type": "CALCULATION | RISK_TRIGGER | DEFAULT_ASSUMPTION | DOCUMENT_INJECTION | USER_OVERRIDE",
  "rule_id": "string",
  "input_snapshot": {},
  "output_snapshot": {},
  "message": "string"
}
```

### Required Audit Events

- UPS capacity calculated.
- Precision AC capacity calculated.
- Default assumption used.
- Rule_Floor_Loading triggered.
- Rule_Elevator_Height triggered.
- Rule_Budget_Mismatch triggered.
- Forced document chapter injected.
- Manual override attempted against backend minimum.

---

## Test Matrix

### Case 1: Floor Loading Trigger

```json
{
  "room_floor": 3,
  "ups_backup_time_minutes": 120
}
```

Expected:

```json
{
  "risk_id": "RULE_FLOOR_LOADING",
  "severity": "P0_BLOCKER",
  "forced_chapter": "Steel Structure Load加固"
}
```

### Case 2: Elevator Height Trigger

```json
{
  "room_floor": 2
}
```

Expected:

```json
{
  "risk_id": "RULE_ELEVATOR_HEIGHT",
  "severity": "P1_HIGH",
  "message_contains": "Verify elevator height for 2-meter tall AC units"
}
```

### Case 3: Budget Mismatch Trigger

```json
{
  "budget_range_high_rmb": 100000,
  "estimated_bom_cost_rmb": 90000
}
```

Calculation:

```text
required_budget_floor_rmb = 90000 * 1.3 = 117000
budget_range_high_rmb = 100000
trigger = true
```

Expected:

```json
{
  "risk_id": "RULE_BUDGET_MISMATCH",
  "severity": "P1_HIGH",
  "ui_highlight": "budget_range_high_rmb",
  "agent_required_prompt": "suggest lower-tier alternatives"
}
```

### Case 4: UPS Capacity

```json
{
  "rack_count": 10,
  "avg_power_per_rack_kw": 3,
  "redundancy_mode": "N+1"
}
```

Expected:

```json
{
  "total_it_load_kw": 30,
  "required_ups_capacity_kva_raw": 37.5,
  "recommended_ups_capacity_kva": 40
}
```

### Case 5: Precision AC Capacity

```json
{
  "room_area_m2": 40,
  "rack_count": 10,
  "avg_power_per_rack_kw": 3,
  "room_thermal_density_kw_per_m2": 0.08,
  "cooling_safety_margin_factor": 1.15,
  "cooling_model_catalog_kw": [25, 40, 60, 80, 100]
}
```

Expected:

```json
{
  "room_thermal_load_kw": 3.2,
  "total_it_load_kw": 30,
  "required_cooling_capacity_kw_raw": 38.18,
  "recommended_precision_ac_model_kw": 40
}
```
