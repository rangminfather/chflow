// 매일 새벽 4시 실행 (Vercel Cron)
// 1. messenger-attachments 30일 초과 → R2 + DB 삭제
// 2. bulletins 52개 초과 (jubo/dept 각각) → R2 삭제 + pdf_url null
// 5. R2 용량 80% 초과 시 관리자 알림 (DB 스냅샷 cron 은 R2 를 못 보므로 여기서)
// 6. DB 용량 임계치 초과 시 관리자 알림 (quota 가 Vercel 환경변수라 pg_cron 이 못 보므로 여기서)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2, r2Usage } from "@/lib/r2";
import { DB_CAPACITY_THRESHOLDS } from "@/lib/usageDiagnostics";

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

  // ── 4. 구형 .xls 월간계획서 폐기 (2026-06-30 경과 후) ────────────
  // .xls는 주보만들기에만 쓰이고 6/30까지만 보관, 이후 자동 폐기.
  try {
    const now = new Date();
    const cutoff = new Date("2026-07-01T00:00:00+09:00");
    if (now >= cutoff) {
      const { data: keys } = await r2.from("monthly-plans").listAll();
      const xls = (keys ?? []).filter((k) => k.toLowerCase().endsWith(".xls"));
      if (xls.length > 0) {
        await r2.from("monthly-plans").remove(xls);
        results.monthly_xls = `${xls.length}개 폐기`;
      } else {
        results.monthly_xls = "없음";
      }
    } else {
      results.monthly_xls = "보관기간(6/30) 이전";
    }
  } catch (e) {
    results.monthly_xls_error = (e as Error).message;
  }

  // ── 5. R2 용량 감시 — 무료플랜 10GB의 80% 초과 시 관리자 알림 (3일 dedupe) ──
  try {
    const R2_LIMIT = 10 * 1024 * 1024 * 1024;
    const usage = await r2Usage();
    const total = Object.values(usage).reduce((s, u) => s + u.bytes, 0);
    const pct = Math.round((total / R2_LIMIT) * 100);
    if (total > R2_LIMIT * 0.8) {
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await admin
        .from("notifications")
        .select("id")
        .eq("type", "usage_r2_capacity")
        .gt("created_at", since)
        .limit(1);
      if (recent && recent.length > 0) {
        results.r2_watch = `중복 스킵 (${pct}%)`;
      } else {
        const { data: admins } = await admin
          .from("profiles")
          .select("id")
          .in("role", ["admin", "office", "pastor"])
          .eq("status", "active");
        const rows = (admins ?? []).map((a: { id: string }) => ({
          user_id: a.id,
          type: "usage_r2_capacity",
          title: "R2 저장용량 경고",
          body: `R2 저장 ${pct}% — 무료플랜 10GB의 80% 초과. 사진 원본·버킷 정리 확인 필요`,
          link_url: "/admin/usage-status",
        }));
        if (rows.length > 0) await admin.from("notifications").insert(rows);
        results.r2_watch = `알림 발송 (${pct}%)`;
      }
    } else {
      results.r2_watch = `정상 (${(total / R2_LIMIT * 100).toFixed(1)}%)`;
    }
  } catch (e) {
    results.r2_watch_error = (e as Error).message;
  }

  // ── 6. DB 용량 감시 — quota 대비 임계치 초과 시 관리자 알림 (3일 dedupe) ──
  // quota 는 SUPABASE_DB_QUOTA_BYTES(Vercel 환경변수)라 pg_cron 이 볼 수 없다.
  // 그래서 DB 이상감지(admin_usage_check_anomalies)가 아니라 여기서 판정한다.
  // 임계치는 lib/usageDiagnostics 의 DB_CAPACITY_THRESHOLDS.warn 과 공유한다.
  try {
    const configured = Number(process.env.SUPABASE_DB_QUOTA_BYTES);
    const quota = Number.isSafeInteger(configured) && configured > 0 ? configured : null;
    if (!quota) {
      // 조용히 "정상"으로 넘기지 않는다. 관리자 이용현황 화면에도 DB_QUOTA_UNSET 으로 표시된다.
      results.db_watch = "quota 미설정 — 판정 불가 (SUPABASE_DB_QUOTA_BYTES)";
    } else {
      const { data: snap } = await admin
        .from("admin_usage_snapshots")
        .select("snap_date, db_size_bytes")
        .order("snap_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const dbBytes = (snap as { db_size_bytes: number } | null)?.db_size_bytes ?? null;
      if (dbBytes === null) {
        results.db_watch = "스냅샷 없음 — 판정 불가";
      } else {
        const pct = Math.round((dbBytes / quota) * 100);
        if (pct < DB_CAPACITY_THRESHOLDS.warn) {
          results.db_watch = `정상 (${pct}%)`;
        } else {
          const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
          const { data: recent } = await admin
            .from("notifications")
            .select("id")
            .eq("type", "usage_db_capacity")
            .gt("created_at", since)
            .limit(1);
          if (recent && recent.length > 0) {
            results.db_watch = `중복 스킵 (${pct}%)`;
          } else {
            const { data: admins } = await admin
              .from("profiles")
              .select("id")
              .in("role", ["admin", "office", "pastor"])
              .eq("status", "active");
            const rows = (admins ?? []).map((a: { id: string }) => ({
              user_id: a.id,
              type: "usage_db_capacity",
              title: "DB 저장용량 경고",
              body: `DB ${pct}% — 설정된 quota의 ${DB_CAPACITY_THRESHOLDS.warn}% 초과. 테이블 증가·보존기간 확인 필요`,
              link_url: "/admin/usage-status",
            }));
            if (rows.length > 0) await admin.from("notifications").insert(rows);
            results.db_watch = `알림 발송 (${pct}%)`;
          }
        }
      }
    }
  } catch (e) {
    results.db_watch_error = (e as Error).message;
  }

  return NextResponse.json({ ok: true, ...results });
}
