import type { BackendSession, FieldPatch, KnowledgeHit, RiskFlag } from "./types.js";

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
  role: "system" | "user";
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
}

const defaultBaseUrl = "https://api.openai.com/v1";
const defaultModel = "gpt-4o-mini";
const defaultTimeoutMs = 12000;

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

function promptForAgent(context: AgentLlmContext): ChatCompletionMessage[] {
  const fieldSummary = Object.values(context.session.dashboard_fields).map((field) => ({
    code: field.code,
    label: field.label,
    value: field.value,
    source: field.source,
    confidence: field.confidence,
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

  return [
    {
      role: "system",
      content:
        "你是资深中文数据中心/机房建设售前总监。你要务实、商业敏感、少问长表单。只输出一个 JSON 对象，不要 Markdown。JSON 必须包含 ai_response、quick_replies、field_candidates。field_candidates 只能使用用户明确或强暗示的信息，不要编造。"
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "根据用户消息、当前字段、知识命中和风险，生成面向用户的中文售前回复，并给出可补充的字段候选。",
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
        constraints: [
          "回复要像售前负责人，不要像客服模板。",
          "不要输出价格承诺，报价仍需人工确认。",
          "如果知识命中有帮助，可自然提到来源依据，但不要伪造资料名。",
          "quick_replies 最多 4 个，短句。",
          "field_candidates 只输出你有把握从用户消息中提取的字段。"
        ],
        user_message: context.userText,
        dashboard_fields: fieldSummary,
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

export async function generateAgentLlmOutput(context: AgentLlmContext): Promise<AgentLlmOutput | null> {
  if (!enabled()) return null;
  const messages = promptForAgent(context);

  try {
    const firstResponse = await postChatCompletion(messages, true);
    return parseAgentOutput(firstMessageContent(firstResponse));
  } catch (error) {
    if (error instanceof OpenAiCompatibleError && isJsonModeUnsupported(error.status, error.body)) {
      try {
        const retryResponse = await postChatCompletion(messages, false);
        return parseAgentOutput(firstMessageContent(retryResponse));
      } catch {
        return null;
      }
    }
    return null;
  }
}
