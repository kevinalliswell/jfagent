import { resolve } from "node:path";

function fromEnv(name: string, fallbackSegments: string[]) {
  const configured = process.env[name]?.trim();
  return configured ? resolve(configured) : resolve(process.cwd(), ...fallbackSegments);
}

export function getDataDir() {
  return fromEnv("JFAGENT_DATA_DIR", ["data"]);
}

export function getDatabasePath() {
  return resolve(getDataDir(), "jfagent.sqlite");
}

export function getOutputDir() {
  return fromEnv("JFAGENT_OUTPUT_DIR", ["output", "doc"]);
}

export function getKnowledgeUploadDir() {
  return fromEnv("JFAGENT_UPLOAD_DIR", ["knowledge", "uploads"]);
}
