import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { ExportAsset } from "./types.js";
import type { ExportPayloadV1 } from "./exportPayload.js";

interface StoredAsset {
  asset: ExportAsset;
  file_path: string;
}

export interface RenderedExportDocument {
  asset: ExportAsset;
  layout_validation: {
    status: "passed" | "warning" | "blocked";
    checks: string[];
  };
}

const outputDir = resolve(process.cwd(), "output/doc");
const renderScript = resolve(process.cwd(), "scripts/render-export-docx.py");
const renderedAssets = new Map<string, StoredAsset>();

function pythonBinary() {
  return process.env.PYTHON_BIN ?? process.env.PYTHON ?? "python3";
}

function safeFileStem(value: string) {
  return (
    value
      .replace(/[\\/:*?"<>|\s]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "jfagent_export"
  );
}

function sha256(path: string) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function readAudit(path: string): RenderedExportDocument["layout_validation"] {
  const fallback: RenderedExportDocument["layout_validation"] = {
    status: "warning",
    checks: ["docx_rendered:audit_json_missing"]
  };
  if (!existsSync(path)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      status?: "passed" | "warning" | "blocked";
      checks?: Array<{ id?: string; status?: string; message?: string }>;
    };
    return {
      status: parsed.status ?? "warning",
      checks: (parsed.checks ?? []).map((check) => `${check.id ?? "check"}:${check.status ?? "unknown"}`)
    };
  } catch {
    return fallback;
  }
}

export function renderExportDocx(payload: ExportPayloadV1): RenderedExportDocument {
  mkdirSync(outputDir, { recursive: true });
  const assetId = `asset_docx_${randomUUID()}`;
  const fileStem = `${safeFileStem(payload.project_name)}_需求表_v1`;
  const payloadPath = resolve(outputDir, `${assetId}.json`);
  const auditPath = resolve(outputDir, `${assetId}.audit.json`);
  const docxPath = resolve(outputDir, `${fileStem}_${assetId.slice(-8)}.docx`);

  writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf8");
  const result = spawnSync(pythonBinary(), [renderScript, payloadPath, docxPath, "--audit-json", auditPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.status !== 0 || !existsSync(docxPath)) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(details || "DOCX renderer failed.");
  }

  const stat = statSync(docxPath);
  const asset: ExportAsset = {
    asset_id: assetId,
    file_name: basename(docxPath),
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    download_url: `/api/assets/${assetId}/download`,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    sha256: sha256(docxPath),
    size_bytes: stat.size
  };
  renderedAssets.set(assetId, { asset, file_path: docxPath });

  return {
    asset,
    layout_validation: readAudit(auditPath)
  };
}

export function getRenderedAsset(assetId: string) {
  return renderedAssets.get(assetId) ?? null;
}
