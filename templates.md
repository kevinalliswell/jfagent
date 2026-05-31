# Technical Proposal Template Mapping

> **STATUS: PARTIAL — first-pass renderer only.** A fixed chapter set is rendered
> by `server/exportPayload.ts` + `scripts/render-export-docx.py` (`python-docx`).
> This is not full-fidelity; visual/layout QA needs LibreOffice/`soffice`.
> See `docs/specs-future/README.md` and `GOAL.md`.

## Purpose

This document defines how the system compiles finalized JSON session data into a professional corporate Word `.docx` technical proposal for data center room construction and integration projects.

The template system must produce clean, stable, enterprise-grade Word output with no messy alignment issues, broken tables, inconsistent fonts, floating images, or manually repaired formatting. The LLM may generate business wording, but document structure, chapter inclusion, styles, tables, placeholders, and risk-driven sections are controlled by deterministic rendering logic.

---

## Rendering Authority

### Precedence Order

```text
rules.md forced_document_injections
> templates.md chapter_matrix
> finalized_json_session_data
> LLM-generated prose
> default placeholder text
```

### Non-Negotiable Rendering Rules

1. The renderer must use Word styles, not manual inline formatting, wherever possible.
2. The renderer must use fixed-width tables with explicit column widths.
3. The renderer must not allow LLM-generated Markdown tables to pass directly into the `.docx`.
4. The renderer must not omit mandatory chapters injected by backend risk rules.
5. The renderer must render price fields as yellow-highlighted placeholders unless a legally approved pricing source is attached.
6. The renderer must generate a document that remains readable if printed in black and white.
7. The renderer must keep Chinese and English technical terms visually consistent.

---

## Input Contract

The proposal compiler consumes a frozen session payload assembled from the conversational agent, calculation engines, risk trigger engine, and dashboard edits.

```json
{
  "session_id": "string",
  "version": "v1",
  "customer_name": "string",
  "project_name": "string",
  "customer_industry": "medical | government | education | enterprise | industrial | carrier | unknown",
  "project_type": "new_build | renovation | expansion | migration | maintenance | unknown",
  "room_area_m2": 0,
  "room_floor": 1,
  "rack_count": 0,
  "server_count": null,
  "redundancy_mode": "N | N+1 | 2N",
  "ups_backup_time_minutes": 0,
  "calculation_outputs": {},
  "risk_flags": [],
  "forced_document_injections": [],
  "bom": {},
  "scope": {},
  "commercial": {},
  "export_metadata": {}
}
```

### Required Export Metadata

```json
{
  "generated_at": "ISO-8601",
  "generated_by": "Data Center Pre-sales AI Agent",
  "document_type": "technical_proposal",
  "pricing_mode": "manual_placeholder | approved_price_source",
  "template_version": "2026.05",
  "calculation_status": "confirmed | provisional | blocked"
}
```

If `calculation_status = "blocked"`, the document may be exported only as a draft with a visible warning on the cover page and in the executive summary.

---

## Chapter Matrix

The Chapter Matrix defines deterministic chapter order, inclusion conditions, source data, and rendering behavior.

| Order | Chapter | Inclusion Rule | Source Data | Rendering Mode |
| ---: | --- | --- | --- | --- |
| 0 | Cover Page & Catalog | Always render | `customer_name`, `project_name`, `generated_at` | Fixed layout |
| 1 | Project Overview & Medical/Gov Industry Background | Always render | `customer_industry`, `project_type`, `room_area_m2`, `scope` | LLM prose inside locked style blocks |
| 2 | Civil Works & Structural Reinforcement | Render only if `RULE_FLOOR_LOADING` triggered | `risk_flags`, `forced_document_injections`, `room_floor`, `ups_backup_time_minutes` | Conditional mandatory chapter |
| 3 | Power Distribution & UPS Engineering | Always render when UPS scope exists or UPS calculation exists | `calculation_outputs`, `bom.ups`, `bom.battery`, `bom.pdu` | Deterministic tables plus short LLM notes |
| 4 | Precision Air Conditioning & Fresh Air Systems | Always render when cooling scope exists or cooling calculation exists | `calculation_outputs`, `bom.cooling`, `redundancy_mode` | Deterministic tables plus N+1 diagrams/tables |
| 5 | Integrated Monitoring, Fire, Cabling & Fitout Scope | Render when any related scope exists | `scope` | Deterministic checklist tables |
| 6 | Risk Register & Open Items | Always render when risks or provisional fields exist | `risk_flags`, `audit_log`, `field_metadata` | Deterministic risk table |
| 7 | Commercial Placeholder Appendix | Always render | `bom`, `commercial`, `pricing_mode` | Yellow placeholders |

