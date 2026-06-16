// 매일 새벽 4시 실행 (Vercel Cron)
// 1. messenger-attachments 30일 초과 → R2 + DB 삭제
// 2. bulletins 52개 초과 (jubo/dept 각각) → R2 삭제 + pdf_url null

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2 } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const results: Record<string, unknown> = {};

  // ── 1. 메신저 첨부파일 30일 이상 된 것 삭제 ──────────────────────
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: old } = await admin
      .from("messenger_message_attachments")
      .select("id, file_path")
      .lt("created_at", cutoff);

    if (old && old.length > 0) {
      const paths = old.map((r: { file_path: string }) => r.file_path);
      await r2.from("messenger-attachments").remove(paths);
      const ids = old.map((r: { id: string }) => r.id);
      await admin.from("messenger_message_attachments").delete().in("id", ids);
      results.messenger = `${old.length}개 삭제`;
    } else {
      results.messenger = "없음";
    }
  } catch (e) {
    results.messenger_error = (e as Error).message;
  }

  // ── 2. 주보(jubo) — 최근 52개 초과분 R2 삭제 + pdf_url null ──────
  try {
    const { data: juboAll } = await admin
      .from("bulletins")
      .select("id, pdf_url")
      .not("pdf_url", "is", null)
      .ilike("pdf_url", "jubo/%")
      .order("sunday_date", { ascending: false });

    const juboOld = (juboAll ?? []).slice(52);
    if (juboOld.length > 0) {
      const paths = juboOld.map((r: { pdf_url: string }) => r.pdf_url);
      await r2.from("bulletins").remove(paths);
      const ids = juboOld.map((r: { id: string }) => r.id);
      await admin.from("bulletins").update({ pdf_url: null }).in("id", ids);
      results.jubo = `${juboOld.length}개 정리`;
    } else {
      results.jubo = "없음";
    }
  } catch (e) {
    results.jubo_error = (e as Error).message;
  }

  // ── 3. 부서 주보(dept) — 최근 52개 초과분 R2 삭제 + pdf_url null ──
  try {
    const { data: deptAll } = await admin
      .from("bulletins")
      .select("id, pdf_url")
      .not("pdf_url", "is", null)
      .ilike("pdf_url", "dept/%")
      .order("sunday_date", { ascending: false });

    const deptOld = (deptAll ?? []).slice(52);
    if (deptOld.length > 0) {
      const paths = deptOld.map((r: { pdf_url: string }) => r.pdf_url);
      await r2.from("bulletins").remove(paths);
      const ids = deptOld.map((r: { id: string }) => r.id);
      await admin.from("bulletins").update({ pdf_url: null }).in("id", ids);
      results.dept_bulletin = `${deptOld.length}개 정리`;
    } else {
      results.dept_bulletin = "없음";
    }
  } catch (e) {
    results.dept_error = (e as Error).message;
  }

  return NextResponse.json({ ok: true, ...results });
}
