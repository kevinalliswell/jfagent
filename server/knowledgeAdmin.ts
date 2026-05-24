import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { reloadKnowledgeIndex, getKnowledgeIndexStats } from "./localVectorSearch.js";
import { ApiValidationError } from "./sessionService.js";

const uploadDir = resolve(process.cwd(), "knowledge/uploads");
const supportedExtensions = new Set([".md", ".txt", ".docx", ".pdf", ".xlsx", ".csv", ".tsv"]);
const maxUploadBytes = 20 * 1024 * 1024;
let lastUpload: UploadedKnowledgeFile | null = null;
let isRebuilding = false;

interface UploadedKnowledgeFile {
  original_file_name: string;
  stored_file_name: string;
  stored_path: string;
  size_bytes: number;
  uploaded_at: string;
}

interface KnowledgeUploadRequest {
  file_name?: unknown;
  content_base64?: unknown;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function safeStoredFileName(fileName: string) {
  const rawBase = basename(fileName).trim();
  const extension = extname(rawBase).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new ApiValidationError(
      `Unsupported knowledge file type: ${extension || "(none)"}. Supported: ${Array.from(supportedExtensions).join(", ")}.`
    );
  }
  const stem = rawBase
    .slice(0, -extension.length)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  return `${stem || "knowledge"}_${timestamp}${extension}`;
}

function decodeUploadBody(body: KnowledgeUploadRequest) {
  if (typeof body.file_name !== "string" || !body.file_name.trim()) {
    throw new ApiValidationError("file_name is required.");
  }
  if (typeof body.content_base64 !== "string" || !body.content_base64.trim()) {
    throw new ApiValidationError("content_base64 is required.");
  }

  const content = Buffer.from(body.content_base64, "base64");
  if (!content.byteLength) {
    throw new ApiValidationError("Uploaded file is empty.");
  }
  if (content.byteLength > maxUploadBytes) {
    throw new ApiValidationError("Uploaded file exceeds the 20MB seed-trial limit.");
  }

  return {
    originalFileName: body.file_name.trim(),
    content
  };
}

function rebuildKnowledgeIndex() {
  if (isRebuilding) {
    throw new ApiValidationError("Knowledge index is already rebuilding. Please retry shortly.");
  }
  isRebuilding = true;
  try {
    const result = spawnSync(npmCommand(), ["run", "kb:build"], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      maxBuffer: 40 * 1024 * 1024
    });
    if (result.status !== 0) {
      const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      throw new Error(details || "Knowledge index rebuild failed.");
    }
    return reloadKnowledgeIndex();
  } finally {
    isRebuilding = false;
  }
}

function listUploadedFiles() {
  try {
    return readdirSync(uploadDir)
      .map((fileName) => {
        const filePath = join(uploadDir, fileName);
        const stat = statSync(filePath);
        return {
          stored_file_name: fileName,
          stored_path: filePath,
          size_bytes: stat.size,
          uploaded_at: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  } catch {
    return [];
  }
}

export function getKnowledgeAdminStatus() {
  const uploadedFiles = listUploadedFiles();
  return {
    rebuild_status: isRebuilding ? "rebuilding" : "idle",
    index: getKnowledgeIndexStats(),
    last_uploaded_file: lastUpload ?? uploadedFiles[0] ?? null,
    uploaded_file_count: uploadedFiles.length
  };
}

export function postKnowledgeUpload(body: KnowledgeUploadRequest) {
  const { originalFileName, content } = decodeUploadBody(body);
  const storedFileName = safeStoredFileName(originalFileName);
  mkdirSync(uploadDir, { recursive: true });
  const storedPath = join(uploadDir, storedFileName);
  writeFileSync(storedPath, content);

  lastUpload = {
    original_file_name: originalFileName,
    stored_file_name: storedFileName,
    stored_path: storedPath,
    size_bytes: content.byteLength,
    uploaded_at: new Date().toISOString()
  };

  const index = rebuildKnowledgeIndex();
  return {
    uploaded_file: lastUpload,
    index,
    rebuild_status: "completed"
  };
}
