# API Specification

## Purpose

This document defines the production API contract between the minimalist Frontend Workstation and the backend LLM, RAG, rules, risk, billing, and document export engines.

The Frontend Workstation contains two primary surfaces:

- Chat panel: free-form WeChat-style interaction with the AI pre-sales agent.
- Dashboard panel: structured session fields that can be manually corrected by the user.

The backend is authoritative for:

- Session state mutation.
- LLM response generation.
- Field extraction and normalization.
- Rule engine evaluation.
- Risk trigger generation.
- Manual override precedence.
- 99 RMB / credit payment simulation.
- Final `.docx` proposal compilation.

This specification follows OpenAPI 3.0 design philosophy: explicit paths, request/response schemas, stable enums, error models, idempotency support, and predictable status codes.

---

## OpenAPI Document Skeleton

```yaml
openapi: 3.0.3
info:
  title: Data Center Pre-sales AI Agent API
  version: 1.0.0
  description: Real-time synchronization API for Chat + Dashboard frontend and backend LLM/rule engines.
servers:
  - url: https://api.example.com
    description: Production
  - url: http://localhost:3000
    description: Local development
tags:
  - name: Session
  - name: Chat
  - name: Override
  - name: Export
```

---

## API Principles

### State Authority

```text
backend_session_state
> dashboard_manual_override
> user_chat_message
> uploaded_file_extraction
> quick_reply_selection
> LLM_inference
> defaults
```

### Synchronization Rules

1. Every mutating request must include `session_id`.
2. Every mutating response must include `state_version`.
3. The frontend must replace local dashboard values only when the response has a newer `state_version`.
4. Manual overrides from `/api/session/override` outrank later LLM inference.
5. Triggered risks returned by the backend must be displayed immediately.
6. Export must always compile from backend state, not frontend-local state.
7. Billing simulation must run before final `.docx` asset generation.

### Required Headers

| Header | Required | Purpose |
| --- | --- | --- |
| `Content-Type: application/json` | Yes | JSON request body |
| `Authorization: Bearer <token>` | Production | User/session auth |
| `X-Request-ID` | Recommended | Request tracing |
| `Idempotency-Key` | Recommended for mutating calls | Retry safety |

### Standard Response Envelope

All successful responses should use this envelope unless streaming is explicitly enabled.

```json
{
  "ok": true,
  "session_id": "sess_123",
  "state_version": 12,
  "server_time": "2026-05-22T21:40:00+08:00",
  "data": {}
}
```

### Standard Error Envelope

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "field_code is required.",
    "details": {},
    "retryable": false
  },
  "request_id": "req_123",
  "server_time": "2026-05-22T21:40:00+08:00"
}
```

---

## Endpoint Summary

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/session/chat` | Send text, voice transcription, or file payload into the LLM/rule pipeline. |
| `POST` | `/api/session/override` | Commit a dashboard manual correction after double-click editing. |
| `GET` | `/api/session/export` | Run billing check and compile final `.docx` proposal asset. |
| `GET` | `/api/assets/{asset_id}/download` | Download a generated export asset. |
| `GET` | `/api/admin/knowledge/status` | Return runtime knowledge index status for seed-trial admins. |
| `POST` | `/api/admin/knowledge/upload` | Upload a knowledge file, rebuild the local index, and reload backend retrieval. |

---

## 1. POST /api/session/chat

### Purpose

Accepts a user chat input from the frontend, invokes the agent extraction pipeline, evaluates hard rules, updates session state, and returns an AI response plus dashboard field patches and risk warnings.

This endpoint is used for:

- Raw project descriptions.
- Voice-to-text content.
- File references or file-extracted text.
- Quick-reply chip follow-ups when represented as plain content.

### OpenAPI Path Definition

```yaml
paths:
  /api/session/chat:
    post:
      tags: [Chat, Session]
      summary: Send chat input and synchronize extracted state.
      operationId: postSessionChat
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ChatRequest'
      responses:
        '200':
          description: Chat processed and session state updated.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ChatResponseEnvelope'
        '400':
          $ref: '#/components/responses/BadRequest'
        '409':
          $ref: '#/components/responses/StateConflict'
        '422':
          $ref: '#/components/responses/UnprocessableInput'
        '500':
          $ref: '#/components/responses/InternalError'
```

### Request Payload

Required product payload:

```json
{
  "session_id": "sess_123",
  "message_type": "text",
  "content": "raw string data"
}
```

Production schema:

```json
{
  "session_id": "sess_123",
  "message_type": "text",
  "content": "某医院老机房改造，面积50平方，10个机柜，UPS后备2小时。",
  "client_state_version": 11,
  "client_message_id": "msg_local_001",
  "locale": "zh-CN",
  "timezone": "Asia/Shanghai"
}
```

