import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function isUsableRecoveryEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.toLowerCase().endsWith("@smartms.app");
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
    }

    const { email } = await req.json();
    const trimmedEmail = String(email || "").trim().toLowerCase();
    if (!isUsableRecoveryEmail(trimmedEmail)) {
      return NextResponse.json({ error: "사용 가능한 실제 이메일 주소를 입력하세요" }, { status: 400 });
    }

    const verifier = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await verifier.auth.getUser(token);
    if (authError || !authData.user) {
      return NextResponse.json({ error: "로그인이 만료되었습니다" }, { status: 401 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: updateAuthError } = await admin.auth.admin.updateUserById(authData.user.id, {
      email: trimmedEmail,
      email_confirm: true,
    });
    if (updateAuthError) {
      return NextResponse.json({ error: updateAuthError.message }, { status: 500 });
    }

    const { error: updateProfileError } = await admin
      .from("profiles")
      .update({ email: trimmedEmail })
      .eq("id", authData.user.id);

    if (updateProfileError) {
      return NextResponse.json({ error: updateProfileError.message }, { status: 500 });
    }

    return NextResponse.json({ email: trimmedEmail });
  } catch {
    return NextResponse.json({ error: "이메일 등록 중 오류가 발생했습니다" }, { status: 500 });
  }
}
