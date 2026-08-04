import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ ok: false, error: "로그인이 만료되었습니다." }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { reason?: string } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : null;

  // The user-scoped RPC performs the membership/content-preserving transaction.
  const { data: withdrawal, error: withdrawalError } = await userClient.rpc("withdraw_my_account", {
    p_reason: reason || null,
  });
  if (withdrawalError) {
    return NextResponse.json({ ok: false, error: withdrawalError.message }, { status: 500 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
  if (deleteError) {
    return NextResponse.json(
      { ok: false, error: `탈퇴 처리는 저장되었지만 로그인 계정 삭제에 실패했습니다: ${deleteError.message}` },
      { status: 500 },
    );
  }

  const { error: archiveError } = await admin
    .from("account_withdrawals")
    .update({ account_deleted_at: new Date().toISOString() })
    .eq("user_id", authData.user.id);
  if (archiveError) {
    // The account is already gone; keep the successful withdrawal response while
    // leaving the archive row available for an admin retry/audit repair.
    console.error("account withdrawal archive timestamp update failed", archiveError);
  }

  return NextResponse.json({ ok: true, withdrawal });
}
