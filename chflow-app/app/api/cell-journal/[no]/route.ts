// 해외선교 후원목장 "목장일지" 상세 조회.
// GET /api/cell-journal/[no] — 캐싱된 내 목장(board) 기준 상세 1건.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/bulletin/creds-crypto";
import { loginUms, fetchEntryDetail, isCellShepherd } from "@/lib/server/ums-cell-journal";

export const runtime = "nodejs";
export const maxDuration = 30;

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  const { no: noParam } = await params;
  const no = parseInt(noParam, 10);
  if (!Number.isFinite(no)) return NextResponse.json({ ok: false, error: "잘못된 글 번호입니다." }, { status: 400 });

  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (!(await isCellShepherd(admin, user.uid))) {
    return NextResponse.json({ ok: false, error: "목자/목녀만 이용할 수 있습니다." }, { status: 403 });
  }

  const { data: creds, error: credsError } = await admin
    .from("user_ums_credentials")
    .select("ums_user_id, ums_password_encrypted, cell_board_id, cell_board_category")
    .eq("user_id", user.uid)
    .maybeSingle();

  if (credsError || !creds) return NextResponse.json({ ok: false, error: "UMS 계정이 등록되어 있지 않습니다." }, { status: 404 });
  if (!creds.cell_board_id || creds.cell_board_category == null) {
    return NextResponse.json({ ok: false, error: "연동된 목장일지 게시판이 없습니다." }, { status: 404 });
  }

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

  try {
    const detail = await fetchEntryDetail(creds.cell_board_id, creds.cell_board_category, no, cookie);
    if ("denied" in detail) {
      return NextResponse.json({ ok: false, error: "이 글을 열람할 권한이 없습니다." }, { status: 403 });
    }
    return NextResponse.json({ ok: true, entry: detail });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "목장일지를 불러오지 못했습니다.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