---

## Cover Page & Catalog

### Inclusion Rule

Always render.

### Dynamic Fields

| Placeholder | Source | Required | Fallback |
| --- | --- | --- | --- |
| `[customer_name]` | `session.customer_name` | Yes | `客户名称待确认` |
| `[project_name]` | `session.project_name` | Yes | `[customer_name]数据中心机房建设项目` |
| `[generated_at]` | `export_metadata.generated_at` | Yes | Current export timestamp |
| `[document_version]` | `session.version` | Yes | `v1` |

### Cover Layout

```pseudo
FUNCTION render_cover_page(session):
  add_section("cover", page_size="A4", margins="normal")
  add_logo(position="top_left", max_width_cm=3.2)
  add_vertical_space(lines=8)
  add_paragraph(session.customer_name, style="CoverCustomer")
  add_paragraph(session.project_name, style="CoverTitle")
  add_paragraph("数据中心机房建设技术方案", style="CoverSubtitle")
  add_vertical_space(lines=6)
  add_metadata_table([
    ["文档版本", session.version],
    ["生成时间", format_date(session.export_metadata.generated_at)],
    ["方案类型", "技术建议书 / Technical Proposal"],
    ["编制单位", "Pre-sales AI Copilot"]
  ])
  add_page_break()
```

### Catalog Rendering

The catalog must be generated using Word-native table-of-contents fields, not manually typed numbering.

```pseudo
FUNCTION render_catalog():
  add_heading("目录", level=1)
  insert_word_toc(
    include_heading_levels=[1,2,3],
    right_align_page_numbers=true,
    use_hyperlinks=true
  )
  add_page_break()
```

### Alignment Rules

- Cover title is centered.
- Metadata table is centered with fixed width `14.5 cm`.
- Do not use floating text boxes.
- Do not use absolute-positioned shapes for critical text.
- Use page break after cover and after catalog.

---

## Chapter 1: Project Overview & Medical/Gov Industry Background

### Inclusion Rule

Always render.

### Purpose

This chapter provides a professional project opening, summarizes the known construction scope, and generates an industry-specific standard pitch based on `customer_industry`.

### LLM Generation Boundary

The LLM may generate polished prose, but only inside predefined blocks:

```json
{
  "allowed_llm_blocks": [
    "industry_background_pitch",
    "project_objective_summary",
    "construction_value_statement"
  ],
  "forbidden_llm_actions": [
    "invent_customer_credentials",
    "invent_certifications",
    "invent_final_price",
    "remove_risk_warnings",
    "claim_verified_site_conditions_without evidence"
  ]
}
```

### Industry Pitch Mapping

| `customer_industry` | Required Pitch Angle |
| --- | --- |
| `medical` | Medical continuity, HIS/PACS/LIS stability, critical service uptime, regulated facility safety |
| `government` | Secure government operations, reliable public service systems, standardized construction acceptance |
| `education` | Campus digital infrastructure, teaching/research continuity, budget-sensitive expandability |
| `enterprise` | Business continuity, scalable IT infrastructure, maintainable lifecycle cost |
| `industrial` | Production system reliability, environmental resilience, industrial network continuity |
| `carrier` | High availability, standardized telecom-grade infrastructure, operational maintainability |
| `unknown` | General data center room reliability, safety, expandability, and maintainability |

### Chapter Structure

```pseudo
add_heading("第一章 项目概况与行业建设背景", level=1)

add_heading("1.1 项目基本信息", level=2)
render_project_basic_info_table(session)

add_heading("1.2 行业背景与建设必要性", level=2)
render_llm_block(
  block_id="industry_background_pitch",
  max_words=450,
  style="BodyText"
)

add_heading("1.3 建设目标", level=2)
render_bullets([
  "提升机房供配电系统可靠性与可维护性。",
  "保障核心IT设备连续运行与散热安全。",
  "形成规范化、可验收、可扩展的数据中心基础设施环境。",
  "为后续报价、深化设计、施工组织和验收交付提供统一技术口径。"
])
```

### Project Basic Information Table