### Field Rules

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `session_id` | string | Yes | Existing or newly allocated session id. |
| `message_type` | enum | Yes | `text`, `voice`, or `file`. |
| `content` | string | Yes | Raw text, voice transcript, or file extraction reference/payload. |
| `client_state_version` | integer | No | Used for conflict detection. |
| `client_message_id` | string | No | Frontend-generated id for retry dedupe. |
| `locale` | string | No | Default `zh-CN`. |
| `timezone` | string | No | Default server timezone. |

### Message Type Semantics

| `message_type` | `content` Meaning | Backend Behavior |
| --- | --- | --- |
| `text` | Raw typed user text | Run LLM extraction, RAG if needed, rules engine. |
| `voice` | Voice transcript string | Treat as text but mark source as `voice`. |
| `file` | File id, URI, or extracted text payload | Run file ingestion/extraction pipeline before state update. |

### Response Payload

Required product response:

```json
{
  "ai_response": "text",
  "quick_replies": ["string"],
  "updated_fields": {
    "room_area": 50
  },
  "triggered_risks": [
    {
      "id": "ERR_LOAD",
      "level": "P1",
      "text": "..."
    }
  ]
}
```

Production response envelope:

```json
{
  "ok": true,
  "session_id": "sess_123",
  "state_version": 12,
  "server_time": "2026-05-22T21:40:00+08:00",
  "data": {
    "ai_response": "我先按医院老机房改造整理：面积约50平方米，10台机柜，UPS后备约120分钟。这里会触发楼板承重风险，我已标红并加入结构加固章节。",
    "quick_replies": [
      "确认按10台机柜",
      "补充UPS品牌",
      "生成Word需求表"
    ],
    "updated_fields": {
      "customer_industry": "medical",
      "project_type": "renovation",
      "room_area": 50,
      "room_area_m2": 50,
      "rack_count": 10,
      "ups_backup_time_minutes": 120
    },
    "field_patches": [
      {
        "field_code": "room_area_m2",
        "old_value": null,
        "new_value": 50,
        "source": "user_message",
        "confidence": 0.92,
        "needs_confirmation": false
      },
      {
        "field_code": "rack_count",
        "old_value": null,
        "new_value": 10,
        "source": "user_message",
        "confidence": 0.95,
        "needs_confirmation": false
      }
    ],
    "triggered_risks": [
      {
        "id": "RULE_FLOOR_LOADING",
        "legacy_id": "ERR_LOAD",
        "level": "P0_BLOCKER",
        "text": "Structural Loading Deficit Risk: room is above the first floor and UPS backup time is at least 120 minutes.",
        "blocking": true,
        "dismissible": false,
        "trigger_fields": ["room_floor", "ups_backup_time_minutes"]
      }
    ],
    "knowledge_hits": [
      {
        "id": "kb_rules_1",
        "title": "机房风险规则",
        "source_type": "rule",
        "source_file": "rules.md",
        "score": 0.82,
        "excerpt": "二层及以上机房叠加长延时电池时，应复核楼板承重和运输路线。",
        "retrieval_method": "hybrid",
        "vector_score": 0.31,
        "keyword_score": 8
      }
    ],
    "state": {
      "fsm_state": "S2_PROACTIVE_INQUIRIES",
      "export_status": "draft",
      "calculation_status": "provisional"
    }
  }
}
```

### Processing Pipeline

```pseudo
FUNCTION post_session_chat(request):
  validate_chat_request(request)
  session = load_or_create_session(request.session_id)
  detect_state_conflict(request.client_state_version, session.state_version)

  normalized_input = normalize_message(request.message_type, request.content)

  IF request.message_type == "file":
    extracted_content = process_file_payload(normalized_input)
    append_session_event("onUploadProcessed", extracted_content)
  ELSE:
    append_session_event("onUserMessageReceived", normalized_input)

  extraction_result = run_llm_extraction(normalized_input, session.context)
  apply_field_updates_with_precedence(session, extraction_result.field_updates)

  knowledge_hits = run_rag_retrieval(normalized_input, session.context)

  calculation_result = evaluate_project_backend_rules(session.context)
  apply_risk_flags(session, calculation_result.risk_flags)

  ai_response = generate_agent_response(session, extraction_result, calculation_result, knowledge_hits)
  quick_replies = select_next_best_chips(session)

  session.state_version += 1
  save_session(session)

  RETURN chat_response(session, ai_response, quick_replies, calculation_result, knowledge_hits)
```

### Frontend Behavior

The frontend must:

