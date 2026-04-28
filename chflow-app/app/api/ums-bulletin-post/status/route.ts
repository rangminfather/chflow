import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const preferredRegion = "icn1";

// 환경변수에 박혀있는 공용 UMS 계정의 user_id (예: 'clyawy').
// 향후 부서별/등록자별로 분리되면 클라이언트가 ums_user_id 파라미터를 보내도록 변경.
const UMS_USER_ID = process.env.UMS_USER_ID || "";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  if (!UMS_USER_ID) {
    return NextResponse.json(
      { ok: false, error: "UMS_USER_ID 환경변수가 설정되지 않았습니다" },
      { status: 500 },
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("ums_check_cooldown", {
    p_ums_user_id: UMS_USER_ID,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const row = (data && data[0]) || { remaining_seconds: 0, last_posted_at: null, last_post_no: null, last_subject: null };

  return NextResponse.json({
    ok: true,
    remaining_seconds: row.remaining_seconds || 0,
    can_post: (row.remaining_seconds || 0) === 0,
    last_posted_at: row.last_posted_at,
    last_post_no: row.last_post_no,
    last_subject: row.last_subject,
    ums_user_id: UMS_USER_ID,  // 디버그/표시용 (비밀번호는 노출 X)
  });
}
