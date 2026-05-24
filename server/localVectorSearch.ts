import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KnowledgeHit } from "./types.js";

type SourceType = "rule" | "case" | "device_manual" | "template" | "quotation" | "boq" | "local_doc";

interface LocalKnowledgeChunk {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceFile: string;
  text: string;
  vector: number[];
}

interface RuntimeKnowledgeIndex {
  generatedAt: string;
  localEmbeddingModel: string;
  localEmbeddingDimensions: number;
  knowledgeIndex: LocalKnowledgeChunk[];
}

export interface KnowledgeIndexStats {
  generated_at: string;
  local_embedding_model: string;
  local_embedding_dimensions: number;
  chunk_count: number;
  index_file: string;
}

const indexFile = resolve(process.cwd(), "server/generatedKnowledge.json");

const domainTerms = [
  "机房",
  "数据中心",
  "改造",
  "新建",
  "扩容",
  "医院",
  "学校",
  "政府",
  "园区",
  "ups",
  "电池",
  "后备",
  "机柜",
  "服务器",
  "精密空调",
  "空调",
  "制冷",
  "动环",
  "监控",
  "消防",
  "配电",
  "接地",
  "防雷",
  "布线",
  "防静电地板",
  "承重",
  "楼板",
  "预算",
  "报价",
  "报价清单",
  "boq",
  "设备清单",
  "工程量",
  "单价",
  "合价",
  "金额",
  "需求表",
  "word",
  "docx",
  "steel structure load"
];

function loadKnowledgeIndex(): RuntimeKnowledgeIndex {
  if (!existsSync(indexFile)) {
    throw new Error(`Knowledge runtime index is missing: ${indexFile}. Run npm run kb:build first.`);
  }
  const parsed = JSON.parse(readFileSync(indexFile, "utf8")) as RuntimeKnowledgeIndex;
  if (!Array.isArray(parsed.knowledgeIndex) || parsed.knowledgeIndex.length === 0) {
    throw new Error(`Knowledge runtime index is empty or invalid: ${indexFile}.`);
  }
  if (typeof parsed.localEmbeddingDimensions !== "number" || parsed.localEmbeddingDimensions <= 0) {
    throw new Error(`Knowledge runtime index dimensions are invalid: ${indexFile}.`);
  }
  return parsed;
}

let runtimeIndex = loadKnowledgeIndex();

function expandQueryTerms(text: string) {
  const terms = new Set<string>();
  const lower = text.toLowerCase();

  domainTerms.forEach((term) => {
    if (lower.includes(term.toLowerCase())) terms.add(term.toLowerCase());
  });

  const aliases: Array<[RegExp, string[]]> = [
    [/冷机|空调|恒温恒湿|precision ac/i, ["精密空调", "制冷", "N+1"]],
    [/电瓶|电池|后备|延时|battery/i, ["UPS", "电池", "后备时间"]],
    [/柜子|rack|机柜/i, ["机柜", "IT负载", "服务器"]],
    [/消防|七氟丙烷|fire/i, ["气体消防", "消防"]],
    [/环控|动环|监控/i, ["动环监控", "环境监控"]],
    [/静电地板|防静电/i, ["防静电地板", "装修"]],
    [/三楼|3楼|二层|2楼|楼层|承重|楼板/i, ["承重", "运输", "楼板", "Steel Structure Load"]],
    [/报价|清单|boq|设备清单|工程量|单价|合价|金额/i, ["报价清单", "BOQ", "设备清单", "单价", "合价"]],
    [/导出|word|docx|需求表|正式版/i, ["需求表", "Word", "DOCX", "模板"]]
  ];

  aliases.forEach(([pattern, words]) => {
    if (pattern.test(text)) words.forEach((word) => terms.add(word.toLowerCase()));
  });

  text
    .split(/[\s,，。；;、/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 16)
    .forEach((item) => terms.add(item.toLowerCase()));

  return Array.from(terms);
}

function tokenizeForEmbedding(input: string) {
  const normalized = input.toLowerCase();
  const tokens: string[] = [];

  domainTerms.forEach((term) => {
    if (normalized.includes(term.toLowerCase())) tokens.push(term.toLowerCase(), term.toLowerCase());
  });
  tokens.push(...expandQueryTerms(normalized));

  for (const match of normalized.matchAll(/[a-z0-9+#.]{2,}/g)) {
    tokens.push(match[0]);
  }

  for (const match of normalized.matchAll(/\d+(?:\.\d+)?\s*(?:kva|kw|ah|v|分钟|小时|平|楼|台|节|项)?/g)) {
    tokens.push(match[0].replace(/\s+/g, ""));
  }

  for (const match of normalized.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const segment = match[0];
    if (segment.length <= 16) tokens.push(segment);
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= segment.length - size; index += 1) {
        tokens.push(segment.slice(index, index + size));
      }
    }
  }

  return tokens;
}

function hashToken(token: string) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function embedQuery(text: string, dimensions: number) {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const token of tokenizeForEmbedding(text)) {
    const hash = hashToken(token);
    const dimension = hash % dimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[dimension] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return vector;
  return vector.map((value) => value / magnitude);
}

function dotProduct(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += a[index] * b[index];
  }
  return score;
}