- Append `ai_response` to chat.
- Render `quick_replies` as chips.
- Apply `updated_fields` and `field_patches` to the dashboard.
- Render `triggered_risks` immediately as warning banners/cards.
- Render backend-provided `knowledge_hits` as citations; the frontend must not recompute retrieval in backend mode.
- Preserve local manual edit mode if the user is actively editing a field.

---

## Admin Knowledge Upload For Seed Trial

These endpoints are for controlled seed validation only. Production SaaS should replace Nginx Basic Auth with application-level authentication, tenant isolation, upload audit logs, and document permissions.

### GET /api/admin/knowledge/status

Returns the current backend runtime retrieval index status.

```json
{
  "ok": true,
  "server_time": "2026-05-24T10:00:00.000Z",
  "data": {
    "rebuild_status": "idle",
    "index": {
      "generated_at": "2026-05-24T10:00:00.000Z",
      "local_embedding_model": "local-hash-v1",
      "local_embedding_dimensions": 96,
      "chunk_count": 123,
      "index_file": "/opt/jfagent/server/generatedKnowledge.json"
    },
    "last_uploaded_file": null,
    "uploaded_file_count": 0
  }
}
```

### POST /api/admin/knowledge/upload

Uploads one supported knowledge file using JSON base64 to avoid multipart dependencies in the seed MVP.

Request:

```json
{
  "file_name": "医院机房UPS选型经验.md",
  "content_base64": "base64-encoded-content"
}
```

Rules:

- Supported extensions: `.md`, `.txt`, `.docx`, `.pdf`, `.xlsx`, `.csv`, `.tsv`.
- Default max decoded file size: `20MB`.
- Files are saved under `knowledge/uploads/`.
- Upload triggers `npm run kb:build`.
- Backend retrieval reloads `server/generatedKnowledge.json` after a successful build.

Response:

```json
{
  "ok": true,
  "server_time": "2026-05-24T10:00:00.000Z",
  "data": {
    "rebuild_status": "completed",
    "uploaded_file": {
      "original_file_name": "医院机房UPS选型经验.md",
      "stored_file_name": "医院机房UPS选型经验_20260524100000.md",
      "stored_path": "/opt/jfagent/knowledge/uploads/医院机房UPS选型经验_20260524100000.md",
      "size_bytes": 2048,
      "uploaded_at": "2026-05-24T10:00:00.000Z"
    },
    "index": {
      "generated_at": "2026-05-24T10:00:00.000Z",
      "local_embedding_model": "local-hash-v1",
      "local_embedding_dimensions": 96,
      "chunk_count": 124,
      "index_file": "/opt/jfagent/server/generatedKnowledge.json"
    }
  }
}
```

---

## 2. POST /api/session/override

### Purpose

Commits a user-forced dashboard correction after the user double-clicks a field in the right dashboard panel and manually changes the value.

This endpoint is the API counterpart of:

- `onDashboardFieldDoubleClick`
- `onDashboardFieldCommit`
- Anti-friction manual override rules in `agents.md`

Manual override values outrank LLM inference and must be injected into the LLM prompt context for all future turns.

### OpenAPI Path Definition

```yaml
paths:
  /api/session/override:
    post:
      tags: [Override, Session]
      summary: Commit dashboard manual override and inject context into future LLM turns.
      operationId: postSessionOverride
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/OverrideRequest'
      responses:
        '200':
          description: Override accepted and synchronized.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OverrideResponseEnvelope'
        '400':
          $ref: '#/components/responses/BadRequest'
        '404':
          $ref: '#/components/responses/SessionNotFound'
        '409':
          $ref: '#/components/responses/StateConflict'
        '422':
          $ref: '#/components/responses/UnprocessableInput'
        '500':
          $ref: '#/components/responses/InternalError'
```

### Request Payload

Required product payload:

```json
{
  "session_id": "sess_123",
  "field_code": "rack_count",
  "value": "10"
}
```

Production schema:

```json
{
  "session_id": "sess_123",
  "field_code": "rack_count",
  "value": "10",
  "client_state_version": 12,
  "edit_event_id": "edit_001",
  "commit_mode": "enter"
}
```

### Field Rules

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `session_id` | string | Yes | Must reference an active session. |
| `field_code` | string | Yes | Must be an editable dashboard field. |
| `value` | string | Yes | Raw user-entered value; backend normalizes type. |
| `client_state_version` | integer | No | Enables conflict detection. |
| `edit_event_id` | string | No | Idempotency for repeated commits. |
| `commit_mode` | enum | No | `enter`, `blur`, or `check_icon`. |

### Editable Field Codes

```json
[
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
  "expected_delivery_date"
]
```

### Response Payload