| Field Label | Data Source | Fallback |
| --- | --- | --- |
| 客户名称 | `customer_name` | `待确认` |
| 项目名称 | `project_name` | `待确认` |
| 行业类型 | `customer_industry` | `通用行业` |
| 项目类型 | `project_type` | `待确认` |
| 机房面积 | `room_area_m2` | `待确认` |
| 所在楼层 | `room_floor` | `待确认` |
| 机柜数量 | `rack_count` | `待确认` |
| 冗余模式 | `redundancy_mode` | `待确认` |

### Table Rendering Rules

- Table width: `16.0 cm`.
- Column widths: `4.2 cm`, `11.8 cm`.
- Header row background: `#1F4E79`.
- Header row text: white, bold.
- Body row font: `Microsoft YaHei`, 10.5 pt.
- No merged cells.
- No auto-fit to contents.

---

## Chapter 2: Civil Works & Structural Reinforcement

### Conditional Chapter Rule

This chapter must be rendered strictly only if `Rule_Floor_Loading` is triggered.

```pseudo
FUNCTION should_render_chapter_2(session):
  RETURN exists(
    risk IN session.risk_flags
    WHERE risk.id == "RULE_FLOOR_LOADING"
  )
```

### Strict Exclusion Rule

```pseudo
IF should_render_chapter_2(session) == false:
  DO NOT render chapter title
  DO NOT render empty placeholder
  DO NOT render "not applicable" page
  DO NOT reserve chapter numbering
```

### Required Title

```text
第二章 土建条件与 Steel Structure Load加固
```

The mixed Chinese-English title must match the forced chapter title from `rules.md`.

### Required Content

```pseudo
add_heading("第二章 土建条件与 Steel Structure Load加固", level=1)

add_warning_box(
  title="Structural Loading Deficit Risk",
  severity="P0_BLOCKER",
  body="机房位于二层及以上，且UPS后备时间达到或超过120分钟。电池柜及UPS设备重量可能导致楼板承重不足，必须进行结构荷载复核。"
)

add_heading("2.1 触发条件", level=2)
render_key_value_table([
  ["所在楼层", session.room_floor],
  ["UPS后备时间", session.ups_backup_time_minutes + " 分钟"],
  ["触发规则", "Rule_Floor_Loading"],
  ["风险等级", "P0_BLOCKER"]
])

add_heading("2.2 结构复核要求", level=2)
render_bullets([
  "复核原建筑结构设计荷载与实际设备集中荷载。",
  "计算UPS主机、电池柜、电池组及底座的静载和集中荷载。",
  "必要时设置钢结构承重平台、分布梁或楼板加固措施。",
  "结构复核及加固方案应由业主或具备资质的结构专业单位确认。"
])

add_heading("2.3 施工配合要求", level=2)
render_bullets([
  "设备进场前完成承重复核。",
  "承重加固施工完成后再进行UPS及电池柜安装。",
  "加固区域应与设备平面布置、线缆路由和检修空间统一协调。"
])
```

### Formatting Rules

- Risk warning box uses bright red border `#C00000`.
- Risk title is bold red, 12 pt.
- Body text remains black for print readability.
- Do not use decorative icons as the only risk signal.
- Chapter must be listed in the Word catalog only when rendered.

---

## Chapter 3: Power Distribution & UPS Engineering

### Inclusion Rule

Render when any of the following is true:

```pseudo
session.scope.ups == true
OR session.scope.power_distribution == true
OR session.calculation_outputs.recommended_ups_capacity_kva IS NOT NULL
OR session.bom.ups IS NOT EMPTY
```

### Required Content

This chapter must incorporate tabular data showing:

- Calculated `40kVA` modular UPS BOM when the calculation output recommends `40 kVA`.
- Battery runtime logs.
- PDU configurations.
- Manual price placeholders highlighted in yellow.

### Chapter Structure

```pseudo
add_heading("第三章 供配电与UPS工程方案", level=1)

add_heading("3.1 UPS容量计算结果", level=2)
render_ups_calculation_table(session.calculation_outputs)

add_heading("3.2 40kVA模块化UPS配置BOM", level=2)
render_modular_ups_bom_table(session.bom.ups)

add_heading("3.3 电池后备时间与配置记录", level=2)
render_battery_runtime_log_table(session.bom.battery)

add_heading("3.4 PDU与配电回路配置", level=2)
render_pdu_configuration_table(session.bom.pdu)

add_heading("3.5 施工与验收要点", level=2)
render_bullets([
  "UPS输入、输出及旁路回路应按设计容量和现场配电条件进行复核。",
  "电池开关、线缆截面、端子压接和标识应满足安全和维护要求。",
  "PDU回路编号、负载分配和机柜位置应与最终机柜平面图一致。",
  "投运前应完成市电/电池切换、旁路切换、告警联动和带载测试。"
])
```

