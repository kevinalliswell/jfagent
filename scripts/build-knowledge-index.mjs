import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const root = process.cwd();
const knowledgeDir = path.join(root, "knowledge");
const configuredUploadDir = process.env.JFAGENT_UPLOAD_DIR?.trim();
const uploadDir = configuredUploadDir ? path.resolve(configuredUploadDir) : path.join(knowledgeDir, "uploads");
const frontendOutputFile = path.join(root, "src", "generatedKnowledge.ts");
const backendOutputFile = path.join(root, "server", "generatedKnowledge.ts");
const backendRuntimeOutputFile = path.join(root, "server", "generatedKnowledge.json");
const extractorFile = path.join(root, "scripts", "extract-document-text.py");
const spreadsheetExtractorFile = path.join(root, "scripts", "extract-spreadsheet-text.py");
const topLevelSeeds = ["knowledge_base.md", "rules.md", "templates.md"];
const supportedExtensions = new Set([".md", ".txt", ".docx", ".pdf", ".xlsx", ".csv", ".tsv"]);
const execFileAsync = promisify(execFile);
const pythonBin = process.env.PYTHON_BIN ?? process.env.PYTHON ?? "python3";
const embeddingModel = "local-hash-v1";
const embeddingDimensions = 96;
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

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      if (entry.name.startsWith("~$")) return [];
      return supportedExtensions.has(path.extname(entry.name).toLowerCase()) ? [fullPath] : [];
    })
  );
  return files.flat();
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function logicalSourcePath(filePath) {
  if (isWithin(uploadDir, filePath)) {
    return path.posix.join("knowledge", "uploads", path.relative(uploadDir, filePath).split(path.sep).join("/"));
  }
  return path.relative(root, filePath).split(path.sep).join("/");
}

async function readKnowledgeText(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md" || extension === ".txt") {
    return readFile(filePath, "utf8");
  }

  if (extension === ".docx" || extension === ".pdf") {
    const { stdout } = await execFileAsync(pythonBin, [extractorFile, filePath], {
      cwd: root,
      maxBuffer: 20 * 1024 * 1024
    });
    return stdout;
  }

  if (extension === ".xlsx" || extension === ".csv" || extension === ".tsv") {
    const { stdout } = await execFileAsync(pythonBin, [spreadsheetExtractorFile, filePath], {
      cwd: root,
      maxBuffer: 20 * 1024 * 1024
    });
    return stdout;
  }

  return "";
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_\-]{2,}/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function queryAliases(text) {
  const aliases = [];
  const patterns = [
    [/冷机|空调|恒温恒湿|precision ac/i, ["精密空调", "制冷", "n+1"]],
    [/电瓶|电池|后备|延时|battery/i, ["ups", "电池", "后备时间"]],
    [/柜子|rack|机柜/i, ["机柜", "it负载", "服务器"]],
    [/消防|七氟丙烷|fire/i, ["气体消防", "消防"]],
    [/环控|动环|监控/i, ["动环监控", "环境监控"]],
    [/静电地板|防静电/i, ["防静电地板", "装修"]],
    [/三楼|3楼|二层|2楼|楼层|承重|楼板/i, ["承重", "运输", "楼板", "steel structure load"]],
    [/报价|清单|boq|设备清单|工程量|单价|合价|金额/i, ["报价清单", "boq", "设备清单", "单价", "合价"]],
    [/导出|word|docx|需求表|正式版/i, ["需求表", "word", "docx", "模板"]]
  ];

  patterns.forEach(([pattern, words]) => {
    if (pattern.test(text)) aliases.push(...words);
  });
  return aliases;
}

