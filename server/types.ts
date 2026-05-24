import type { ExportPayloadV1 } from "./exportPayload.js";

export type MessageType = "text" | "voice" | "file";

export type FieldSource =
  | "user_message"
  | "voice"
  | "upload"
  | "button_chip"
  | "dashboard_edit"
  | "agent_inference"
  | "default";

export type RiskLevel = "P0_BLOCKER" | "P1_HIGH" | "P2_MEDIUM" | "P3_LOW";
export type FsmState = "S0_IDLE" | "S1_CORE_EXTRACTION" | "S2_PROACTIVE_INQUIRIES" | "S3_READY_MONETIZATION";
export type ExportStatus = "draft" | "ready" | "exported";

export interface DashboardField {
  code: string;
  label: string;
  value: string | number | null;
  displayValue: string;
  source: FieldSource | "pending";
  confidence: number;
  needs_confirmation: boolean;
}

export interface FieldPatch {
  field_code: string;
  old_value: string | number | null;
  new_value: string | number | null;
  source: FieldSource;
  confidence: number;
  needs_confirmation: boolean;
}

export interface RiskFlag {
  id: string;
  legacy_id?: string;
  level: RiskLevel;
  text: string;
  blocking: boolean;
  dismissible: boolean;
  trigger_fields: string[];
}

export interface SuggestionSummary {
  upsCapacityKva: number | null;
  batteryRuntimeMinutes: number | null;
  coolingModelKw: number | null;
  coolingRedundancy: string;
  pduNote: string;
  structuralNote: string;
  stale: boolean;
}

export interface KnowledgeHit {
  id: string;
  title: string;
  source_type: "rule" | "case" | "device_manual" | "template" | "quotation" | "boq" | "local_doc";
  source_file?: string;
  score: number;
  excerpt: string;
  retrieval_method?: "keyword" | "vector" | "hybrid";
  vector_score?: number;
  keyword_score?: number;
}

export interface ChatRequest {
  session_id: string;
  message_type: MessageType;
  content: string;
  client_state_version?: number;
  client_message_id?: string;
  locale?: string;
  timezone?: string;
}

export interface OverrideRequest {
  session_id: string;
  field_code: string;
  value: string;
  client_state_version?: number;
  edit_event_id?: string;
  commit_mode?: "enter" | "blur" | "check_icon";
}

export interface ChatResponseData {
  ai_response: string;
  quick_replies: string[];
  updated_fields: Record<string, string | number | null>;
  field_patches: FieldPatch[];
  triggered_risks: RiskFlag[];
  knowledge_hits: KnowledgeHit[];
  state: {
    fsm_state: FsmState;
    export_status: ExportStatus;
    calculation_status: "confirmed" | "provisional" | "blocked";
  };
  suggestion: SuggestionSummary | null;
}

export interface OverrideResponseData {
  sync_status: "synced" | "synced_with_conflict_notice";
  field_code: string;
  normalized_value: string | number | null;
  old_value: string | number | null;
  source: "dashboard_edit";
  confidence: 1;
  llm_context_injected: boolean;
  llm_context_injection_id: string;
  export_payload_stale: boolean;
  recomputed_outputs: Record<string, string | number | null>;
  triggered_risks: RiskFlag[];
  agent_silent_event: Record<string, unknown>;
  ai_notice: string;
  suggestion: SuggestionSummary | null;
}

export interface ExportAsset {
  asset_id: string;
  file_name: string;
  mime_type: string;
  download_url: string;
  expires_at: string;
  sha256?: string;
  size_bytes?: number;
}

export interface ExportResponseData {
  export_status: "ready" | "preview_ready";
  asset: ExportAsset;
  billing_check: {
    mode: "simulate_99_rmb" | "credit" | "free_preview";
    amount_rmb: number;
    currency: "CNY";
    status: "approved" | "free_preview";
    transaction_id: string;
  };
  included_chapters: string[];
  export_payload: ExportPayloadV1;
  triggered_risks: RiskFlag[];
  layout_validation: {
    status: "passed" | "warning" | "blocked";
    checks: string[];
  };
}

export interface SuccessEnvelope<T> {
  ok: true;
  session_id: string;
  state_version: number;
  server_time: string;
  data: T;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable: boolean;
  };
  request_id: string;
  server_time: string;
}

export interface BackendSession {
  session_id: string;
  state_version: number;
  fsm_state: FsmState;
  export_status: ExportStatus;
  dashboard_fields: Record<string, DashboardField>;
  triggered_risks: RiskFlag[];
  knowledge_hits: KnowledgeHit[];
  suggestion: SuggestionSummary | null;
  payment_willingness_99_rmb: boolean | "maybe_preview_first" | null;
  export_payload_stale: boolean;
  created_at: string;
  updated_at: string;
}