```json
{
  "ok": true,
  "session_id": "sess_123",
  "state_version": 13,
  "server_time": "2026-05-22T21:41:00+08:00",
  "data": {
    "sync_status": "synced",
    "field_code": "rack_count",
    "normalized_value": 10,
    "old_value": 8,
    "source": "dashboard_edit",
    "confidence": 1.0,
    "llm_context_injected": true,
    "llm_context_injection_id": "ctxinj_456",
    "export_payload_stale": true,
    "recomputed_outputs": {
      "total_it_load_kw": 30,
      "recommended_ups_capacity_kva": 40,
      "recommended_precision_ac_model_kw": 40
    },
    "triggered_risks": [],
    "agent_silent_event": {
      "event": "onDashboardFieldCommit",
      "field_code": "rack_count",
      "old_value": 8,
      "new_value": 10
    }
  }
}
```

### Sync Confirmation Fields

| Field | Meaning |
| --- | --- |
| `sync_status` | `synced`, `rejected`, or `conflict_requires_confirmation`. |
| `normalized_value` | Backend type-normalized value used in session context. |
| `source` | Always `dashboard_edit` for accepted overrides. |
| `confidence` | Always `1.0` for syntactically valid manual override. |
| `llm_context_injected` | Confirms future LLM turns receive the manual value as authoritative. |
| `export_payload_stale` | Indicates final docx payload must be rebuilt before export. |
| `recomputed_outputs` | Any calculation/risk outputs changed by the override. |

### Processing Pipeline

```pseudo
FUNCTION post_session_override(request):
  validate_override_request(request)
  session = load_session(request.session_id)
  assert_field_is_editable(request.field_code)

  normalized_value = normalize_field_value(
    field_code = request.field_code,
    raw_value = request.value
  )

  IF normalized_value.invalid:
    RETURN 422 INVALID_FIELD_VALUE

  old_value = session.context[request.field_code].value

  session.context[request.field_code] = {
    "value": normalized_value.value,
    "source": "dashboard_edit",
    "confidence": 1.0,
    "needs_confirmation": false,
    "last_updated_at": now()
  }

  session.override_locks.ADD(request.field_code)
  session.export_payload_stale = true

  append_session_event({
    "event": "onDashboardFieldCommit",
    "field_code": request.field_code,
    "old_value": old_value,
    "new_value": normalized_value.value
  })

  inject_llm_context({
    "type": "manual_override",
    "field_code": request.field_code,
    "value": normalized_value.value,
    "precedence": "dashboard_edit"
  })

  recalculation = evaluate_project_backend_rules(session.context)
  apply_risk_flags(session, recalculation.risk_flags)

  session.state_version += 1
  save_session(session)

  RETURN override_response(session, old_value, normalized_value, recalculation)
```

### Conflict Behavior

If the frontend sends an old `client_state_version`, the backend may still accept the override because manual dashboard edits have high precedence. It must return conflict metadata if any newer backend value existed.

```json
{
  "sync_status": "synced_with_conflict_notice",
  "conflict": {
    "field_code": "rack_count",
    "client_seen_value": 8,
    "backend_previous_value": 12,
    "accepted_value": 10,
    "reason": "Manual override has precedence."
  }
}
```

---

## 3. GET /api/session/export

### Purpose

Compiles the final `.docx` technical proposal asset from backend session state. This endpoint includes a billing check hook for the 99 RMB / credit payment simulator.

Export must use:

- Current backend session state.
- Manual dashboard overrides.
- `rules.md` calculation and risk outputs.
- `templates.md` chapter matrix.
- Yellow price placeholder policy.
- RAG-supported LLM prose only in allowed template blocks.

### OpenAPI Path Definition

```yaml
paths:
  /api/session/export:
    get:
      tags: [Export, Session]
      summary: Run billing check and compile final docx proposal.
      operationId: getSessionExport
      parameters:
        - name: session_id
          in: query
          required: true
          schema:
            type: string
        - name: export_type
          in: query
          required: false
          schema:
            type: string
            enum: [docx_technical_proposal, docx_requirement_sheet, preview_pdf]
            default: docx_technical_proposal
        - name: payment_mode
          in: query
          required: false
          schema:
            type: string
            enum: [simulate_99_rmb, credit, free_preview]
            default: simulate_99_rmb
      responses:
        '200':
          description: Export ready, payment required, or preview generated.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ExportResponseEnvelope'
        '402':
          description: Payment required before final asset generation.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentRequiredEnvelope'
        '404':
          $ref: '#/components/responses/SessionNotFound'
        '409':
          $ref: '#/components/responses/ExportNotReady'
        '500':
          $ref: '#/components/responses/InternalError'
```

### Query Parameters

| Parameter | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `session_id` | string | Yes | - | Session to export. |
| `export_type` | enum | No | `docx_technical_proposal` | Asset type to compile. |
| `payment_mode` | enum | No | `simulate_99_rmb` | Billing hook behavior. |

