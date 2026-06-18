import { createHmac, createHash, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

const TOKEN_VERSION = "v1";

export type SignupAttemptResult =
  | "matched"
  | "no_match"
  | "duplicate_account"
  | "multiple_match"
  | "rate_limited"
  | "invalid_request"
  | "signup_created"
  | "signup_failed";

export type SignupRiskLevel = "low" | "medium" | "high" | "critical";

export type VerifiedSignupIdentity = {
  provider: string;
  subject: string;
  name: string;
  phone: string;
  verifiedAt: number;
};

type LogSignupAttemptArgs = {
  route: "manual" | "verified" | "child" | "support" | "unknown";
  result: SignupAttemptResult;
  riskLevel?: SignupRiskLevel;
  reason?: string | null;
  name?: string | null;
  phone?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export function normalizePhoneDigits(phone: string): string {
  return (phone || "").replace(/[^0-9]/g, "");
}

export function maskName(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 1) return `${trimmed}*`;
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}*${trimmed.slice(-1)}`;
}

export function maskPhone(phone: string): string {
  const d = normalizePhoneDigits(phone);
  if (d.length < 7) return phone ? "***" : "";
  if (d.length === 10) return `${d.slice(0, 3)}-***-${d.slice(-4)}`;
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

export function hashValue(value: string | null | undefined): string | null {
  const clean = (value || "").trim();
  if (!clean) return null;
  return createHash("sha256")
    .update(`${process.env.SIGNUP_LOG_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "chflow"}:${clean}`)
    .digest("hex");
}

export async function logSignupAttempt(
  admin: SupabaseClient,
  args: LogSignupAttemptArgs
): Promise<void> {
  try {
    await admin.from("signup_attempt_logs").insert({
      route: args.route,
      result: args.result,
      risk_level: args.riskLevel || "low",
      reason: args.reason || null,
      input_name_masked: args.name ? maskName(args.name) : null,
      input_phone_masked: args.phone ? maskPhone(args.phone) : null,
      input_phone_hash: args.phone ? hashValue(normalizePhoneDigits(args.phone)) : null,
      ip_hash: hashValue(args.ip || null),
      user_agent: args.userAgent || null,
      metadata: args.metadata || {},
    });
  } catch {
    // Logging must not break signup. Missing migrations are handled by deploy order.
  }
}

export async function getSignupThrottle(
  admin: SupabaseClient,
  ip: string,
  phone: string
): Promise<{ limited: boolean; level: SignupRiskLevel; reason: string | null }> {
  const ipHash = hashValue(ip);
  const phoneHash = hashValue(normalizePhoneDigits(phone));
  if (!ipHash && !phoneHash) return { limited: false, level: "low", reason: null };

  try {
    const since10m = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const suspiciousResults = ["no_match", "multiple_match", "duplicate_account", "rate_limited"];

    const recentIp = ipHash
      ? await admin
        .from("signup_attempt_logs")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .in("result", suspiciousResults)
        .gte("created_at", since10m)
      : { count: 0 };

    const dailyPhone = phoneHash
      ? await admin
        .from("signup_attempt_logs")
        .select("id", { count: "exact", head: true })
        .eq("input_phone_hash", phoneHash)
        .in("result", suspiciousResults)
        .gte("created_at", since24h)
      : { count: 0 };

    const ipCount = recentIp.count || 0;
    const phoneCount = dailyPhone.count || 0;

    if (ipCount >= 12) {
      return { limited: true, level: "critical", reason: "10분 내 가입 조회 실패가 과도하게 반복되었습니다." };
    }
    if (phoneCount >= 10) {
      return { limited: true, level: "high", reason: "같은 전화번호로 가입 조회 실패가 하루 기준 과도하게 반복되었습니다." };
    }
    if (ipCount >= 5) {
      return { limited: true, level: "medium", reason: "10분 내 가입 조회 실패가 반복되었습니다." };
    }

    return { limited: false, level: "low", reason: null };
  } catch {
    return { limited: false, level: "low", reason: null };
  }
}

function getTokenSecret(): string {
  return process.env.SIGNUP_VERIFICATION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function signTokenPayload(payload: string): string {
  return createHmac("sha256", getTokenSecret()).update(payload).digest("base64url");
}

export function createSignupIdentityToken(identity: VerifiedSignupIdentity): string {
  const payload = Buffer.from(JSON.stringify(identity), "utf8").toString("base64url");
  return `${TOKEN_VERSION}.${payload}.${signTokenPayload(`${TOKEN_VERSION}.${payload}`)}`;
}

export function verifySignupIdentityToken(token: string | null | undefined): VerifiedSignupIdentity | null {
  if (!token || !getTokenSecret()) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const expected = signTokenPayload(`${parts[0]}.${parts[1]}`);
  const actual = parts[2];
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as VerifiedSignupIdentity;
    if (!parsed.name || !parsed.phone || !parsed.provider || !parsed.subject || !parsed.verifiedAt) return null;
    if (Date.now() - parsed.verifiedAt > 15 * 60 * 1000) return null;
    return { ...parsed, phone: normalizePhoneDigits(parsed.phone) };
  } catch {
    return null;
  }
}