### UPS Calculation Table

| Column | Source | Example |
| --- | --- | --- |
| 参数 | Static label | `机柜数量` |
| 数值 | Calculation input/output | `10` |
| 单位 | Static unit | `台` |
| 备注 | Derived note | `来自最终会话数据` |

Rows:

```json
[
  ["机柜数量", "rack_count", "台", "用于IT负载估算"],
  ["单柜平均功率", "avg_power_per_rack_kw", "kW/柜", "未确认时使用默认值并标记为暂估"],
  ["总IT负载", "total_it_load_kw", "kW", "Rack Count * Avg Power per Rack"],
  ["冗余模式", "redundancy_mode", "-", "N / N+1 / 2N"],
  ["UPS冗余系数", "redundancy_factor", "-", "由冗余模式映射"],
  ["UPS原始计算容量", "required_ups_capacity_kva_raw", "kVA", "未向下取整"],
  ["推荐UPS容量", "recommended_ups_capacity_kva", "kVA", "按标准容量向上取整"]
]
```

### 40kVA Modular UPS BOM Table

Render this table when:

```pseudo
session.calculation_outputs.recommended_ups_capacity_kva == 40
```

Default 40kVA BOM rows:

| 序号 | 设备名称 | 规格建议 | 数量 | 单位 | 单价 | 合价 | 备注 |
| ---: | --- | --- | ---: | --- | --- | --- | --- |
| 1 | 模块化UPS主机框架 | 40kVA级模块化UPS机框 | 1 | 套 | `[Please manually enter your local channel price here]` | `[Please manually enter your local channel price here]` | 含监控显示与基础通讯接口 |
| 2 | UPS功率模块 | 20kVA功率模块 | 2 | 块 | `[Please manually enter your local channel price here]` | `[Please manually enter your local channel price here]` | 满足40kVA配置 |
| 3 | UPS输入输出配电 | 输入、输出、维修旁路配套 | 1 | 项 | `[Please manually enter your local channel price here]` | `[Please manually enter your local channel price here]` | 以现场深化为准 |
| 4 | UPS安装调试 | 安装、接线、基础调试 | 1 | 项 | `[Please manually enter your local channel price here]` | `[Please manually enter your local channel price here]` | 不含特殊搬运 |

### Price Placeholder Rule

All price cells must render as yellow-highlighted placeholders unless `pricing_mode = "approved_price_source"`.

```pseudo
FUNCTION render_price_cell(value, pricing_mode):
  IF pricing_mode != "approved_price_source":
    RETURN highlighted_text(
      "[Please manually enter your local channel price here]",
      highlight_color="#FFF2CC",
      font_color="#9C6500"
    )

  RETURN format_currency(value, "RMB")
```

### Battery Runtime Log Table

| Column | Width | Source |
| --- | ---: | --- |
| 电池系统 | `3.0 cm` | `bom.battery.system_name` |
| 后备时间 | `2.4 cm` | `ups_backup_time_minutes` |
| 电池规格 | `3.2 cm` | `bom.battery.model` |
| 数量 | `1.8 cm` | `bom.battery.quantity` |
| 组数 | `1.8 cm` | `bom.battery.strings` |
| 计算说明 | `4.0 cm` | `bom.battery.runtime_notes` |

If battery data is missing:

```pseudo
render_table_row([
  "UPS Battery Bank",
  session.ups_backup_time_minutes OR "待确认",
  "待深化",
  "待深化",
  "待深化",
  "需结合UPS品牌、电池规格、放电曲线和现场温度进行复核"
])
```

### PDU Configuration Table

| Column | Width | Source |
| --- | ---: | --- |
| PDU类型 | `3.0 cm` | `bom.pdu.type` |
| 输入规格 | `3.0 cm` | `bom.pdu.input_rating` |
| 输出位数 | `2.4 cm` | `bom.pdu.outlet_count` |
| 数量 | `1.8 cm` | `bom.pdu.quantity` |
| 安装位置 | `2.8 cm` | `bom.pdu.location` |
| 备注 | `3.0 cm` | `bom.pdu.notes` |

