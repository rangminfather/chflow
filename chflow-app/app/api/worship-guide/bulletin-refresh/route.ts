import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncJuboBulletin } from "@/lib/bulletin/jubo-sync";
import { syncDeptBulletin } from "@/lib/bulletin/dept-bulletin-sync";

// 예배안내 메뉴에서 주보(교회주보·초등1부 주보)가 아직 수집 안 됐을 때
// 사용자(전도사·부장)가 수집을 1회 트리거하는 엔드포인트.
// 실제 수집 로직은 cron 과 동일한 lib 를 공유하며, in-flight 잠금 + already_fetched
// 가드가 있어 중복 수집되지 않는다. 인스턴스당 10분 스로틀로 UMS 트래픽을 제한한다.

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const THROTTLE_MS = 10 * 60 * 1000;

const lastRun: Record<string, number> = {};

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function POST(req: NextRequest) {
  const token = tokenFrom(req);
  if (!token) return NextResponse.json({ ok: false, error: "로그인이 필요합니다" }, { status: 401 });

  let body: { dept_id?: string; targets?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }
  const deptId = body.dept_id;
  if (!deptId) return NextResponse.json({ ok: false, error: "dept_id가 필요합니다" }, { status: 400 });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) {
    return NextResponse.json({ ok: false, error: "로그인이 만료되었습니다" }, { status: 401 });
  }
  const { data: allowed } = await userClient.rpc("dept_mgmt_grade_ok", {
    p_dept_id: deptId,
    p_menu_key: "dept/worship-guide",
  });
  if (allowed !== true) {
    return NextResponse.json({ ok: false, error: "예배안내 접근 권한이 없습니다" }, { status: 403 });
  }

  const targets = (body.targets || ["church", "dept"]).filter((t) => t === "church" || t === "dept");
  const now = Date.now();
  const results: Record<string, { ok: boolean; skipped?: boolean; reason?: string; error?: string }> = {};

  await Promise.all(targets.map(async (target) => {
    if (now - (lastRun[target] || 0) < THROTTLE_MS) {
      results[target] = { ok: true, skipped: true, reason: "throttled" };
      return;
    }
    lastRun[target] = now;
    try {
      const r = target === "church" ? await syncJuboBulletin() : await syncDeptBulletin();
      results[target] = { ok: r.ok !== false, skipped: r.skipped, reason: r.reason };
    } catch (e) {
      results[target] = { ok: false, error: e instanceof Error ? e.message : "수집 실패" };
    }
  }));

  return NextResponse.json({ ok: true, results });
}
