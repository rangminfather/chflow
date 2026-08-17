// R2 스토리지 사용량 집계 — 관리자 이용현황 페이지 전용
// GET /api/admin/r2-usage
// 이 스캔은 목록 호출 몇 번 수준이다. quota는 명시적 환경설정이 있을 때만 반환한다.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { r2Usage } from "@/lib/r2";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    const client = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await client.auth.getUser(token);
    if (!error && data.user) return data.user.id;
  }
  const cookieStore = await cookies();
  const ssrClient = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });
  const { data: { user } } = await ssrClient.auth.getUser();
  return user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const uid = await getAuthUserId(req);
  if (!uid) return new NextResponse(null, { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: profile } = await admin.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (!["admin", "office", "pastor"].includes(profile?.role || "")) {
    return new NextResponse(null, { status: 403 });
  }

  try {
    const usage = await r2Usage();
    const buckets = Object.entries(usage)
      .map(([bucket, u]) => ({ bucket, ...u }))
      .sort((a, b) => b.bytes - a.bytes);
    const totalBytes = buckets.reduce((s, b) => s + b.bytes, 0);
    const configuredQuota = Number(process.env.R2_STORAGE_QUOTA_BYTES);
    const quotaBytes = Number.isSafeInteger(configuredQuota) && configuredQuota > 0
      ? configuredQuota
      : null;
    return NextResponse.json({ totalBytes, buckets, quotaBytes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
