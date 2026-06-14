// 관리자 비밀번호 초기화 endpoint
// admin role 사용자만 호출 가능. 임시 비번 발급 + must_change_password=true 자동 설정.
// 모든 reset 은 password_reset_log 에 기록.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface ResetBody {
  target_user_id: string;
  reason?: string;
}

function generateTempPassword(): string {
  // 8자 random — 숫자 + 영문 (헷갈리는 0/O/1/l 제외)
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

export async function POST(req: NextRequest) {
  // 1. 호출자 인증
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }
  const adminUserId = authData.user.id;

  // 2. admin role 체크
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerProfile, error: pErr } = await admin
    .from("profiles")
    .select("username, role")
    .eq("id", adminUserId)
    .maybeSingle();
  if (pErr || !callerProfile) {
    return NextResponse.json({ ok: false, error: "프로필 조회 실패" }, { status: 500 });
  }
  if (callerProfile.role !== "admin") {
    return NextResponse.json({ ok: false, error: "관리자 권한 필요" }, { status: 403 });
  }

  // 3. body 검증
  let body: ResetBody;
  try {
    body = (await req.json()) as ResetBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.target_user_id) {
    return NextResponse.json({ ok: false, error: "target_user_id 필수" }, { status: 400 });
  }
  if (body.target_user_id === adminUserId) {
    return NextResponse.json(
      { ok: false, error: "본인 비밀번호는 myinfo 에서 변경하세요" },
      { status: 400 },
    );
  }

  // 4. target 사용자 정보 조회
  const { data: target, error: tErr } = await admin
    .from("profiles")
    .select("id, username, name")
    .eq("id", body.target_user_id)
    .maybeSingle();
  if (tErr || !target) {
    return NextResponse.json({ ok: false, error: "대상 사용자 없음" }, { status: 404 });
  }

  // 5. 임시 비번 생성 + auth 비번 + must_change_password 동시 업데이트
  const tempPw = generateTempPassword();
  const { error: updErr } = await admin.auth.admin.updateUserById(target.id, {
    password: tempPw,
  });
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: "비밀번호 변경 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }

  await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", target.id);

  // 6. audit log 기록
  await admin.from("password_reset_log").insert({
    admin_id: adminUserId,
    admin_username: callerProfile.username,
    target_id: target.id,
    target_username: target.username,
    target_name: target.name,
    reason: body.reason || null,
  });

  return NextResponse.json({
    ok: true,
    target_username: target.username,
    target_name: target.name,
    temp_password: tempPw,
    message: "임시 비밀번호 발급 완료. 사용자에게 전달 후 첫 로그인 시 비밀번호 변경하도록 안내하세요.",
  });
}
