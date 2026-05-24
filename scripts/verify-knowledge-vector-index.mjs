import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const generatedTypeScriptFiles = [
  path.join(root, "src", "generatedKnowledge.ts"),
  path.join(root, "server", "generatedKnowledge.ts")
];
const generatedRuntimeFile = path.join(root, "server", "generatedKnowledge.json");

function validateChunks(label, dimensions, chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error(`${label}: knowledgeIndex is empty.`);
  }

  const invalidChunk = chunks.find(
    (chunk) =>
      !Array.isArray(chunk.vector) ||
      chunk.vector.length !== dimensions ||
      chunk.vector.some((value) => typeof value !== "number" || Number.isNaN(value))
  );
  if (invalidChunk) {
    throw new Error(`${label}: invalid vector on chunk ${invalidChunk.id ?? "(unknown)"}.`);
  }

  const zeroVector = chunks.find((chunk) => chunk.vector.every((value) => value === 0));
  if (zeroVector) {
    throw new Error(`${label}: zero vector on chunk ${zeroVector.id}.`);
  }
}

async function parseGeneratedTypeScript(generatedFile) {
  const source = await readFile(generatedFile, "utf8");
  const label = path.relative(root, generatedFile);

  const dimensionMatch = source.match(/export const localEmbeddingDimensions = (\d+);/);
  if (!dimensionMatch) {
    throw new Error(`${label}: localEmbeddingDimensions export is missing.`);
  }

  const dimensions = Number(dimensionMatch[1]);
  const indexMatch = source.match(/export const knowledgeIndex: LocalKnowledgeChunk\[] = ([\s\S]+);\s*$/);
  if (!indexMatch) {
    throw new Error(`${label}: knowledgeIndex export is missing or not parseable.`);
  }

  const chunks = JSON.parse(indexMatch[1]);
  validateChunks(label, dimensions, chunks);

  return { label, dimensions, chunks };
}

async function parseGeneratedRuntimeJson(generatedFile) {
  const label = path.relative(root, generatedFile);
  const parsed = JSON.parse(await readFile(generatedFile, "utf8"));
  const dimensions = parsed.localEmbeddingDimensions;
  if (typeof dimensions !== "number") {
    throw new Error(`${label}: localEmbeddingDimensions is missing.`);
  }
  const chunks = parsed.knowledgeIndex;
  validateChunks(label, dimensions, chunks);
  return { label, dimensions, chunks };
}

const indexes = [
  ...(await Promise.all(generatedTypeScriptFiles.map(parseGeneratedTypeScript))),
  await parseGeneratedRuntimeJson(generatedRuntimeFile)
];
const [frontend, ...rest] = indexes;
const backend = rest[0];
if (frontend.dimensions !== backend.dimensions) {
  throw new Error(
    `Embedding dimensions differ: ${frontend.label}=${frontend.dimensions}, ${backend.label}=${backend.dimensions}.`
  );
}
if (frontend.chunks.length !== backend.chunks.length) {
  throw new Error(
    `Knowledge chunk counts differ: ${frontend.label}=${frontend.chunks.length}, ${backend.label}=${backend.chunks.length}.`
  );
}

const mismatchedChunk = frontend.chunks.find((chunk, index) => chunk.id !== backend.chunks[index]?.id);
if (mismatchedChunk) {
  throw new Error(`Knowledge index order differs at chunk ${mismatchedChunk.id}.`);
}

rest.slice(1).forEach((index) => {
  if (frontend.dimensions !== index.dimensions) {
    throw new Error(
      `Embedding dimensions differ: ${frontend.label}=${frontend.dimensions}, ${index.label}=${index.dimensions}.`
    );
  }
  if (frontend.chunks.length !== index.chunks.length) {
    throw new Error(
      `Knowledge chunk counts differ: ${frontend.label}=${frontend.chunks.length}, ${index.label}=${index.chunks.length}.`
    );
  }
  const mismatch = frontend.chunks.find((chunk, chunkIndex) => chunk.id !== index.chunks[chunkIndex]?.id);
  if (mismatch) {
    throw new Error(`Knowledge index order differs for ${index.label} at chunk ${mismatch.id}.`);
  }
});

console.log(
  `Verified ${frontend.chunks.length} local vectors (${frontend.dimensions} dimensions) in frontend, backend, and runtime indexes.`
);
