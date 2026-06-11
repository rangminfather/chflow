import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    // Why: API route modules are imported during Vercel build page-data
    // collection. Create the admin client only when the route is actually
    // called so missing Preview env vars do not break unrelated builds.
    throw new Error("Missing Supabase admin env for password reset API.");
  }

  return createClient(url, serviceKey);
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

export async function POST(req: Request) {
  try {
    const supabaseAdmin = createSupabaseAdmin();
    const { username } = await req.json();
    if (!username?.trim()) {
      return NextResponse.json({ error: "아이디를 입력해주세요" }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("username", username.trim())
      .single();

    if (!profile) {
      return NextResponse.json({ error: "등록되지 않은 아이디입니다" }, { status: 404 });
    }

    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(profile.user_id);

    if (!user?.email || user.email.endsWith("@smartms.app")) {
      return NextResponse.json({ noEmail: true });
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://chflow-app.vercel.app";

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${siteUrl}/reset-password`,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, maskedEmail: maskEmail(user.email) });
  } catch {
    return NextResponse.json({ error: "오류가 발생했습니다" }, { status: 500 });
  }
}
