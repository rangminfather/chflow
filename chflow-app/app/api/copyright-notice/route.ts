// 저작권 안내 — 로그인한 성도 누구나 볼 수 있는 공개용 조회 (관리자 제한 없음)
// GET /api/copyright-notice             승인·라이선스 구매 상태 항목 전체
// GET /api/copyright-notice?slug=...    특정 항목 하나 (없으면 items: [])
//
// 관리자 전용 CRUD는 /api/admin/copyright 를 쓴다. 여기는 읽기 전용이고,
// get_public_copyright_notices() RPC가 상태를 approved/licensed로 이미 걸러서 돌려준다.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { fromPublicRow } from "@/lib/copyright";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function callerClient(req: NextRequest) {
  const token = tokenFrom(req);
  if (token) {
    return createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });
}

function apiError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest) {
  const client = await callerClient(req);
  const slug = req.nextUrl.searchParams.get("slug");
  const { data, error } = await client.rpc("get_public_copyright_notices", { p_slug: slug || null });
  if (error) return apiError(error.message, error.message.includes("로그인") ? 401 : 400);
  return NextResponse.json({ ok: true, items: (data ?? []).map(fromPublicRow) });
}
