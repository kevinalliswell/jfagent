import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type {
  BackendProject,
  BackendSession,
  CreditTransaction,
  ExportAsset,
  LicenseRecord,
  UserRecord
} from "./types.js";
import { getDataDir, getDatabasePath } from "./runtimePaths.js";

export interface StoredAssetRecord {
  asset: ExportAsset;
  file_path: string;
  session_id: string;
  state_version: number;
  created_at: string;
}

export interface PersistedKnowledgeUploadRecord {
  upload_id: string;
  original_file_name: string;
  stored_file_name: string;
  stored_path: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface PersistedKnowledgeJobRecord {
  job_id: string;
  file_name: string;
  status: "queued" | "rebuilding" | "completed" | "failed";
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

interface SessionRow {
  snapshot_json: string;
}

interface ProjectRow {
  project_json: string;
}

interface AssetRow {
  asset_json: string;
  file_path: string;
  session_id: string;
  state_version: number;
  created_at: string;
}

interface KnowledgeUploadRow {
  record_json: string;
}

interface KnowledgeJobRow {
  job_json: string;
}

mkdirSync(getDataDir(), { recursive: true });

const database = new DatabaseSync(getDatabasePath());

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    project_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS export_assets (
    asset_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    state_version INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    asset_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_uploads (
    upload_id TEXT PRIMARY KEY,
    stored_file_name TEXT NOT NULL UNIQUE,
    record_json TEXT NOT NULL,
    uploaded_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_jobs (
    job_id TEXT PRIMARY KEY,
    requested_at TEXT NOT NULL,
    job_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS retrieval_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    query_text TEXT NOT NULL,
    hit_json TEXT NOT NULL,
    requested_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    export_credits INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS licenses (
    code TEXT PRIMARY KEY,
    credits INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    note TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    redeemed_by TEXT,
    redeemed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    credits_delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    ref TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

function ensureColumn(table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("sessions", "user_id", "TEXT");
ensureColumn("projects", "user_id", "TEXT");

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizeSession(session: BackendSession) {
  const { payment_willingness_99_rmb: _legacyPayment, ...rest } = session;
  return rest;
}

export function loadSession(sessionId: string) {
  const row = database.prepare("SELECT snapshot_json FROM sessions WHERE session_id = ?").get(sessionId) as
    | SessionRow
    | undefined;
  return row ? parseJson<BackendSession>(row.snapshot_json) : null;
}

export function saveSession(session: BackendSession) {
  database
    .prepare(
      `
        INSERT INTO sessions (session_id, snapshot_json, updated_at, user_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at,
          user_id = excluded.user_id
      `
    )
    .run(
      session.session_id,
      JSON.stringify(normalizeSession(session)),
      session.updated_at,
      session.user_id ?? null
    );
}

export function countSessions() {
  const row = database.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
  return row.count;
}

export function loadProject(projectId: string) {
  const row = database.prepare("SELECT project_json FROM projects WHERE project_id = ?").get(projectId) as
    | ProjectRow
    | undefined;
  return row ? parseJson<BackendProject>(row.project_json) : null;
}

export function loadProjects(userId?: string | null) {
  if (userId) {
    const rows = database
      .prepare("SELECT project_json FROM projects WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId) as unknown as ProjectRow[];
    return rows.map((row) => parseJson<BackendProject>(row.project_json));
  }
  const rows = database
    .prepare("SELECT project_json FROM projects ORDER BY updated_at DESC")
    .all() as unknown as ProjectRow[];
  return rows.map((row) => parseJson<BackendProject>(row.project_json));
}

export function saveProject(project: BackendProject) {
  database
    .prepare(
      `
        INSERT INTO projects (project_id, project_json, updated_at, user_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          project_json = excluded.project_json,
          updated_at = excluded.updated_at,
          user_id = excluded.user_id
      `
    )
    .run(project.project_id, JSON.stringify(project), project.updated_at, project.user_id ?? null);
}

/**
 * Assign all legacy rows without an owner to the given user. Runs once when
 * the bootstrap admin account is created so pre-auth data stays reachable.
 */
export function claimLegacyOwnership(userId: string) {
  database.prepare("UPDATE projects SET user_id = ? WHERE user_id IS NULL").run(userId);
  database.prepare("UPDATE sessions SET user_id = ? WHERE user_id IS NULL").run(userId);
  const projectRows = database
    .prepare("SELECT project_json FROM projects WHERE user_id = ?")
    .all(userId) as unknown as ProjectRow[];
  for (const row of projectRows) {
    const project = parseJson<BackendProject>(row.project_json);
    if (!project.user_id) {
      project.user_id = userId;
      saveProject(project);
    }
  }
}

export function saveExportAsset(record: StoredAssetRecord) {
  database
    .prepare(
      `
        INSERT INTO export_assets (asset_id, session_id, state_version, file_path, asset_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          session_id = excluded.session_id,
          state_version = excluded.state_version,
          file_path = excluded.file_path,
          asset_json = excluded.asset_json,
          created_at = excluded.created_at
      `
    )
    .run(
      record.asset.asset_id,
      record.session_id,
      record.state_version,
      record.file_path,
      JSON.stringify(record.asset),
      record.created_at
    );
}

export function loadExportAsset(assetId: string) {
  const row = database
    .prepare(
      `
        SELECT asset_json, file_path, session_id, state_version, created_at
        FROM export_assets
        WHERE asset_id = ?
      `
    )
    .get(assetId) as AssetRow | undefined;
  if (!row) return null;
  return {
    asset: parseJson<ExportAsset>(row.asset_json),
    file_path: row.file_path,
    session_id: row.session_id,
    state_version: row.state_version,
    created_at: row.created_at
  } satisfies StoredAssetRecord;
}

export function saveKnowledgeUpload(record: PersistedKnowledgeUploadRecord) {
  database
    .prepare(
      `
        INSERT INTO knowledge_uploads (upload_id, stored_file_name, record_json, uploaded_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(stored_file_name) DO UPDATE SET
          upload_id = excluded.upload_id,
          record_json = excluded.record_json,
          uploaded_at = excluded.uploaded_at
      `
    )
    .run(record.upload_id, record.stored_file_name, JSON.stringify(record), record.uploaded_at);
}

export function loadLatestKnowledgeUpload() {
  const row = database
    .prepare(
      `
        SELECT record_json
        FROM knowledge_uploads
        ORDER BY uploaded_at DESC
        LIMIT 1
      `
    )
    .get() as KnowledgeUploadRow | undefined;
  return row ? parseJson<PersistedKnowledgeUploadRecord>(row.record_json) : null;
}

export function countKnowledgeUploads() {
  const row = database.prepare("SELECT COUNT(*) AS count FROM knowledge_uploads").get() as { count: number };
  return row.count;
}

export function createKnowledgeJob(record: PersistedKnowledgeJobRecord) {
  database
    .prepare(
      `
        INSERT INTO knowledge_jobs (job_id, requested_at, job_json)
        VALUES (?, ?, ?)
      `
    )
    .run(record.job_id, record.requested_at, JSON.stringify(record));
}

export function updateKnowledgeJob(record: PersistedKnowledgeJobRecord) {
  database
    .prepare(
      `
        INSERT INTO knowledge_jobs (job_id, requested_at, job_json)
        VALUES (?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          requested_at = excluded.requested_at,
          job_json = excluded.job_json
      `
    )
    .run(record.job_id, record.requested_at, JSON.stringify(record));
}

export function loadLatestKnowledgeJob() {
  const row = database
    .prepare(
      `
        SELECT job_json
        FROM knowledge_jobs
        ORDER BY requested_at DESC
        LIMIT 1
      `
    )
    .get() as KnowledgeJobRow | undefined;
  return row ? parseJson<PersistedKnowledgeJobRecord>(row.job_json) : null;
}

export function countPendingKnowledgeJobs() {
  const rows = database.prepare("SELECT job_json FROM knowledge_jobs").all() as unknown as KnowledgeJobRow[];
  return rows
    .map((row) => parseJson<PersistedKnowledgeJobRecord>(row.job_json))
    .filter((job) => job.status === "queued" || job.status === "rebuilding").length;
}

export function loadActiveKnowledgeJob() {
  const rows = database.prepare("SELECT job_json FROM knowledge_jobs").all() as unknown as KnowledgeJobRow[];
  return (
    rows
      .map((row) => parseJson<PersistedKnowledgeJobRecord>(row.job_json))
      .filter((job) => job.status === "queued" || job.status === "rebuilding")
      .sort((left, right) => left.requested_at.localeCompare(right.requested_at))[0] ?? null
  );
}

export function logRetrievalAudit(sessionId: string, queryText: string, hits: unknown) {
  database
    .prepare(
      `
        INSERT INTO retrieval_audit (session_id, query_text, hit_json, requested_at)
        VALUES (?, ?, ?, ?)
      `
    )
    .run(sessionId, queryText, JSON.stringify(hits), new Date().toISOString());
}

interface UserRow {
  user_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  export_credits: number;
  created_at: string;
  updated_at: string;
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    user_id: row.user_id,
    email: row.email,
    password_hash: row.password_hash,
    display_name: row.display_name,
    role: row.role === "admin" ? "admin" : "user",
    export_credits: row.export_credits,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function insertUser(user: UserRecord) {
  database
    .prepare(
      `
        INSERT INTO users (user_id, email, password_hash, display_name, role, export_credits, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      user.user_id,
      user.email,
      user.password_hash,
      user.display_name,
      user.role,
      user.export_credits,
      user.created_at,
      user.updated_at
    );
}

export function getUserByEmail(email: string) {
  const row = database.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  return row ? toUserRecord(row) : null;
}

export function getUserById(userId: string) {
  const row = database.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as UserRow | undefined;
  return row ? toUserRecord(row) : null;
}

export function countUsers() {
  const row = database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  return row.count;
}

export function listUsers() {
  const rows = database.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as unknown as UserRow[];
  return rows.map(toUserRecord);
}

export function updateUserCredits(userId: string, balanceAfter: number) {
  database
    .prepare("UPDATE users SET export_credits = ?, updated_at = ? WHERE user_id = ?")
    .run(balanceAfter, new Date().toISOString(), userId);
}

export function insertCreditTransaction(entry: CreditTransaction) {
  database
    .prepare(
      `
        INSERT INTO credit_transactions (user_id, type, credits_delta, balance_after, ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .run(entry.user_id, entry.type, entry.credits_delta, entry.balance_after, entry.ref, entry.created_at);
}

export function listCreditTransactions(userId: string, limit = 50) {
  return database
    .prepare(
      `
        SELECT user_id, type, credits_delta, balance_after, ref, created_at
        FROM credit_transactions
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ?
      `
    )
    .all(userId, limit) as unknown as CreditTransaction[];
}

interface LicenseRow {
  code: string;
  credits: number;
  status: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  redeemed_by: string | null;
  redeemed_at: string | null;
}

function toLicenseRecord(row: LicenseRow): LicenseRecord {
  return {
    code: row.code,
    credits: row.credits,
    status: row.status === "redeemed" ? "redeemed" : row.status === "disabled" ? "disabled" : "active",
    note: row.note,
    created_by: row.created_by,
    created_at: row.created_at,
    redeemed_by: row.redeemed_by,
    redeemed_at: row.redeemed_at
  };
}

export function insertLicense(license: LicenseRecord) {
  database
    .prepare(
      `
        INSERT INTO licenses (code, credits, status, note, created_by, created_at, redeemed_by, redeemed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      license.code,
      license.credits,
      license.status,
      license.note,
      license.created_by,
      license.created_at,
      license.redeemed_by,
      license.redeemed_at
    );
}

export function getLicense(code: string) {
  const row = database.prepare("SELECT * FROM licenses WHERE code = ?").get(code) as LicenseRow | undefined;
  return row ? toLicenseRecord(row) : null;
}

export function markLicenseRedeemed(code: string, userId: string) {
  database
    .prepare("UPDATE licenses SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE code = ?")
    .run(userId, new Date().toISOString(), code);
}

export function listLicenses(limit = 100) {
  const rows = database
    .prepare("SELECT * FROM licenses ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as LicenseRow[];
  return rows.map(toLicenseRecord);
}

export function getAppSecret(key: string) {
  const row = database.prepare("SELECT value FROM app_secrets WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setAppSecret(key: string, value: string) {
  database
    .prepare(
      `
        INSERT INTO app_secrets (key, value, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
    )
    .run(key, value, new Date().toISOString());
}
