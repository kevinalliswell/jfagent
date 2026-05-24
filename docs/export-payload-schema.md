# Export Payload Schema

## Purpose

`ExportPayloadV1` is the frozen JSON contract between backend session state and the Word rendering service. Its job is to collect the current session, dashboard edits, risk rules, calculation outputs, BOM placeholders, commercial disclaimers, and chapter plan into one deterministic payload.

The schema follows `templates.md` and keeps the current 99 RMB flow as payment-willingness validation only.

## Source Of Truth

Current implementation:

- TypeScript schema and builder: `server/exportPayload.ts`
- First DOCX renderer: `scripts/render-export-docx.py`
- Backend renderer orchestration: `server/exportDocument.ts`
- API response surface: `GET /api/session/export`
- Template rules: `templates.md`
- API envelope rules: `api_spec.md`

The backend builds the payload from `BackendSession`. Manual dashboard edits remain authoritative through the existing field source and confidence metadata.

## Top-Level Contract

```ts
interface ExportPayloadV1 {
  version: "v1";
  session_id: string;
  state_version: number;
  customer_name: string;
  project_name: string;
  customer_industry: "medical" | "government" | "education" | "enterprise" | "industrial" | "carrier" | "unknown";
  project_type: "new_build" | "renovation" | "expansion" | "migration" | "maintenance" | "unknown";
  room_area_m2: number | null;
  room_floor: number | null;
  rack_count: number | null;
  server_count: number | null;
  redundancy_mode: "N" | "N+1" | "2N" | "unknown";
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
```

## Required Metadata

`export_metadata` always includes:

- `generated_at`
- `generated_by = "Data Center Pre-sales AI Agent"`
- `document_type = "technical_proposal"`
- `export_type`
- `pricing_mode = "manual_placeholder"`
- `template_version = "2026.05"`
- `calculation_status`
- `render_mode = "deterministic_template_with_llm_blocks"`

`calculation_status` is:

- `confirmed` when required export fields are present and no required field needs confirmation.
- `provisional` when the document can be drafted but some fields or risks remain open.
- `blocked` when the payload lacks enough core sizing information and must render a visible draft warning.

## Chapter Plan

The builder emits deterministic chapter IDs aligned with `templates.md`:

| ID | Inclusion |
| --- | --- |
| `COVER_AND_CATALOG` | Always |
| `CHAPTER_1_PROJECT_OVERVIEW` | Always |
| `CHAPTER_2_CIVIL_STRUCTURAL_REINFORCEMENT` | Only when `RULE_FLOOR_LOADING` forces the structural chapter |
| `CHAPTER_3_POWER_UPS` | UPS scope or UPS calculation exists |
| `CHAPTER_4_PRECISION_AC_FRESH_AIR` | Cooling scope or cooling calculation exists |
| `CHAPTER_5_MONITORING_FIRE_CABLING_FITOUT` | Auxiliary scope exists |
| `CHAPTER_6_RISK_REGISTER` | Risks or open items exist |
| `CHAPTER_7_COMMERCIAL_PLACEHOLDER_APPENDIX` | Always |

Chapter 2 is never emitted unless the floor-loading rule is present. This prevents empty conditional chapters.

## Pricing Policy

The first schema always uses:

```json
{
  "pricing_mode": "manual_placeholder",
  "price_placeholder_text": "[Please manually enter your local channel price here]"
}
```

Every BOM price cell carries semantic type, placeholder text, highlight color `#FFF2CC`, and font color `#9C6500`. Numeric price rendering remains blocked until an approved pricing source decision is made.

## Validation

`validation` is schema-level validation, not Word layout QA. It checks:

- cover fields have values or explicit fallbacks
- Chapter 2 is tied to `RULE_FLOOR_LOADING`
- price placeholders are required under manual pricing mode
- commercial disclaimer is present
- required export fields missing from the session

The first `.docx` renderer performs structural package checks. Full rendered-page visual QA requires LibreOffice/`soffice`.

## API Behavior

`GET /api/session/export` now returns:

```json
{
  "data": {
    "export_status": "preview_ready",
    "asset": {},
    "billing_check": {},
    "included_chapters": [],
    "export_payload": {},
    "triggered_risks": [],
    "layout_validation": {}
  }
}
```

Formal approved exports consume this payload to generate a real `.docx`. The frontend may still ignore `export_payload` for display purposes.
