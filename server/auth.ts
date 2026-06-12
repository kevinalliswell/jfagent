import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { LicenseRecord, PublicUser, UserRecord, UserRole } from "./types.js";
import {
  claimLegacyOwnership,
  countUsers,
  getAppSecret,
  getLicense,
  getUserByEmail,
  getUserById,
  insertCreditTransaction,
  insertLicense,
  insertUser,
  listLicenses,
  listUsers,
  markLicenseRedeemed,
  setAppSecret,
  updateUserCredits
} from "./persistence.js";

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const SCRYPT_KEYLEN = 64;

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

export function isAuthDisabled() {
  const value = process.env.AUTH_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function registrationMode(): "open" | "closed" {
  return process.env.REGISTRATION_MODE?.trim().toLowerCase() === "closed" ? "closed" : "open";
}

function freeSignupCredits() {
  const configured = Number(process.env.FREE_EXPORT_CREDITS ?? 1);
  return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 1;
}

let cachedSecret: string | null = null;

function jwtSecret() {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  const persisted = getAppSecret("jwt_secret");
  if (persisted) {
    cachedSecret = persisted;
    return cachedSecret;
  }
  const generated = randomBytes(32).toString("hex");
  setAppSecret("jwt_secret", generated);
  cachedSecret = generated;
  return cachedSecret;
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expected] = parts;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(actual, expectedBuffer);
}

interface TokenPayload {
  uid: string;
  role: UserRole;
  exp: number;
}

export function signToken(user: Pick<UserRecord, "user_id" | "role">) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      uid: user.user_id,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    } satisfies TokenPayload)
  );
  const signature = createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenPayload;
    if (typeof parsed.uid !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    export_credits: user.export_credits,
    created_at: user.created_at
  };
}

const LOCAL_ADMIN: PublicUser = {
  user_id: "local_admin",
  email: "local@jfagent",
  display_name: "本地管理员",
  role: "admin",
  export_credits: 9999,
  created_at: new Date(0).toISOString()
};

/** Synthetic identity used when AUTH_DISABLED=1 (single-operator local mode). */
export function localAdminUser(): PublicUser {
  return { ...LOCAL_ADMIN };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function registerUser(params: {
  email: string;
  password: string;
  display_name?: string;
  forceRole?: UserRole;
}): { user: PublicUser; token: string } {
  const email = normalizeEmail(params.email ?? "");
  if (!validateEmail(email)) {
    throw new AuthError("邮箱格式不正确。", 400, "INVALID_EMAIL");
  }
  if (!params.password || params.password.length < 8) {
    throw new AuthError("密码至少需要 8 位。", 400, "WEAK_PASSWORD");
  }
  if (getUserByEmail(email)) {
    throw new AuthError("该邮箱已注册，请直接登录。", 409, "EMAIL_TAKEN");
  }

  const isFirstUser = countUsers() === 0;
  if (!isFirstUser && !params.forceRole && registrationMode() === "closed") {
    throw new AuthError("当前部署已关闭注册，请联系管理员开通账号。", 403, "REGISTRATION_CLOSED");
  }

  const role: UserRole = params.forceRole ?? (isFirstUser ? "admin" : "user");
  const credits = role === "admin" ? 0 : freeSignupCredits();
  const now = new Date().toISOString();
  const user: UserRecord = {
    user_id: `user_${randomUUID()}`,
    email,
    password_hash: hashPassword(params.password),
    display_name: params.display_name?.trim() || email.split("@")[0],
    role,
    export_credits: credits,
    created_at: now,
    updated_at: now
  };
  insertUser(user);

  if (credits > 0) {
    insertCreditTransaction({
      user_id: user.user_id,
      type: "signup_grant",
      credits_delta: credits,
      balance_after: credits,
      ref: "free_signup",
      created_at: now
    });
  }
  if (role === "admin") {
    claimLegacyOwnership(user.user_id);
  }

  return { user: toPublicUser(user), token: signToken(user) };
}

export function loginUser(params: { email: string; password: string }): {
  user: PublicUser;
  token: string;
} {
  const email = normalizeEmail(params.email ?? "");
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(params.password ?? "", user.password_hash)) {
    throw new AuthError("邮箱或密码不正确。", 401, "INVALID_CREDENTIALS");
  }
  return { user: toPublicUser(user), token: signToken(user) };
}