### Export Flow

```pseudo
FUNCTION get_session_export(query):
  session = load_session(query.session_id)
  assert_export_intent_allowed(session)

  IF session.export_payload_stale:
    rebuild_export_payload(session)

  billing_result = run_billing_check(
    session_id = session.id,
    payment_mode = query.payment_mode,
    amount_rmb = 99
  )

  IF billing_result.status == "payment_required":
    RETURN 402 payment_required_response(billing_result)

  IF billing_result.status == "declined":
    RETURN 402 payment_declined_response(billing_result)

  final_rule_eval = evaluate_project_backend_rules(session.context)
  apply_backend_rule_outputs_to_export_payload(final_rule_eval)

  docx_asset = compile_docx_proposal(
    session = session,
    template_version = "2026.05"
  )

  asset_record = persist_asset(docx_asset)
  session.export_status = "exported"
  session.state_version += 1
  save_session(session)

  RETURN export_ready_response(asset_record, session)
```

### Billing Check Hook

The billing simulator is intentionally explicit so production payment can replace it later.

```json
{
  "billing_check": {
    "enabled": true,
    "mode": "simulate_99_rmb",
    "amount_rmb": 99,
    "currency": "CNY",
    "credit_cost": 1,
    "status": "approved | payment_required | declined | free_preview",
    "transaction_id": "pay_sim_123"
  }
}
```

### Payment Required Response

HTTP `402`:

```json
{
  "ok": false,
  "session_id": "sess_123",
  "state_version": 13,
  "server_time": "2026-05-22T21:42:00+08:00",
  "error": {
    "code": "PAYMENT_REQUIRED",
    "message": "99 RMB payment willingness verification is required before final docx export.",
    "retryable": true
  },
  "billing_check": {
    "mode": "simulate_99_rmb",
    "amount_rmb": 99,
    "currency": "CNY",
    "status": "payment_required",
    "actions": [
      {
        "id": "pay_99_rmb",
        "label": "愿意，生成正式版"
      },
      {
        "id": "free_preview",
        "label": "先预览免费版"
      },
      {
        "id": "cancel",
        "label": "暂时不用"
      }
    ]
  }
}
```

### Export Ready Response

HTTP `200`:

```json
{
  "ok": true,
  "session_id": "sess_123",
  "state_version": 14,
  "server_time": "2026-05-22T21:43:00+08:00",
  "data": {
    "export_status": "ready",
    "asset": {
      "asset_id": "asset_docx_001",
      "file_name": "XX医院中心机房改造项目_技术方案_v1.docx",
      "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "download_url": "/api/assets/asset_docx_001/download",
      "expires_at": "2026-05-23T21:43:00+08:00",
      "sha256": "string",
      "size_bytes": 49152
    },
    "billing_check": {
      "mode": "simulate_99_rmb",
      "amount_rmb": 99,
      "currency": "CNY",
      "status": "approved",
      "transaction_id": "pay_sim_123"
    },
    "included_chapters": [
      "Cover Page & Catalog",
      "Project Overview & Medical/Gov Industry Background",
      "Civil Works & Structural Reinforcement",
      "Power Distribution & UPS Engineering",
      "Precision Air Conditioning & Fresh Air Systems"
    ],
    "export_payload": {
      "version": "v1",
      "session_id": "sess_123",
      "project_name": "XX医院中心机房改造项目",
      "chapter_plan": [],
      "commercial": {
        "pricing_mode": "manual_placeholder",
        "price_placeholder_text": "[Please manually enter your local channel price here]"
      },
      "export_metadata": {
        "template_version": "2026.05",
        "calculation_status": "provisional"
      }
    },
    "triggered_risks": [
      {
        "id": "RULE_FLOOR_LOADING",
        "level": "P0_BLOCKER",
        "text": "Structural Loading Deficit Risk"
      }
    ],
    "layout_validation": {
      "status": "passed",
      "checks": [
        "fixed_width_tables",
        "price_placeholders_highlighted",
        "forced_chapters_locked",
        "toc_updated"
      ]
    }
  }
}
```

### Export Not Ready Response

HTTP `409`:

```json
{
  "ok": false,
  "session_id": "sess_123",
  "state_version": 13,
  "error": {
    "code": "EXPORT_NOT_READY",
    "message": "The session is missing required fields for export.",
    "details": {
      "missing_fields": ["project_type", "room_area_m2"],
      "recommended_action": "Ask one proactive follow-up question before export."
    },
    "retryable": true
  }
}
```

---

## 4. GET /api/assets/{asset_id}/download

### Purpose

