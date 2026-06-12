import type {
  AdminRuntimeStatus,
  AgentFallbackReason,
  AgentRuntimeSummary,
  BackendSession,
  FieldPatch,
  KnowledgeHit,
  RiskFlag
} from "./types.js";

interface LlmFieldCandidate {
  field_code?: unknown;
  value?: unknown;
  confidence?: unknown;
  needs_confirmation?: unknown;
}

export interface AgentLlmOutput {
  ai_response: string;
  quick_replies: string[];
  field_candidates: Array<{
    field_code: string;
    value: string | number | null;
    confidence: number;
    needs_confirmation: boolean;
  }>;
}

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export interface AgentLlmContext {
  userText: string;
  session: BackendSession;
  patches: FieldPatch[];
  knowledgeHits: KnowledgeHit[];
  risks: RiskFlag[];
  history?: Array<{ sender: "user" | "ai"; text: string }>;
  engineSummary?: Record<string, unknown> | null;
  requiredPrompts?: string[];
}

export interface AgentLlmResult {
  output: AgentLlmOutput | null;
  runtime: AgentRuntimeSummary;
}

const defaultBaseUrl = "https://api.openai.com/v1";
const defaultModel = "gpt-4o-mini";
const defaultTimeoutMs = 25000;
const maxHistoryTurns = 12;

function enabled() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function baseUrl() {
  return (process.env.OPENAI_BASE_URL?.trim() || defaultBaseUrl).replace(/\/+$/, "");
}

function model() {
  return process.env.OPENAI_MODEL?.trim() || defaultModel;
}

function timeoutMs() {
  const configured = Number(process.env.OPENAI_TIMEOUT_MS ?? defaultTimeoutMs);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultTimeoutMs;
}

export function getAgentRuntimeStatus(): AdminRuntimeStatus["agent"] {
  return {
    llm_configured: enabled(),
    provider_name: "openai_compatible",
    base_url: baseUrl(),
    model: model(),
    timeout_ms: timeoutMs()
  };
}

function chatCompletionsUrl() {
  return `${baseUrl()}/chat/completions`;
}

function isJsonModeUnsupported(status: number, body: string) {
  const lower = body.toLowerCase();
  return (
    status === 400 &&
    (lower.includes("response_format") ||
      lower.includes("json_object") ||
      lower.includes("unsupported") ||
      lower.includes("not support"))
  );
}

function normalizeTextValue(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null) return null;
  return null;
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.72;
  return Math.min(0.9, Math.max(0.5, value));
}

function parseAgentOutput(raw: string): AgentLlmOutput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const data = parsed as {
    ai_response?: unknown;
    quick_replies?: unknown;
    field_candidates?: unknown;
  };
  if (typeof data.ai_response !== "string" || !data.ai_response.trim()) return null;

  const quickReplies = Array.isArray(data.quick_replies)
    ? data.quick_replies
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim())
        .slice(0, 4)
    : [];

  const fieldCandidates = Array.isArray(data.field_candidates)
    ? data.field_candidates
        .map((item): AgentLlmOutput["field_candidates"][number] | null => {
          if (typeof item !== "object" || item === null) return null;
          const candidate = item as LlmFieldCandidate;
          if (typeof candidate.field_code !== "string" || !candidate.field_code.trim()) return null;
          const normalizedValue = normalizeTextValue(candidate.value);
          if (normalizedValue === null) return null;
          return {
            field_code: candidate.field_code.trim(),
            value: normalizedValue,
            confidence: normalizeConfidence(candidate.confidence),
            needs_confirmation:
              typeof candidate.needs_confirmation === "boolean" ? candidate.needs_confirmation : true
          };
        })
        .filter((item): item is AgentLlmOutput["field_candidates"][number] => Boolean(item))
        .slice(0, 8)
    : [];

  return {
    ai_response: data.ai_response.trim(),
    quick_replies: quickReplies,
    field_candidates: fieldCandidates
  };
}

const SYSTEM_PROMPT = [
  "你是一名有十五年经验的中文数据中心/机房建设售前总监，服务于工程集成商的销售与售前团队。",
  "你的风格：务实、商业敏感、懂工程边界、说人话；像带团队的负责人，不像客服模板，也不堆术语。",
  "工作方式：",
  "1. 后端确定性计算引擎给出的 UPS 容量、制冷配置、电池规模、造价估算和风险，是工程最低口径。你可以解释和展开，但绝不能调低、淡化或隐藏，也不能宣称某条已触发风险'问题不大'。",
  "2. 已触发的风险必须在回复中自然带到，并说明需要确认什么。",
  "3. 缺关键口径时，一次最多追问 1-2 个最影响方案和报价的问题，优先级：机柜/服务器规模 > 面积楼层 > UPS后备时间 > 预算 > 品牌偏好。",
  "4. 知识库命中可以作为依据自然引用（说资料名），但不得伪造资料名或编造数据。",
  "5. 不输出价格承诺；估算只能引用引擎给出的参考估算区间，并强调'内部参考估算、非正式报价'。",
  "6. field_candidates 只填用户消息中明确或强暗示的信息，禁止臆造；值要做单位规范化（面积㎡数字、楼层数字、后备时间分钟数、预算人民币元）。",
  "输出协议：只输出一个 JSON 对象，不要 Markdown、不要代码块。必须包含 ai_response（中文回复，120-300字为宜）、quick_replies（最多4个短句）、field_candidates（数组，可为空）。"
].join("\n");

