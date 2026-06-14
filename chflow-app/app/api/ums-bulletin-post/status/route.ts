import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// 사용자 본인의 UMS 자격증명 기준 쿨다운 상태 조회.
// Bearer token 인증 필수 (본인만 본인 정보 봄).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getAuthUser(req: NextRequest): Promise<{ uid: string } | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { uid: data.user.id };
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) {
    // 미인증: 정상 응답 (자격증명 없음 / 쿨다운 0)
    return NextResponse.json({
      ok: true,
      has_credentials: false,
      remaining_seconds: 0,
      can_post: true,
      last_posted_at: null,
      last_post_no: null,
      last_subject: null,
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 사용자 자격증명 조회
  const { data: cred } = await admin
    .from("user_ums_credentials")
    .select("ums_user_id")
    .eq("user_id", user.uid)
    .maybeSingle();

  if (!cred) {
    return NextResponse.json({
      ok: true,
      has_credentials: false,
      remaining_seconds: 0,
      can_post: true,
      last_posted_at: null,
      last_post_no: null,
      last_subject: null,
      ums_user_id: null,
    });
  }

  const { data: cdRows, error } = await admin.rpc("ums_check_cooldown", {
    p_ums_user_id: cred.ums_user_id,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "상태 조회 중 오류가 발생했습니다." }, { status: 500 });
  }
  const row = (cdRows && cdRows[0]) || {
    remaining_seconds: 0, last_posted_at: null, last_post_no: null, last_subject: null,
  };

  return NextResponse.json({
    ok: true,
    has_credentials: true,
    remaining_seconds: row.remaining_seconds || 0,
    can_post: (row.remaining_seconds || 0) === 0,
    last_posted_at: row.last_posted_at,
    last_post_no: row.last_post_no,
    last_subject: row.last_subject,
    ums_user_id: cred.ums_user_id,
  });
}