export function resolveUser(token: string | null): PublicUser | null {
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = getUserById(payload.uid);
  return user ? toPublicUser(user) : null;
}

/** Create the env-configured admin account at startup when it does not exist. */
export function ensureBootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!email || !password) return null;
  const existing = getUserByEmail(normalizeEmail(email));
  if (existing) return toPublicUser(existing);
  const created = registerUser({
    email,
    password,
    display_name: process.env.ADMIN_DISPLAY_NAME?.trim() || "管理员",
    forceRole: "admin"
  });
  return created.user;
}

function applyCreditsDelta(
  userId: string,
  delta: number,
  type: "signup_grant" | "redeem" | "export_debit" | "admin_grant",
  ref: string | null
) {
  const user = getUserById(userId);
  if (!user) throw new AuthError("用户不存在。", 404, "USER_NOT_FOUND");
  const balanceAfter = user.export_credits + delta;
  if (balanceAfter < 0) {
    throw new AuthError("导出额度不足。", 402, "NO_CREDITS");
  }
  updateUserCredits(userId, balanceAfter);
  insertCreditTransaction({
    user_id: userId,
    type,
    credits_delta: delta,
    balance_after: balanceAfter,
    ref,
    created_at: new Date().toISOString()
  });
  return balanceAfter;
}

export function debitExportCredit(userId: string, sessionId: string) {
  return applyCreditsDelta(userId, -1, "export_debit", sessionId);
}

export function grantCredits(userId: string, credits: number, ref: string | null) {
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new AuthError("额度必须是正整数。", 400, "INVALID_CREDITS");
  }
  return applyCreditsDelta(userId, credits, "admin_grant", ref);
}

const LICENSE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomLicenseSegment(length = 5) {
  const bytes = randomBytes(length);
  let segment = "";
  for (let index = 0; index < length; index += 1) {
    segment += LICENSE_ALPHABET[bytes[index] % LICENSE_ALPHABET.length];
  }
  return segment;
}

export function generateLicenses(params: {
  count: number;
  credits: number;
  note?: string;
  created_by: string;
}): LicenseRecord[] {
  const count = Math.floor(params.count);
  const credits = Math.floor(params.credits);
  if (!Number.isFinite(count) || count < 1 || count > 200) {
    throw new AuthError("单次最多生成 200 个激活码。", 400, "INVALID_LICENSE_COUNT");
  }
  if (!Number.isFinite(credits) || credits < 1 || credits > 1000) {
    throw new AuthError("激活码额度必须在 1-1000 之间。", 400, "INVALID_LICENSE_CREDITS");
  }

  const created: LicenseRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    let code = `JF-${randomLicenseSegment()}-${randomLicenseSegment()}`;
    while (getLicense(code)) {
      code = `JF-${randomLicenseSegment()}-${randomLicenseSegment()}`;
    }
    const license: LicenseRecord = {
      code,
      credits,
      status: "active",
      note: params.note?.trim() || null,
      created_by: params.created_by,
      created_at: new Date().toISOString(),
      redeemed_by: null,
      redeemed_at: null
    };
    insertLicense(license);
    created.push(license);
  }
  return created;
}

export function redeemLicense(userId: string, rawCode: string) {
  const code = rawCode?.trim().toUpperCase();
  if (!code) throw new AuthError("请输入激活码。", 400, "INVALID_LICENSE_CODE");
  const license = getLicense(code);
  if (!license || license.status === "disabled") {
    throw new AuthError("激活码无效，请核对后重试。", 404, "LICENSE_NOT_FOUND");
  }
  if (license.status === "redeemed") {
    throw new AuthError("该激活码已被使用。", 409, "LICENSE_REDEEMED");
  }
  markLicenseRedeemed(code, userId);
  const balanceAfter = applyCreditsDelta(userId, license.credits, "redeem", code);
  return { credits_added: license.credits, balance_after: balanceAfter };
}

export function listAllUsers() {
  return listUsers().map(toPublicUser);
}

export function listAllLicenses(limit = 100) {
  return listLicenses(limit);
}

export function getRegistrationMode() {
  return registrationMode();
}