Downloads a generated export asset. The current local skeleton serves the first-pass `.docx` requirement sheet created from `ExportPayloadV1`.

Current behavior:

- Generated assets are stored under `output/doc/`.
- The asset registry is in memory.
- This is for local MVP verification, not durable SaaS storage.

Production should replace this with authenticated, tenant-isolated object storage and audit logging.

### Response

HTTP `200` returns the binary asset with:

```text
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename*=UTF-8''...
```

HTTP `404` returns `ASSET_NOT_FOUND` when the in-memory asset record is unavailable.

---

## Component Schemas

### ChatRequest

```yaml
components:
  schemas:
    ChatRequest:
      type: object
      required: [session_id, message_type, content]
      properties:
        session_id:
          type: string
          example: sess_123
        message_type:
          type: string
          enum: [text, voice, file]
        content:
          type: string
          description: Raw text, voice transcript, or file payload/reference.
        client_state_version:
          type: integer
          minimum: 0
        client_message_id:
          type: string
        locale:
          type: string
          default: zh-CN
        timezone:
          type: string
          example: Asia/Shanghai
```

### ChatResponseEnvelope

```yaml
    ChatResponseEnvelope:
      allOf:
        - $ref: '#/components/schemas/SuccessEnvelope'
        - type: object
          properties:
            data:
              $ref: '#/components/schemas/ChatResponseData'

    ChatResponseData:
      type: object
      required: [ai_response, quick_replies, updated_fields, triggered_risks]
      properties:
        ai_response:
          type: string
        quick_replies:
          type: array
          items:
            type: string
        updated_fields:
          type: object
          additionalProperties: true
        field_patches:
          type: array
          items:
            $ref: '#/components/schemas/FieldPatch'
        triggered_risks:
          type: array
          items:
            $ref: '#/components/schemas/RiskFlag'
        state:
          $ref: '#/components/schemas/SessionStateSummary'
```

### OverrideRequest

```yaml
    OverrideRequest:
      type: object
      required: [session_id, field_code, value]
      properties:
        session_id:
          type: string
        field_code:
          type: string
          example: rack_count
        value:
          type: string
          example: "10"
        client_state_version:
          type: integer
        edit_event_id:
          type: string
        commit_mode:
          type: string
          enum: [enter, blur, check_icon]
```

### OverrideResponseEnvelope

```yaml
    OverrideResponseEnvelope:
      allOf:
        - $ref: '#/components/schemas/SuccessEnvelope'
        - type: object
          properties:
            data:
              $ref: '#/components/schemas/OverrideResponseData'

    OverrideResponseData:
      type: object
      required:
        - sync_status
        - field_code
        - normalized_value
        - source
        - confidence
        - llm_context_injected
      properties:
        sync_status:
          type: string
          enum: [synced, synced_with_conflict_notice, rejected, conflict_requires_confirmation]
        field_code:
          type: string
        normalized_value:
          nullable: true
        old_value:
          nullable: true
        source:
          type: string
          enum: [dashboard_edit]
        confidence:
          type: number
          example: 1.0
        llm_context_injected:
          type: boolean
        llm_context_injection_id:
          type: string
        export_payload_stale:
          type: boolean
        recomputed_outputs:
          type: object
          additionalProperties: true
        triggered_risks:
          type: array
          items:
            $ref: '#/components/schemas/RiskFlag'
        agent_silent_event:
          type: object
          additionalProperties: true
```

### ExportResponseEnvelope

```yaml
    ExportResponseEnvelope:
      allOf:
        - $ref: '#/components/schemas/SuccessEnvelope'
        - type: object
          properties:
            data:
              $ref: '#/components/schemas/ExportResponseData'

    ExportResponseData:
      type: object
      properties:
        export_status:
          type: string
          enum: [ready, preview_ready, failed]
        asset:
          $ref: '#/components/schemas/ExportAsset'
        billing_check:
          $ref: '#/components/schemas/BillingCheck'
        included_chapters:
          type: array
          items:
            type: string
        export_payload:
          $ref: '#/components/schemas/ExportPayloadV1'
        triggered_risks:
          type: array
          items:
            $ref: '#/components/schemas/RiskFlag'
        layout_validation:
          type: object
          additionalProperties: true
```

### ExportPayloadV1

`export_payload` is the frozen document input assembled from backend session state. The full living schema is implemented in `server/exportPayload.ts` and described in `docs/export-payload-schema.md`.