Fallback PDU rows:

```json
[
  ["机柜PDU", "32A / 220V 或按现场深化", "待确认", "按机柜数量配置", "机柜后部", "建议A/B路分配"],
  ["配电柜输出回路", "按UPS输出容量深化", "待确认", "1项", "UPS输出侧", "需结合最终配电系统图"]
]
```

---

## Chapter 4: Precision Air Conditioning & Fresh Air Systems

### Inclusion Rule

Render when any of the following is true:

```pseudo
session.scope.precision_ac == true
OR session.scope.cooling == true
OR session.calculation_outputs.recommended_precision_ac_model_kw IS NOT NULL
OR session.bom.cooling IS NOT EMPTY
```

### Required Content

This chapter must render specified redundant N+1 configurations when `cooling_redundancy = "N+1"` or when the backend/session scope indicates redundant precision AC is required.

### Chapter Structure

```pseudo
add_heading("第四章 精密空调与新风系统方案", level=1)

add_heading("4.1 热负荷与制冷量计算", level=2)
render_cooling_calculation_table(session.calculation_outputs)

add_heading("4.2 精密空调配置建议", level=2)
render_precision_ac_configuration_table(session.bom.cooling)

add_heading("4.3 N+1冗余配置说明", level=2)
IF is_cooling_n_plus_1(session):
  render_n_plus_1_configuration(session)
ELSE:
  render_standard_cooling_note(session)

add_heading("4.4 新风与气流组织要求", level=2)
render_fresh_air_and_airflow_requirements(session)
```

### Cooling Calculation Table

Rows:

```json
[
  ["机房面积", "room_area_m2", "m2", "用于环境热负荷估算"],
  ["房间热密度", "room_thermal_density_kw_per_m2", "kW/m2", "默认值需标记为暂估"],
  ["房间热负荷", "room_thermal_load_kw", "kW", "Room Area * Room Thermal Density"],
  ["IT设备热负荷", "total_it_load_kw", "kW", "通常按IT负载等效热负荷"],
  ["安全系数", "cooling_safety_margin_factor", "-", "默认1.15"],
  ["计算制冷量", "required_cooling_capacity_kw_raw", "kW", "未向下取整"],
  ["推荐机型", "recommended_precision_ac_model_kw", "kW", "映射至厂家离散机型"]
]
```

### Precision AC Configuration Table

| 序号 | 设备名称 | 规格建议 | 冗余关系 | 数量 | 单位 | 单价 | 合价 | 备注 |
| ---: | --- | --- | --- | ---: | --- | --- | --- | --- |
| 1 | 精密空调室内机 | `[recommended_precision_ac_model_kw]kW级` | `N`或`N+1` | `[quantity]` | 台 | `[Please manually enter your local channel price here]` | `[Please manually enter your local channel price here]` | 含控制器及基础告警接口 |
| 2 | 室外机/冷凝器 | 与室内机匹配 | 跟随室内机 | `[quantity]` | 台 | `[Please manually enter your local channel price here]` | `[Please manually enter your local channel price here]` | 以品牌选型为准 |
| 3 | 铜管及保温 | 按现场距离深化 | - | 1 | 项 | `[Please manually enter your local channel price here]` | `[Please manually enter your local channel price here]` | 暂按标准距离估算 |
| 4 | 排水与加湿补水 | 按现场条件深化 | - | 1 | 项 | `[Please manually enter your local channel price here]` | `[Please manually enter your local channel price here]` | 需现场确认路由 |
| 5 | 安装调试 | 设备安装、抽真空、调试 | - | 1 | 项 | `[Please manually enter your local channel price here]` | `[Please manually enter your local channel price here]` | 不含特殊吊装 |

### N+1 Configuration Logic

```pseudo
FUNCTION is_cooling_n_plus_1(session):
  RETURN session.cooling_redundancy == "N+1"
    OR session.scope.cooling_redundancy == "N+1"
    OR session.bom.cooling.redundancy_mode == "N+1"
```

