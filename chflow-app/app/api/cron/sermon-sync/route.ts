// 지난 말씀 목록 동기화 — Vercel Cron(하루 1회) 또는 관리자 수동 호출.
//
// 설교는 주 단위로 올라오니 하루 1회로 충분하다. Vercel Hobby 는 cron 이 하루 1회까지
// 허용되므로 이건 vercel.json 으로 처리할 수 있다(실시간 감지와 달리 외부 스케줄러 불필요).
//
// 계정: UMS_USER_ID/UMS_PASSWORD 환경변수를 우선 쓰고, 없으면 주보 기능이 저장해 둔
// user_ums_credentials 의 계정을 쓴다(둘 다 없으면 건너뛴다).

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/bulletin/creds-crypto";
import { syncSermons } from "@/lib/server/ums-sermons";

export const runtime = "nodejs";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

type StoredCreds = { ums_user_id: string | null; ums_password_encrypted: string | null };

async function resolveCreds(
  admin: SupabaseClient
): Promise<{ userId: string; password: string } | null> {
  if (process.env.UMS_USER_ID && process.env.UMS_PASSWORD) {
    return { userId: process.env.UMS_USER_ID, password: process.env.UMS_PASSWORD };
  }
  // 주보 기능이 저장해 둔 계정을 재사용한다 (가장 최근에 갱신된 것)
  const { data } = await admin
    .from("user_ums_credentials")
    .select("ums_user_id, ums_password_encrypted")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as StoredCreds | null;
  if (!row?.ums_user_id || !row?.ums_password_encrypted) return null;
  try {
    return { userId: row.ums_user_id, password: decryptString(row.ums_password_encrypted) };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const creds = await resolveCreds(admin);
  if (!creds) {
    return NextResponse.json({ ok: true, skipped: "UMS 계정 정보가 없습니다." });
  }

  try {
    const results = await syncSermons(admin, creds);
    const total = results.reduce((n, r) => n + r.saved, 0);
    return NextResponse.json({ ok: true, total, results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "동기화 실패" },
      { status: 502 }
    );
  }
}