function promptForAgent(context: AgentLlmContext): ChatCompletionMessage[] {
  const fieldSummary = Object.values(context.session.dashboard_fields).map((field) => ({
    code: field.code,
    label: field.label,
    value: field.value,
    source: field.source,
    needs_confirmation: field.needs_confirmation
  }));
  const knowledgeSummary = context.knowledgeHits.map((hit) => ({
    title: hit.title,
    source_type: hit.source_type,
    source_file: hit.source_file,
    excerpt: hit.excerpt
  }));
  const riskSummary = context.risks.map((risk) => ({
    id: risk.id,
    level: risk.level,
    text: risk.text,
    blocking: risk.blocking
  }));

  const historyMessages: ChatCompletionMessage[] = (context.history ?? [])
    .slice(-maxHistoryTurns)
    .map((message) => ({
      role: message.sender === "user" ? ("user" as const) : ("assistant" as const),
      content: message.text
    }));

  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...historyMessages,
    {
      role: "user",
      content: JSON.stringify({
        task: "根据最新用户消息、当前字段、引擎计算结果、知识命中和风险，生成中文售前回复并给出字段候选。",
        output_shape: {
          ai_response: "string",
          quick_replies: ["string"],
          field_candidates: [
            {
              field_code: "existing_dashboard_field_code",
              value: "string_or_number",
              confidence: 0.5,
              needs_confirmation: true
            }
          ]
        },
        user_message: context.userText,
        dashboard_fields: fieldSummary,
        deterministic_engine: context.engineSummary ?? null,
        engine_required_prompts: context.requiredPrompts ?? [],
        rule_patches: context.patches,
        knowledge_hits: knowledgeSummary,
        triggered_risks: riskSummary
      })
    }
  ];
}

async function postChatCompletion(messages: ChatCompletionMessage[], withJsonMode: boolean) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const body: Record<string, unknown> = {
      model: model(),
      messages,
      temperature: 0.25
    };
    if (withJsonMode) body.response_format = { type: "json_object" };

    const response = await fetch(chatCompletionsUrl(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const rawBody = await response.text();
    if (!response.ok) {
      throw new OpenAiCompatibleError(response.status, rawBody);
    }
    return JSON.parse(rawBody) as ChatCompletionResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function firstMessageContent(response: ChatCompletionResponse) {
  return response.choices?.[0]?.message?.content ?? "";
}

class OpenAiCompatibleError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`OpenAI-compatible request failed with ${status}`);
  }
}

function runtimeSummary(
  patch: Partial<
    Pick<AgentRuntimeSummary, "response_mode" | "used_json_retry" | "fallback_reason" | "fallback_message">
  >
): AgentRuntimeSummary {
  const config = getAgentRuntimeStatus();
  return {
    response_mode: patch.response_mode ?? "fallback",
    llm_configured: config.llm_configured,
    provider_name: config.provider_name,
    model: config.model,
    base_url: config.base_url,
    used_json_retry: patch.used_json_retry ?? false,
    fallback_reason: patch.fallback_reason ?? null,
    fallback_message: patch.fallback_message ?? null,
    responded_at: new Date().toISOString()
  };
}

function runtimeFailure(
  reason: AgentFallbackReason,
  message: string | null,
  usedJsonRetry = false
): AgentLlmResult {
  return {
    output: null,
    runtime: runtimeSummary({
      response_mode: "fallback",
      used_json_retry: usedJsonRetry,
      fallback_reason: reason,
      fallback_message: message
    })
  };
}

function runtimeSuccess(output: AgentLlmOutput, usedJsonRetry = false): AgentLlmResult {
  return {
    output,
    runtime: runtimeSummary({
      response_mode: "real_llm",
      used_json_retry: usedJsonRetry
    })
  };
}

function errorToFallbackReason(error: unknown): {
  reason: AgentFallbackReason;
  message: string | null;
} {
  if (error instanceof OpenAiCompatibleError) {
    return {
      reason: "provider_error",
      message: `HTTP ${error.status}: ${error.body.slice(0, 240)}`
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return {
      reason: "timeout",
      message: "OpenAI-compatible request timed out."
    };
  }
  if (error instanceof Error) {
    return {
      reason: "unknown",
      message: error.message
    };
  }
  return {
    reason: "unknown",
    message: null
  };
}

export async function generateAgentLlmResult(context: AgentLlmContext): Promise<AgentLlmResult> {
  if (!enabled()) {
    return runtimeFailure("not_configured", "OPENAI_API_KEY is not configured.");
  }
  const messages = promptForAgent(context);

  try {
    const firstResponse = await postChatCompletion(messages, true);
    const parsed = parseAgentOutput(firstMessageContent(firstResponse));
    return parsed
      ? runtimeSuccess(parsed)
      : runtimeFailure(
          "invalid_json",
          "Provider returned content that could not be parsed as the required JSON shape."
        );
  } catch (error) {
    if (error instanceof OpenAiCompatibleError && isJsonModeUnsupported(error.status, error.body)) {
      try {
        const retryResponse = await postChatCompletion(messages, false);
        const parsed = parseAgentOutput(firstMessageContent(retryResponse));
        return parsed
          ? runtimeSuccess(parsed, true)
          : runtimeFailure(
              "invalid_json",
              "Provider returned content after JSON-mode retry, but it still could not be parsed.",
              true
            );
      } catch (retryError) {
        const failure = errorToFallbackReason(retryError);
        return runtimeFailure(failure.reason, failure.message, true);
      }
    }
    const failure = errorToFallbackReason(error);
    return runtimeFailure(failure.reason, failure.message);
  }
}
