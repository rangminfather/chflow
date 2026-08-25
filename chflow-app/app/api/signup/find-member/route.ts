import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2 } from "@/lib/r2";
import { getSignupPhotoStoragePath, SIGNUP_PHOTO_PREFIX } from "@/lib/server/signup-photo";
import {
  getClientIp,
  getSignupThrottle,
  logSignupAttempt,
  normalizePhoneDigits,
} from "@/lib/server/signup-security";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 분당 10회 / IP (인스턴스 내 best-effort)
const rl = new Map<string, { n: number; reset: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rl.get(ip);
  if (!entry || now > entry.reset) {
    rl.set(ip, { n: 1, reset: now + 60_000 });
    return true;
  }
  if (entry.n >= 10) return false;
  entry.n++;
  return true;
}

async function resolvePhotoUrl(row: Record<string, unknown>) {
  const raw = row.photo_url;
  if (typeof raw !== "string" || !raw.startsWith(SIGNUP_PHOTO_PREFIX)) return row;
  const storagePath = getSignupPhotoStoragePath(raw);
  if (!storagePath) return { ...row, photo_url: null };
  const { data } = await r2.from("member-photos").createSignedUrl(storagePath, 300);
  return { ...row, photo_url: data?.signedUrl ?? null };
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent");
  if (!checkRateLimit(ip)) {
    await logSignupAttempt(supabaseAdmin, {
      route: "manual",
      result: "rate_limited",
      riskLevel: "medium",
      reason: "in-memory minute rate limit",
      ip,
      userAgent,
    });
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!name || !phone) {
    await logSignupAttempt(supabaseAdmin, {
      route: "manual",
      result: "invalid_request",
      riskLevel: "low",
      reason: "missing name or phone",
      name,
      phone,
      ip,
      userAgent,
    });
    return NextResponse.json({ error: "이름과 전화번호를 입력하세요." }, { status: 400 });
  }

  const throttle = await getSignupThrottle(supabaseAdmin, ip, phone);
  if (throttle.limited) {
    await logSignupAttempt(supabaseAdmin, {
      route: "manual",
      result: "rate_limited",
      riskLevel: throttle.level,
      reason: throttle.reason,
      name,
      phone,
      ip,
      userAgent,
    });
    return NextResponse.json(
      { error: "가입 조회 시도가 반복되어 잠시 제한되었습니다. 관리자에게 문의해 주세요." },
      { status: 429 }
    );
  }

  const { data, error } = await supabaseAdmin.rpc("find_member_for_signup", {
    p_name: name,
    p_phone: phone,
  });
  if (error) return NextResponse.json({ error: "조회 중 오류가 발생했습니다." }, { status: 500 });

  const rows = await Promise.all((data ?? []).map(resolvePhotoUrl));
  const result = rows.length === 0
    ? "no_match"
    : rows.length > 1
      ? "multiple_match"
      : rows[0]?.has_account
        ? "duplicate_account"
        : "matched";

  await logSignupAttempt(supabaseAdmin, {
    route: "manual",
    result,
    riskLevel: result === "multiple_match" ? "medium" : result === "no_match" ? "low" : "low",
    reason: result === "multiple_match"
      ? "name and phone matched multiple member rows"
      : result === "duplicate_account"
        ? "matched member already has app account"
        : null,
    name,
    phone: normalizePhoneDigits(phone),
    ip,
    userAgent,
    metadata: { count: rows.length },
  });

  if (rows.length > 1) {
    return NextResponse.json(
      { error: "동일한 정보가 2건 이상 확인되었습니다. 관리자에게 문의해 주세요.", code: "MULTIPLE_MATCH" },
      { status: 409 }
    );
  }

  return NextResponse.json({ data: rows });
}