```pseudo
FUNCTION render_n_plus_1_configuration(session):
  base_required_kw = session.calculation_outputs.required_cooling_capacity_kw_raw
  model_kw = session.calculation_outputs.recommended_precision_ac_model_kw

  active_unit_count = ceil(base_required_kw / model_kw)
  standby_unit_count = 1
  total_unit_count = active_unit_count + standby_unit_count

  render_key_value_table([
    ["计算所需制冷量", base_required_kw + " kW"],
    ["单台推荐机型", model_kw + " kW"],
    ["运行机数量N", active_unit_count + " 台"],
    ["备用机数量+1", standby_unit_count + " 台"],
    ["合计配置数量", total_unit_count + " 台"]
  ])

  render_paragraph(
    "本项目精密空调按N+1冗余思路配置。当任一台设备维护或故障时，其余设备应满足核心IT负载的基本制冷需求。最终配置需结合冷热通道组织、机柜功率密度、室外机安装位置及品牌选型进行深化。"
  )
```

### Fresh Air Requirements

Render as a fixed checklist table:

| 检查项 | 要求 | 状态 |
| --- | --- | --- |
| 新风引入 | 按机房正压、人员维护及规范要求设置 | 待现场确认 |
| 防尘过滤 | 新风入口应设置过滤措施 | 待现场确认 |
| 防火阀 | 穿越防火分区时按规范设置 | 待深化 |
| 冷凝水排放 | 排水坡度、防倒灌、防渗漏 | 待现场确认 |
| 气流组织 | 避免冷热短路，优先保障机柜进风侧 | 待深化 |

---

## Formatting Requirements

The renderer must apply strict Markdown-to-docx styling mappings. Markdown is an intermediate authoring format only; final `.docx` output must use named Word styles.

### Global Page Setup

| Setting | Value |
| --- | --- |
| Page size | A4 |
| Margins | Top `2.54 cm`, Bottom `2.54 cm`, Left `2.8 cm`, Right `2.5 cm` |
| Header distance | `1.5 cm` |
| Footer distance | `1.5 cm` |
| Default Chinese font | Microsoft YaHei |
| Default English font | Arial |
| Body font size | 10.5 pt |
| Body line spacing | 1.25 |
| Paragraph spacing after | 6 pt |
| Theme color | Corporate blue `#1F4E79` |

### Markdown-to-docx Style Mapping

| Markdown Element | Word Style | Rules |
| --- | --- | --- |
| `#` | `DocTitle` | Cover only; 24 pt, bold, centered |
| `##` | `Heading 1` | Chinese chapter title; 16 pt, bold, blue |
| `###` | `Heading 2` | 13 pt, bold, black |
| `####` | `Heading 3` | 11 pt, bold, black |
| Paragraph | `BodyText` | 10.5 pt, justified, first-line indent `0.74 cm` |
| Bullet list | `ListBullet` | Hanging indent, no manual symbols |
| Numbered list | `ListNumber` | Word-native numbering |
| Blockquote warning | `RiskWarning` | Red/amber/gray based on severity |
| Inline code | `TechnicalToken` | Consolas, 9.5 pt, light gray shading |
| Table | `CorpTable` | Fixed width, no auto-fit |
| Price placeholder | `PricePlaceholder` | Yellow highlight, brown text |

### Heading Numbering

Chapter numbering must be generated by renderer, not by LLM prose.

```pseudo
Heading 1 format: "第{chapter_cn}章 {title}"
Heading 2 format: "{chapter_number}.{section_number} {title}"
Heading 3 format: "{chapter_number}.{section_number}.{subsection_number} {title}"
```

If Chapter 2 is not rendered, subsequent chapters may either:

- Preserve business chapter names as "第三章", "第四章" only if the user expects fixed chapter labels, or
- Renumber sequentially using the renderer.

Default behavior:

```pseudo
preserve_requested_chapter_numbers = true
```

This means Chapter 3 remains "第三章" even when Chapter 2 is omitted, unless product design chooses continuous numbering.

### Table Formatting Rules

All tables must use:

```json
{
  "style": "CorpTable",
  "width_type": "fixed",
  "total_width_cm": 16.0,
  "auto_fit": false,
  "repeat_header_row": true,
  "allow_row_break_across_pages": false,
  "cell_vertical_alignment": "center",
  "cell_margin_top_cm": 0.08,
  "cell_margin_bottom_cm": 0.08,
  "cell_margin_left_cm": 0.12,
  "cell_margin_right_cm": 0.12
}
```

Header row:

```json
{
  "background": "#1F4E79",
  "font_color": "#FFFFFF",
  "bold": true,
  "alignment": "center"
}
```

Body cells:

```json
{
  "font": "Microsoft YaHei",
  "font_size_pt": 9.5,
  "alignment": "left",
  "vertical_alignment": "center"
}
```

