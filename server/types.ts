import type { ExportPayloadV1 } from "./exportPayload.js";

export type MessageType = "text" | "voice" | "file";
export type ProjectStage = "intake" | "clarifying" | "solution_ready";

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
export type AgentResponseMode = "real_llm" | "fallback";
export type AgentFallbackReason =
  | "not_configured"
  | "timeout"
  | "provider_error"
  | "invalid_json"
  | "unknown";

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
  totalItLoadKw?: number | null;
  coolingUnitCount?: number | null;
  batteryCount?: number | null;
  batteryNote?: string | null;
  estimatedBomCostRmb?: number | null;
  estimatedCostLowRmb?: number | null;
  estimatedCostHighRmb?: number | null;
  estimatedBudgetFloorRmb?: number | null;
  calculationStatus?: "confirmed" | "provisional" | "blocked";
}

export interface AgentRuntimeSummary {
  response_mode: AgentResponseMode;
  llm_configured: boolean;
  provider_name: "openai_compatible";
  model: string | null;
  base_url: string | null;
  used_json_retry: boolean;
  fallback_reason: AgentFallbackReason | null;
  fallback_message: string | null;
  responded_at: string;
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
  verification_status?:
    | "Verified"
    | "Vendor_Published"
    | "Distributor_Provided"
    | "Deprecated"
    | "Unverified"
    | "Reference_Only";
  freshness?: "fresh" | "stale" | "unknown";
  can_cite_in_formal_proposal?: boolean;
  source_priority?: "P0" | "P1" | "P2";
}

export interface ChatRequest {
  session_id: string;
  project_id?: string;
  message_type: MessageType;
  content: string;
  client_state_version?: number;
  client_message_id?: string;
  locale?: string;
  timezone?: string;
}

export interface ProjectContext {
  project_id: string;
  project_name: string;
  stage: ProjectStage;
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
  project: ProjectContext | null;
  state: {
    fsm_state: FsmState;
    export_status: ExportStatus;
    calculation_status: "confirmed" | "provisional" | "blocked";
  };
  suggestion: SuggestionSummary | null;
  agent_runtime: AgentRuntimeSummary;
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
    credits_balance?: number | null;
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

export interface KnowledgeUploadSummary {
  upload_id: string;
  original_file_name: string;
  stored_file_name: string;
  stored_path: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface KnowledgeUploadJobSummary {
  job_id: string;
  file_name: string;
  status: "queued" | "rebuilding" | "completed" | "failed";
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface KnowledgeIndexStatus {
  rebuild_status: "idle" | "queued" | "rebuilding" | "failed";
  index: {
    generated_at: string;
    local_embedding_model: string;
    local_embedding_dimensions: number;
    chunk_count: number;
    index_file: string;
  };
  last_uploaded_file: KnowledgeUploadSummary | null;
  uploaded_file_count: number;
  pending_job_count: number;
  active_job: KnowledgeUploadJobSummary | null;
  latest_job: KnowledgeUploadJobSummary | null;
}

export interface KnowledgeUploadResponseData {
  uploaded_file: KnowledgeUploadSummary;
  index: KnowledgeIndexStatus["index"];
  rebuild_status: "completed";
  job: KnowledgeUploadJobSummary;
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

export interface SessionSnapshotData {
  session: SessionSnapshotSession;
  project: ProjectContext | null;
}

export interface SessionSnapshotSession {
  session_id: string;
  project_id: string | null;
  state_version: number;
  fsm_state: FsmState;
  export_status: ExportStatus;
  dashboard_fields: Record<string, DashboardField>;
  triggered_risks: RiskFlag[];
  knowledge_hits: KnowledgeHit[];
  suggestion: SuggestionSummary | null;
  agent_runtime: AgentRuntimeSummary | null;
  messages?: ChatHistoryMessage[];
}

export interface ChatHistoryMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
}

export interface BackendSession {
  session_id: string;
  project_id: string | null;
  user_id?: string | null;
  state_version: number;
  fsm_state: FsmState;
  export_status: ExportStatus;
  dashboard_fields: Record<string, DashboardField>;
  triggered_risks: RiskFlag[];
  knowledge_hits: KnowledgeHit[];
  suggestion: SuggestionSummary | null;
  agent_runtime: AgentRuntimeSummary | null;
  messages?: ChatHistoryMessage[];
  payment_willingness_99_rmb: boolean | "maybe_preview_first" | null;
  export_payload_stale: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectSummary {
  project_id: string;
  project_name: string;
  stage: ProjectStage;
  primary_session_id: string | null;
  updated_at: string;
}

export interface BackendProject extends ProjectSummary {
  created_at: string;
  user_id?: string | null;
  dashboard_snapshot: Record<string, DashboardField>;
}

export type UserRole = "admin" | "user";

export interface UserRecord {
  user_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  export_credits: number;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  user_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  export_credits: number;
  created_at: string;
}

export interface AuthContext {
  user: PublicUser;
  auth_disabled: boolean;
}

export interface LicenseRecord {
  code: string;
  credits: number;
  status: "active" | "redeemed" | "disabled";
  note: string | null;
  created_by: string | null;
  created_at: string;
  redeemed_by: string | null;
  redeemed_at: string | null;
}

export interface CreditTransaction {
  id?: number;
  user_id: string;
  type: "signup_grant" | "redeem" | "export_debit" | "admin_grant";
  credits_delta: number;
  balance_after: number;
  ref: string | null;
  created_at: string;
}

export interface AdminRuntimeStatus {
  agent: {
    llm_configured: boolean;
    provider_name: "openai_compatible";
    base_url: string;
    model: string;
    timeout_ms: number;
  };
  storage: {
    database_path: string;
    upload_dir: string;
    output_dir: string;
  };
}

export interface CreateProjectRequest {
  name?: string;
}
