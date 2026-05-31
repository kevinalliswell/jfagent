import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { reloadKnowledgeIndex, getKnowledgeIndexStats } from "./localVectorSearch.js";
import { ApiValidationError } from "./sessionService.js";
import {
  countKnowledgeUploads,
  countPendingKnowledgeJobs,
  createKnowledgeJob,
  loadActiveKnowledgeJob,
  loadLatestKnowledgeJob,
  loadLatestKnowledgeUpload,
  saveKnowledgeUpload,
  updateKnowledgeJob
} from "./persistence.js";
import { getKnowledgeUploadDir } from "./runtimePaths.js";

const uploadDir = getKnowledgeUploadDir();
const supportedExtensions = new Set([".md", ".txt", ".docx", ".pdf", ".xlsx", ".csv", ".tsv"]);
const maxUploadBytes = 20 * 1024 * 1024;

interface UploadedKnowledgeFile {
  upload_id: string;
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

type KnowledgeJobStatus = "queued" | "rebuilding" | "completed" | "failed";
interface KnowledgeJobRecord {
  job_id: string;
  file_name: string;
  status: KnowledgeJobStatus;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
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
}

function now() {
  return new Date().toISOString();
}

function queueKnowledgeJob(fileName: string) {
  const record: KnowledgeJobRecord = {
    job_id: `job_kb_${randomUUID()}`,
    file_name: fileName,
    status: "queued",
    requested_at: now(),
    started_at: null,
    finished_at: null,
    error: null
  };
  createKnowledgeJob(record);
  return record;
}

function markKnowledgeJob(
  job: KnowledgeJobRecord,
  patch: Partial<{
    status: KnowledgeJobStatus;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
  }>
) {
  const next = {
    ...job,
    ...patch
  };
  updateKnowledgeJob(next);
  return next;
}

export function getKnowledgeAdminStatus() {
  const activeJob = loadActiveKnowledgeJob();
  const latestJob = loadLatestKnowledgeJob();
  const lastUpload = loadLatestKnowledgeUpload();
  const rebuildStatus =
    activeJob?.status === "queued"
      ? "queued"
      : activeJob?.status === "rebuilding"
        ? "rebuilding"
        : latestJob?.status === "failed"
          ? "failed"
          : "idle";
  return {
    rebuild_status: rebuildStatus,
    index: getKnowledgeIndexStats(),
    last_uploaded_file: lastUpload,
    uploaded_file_count: countKnowledgeUploads(),
    pending_job_count: countPendingKnowledgeJobs(),
    active_job: activeJob,
    latest_job: latestJob
  };
}

export function postKnowledgeUpload(body: KnowledgeUploadRequest) {
  const { originalFileName, content } = decodeUploadBody(body);
  const storedFileName = safeStoredFileName(originalFileName);
  mkdirSync(uploadDir, { recursive: true });
  const storedPath = join(uploadDir, storedFileName);
  writeFileSync(storedPath, content);

  const uploadedFile: UploadedKnowledgeFile = {
    upload_id: `upload_${randomUUID()}`,
    original_file_name: originalFileName,
    stored_file_name: storedFileName,
    stored_path: storedPath,
    size_bytes: content.byteLength,
    uploaded_at: now()
  };
  saveKnowledgeUpload(uploadedFile);

  const job = queueKnowledgeJob(originalFileName);
  let persistedJob = job;
  try {
    persistedJob = markKnowledgeJob(job, {
      status: "rebuilding",
      started_at: now(),
      finished_at: null,
      error: null
    });
    const index = rebuildKnowledgeIndex();
    const completedJob = markKnowledgeJob(persistedJob, {
      status: "completed",
      finished_at: now(),
      error: null
    });
    return {
      uploaded_file: uploadedFile,
      index,
      rebuild_status: "completed" as const,
      job: completedJob
    };
  } catch (error) {
    markKnowledgeJob(persistedJob, {
      status: "failed",
      finished_at: now(),
      error: error instanceof Error ? error.message : "Unknown rebuild error"
    });
    throw error;
  }
}
