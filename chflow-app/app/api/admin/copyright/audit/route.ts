// 저작권 등록대장 — 등록·수정·삭제 이력 조회 (관리자 전용, 읽기 전용)
// GET /api/admin/copyright/audit             전체 이력 (최근 300건)
// GET /api/admin/copyright/audit?item_id=... 특정 항목 이력만

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { fromAuditRow } from "@/lib/copyright";

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

function statusFromRpcError(message: string): number {
  if (message.includes("로그인")) return 401;
  if (message.includes("권한")) return 403;
  return 400;
}

export async function GET(req: NextRequest) {
  const client = await callerClient(req);
  const itemId = req.nextUrl.searchParams.get("item_id");
  const { data, error } = await client.rpc("get_copyright_audit_log", { p_item_id: itemId || null });
  if (error) return apiError(error.message, statusFromRpcError(error.message));
  return NextResponse.json({ ok: true, entries: (data ?? []).map(fromAuditRow) });
}