Numeric cells:

```json
{
  "alignment": "center",
  "format": "integer | decimal_2 | currency_rmb"
}
```

### Yellow Price Placeholder Styling

Any price placeholder must use:

```json
{
  "text": "[Please manually enter your local channel price here]",
  "style": "PricePlaceholder",
  "highlight_color": "#FFF2CC",
  "font_color": "#9C6500",
  "bold": false,
  "italic": false
}
```

Legal and pricing liability rule:

```pseudo
IF field.semantic_type == "price"
AND session.export_metadata.pricing_mode != "approved_price_source":
  render_price_cell_as_yellow_placeholder()
  DO NOT render numeric inferred price
  DO NOT render market average price
  DO NOT render supplier quote
```

### Warning Box Styles

| Severity | Border | Fill | Title Color | Required Behavior |
| --- | --- | --- | --- | --- |
| `P0_BLOCKER` | `#C00000` | `#FCE4D6` | `#C00000` | Must show on export |
| `P1_HIGH` | `#FF0000` | `#FCE4D6` | `#C00000` | Must show on export |
| `P2_MEDIUM` | `#F4B183` | `#FFF2CC` | `#9C6500` | Must show if unresolved |
| `P3_LOW` | `#BFBFBF` | `#F2F2F2` | `#404040` | Optional summary |

---

## Data-to-Document Compilation Pipeline

### Pipeline Overview

```pseudo
FUNCTION compile_docx_proposal(session):
  validate_session_payload(session)
  normalize_units_and_labels(session)
  apply_backend_rule_outputs(session)
  build_chapter_plan(session)
  initialize_word_document()
  register_word_styles()
  render_cover_page(session)
  render_catalog_placeholder()

  FOR chapter IN chapter_plan:
    render_chapter(chapter, session)

  render_appendices(session)
  update_word_toc()
  validate_docx_layout()
  return docx_file
```

### Chapter Plan Builder

```pseudo
FUNCTION build_chapter_plan(session):
  chapters = []

  chapters.ADD("COVER_AND_CATALOG")
  chapters.ADD("CHAPTER_1_PROJECT_OVERVIEW")

  IF exists(risk IN session.risk_flags WHERE risk.id == "RULE_FLOOR_LOADING"):
    chapters.ADD("CHAPTER_2_CIVIL_STRUCTURAL_REINFORCEMENT")

  IF has_ups_scope_or_calculation(session):
    chapters.ADD("CHAPTER_3_POWER_UPS")

  IF has_cooling_scope_or_calculation(session):
    chapters.ADD("CHAPTER_4_PRECISION_AC_FRESH_AIR")

  IF has_auxiliary_scope(session):
    chapters.ADD("CHAPTER_5_MONITORING_FIRE_CABLING_FITOUT")

  IF has_risks_or_open_items(session):
    chapters.ADD("CHAPTER_6_RISK_REGISTER")

  chapters.ADD("CHAPTER_7_COMMERCIAL_PLACEHOLDER_APPENDIX")

  RETURN chapters
```

### Forced Injection Merge

```pseudo
FUNCTION apply_backend_rule_outputs(session):
  FOR injection IN session.forced_document_injections:
    IF injection.chapter_id == "STEEL_STRUCTURE_LOAD_REINFORCEMENT":
      ensure_risk_flag_exists("RULE_FLOOR_LOADING")
      session.render_flags.chapter_2_required = true

    lock_injection(injection.chapter_id)

  RETURN session
```

---

## Alignment and Layout QA Rules

The renderer must run layout checks before returning the `.docx`.

### Required Checks

```pseudo
FUNCTION validate_docx_layout(document):
  assert_no_floating_textboxes_for_core_content(document)
  assert_all_tables_fixed_width(document)
  assert_no_table_exceeds_page_width(document)
  assert_header_rows_repeat(document)
  assert_no_empty_conditional_chapters(document)
  assert_price_placeholders_highlighted(document)
  assert_forced_chapters_locked(document)
  assert_toc_updated(document)
  assert_no_unresolved_raw_json_visible(document)
  assert_no_markdown_pipe_tables_visible(document)
```

### Table Overflow Guard

```pseudo
FUNCTION assert_no_table_exceeds_page_width(document):
  max_content_width_cm = page_width_cm - left_margin_cm - right_margin_cm

  FOR table IN document.tables:
    IF table.total_width_cm > max_content_width_cm:
      fail("TABLE_WIDTH_OVERFLOW", table.id)
```

