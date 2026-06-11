import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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

export async function POST(req: Request) {
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
        return NextResponse.json({ error: updateAuthError.message }, { status: 500 });
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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, maskedEmail: maskEmail(resetEmail) });
  } catch {
    return NextResponse.json({ error: "오류가 발생했습니다" }, { status: 500 });
  }
}
