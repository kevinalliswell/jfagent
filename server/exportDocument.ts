import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { ExportAsset } from "./types.js";
import type { ExportPayloadV1 } from "./exportPayload.js";
import { loadExportAsset, saveExportAsset, type StoredAssetRecord } from "./persistence.js";
import { getOutputDir } from "./runtimePaths.js";

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

const outputDir = getOutputDir();
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

function statusRank(status: RenderedExportDocument["layout_validation"]["status"]) {
  if (status === "blocked") return 2;
  if (status === "warning") return 1;
  return 0;
}

function mergeLayoutValidation(
  base: RenderedExportDocument["layout_validation"],
  next: RenderedExportDocument["layout_validation"]
): RenderedExportDocument["layout_validation"] {
  return {
    status: statusRank(next.status) > statusRank(base.status) ? next.status : base.status,
    checks: [...base.checks, ...next.checks]
  };
}

function findExecutableOnPath(fileName: string) {
  for (const entry of (process.env.PATH ?? "").split(":")) {
    if (!entry) continue;
    const candidate = join(entry, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findSofficeBinary() {
  const configured = process.env.SOFFICE_BIN;
  if (configured && existsSync(configured)) return configured;

  const fromPath = findExecutableOnPath("soffice") ?? findExecutableOnPath("libreoffice");
  if (fromPath) return fromPath;

  const knownCandidates = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice"
  ];
  return knownCandidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findPdfRasterizer() {
  return process.env.PDFTOPPM_BIN ?? findExecutableOnPath("pdftoppm");
}

function renderVisualAudit(docxPath: string): RenderedExportDocument["layout_validation"] {
  const soffice = findSofficeBinary();
  if (!soffice) {
    return {
      status: "warning",
      checks: [
        "docx_soffice_available:warning",
        "docx_pdf_rendered:warning",
        "docx_png_pages_rendered:warning"
      ]
    };
  }

  const pdfPath = docxPath.replace(/\.docx$/i, ".pdf");
  const pdfResult = spawnSync(
    soffice,
    ["--headless", "--convert-to", "pdf:writer_pdf_Export", "--outdir", outputDir, docxPath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    }
  );

  if (pdfResult.status !== 0 || !existsSync(pdfPath)) {
    return {
      status: "warning",
      checks: [
        "docx_soffice_available:passed",
        "docx_pdf_rendered:warning",
        "docx_png_pages_rendered:warning"
      ]
    };
  }

  const pdftoppm = findPdfRasterizer();
  if (!pdftoppm) {
    return {
      status: "warning",
      checks: ["docx_soffice_available:passed", "docx_pdf_rendered:passed", "docx_png_pages_rendered:warning"]
    };
  }

  const pngPrefix = docxPath.replace(/\.docx$/i, "_page");
  const pngResult = spawnSync(pdftoppm, ["-png", pdfPath, pngPrefix], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  const pngBase = basename(pngPrefix);
  const pngFiles = readdirSync(outputDir).filter(
    (fileName) => fileName.startsWith(`${pngBase}-`) && fileName.endsWith(".png")
  );

  return {
    status: pngResult.status === 0 && pngFiles.length > 0 ? "passed" : "warning",
    checks: [
      "docx_soffice_available:passed",
      "docx_pdf_rendered:passed",
      pngResult.status === 0 && pngFiles.length > 0
        ? "docx_png_pages_rendered:passed"
        : "docx_png_pages_rendered:warning"
    ]
  };
}

function renderDocxToDisk(payload: ExportPayloadV1, fileSuffix: string) {
  mkdirSync(outputDir, { recursive: true });
  const assetId = `asset_docx_${randomUUID()}`;
  const fileStem = `${safeFileStem(payload.project_name)}_${fileSuffix}`;
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

  return { assetId, docxPath, auditPath };
}

function registerAsset(assetId: string, filePath: string, mimeType: string, payload: ExportPayloadV1) {
  const stat = statSync(filePath);
  const asset: ExportAsset = {
    asset_id: assetId,
    file_name: basename(filePath),
    mime_type: mimeType,
    download_url: `/api/assets/${assetId}/download`,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    sha256: sha256(filePath),
    size_bytes: stat.size
  };
  renderedAssets.set(assetId, { asset, file_path: filePath });
  const storedRecord: StoredAssetRecord = {
    asset,
    file_path: filePath,
    session_id: payload.session_id,
    state_version: payload.state_version,
    created_at: new Date().toISOString()
  };
  saveExportAsset(storedRecord);
  return asset;
}

export function renderExportDocx(payload: ExportPayloadV1): RenderedExportDocument {
  const { assetId, docxPath, auditPath } = renderDocxToDisk(payload, "需求表_v1");
  const asset = registerAsset(
    assetId,
    docxPath,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    payload
  );

  const structuralAudit = readAudit(auditPath);
  const visualAudit = renderVisualAudit(docxPath);

  return {
    asset,
    layout_validation: mergeLayoutValidation(structuralAudit, visualAudit)
  };
}

/**
 * Render a watermarked preview PDF (docx -> soffice -> pdf). Returns null when
 * LibreOffice is unavailable so the caller can fall back to a simulated asset.
 */
export function renderExportPreviewPdf(payload: ExportPayloadV1): RenderedExportDocument | null {
  const soffice = findSofficeBinary();
  if (!soffice) return null;

  const { docxPath, auditPath } = renderDocxToDisk(payload, "预览版");
  const pdfResult = spawnSync(
    soffice,
    ["--headless", "--convert-to", "pdf:writer_pdf_Export", "--outdir", outputDir, docxPath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    }
  );
  const pdfPath = docxPath.replace(/\.docx$/i, ".pdf");
  if (pdfResult.status !== 0 || !existsSync(pdfPath)) {
    return null;
  }

  const assetId = `asset_pdf_${randomUUID()}`;
  const asset = registerAsset(assetId, pdfPath, "application/pdf", payload);
  const structuralAudit = readAudit(auditPath);

  return {
    asset,
    layout_validation: mergeLayoutValidation(structuralAudit, {
      status: "passed",
      checks: ["preview_pdf_rendered:passed"]
    })
  };
}

export function getRenderedAsset(assetId: string) {
  const cached = renderedAssets.get(assetId);
  if (cached) return cached;
  const stored = loadExportAsset(assetId);
  if (!stored) return null;
  const recovered = { asset: stored.asset, file_path: stored.file_path };
  renderedAssets.set(assetId, recovered);
  return recovered;
}