### Empty Chapter Guard

```pseudo
FUNCTION assert_no_empty_conditional_chapters(document):
  FOR chapter IN document.chapters:
    IF chapter.is_conditional AND chapter.rendered AND chapter.body_is_empty:
      fail("EMPTY_CONDITIONAL_CHAPTER", chapter.id)
```

### Placeholder Guard

```pseudo
FUNCTION assert_price_placeholders_highlighted(document):
  FOR run IN document.text_runs:
    IF run.text CONTAINS "[Please manually enter your local channel price here]":
      assert(run.highlight_color == "#FFF2CC")
      assert(run.style == "PricePlaceholder")
```

---

## Legal and Pricing Liability Controls

### Price Rendering Policy

The system is a pre-sales copilot, not a legally binding quotation engine. Therefore:

- It may structure BOM lines.
- It may show quantities and technical specifications.
- It may reserve price columns.
- It must not invent final commercial prices.
- It must not imply that placeholder pricing is a valid offer.

### Required Disclaimer

Render this disclaimer in the Commercial Placeholder Appendix:

```text
本文件由售前辅助系统根据当前会话信息自动整理生成，设备价格、施工费用、税费、运输费用及服务费用需由授权渠道或项目负责人结合当地供货、施工和现场条件人工确认。本文件中的价格占位符不构成正式报价或合同承诺。
```

### Placeholder Columns

The following fields always use yellow placeholders unless approved pricing exists:

- `unit_price`
- `subtotal_price`
- `labor_price`
- `transport_price`
- `commissioning_price`
- `tax_amount`
- `total_project_price`

---

## Example Rendering Scenario

### Input

```json
{
  "customer_name": "XX医院",
  "project_name": "XX医院中心机房改造项目",
  "customer_industry": "medical",
  "room_area_m2": 40,
  "room_floor": 3,
  "rack_count": 10,
  "redundancy_mode": "N+1",
  "ups_backup_time_minutes": 120,
  "calculation_outputs": {
    "total_it_load_kw": 30,
    "recommended_ups_capacity_kva": 40,
    "recommended_precision_ac_model_kw": 40,
    "required_cooling_capacity_kw_raw": 38.18
  },
  "risk_flags": [
    {
      "id": "RULE_FLOOR_LOADING",
      "severity": "P0_BLOCKER",
      "title": "Structural Loading Deficit Risk"
    }
  ],
  "export_metadata": {
    "pricing_mode": "manual_placeholder"
  }
}
```

### Expected Chapter Output

```text
Cover Page
Catalog
第一章 项目概况与行业建设背景
第二章 土建条件与 Steel Structure Load加固
第三章 供配电与UPS工程方案
第四章 精密空调与新风系统方案
第六章 风险清单与待确认事项
第七章 商务价格占位附录
```

### Expected Chapter 3 Behavior

- Render UPS calculation table.
- Render `40kVA` modular UPS BOM.
- Render battery runtime log showing `120分钟`.
- Render PDU configuration table.
- Render all price cells as yellow placeholders.

### Expected Chapter 4 Behavior

- Render cooling calculation table.
- Render `40kW` precision AC model recommendation.
- If `cooling_redundancy = "N+1"`, render active unit count plus one standby unit.
- Render fresh air and airflow checklist.

---

## Implementation Checklist

Before export is released to the user:

- `[ ]` Cover page contains `[customer_name]` and `[project_name]` resolved or clearly marked as pending.
- `[ ]` Word-native catalog is inserted and updated.
- `[ ]` Chapter 1 includes industry pitch based on `customer_industry`.
- `[ ]` Chapter 2 appears only when `RULE_FLOOR_LOADING` is triggered.
- `[ ]` Chapter 2 includes `Structural Loading Deficit Risk` and `Steel Structure Load加固`.
- `[ ]` Chapter 3 includes UPS calculation, 40kVA BOM when applicable, battery runtime logs, and PDU configs.
- `[ ]` Chapter 4 includes precision AC calculation and N+1 config when applicable.
- `[ ]` All price fields use yellow placeholders unless approved pricing exists.
- `[ ]` No Markdown pipe tables remain in final `.docx`.
- `[ ]` All tables have fixed widths and repeat header rows.
- `[ ]` No mandatory risk chapter can be removed by LLM.
- `[ ]` Document disclaimer is included in the commercial appendix.

