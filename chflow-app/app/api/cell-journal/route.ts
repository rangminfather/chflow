// 해외선교 후원목장 "목장일지" 목록 조회.
//
// GET /api/cell-journal            → 등록 상태 + (있으면) 내 목장 게시글 목록
// GET /api/cell-journal?rediscover=1 → 캐시 무시하고 내 목장 다시 찾기
//
// 인증: Supabase JWT + 본인 members.family_church 가 목자/목녀여야 함 (메뉴는 UI에서만
// 숨겨져 있으므로, 다른 role이 URL을 직접 두드리는 경우까지 막는 서버 쪽 방어선).
// 실제 열람 데이터 경계는 UMS 쪽 계정별 권한이 한 번 더 막아준다 (본인 목장 외엔 로그인해도 거부됨).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/bulletin/creds-crypto";
import { loginUms, listAllCandidates, discoverMyBoard, fetchEntryList, isCellShepherd } from "@/lib/server/ums-cell-journal";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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
  if (!user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (!(await isCellShepherd(admin, user.uid))) {
    return NextResponse.json({ ok: false, error: "목자/목녀만 이용할 수 있습니다." }, { status: 403 });
  }

  const { data: creds, error: credsError } = await admin
    .from("user_ums_credentials")
    .select("ums_user_id, ums_password_encrypted, cell_board_id, cell_board_category, cell_board_label, cell_board_checked_at")
    .eq("user_id", user.uid)
    .maybeSingle();

  if (credsError) return NextResponse.json({ ok: false, error: "조회 중 오류가 발생했습니다." }, { status: 500 });
  if (!creds) return NextResponse.json({ ok: true, has_credentials: false });

  let password: string;
  try {
    password = decryptString(creds.ums_password_encrypted);
  } catch {
    return NextResponse.json({ ok: false, error: "저장된 UMS 비밀번호 복호화에 실패했습니다. 다시 등록해 주세요." }, { status: 500 });
  }

  let cookie: string;
  try {
    cookie = await loginUms(creds.ums_user_id, password);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "UMS 로그인 실패";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  const forceRediscover = req.nextUrl.searchParams.get("rediscover") === "1";
  const checkedAt = creds.cell_board_checked_at ? new Date(creds.cell_board_checked_at).getTime() : 0;
  const staleCache = Date.now() - checkedAt > RECHECK_AFTER_MS;

  let boardId = creds.cell_board_id as string | null;
  let category = creds.cell_board_category as number | null;
  let label = creds.cell_board_label as string | null;

  if (forceRediscover || !checkedAt || (staleCache && !boardId)) {
    const candidates = await listAllCandidates();
    const found = await discoverMyBoard(cookie, candidates);

    boardId = found?.boardId ?? null;
    category = found?.category ?? null;
    label = found?.label ?? null;

    await admin
      .from("user_ums_credentials")
      .update({
        cell_board_id: boardId,
        cell_board_category: category,
        cell_board_label: label,
        cell_board_checked_at: new Date().toISOString(),
      })
      .eq("user_id", user.uid);
  }

  if (!boardId || category == null) {
    return NextResponse.json({ ok: true, has_credentials: true, board: null });
  }

  try {
    const entries = await fetchEntryList(boardId, category, cookie);
    return NextResponse.json({
      ok: true,
      has_credentials: true,
      board: { boardId, category, label },
      entries,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "목장일지 목록을 불러오지 못했습니다.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
