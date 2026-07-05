// 새친구 '등반예정' 사전알림 (주말 푸시)
// Vercel Cron: 토 09시·토 17시·일 09시 (KST). vercel.json 에 UTC 로 등록.
//   - 토 09 KST = 토 00:00 UTC ("0 0 * * 6")
//   - 토 17 KST = 토 08:00 UTC ("0 8 * * 6")
//   - 일 09 KST = 일 00:00 UTC ("0 0 * * 0")
// slot/week 은 현재 KST 시각에서 계산. 발송 후 push-dispatch 를 호출해 즉시 큐 처리.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET;

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 현재 KST 시각으로 slot/week(해당 주 토요일 날짜) 계산
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0=일 .. 6=토
  const hour = kst.getUTCHours();
  const url = new URL(req.url);
  let slot = url.searchParams.get("slot"); // 수동 호출 시 강제 지정 허용
  const weekSat = new Date(kst);

  if (!slot) {
    if (day === 6) slot = hour < 12 ? "sat_am" : "sat_pm";
    else if (day === 0) slot = "sun_am";
  }
  if (slot === "sun_am") weekSat.setUTCDate(weekSat.getUTCDate() - 1); // 그 주 토요일

  if (!slot) {
    return NextResponse.json({ ok: true, skipped: "not a weekend alert slot (KST)", kst: kst.toISOString() });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let sent = 0;
  let emitError: string | null = null;
  try {
    const { data, error } = await admin.rpc("edu_emit_promotion_upcoming", {
      p_slot: slot,
      p_week: ymd(weekSat),
    });
    if (error) emitError = error.message;
    else sent = (data as number) ?? 0;
  } catch (e) {
    emitError = (e as Error).message;
  }

  // 장기 미출석 알림 — 주 1회 (토요일 오전 슬롯). 장기결석 처리 학생은 제외됨.
  let absenceSent = 0;
  let absenceError: string | null = null;
  if (slot === "sat_am") {
    try {
      const { data, error } = await admin.rpc("edu_emit_absence_alerts", { p_week: ymd(weekSat) });
      if (error) absenceError = error.message;
      else absenceSent = (data as number) ?? 0;
    } catch (e) {
      absenceError = (e as Error).message;
    }
  }

  // 큐에 쌓인 푸시 즉시 발송 (best-effort)
  let dispatch: unknown = null;
  try {
    const origin = url.origin;
    const res = await fetch(`${origin}/api/mobile/push-dispatch?limit=200`, {
      headers: auth ? { authorization: auth } : {},
    });
    dispatch = await res.json().catch(() => null);
  } catch (e) {
    dispatch = { error: (e as Error).message };
  }

  return NextResponse.json({ ok: !emitError && !absenceError, slot, week: ymd(weekSat), sent, absenceSent, emitError, absenceError, dispatch });
}