```yaml
    ExportPayloadV1:
      type: object
      required:
        - version
        - session_id
        - state_version
        - customer_name
        - project_name
        - customer_industry
        - project_type
        - calculation_outputs
        - risk_flags
        - forced_document_injections
        - bom
        - scope
        - commercial
        - field_metadata
        - open_items
        - chapter_plan
        - render_flags
        - export_metadata
        - validation
      properties:
        version:
          type: string
          enum: [v1]
        session_id:
          type: string
        state_version:
          type: integer
        customer_name:
          type: string
        project_name:
          type: string
        customer_industry:
          type: string
          enum: [medical, government, education, enterprise, industrial, carrier, unknown]
        project_type:
          type: string
          enum: [new_build, renovation, expansion, migration, maintenance, unknown]
        room_area_m2:
          type: number
          nullable: true
        room_floor:
          type: number
          nullable: true
        rack_count:
          type: number
          nullable: true
        server_count:
          type: number
          nullable: true
        redundancy_mode:
          type: string
          enum: [N, N+1, 2N, unknown]
        ups_backup_time_minutes:
          type: number
          nullable: true
        calculation_outputs:
          type: object
          additionalProperties: true
        risk_flags:
          type: array
          items:
            $ref: '#/components/schemas/RiskFlag'
        forced_document_injections:
          type: array
          items:
            type: object
            additionalProperties: true
        bom:
          type: object
          additionalProperties: true
        scope:
          type: object
          additionalProperties:
            type: boolean
        commercial:
          type: object
          required: [pricing_mode, currency, price_placeholder_text, disclaimer]
          properties:
            pricing_mode:
              type: string
              enum: [manual_placeholder, approved_price_source]
            currency:
              type: string
              enum: [CNY]
            price_placeholder_text:
              type: string
            disclaimer:
              type: string
        field_metadata:
          type: array
          items:
            type: object
            additionalProperties: true
        open_items:
          type: array
          items:
            type: object
            additionalProperties: true
        chapter_plan:
          type: array
          items:
            type: object
            required: [id, order, title, required, inclusion_reason, source_paths]
            properties:
              id:
                type: string
              order:
                type: integer
              title:
                type: string
              required:
                type: boolean
              inclusion_reason:
                type: string
              source_paths:
                type: array
                items:
                  type: string
        render_flags:
          type: object
          additionalProperties: true
        export_metadata:
          type: object
          required: [generated_at, generated_by, document_type, export_type, pricing_mode, template_version, calculation_status]
          properties:
            generated_at:
              type: string
              format: date-time
            generated_by:
              type: string
            document_type:
              type: string
              enum: [technical_proposal]
            export_type:
              type: string
              enum: [docx_requirement_sheet, docx_technical_proposal, preview_pdf]
            pricing_mode:
              type: string
              enum: [manual_placeholder, approved_price_source]
            template_version:
              type: string
            calculation_status:
              type: string
              enum: [confirmed, provisional, blocked]
        validation:
          type: object
          additionalProperties: true
```

### Shared Schemas

```yaml
    SuccessEnvelope:
      type: object
      required: [ok, session_id, state_version, server_time]
      properties:
        ok:
          type: boolean
          enum: [true]
        session_id:
          type: string
        state_version:
          type: integer
        server_time:
          type: string
          format: date-time

    FieldPatch:
      type: object
      required: [field_code, new_value, source, confidence]
      properties:
        field_code:
          type: string
        old_value:
          nullable: true
        new_value:
          nullable: true
        source:
          type: string
          enum: [user_message, voice, upload, button_chip, dashboard_edit, agent_inference, default]
        confidence:
          type: number
          minimum: 0
          maximum: 1
        needs_confirmation:
          type: boolean

    RiskFlag:
      type: object
      required: [id, level, text]
      properties:
        id:
          type: string
          example: RULE_FLOOR_LOADING
        legacy_id:
          type: string
          example: ERR_LOAD
        level:
          type: string
          enum: [P0_BLOCKER, P1_HIGH, P2_MEDIUM, P3_LOW, P1]
        text:
          type: string
        blocking:
          type: boolean
        dismissible:
          type: boolean
        trigger_fields:
          type: array
          items:
            type: string

    SessionStateSummary:
      type: object
      properties:
        fsm_state:
          type: string
          enum: [S0_IDLE, S1_CORE_EXTRACTION, S2_PROACTIVE_INQUIRIES, S3_READY_MONETIZATION]
        export_status:
          type: string
          enum: [draft, ready, exported]
        calculation_status:
          type: string
          enum: [confirmed, provisional, blocked]

    ExportAsset:
      type: object
      required: [asset_id, file_name, mime_type, download_url]
      properties:
        asset_id:
          type: string
        file_name:
          type: string
        mime_type:
          type: string
        download_url:
          type: string
        expires_at:
          type: string
          format: date-time
        sha256:
          type: string
        size_bytes:
          type: integer

    BillingCheck:
      type: object
      properties:
        enabled:
          type: boolean
        mode:
          type: string
          enum: [simulate_99_rmb, credit, free_preview]
        amount_rmb:
          type: number
          example: 99
        currency:
          type: string
          enum: [CNY]
        credit_cost:
          type: integer
        status:
          type: string
          enum: [approved, payment_required, declined, free_preview]
        transaction_id:
          type: string
```

