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

export interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
}

export interface DashboardField {
  code: string;
  label: string;
  value: string | number | null;
  displayValue: string;
  source: FieldSource | "pending";
  confidence: number;
  needs_confirmation: boolean;
  riskLinked?: boolean;
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

export interface KnowledgeIndexStatus {
  rebuild_status: "idle" | "rebuilding";
  index: {
    generated_at: string;
    local_embedding_model: string;
    local_embedding_dimensions: number;
    chunk_count: number;
    index_file: string;
  };
  last_uploaded_file: {
    original_file_name?: string;
    stored_file_name: string;
    stored_path: string;
    size_bytes: number;
    uploaded_at: string;
  } | null;
  uploaded_file_count: number;
}

export interface KnowledgeUploadResponseData {
  uploaded_file: {
    original_file_name: string;
    stored_file_name: string;
    stored_path: string;
    size_bytes: number;
    uploaded_at: string;
  };
  index: KnowledgeIndexStatus["index"];
  rebuild_status: "completed";
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

export interface ExportPayloadV1 {
  version: "v1";
  session_id: string;
  state_version: number;
  project_name: string;
  commercial: {
    pricing_mode: "manual_placeholder" | "approved_price_source";
    price_placeholder_text: string;
  };
  chapter_plan: Array<{
    id: string;
    order: number;
    title: string;
    required: boolean;
    inclusion_reason: string;
    source_paths: string[];
  }>;
  export_metadata: {
    template_version: string;
    calculation_status: "confirmed" | "provisional" | "blocked";
    export_type: "docx_requirement_sheet" | "docx_technical_proposal" | "preview_pdf";
  };
  validation: {
    status: "passed" | "warning" | "blocked";
    missing_required_fields: string[];
    checks: Array<{ id: string; status: "passed" | "warning" | "blocked"; message: string }>;
  };
  [key: string]: unknown;
}

export interface SessionSnapshot {
  session_id: string;
  state_version: number;
  fsm_state: FsmState;
  export_status: ExportStatus;
  completion: number;
  messages: ChatMessage[];
  quick_replies: string[];
  dashboard_fields: Record<string, DashboardField>;
  triggered_risks: RiskFlag[];
  suggestion: SuggestionSummary | null;
  knowledge_hits: KnowledgeHit[];
  export_asset: ExportAsset | null;
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

export interface SuccessEnvelope<T> {
  ok: true;
  session_id: string;
  state_version: number;
  server_time: string;
  data: T;
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
  export_payload?: ExportPayloadV1;
  triggered_risks: RiskFlag[];
  layout_validation: {
    status: "passed" | "warning" | "blocked";
    checks: string[];
  };
}

export interface PaymentRequiredError {
  ok: false;
  session_id: string;
  state_version: number;
  server_time: string;
  error: {
    code: "PAYMENT_REQUIRED";
    message: string;
    retryable: true;
  };
  billing_check: {
    mode: "simulate_99_rmb";
    amount_rmb: 99;
    currency: "CNY";
    status: "payment_required";
    actions: Array<{ id: "pay_99_rmb" | "free_preview" | "cancel"; label: string }>;
  };
}