function keywordScore(chunk: LocalKnowledgeChunk, terms: string[]) {
  const title = chunk.title.toLowerCase();
  const file = chunk.sourceFile.toLowerCase();
  const haystack = `${chunk.title} ${chunk.sourceFile} ${chunk.text}`.toLowerCase();
  let rawScore = 0;

  terms.forEach((term) => {
    if (!term) return;
    if (title.includes(term)) rawScore += 4;
    if (file.includes(term)) rawScore += 2;
    if (haystack.includes(term)) rawScore += 1;
  });
  if (chunk.sourceFile.startsWith("knowledge/")) rawScore += 2;
  return rawScore;
}

interface RankedChunk {
  chunk: LocalKnowledgeChunk;
  keywordScore: number;
  vectorScore: number;
  finalScore: number;
}

function chunkToHit(item: RankedChunk): KnowledgeHit {
  const { chunk } = item;
  const excerptLength = chunk.sourceType === "quotation" || chunk.sourceType === "boq" ? 180 : 96;
  return {
    id: chunk.id,
    title: chunk.title,
    source_type: chunk.sourceType,
    source_file: chunk.sourceFile,
    score: Math.min(0.99, Math.max(0.5, 0.55 + item.finalScore * 0.42)),
    excerpt: chunk.text.length > excerptLength ? `${chunk.text.slice(0, excerptLength)}...` : chunk.text,
    retrieval_method: "hybrid",
    vector_score: Number(item.vectorScore.toFixed(4)),
    keyword_score: Number(item.keywordScore.toFixed(4))
  };
}

export function reloadKnowledgeIndex(): KnowledgeIndexStats {
  runtimeIndex = loadKnowledgeIndex();
  return getKnowledgeIndexStats();
}

export function getKnowledgeIndexStats(): KnowledgeIndexStats {
  return {
    generated_at: runtimeIndex.generatedAt,
    local_embedding_model: runtimeIndex.localEmbeddingModel,
    local_embedding_dimensions: runtimeIndex.localEmbeddingDimensions,
    chunk_count: runtimeIndex.knowledgeIndex.length,
    index_file: indexFile
  };
}

export function searchKnowledge(text: string, limit = 3): KnowledgeHit[] {
  const index = runtimeIndex;
  const terms = expandQueryTerms(text);
  const queryVector = embedQuery(text, index.localEmbeddingDimensions);
  const ranked = index.knowledgeIndex
    .map((chunk): RankedChunk => {
      const rawKeywordScore = keywordScore(chunk, terms);
      const vectorScore = dotProduct(queryVector, chunk.vector);
      const keywordNorm = Math.min(1, rawKeywordScore / 12);
      const vectorNorm = Math.max(0, vectorScore);
      const sourceBoost = chunk.sourceFile.startsWith("knowledge/") ? 0.05 : 0;
      const finalScore = vectorNorm * 0.62 + keywordNorm * 0.33 + sourceBoost;
      return {
        chunk,
        keywordScore: rawKeywordScore,
        vectorScore,
        finalScore
      };
    })
    .filter((item) => item.keywordScore > 0 || item.vectorScore >= 0.12)
    .sort((a, b) => b.finalScore - a.finalScore);

  let scored = ranked.slice(0, limit).map(chunkToHit);

  const shouldIncludeCommercialHit =
    /报价|清单|boq|设备清单|工程量|单价|合价|金额|ups|电池|空调|配电|动环|消防/i.test(text);
  const commercialLineCandidate = ranked.find(
    (item) =>
      (item.chunk.sourceType === "quotation" || item.chunk.sourceType === "boq") &&
      item.chunk.title.startsWith("报价项:")
  );
  const commercialCandidate =
    commercialLineCandidate ??
    ranked.find((item) => item.chunk.sourceType === "quotation" || item.chunk.sourceType === "boq");

  if (
    shouldIncludeCommercialHit &&
    commercialCandidate &&
    !scored.some((hit) => hit.source_type === "quotation" || hit.source_type === "boq")
  ) {
    scored = [...scored.slice(0, Math.max(0, limit - 1)), chunkToHit(commercialCandidate)];
  }

  if (
    shouldIncludeCommercialHit &&
    commercialLineCandidate &&
    !scored.some((hit) => hit.title.startsWith("报价项:"))
  ) {
    const replacement = chunkToHit(commercialLineCandidate);
    const replaceIndex = scored.findIndex(
      (hit) => hit.source_type !== "quotation" && hit.source_type !== "boq"
    );
    if (replaceIndex >= 0) {
      scored = scored.map((hit, index) => (index === replaceIndex ? replacement : hit));
    } else {
      scored = [...scored.slice(0, Math.max(0, limit - 1)), replacement];
    }
  }

  if (scored.length > 0) return scored;

  return index.knowledgeIndex.slice(0, limit).map((chunk, fallbackIndex) =>
    chunkToHit({
      chunk,
      keywordScore: 0,
      vectorScore: 0,
      finalScore: 0.55 - fallbackIndex * 0.05
    })
  );
}

export const localVectorSearchInfo = {
  get model() {
    return runtimeIndex.localEmbeddingModel;
  },
  get dimensions() {
    return runtimeIndex.localEmbeddingDimensions;
  }
};