function tokenizeForEmbedding(input) {
  const normalized = input.toLowerCase();
  const tokens = [];

  domainTerms.forEach((term) => {
    if (normalized.includes(term.toLowerCase())) tokens.push(term.toLowerCase(), term.toLowerCase());
  });
  tokens.push(...queryAliases(normalized).map((item) => item.toLowerCase()));

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

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function embedText(text) {
  const vector = Array.from({ length: embeddingDimensions }, () => 0);
  for (const token of tokenizeForEmbedding(text)) {
    const hash = hashToken(token);
    const dimension = hash % embeddingDimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[dimension] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function inferSourceType(relativePath, title) {
  const haystack = `${relativePath} ${title}`.toLowerCase();
  if (/boq|工程量|设备清单|材料清单/.test(haystack)) return "boq";
  if (/报价|quotation|quote|价格|单价|合价|总价|金额/.test(haystack)) return "quotation";
  if (/案例|case|项目|医院|学校|工厂|园区/.test(haystack)) return "case";
  if (/规则|标准|规范|rule|rules|guardrail/.test(haystack)) return "rule";
  if (/模板|话术|template|word/.test(haystack)) return "template";
  if (/设备|ups|空调|电池|动环|消防|manual|spec/.test(haystack)) return "device_manual";
  return "local_doc";
}

function chunkDocument(rawText, relativePath) {
  const fileTitle = path.basename(relativePath, path.extname(relativePath));
  const lines = rawText.split("\n");
  const sections = [];
  let currentTitle = fileTitle;
  let current = [];

  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading && current.length > 0) {
      sections.push({ title: currentTitle, text: current.join("\n") });
      current = [];
    }
    if (heading) {
      currentTitle = stripMarkdown(heading[2]).slice(0, 60) || fileTitle;
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) sections.push({ title: currentTitle, text: current.join("\n") });

  const chunks = [];
  for (const section of sections) {
    const clean = stripMarkdown(section.text);
    if (clean.length < 32) continue;

    const paragraphs = clean
      .split(/(?<=[。！？.!?])\s+|\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);

    let buffer = "";
    for (const paragraph of paragraphs) {
      if ((buffer + paragraph).length > 720 && buffer.length > 0) {
        chunks.push({ title: section.title, text: buffer.trim() });
        buffer = "";
      }
      buffer += `${paragraph} `;
    }
    if (buffer.trim()) chunks.push({ title: section.title, text: buffer.trim() });
  }

  return chunks;
}

function makeId(relativePath, index) {
  const slug = relativePath
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  return `kb_${slug}_${index + 1}`;
}

const knowledgeFiles = [
  ...(await walk(knowledgeDir)),
  ...(isWithin(knowledgeDir, uploadDir) ? [] : await walk(uploadDir)),
  ...(
    await Promise.all(
      topLevelSeeds.map(async (name) => {
        const filePath = path.join(root, name);
        return (await exists(filePath)) ? filePath : null;
      })
    )
  ).filter(Boolean)
];

const chunks = [];
for (const filePath of knowledgeFiles) {
  const relativePath = logicalSourcePath(filePath);
  let rawText = "";
  try {
    rawText = await readKnowledgeText(filePath);
  } catch (error) {
    console.warn(`Skipped ${relativePath}: ${error.message}`);
    continue;
  }
  const documentChunks = chunkDocument(rawText, relativePath);
  documentChunks.forEach((chunk, index) => {
    const sourceType = inferSourceType(relativePath, chunk.title);
    const embeddingText = `${chunk.title} ${chunk.title} ${sourceType} ${relativePath} ${chunk.text}`;
    chunks.push({
      id: makeId(relativePath, index),
      title: chunk.title,
      sourceType,
      sourceFile: relativePath,
      text: chunk.text,
      vector: embedText(embeddingText)
    });
  });
}

const generatedAt = new Date().toISOString();
const runtimeIndex = {
  generatedAt,
  localEmbeddingModel: embeddingModel,
  localEmbeddingDimensions: embeddingDimensions,
  knowledgeIndex: chunks
};

function renderGeneratedKnowledgeModule() {
  return `// Auto-generated by scripts/build-knowledge-index.mjs. Do not edit by hand.
export type LocalKnowledgeChunk = {
  id: string;
  title: string;
  sourceType: "rule" | "case" | "device_manual" | "template" | "quotation" | "boq" | "local_doc";
  sourceFile: string;
  text: string;
  vector: number[];
};

export const generatedAt = ${JSON.stringify(generatedAt)};
export const localEmbeddingModel = ${JSON.stringify(embeddingModel)};
export const localEmbeddingDimensions = ${JSON.stringify(embeddingDimensions)};

export const knowledgeIndex: LocalKnowledgeChunk[] = ${JSON.stringify(chunks, null, 2)};
`;
}

const output = renderGeneratedKnowledgeModule();
await Promise.all([
  writeFile(frontendOutputFile, output, "utf8"),
  writeFile(backendOutputFile, output, "utf8"),
  writeFile(backendRuntimeOutputFile, `${JSON.stringify(runtimeIndex, null, 2)}\n`, "utf8")
]);
console.log(
  `Built ${chunks.length} knowledge chunks -> ${path.relative(root, frontendOutputFile)}, ${path.relative(
    root,
    backendOutputFile
  )}, ${path.relative(root, backendRuntimeOutputFile)}`
);