---

## Error Codes

| HTTP | Code | Meaning |
| ---: | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing or invalid request shape. |
| 400 | `UNSUPPORTED_MESSAGE_TYPE` | `message_type` is not `text`, `voice`, or `file`. |
| 404 | `SESSION_NOT_FOUND` | `session_id` does not exist. |
| 409 | `STATE_VERSION_CONFLICT` | Client version is stale and cannot be auto-merged. |
| 409 | `EXPORT_NOT_READY` | Required export fields are missing. |
| 422 | `INVALID_FIELD_VALUE` | Override value cannot be normalized. |
| 422 | `UNPROCESSABLE_INPUT` | File/text input cannot be processed. |
| 402 | `PAYMENT_REQUIRED` | 99 RMB or credit confirmation is required. |
| 402 | `PAYMENT_DECLINED` | Payment simulator declined. |
| 500 | `INTERNAL_ERROR` | Unexpected backend failure. |

---

## Frontend Synchronization Contract

### Chat Submit

```pseudo
frontend.send_chat(message):
  optimistic_append_user_message(message)
  response = POST /api/session/chat
  append_ai_message(response.data.ai_response)
  render_quick_replies(response.data.quick_replies)
  apply_field_patches(response.data.field_patches)
  render_risks(response.data.triggered_risks)
  update_state_version(response.state_version)
```

### Dashboard Double-Click Override

```pseudo
frontend.commit_dashboard_override(field_code, value):
  enter_pending_state(field_code)
  response = POST /api/session/override

  IF response.data.sync_status STARTS_WITH "synced":
    set_field_value(field_code, response.data.normalized_value)
    mark_field_source(field_code, "dashboard_edit")
    update_state_version(response.state_version)
    render_risks(response.data.triggered_risks)

  ELSE:
    show_field_error(response.error.message)
```

### Export Click

```pseudo
frontend.click_export():
  response = GET /api/session/export?session_id=...

  IF response.status == 402:
    show_99_rmb_payment_modal(response.billing_check.actions)

  IF response.status == 200:
    show_download_button(response.data.asset.download_url)
```

---

## Security and Reliability

### Idempotency

Mutating endpoints should support `Idempotency-Key`.

```pseudo
IF duplicate_idempotency_key_seen:
  RETURN original_response
```

### Rate Limits

| Endpoint | Suggested Limit |
| --- | --- |
| `POST /api/session/chat` | 30 requests / minute / session |
| `POST /api/session/override` | 60 requests / minute / session |
| `GET /api/session/export` | 10 requests / hour / session |

### Audit Events

Every endpoint must write audit events:

```json
{
  "event_type": "API_CALL",
  "endpoint": "/api/session/chat",
  "session_id": "sess_123",
  "state_version_before": 11,
  "state_version_after": 12,
  "request_id": "req_123",
  "timestamp": "2026-05-22T21:40:00+08:00"
}
```

Required audit events:

- Chat message received.
- Field extraction applied.
- Manual override committed.
- LLM context injection created.
- Rule engine evaluated.
- Risk triggered.
- Payment simulator checked.
- Export payload rebuilt.
- `.docx` asset generated.

---

## Acceptance Tests

### Test 1: Chat Extracts Fields and Risks

Request:

```json
{
  "session_id": "sess_test",
  "message_type": "text",
  "content": "医院机房改造，50平方，10台机柜，三楼，UPS后备120分钟"
}
```

Expected:

```json
{
  "updated_fields": {
    "room_area": 50,
    "rack_count": 10,
    "room_floor": 3,
    "ups_backup_time_minutes": 120
  },
  "triggered_risks_contains": "RULE_FLOOR_LOADING"
}
```

### Test 2: Dashboard Override Wins

Request:

```json
{
  "session_id": "sess_test",
  "field_code": "rack_count",
  "value": "10"
}
```

Expected:

```json
{
  "sync_status": "synced",
  "source": "dashboard_edit",
  "confidence": 1.0,
  "llm_context_injected": true
}
```

### Test 3: Export Requires Payment Hook

Request:

```text
GET /api/session/export?session_id=sess_test&payment_mode=simulate_99_rmb
```

Expected before payment approval:

```json
{
  "http_status": 402,
  "error_code": "PAYMENT_REQUIRED",
  "amount_rmb": 99
}
```

Expected after simulator approval:

```json
{
  "http_status": 200,
  "export_status": "ready",
  "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
```
