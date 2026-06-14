import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const rl = new Map<string, { n: number; reset: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rl.get(ip);
  if (!entry || now > entry.reset) { rl.set(ip, { n: 1, reset: now + 60_000 }); return true; }
  if (entry.n >= 5) return false;
  entry.n++;
  return true;
}

function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    // Why: Vercel can import route modules during build. Delay the real
    // Supabase client creation until this API is called.
    throw new Error("Missing Supabase admin env for password reset API.");
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const masked = local.length <= 2
    ? "*".repeat(local.length)
    : local.substring(0, 2) + "*".repeat(local.length - 2);
  const domainParts = domain.split(".");
  const maskedDomain =
    domainParts[0].substring(0, 1) +
    "*".repeat(Math.max(domainParts[0].length - 1, 1)) +
    "." +
    domainParts.slice(1).join(".");
  return `${masked}@${maskedDomain}`;
}

function isUsableRecoveryEmail(email: string | null | undefined): email is string {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.toLowerCase().endsWith("@smartms.app");
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }, { status: 429 });
  }
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const { username } = await req.json();
    const lowerUsername = String(username || "").toLowerCase().trim();

    if (!lowerUsername) {
      return NextResponse.json({ error: "아이디를 입력해주세요" }, { status: 400 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .ilike("username", lowerUsername)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: "계정 정보를 확인할 수 없습니다" }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: "등록되지 않은 아이디입니다" }, { status: 404 });
    }

    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    if (userError || !userData.user) {
      return NextResponse.json({ error: "계정 정보를 확인할 수 없습니다" }, { status: 500 });
    }

    let resetEmail = userData.user.email || "";

    // Older accounts started with username@smartms.app for username login.
    // Password recovery must use the registered real email, not that alias.
    if (!isUsableRecoveryEmail(resetEmail)) {
      if (!isUsableRecoveryEmail(profile.email)) {
        return NextResponse.json({ noEmail: true });
      }

      const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
        email: profile.email,
        email_confirm: true,
      });
      if (updateAuthError) {
        return NextResponse.json({ error: "계정 정보를 업데이트할 수 없습니다" }, { status: 500 });
      }

      resetEmail = profile.email;
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://chflow-app.vercel.app";

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${siteUrl}/reset-password`,
    });

    if (error) {
      return NextResponse.json({ error: "비밀번호 재설정 메일을 발송할 수 없습니다" }, { status: 500 });
    }

    return NextResponse.json({ success: true, maskedEmail: maskEmail(resetEmail) });
  } catch {
    return NextResponse.json({ error: "오류가 발생했습니다" }, { status: 500 });
  }
}
