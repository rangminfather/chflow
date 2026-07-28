// 예배 생방송 상태 조회 (로그인 사용자용).
//
// Vercel Hobby 는 cron 을 하루 1회로 제한하므로 주기 폴링을 못 쓴다.
// 대신 이 라우트가 호출될 때 캐시가 3분 이상 오래됐으면 서버에서 한 번만 갱신한다.
// 동시 요청은 조건부 update 로 한 건만 선점하므로 YouTube 호출이 늘어나지 않는다.
// 최악의 경우 3분당 1회 = 480회/일 × 2유닛 = 960유닛/일 (기본 쿼터 10,000).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readStatus, refreshIfStale, serviceClient, STALE_AFTER_MS } from "@/lib/server/youtube-live";

export const runtime = "nodejs";

async function requireUser(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data, error } = await anon.auth.getUser(token);
  return !error && !!data.user;
}

export async function GET(req: NextRequest) {
  if (!(await requireUser(req))) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = serviceClient();
  await refreshIfStale(admin);
  const status = await readStatus(admin);

  const checkedMs = status?.checked_at ? new Date(status.checked_at).getTime() : NaN;
  const stale = !status || Number.isNaN(checkedMs) || Date.now() - checkedMs > STALE_AFTER_MS;

  const res = NextResponse.json({
    ok: true,
    is_live: !!status?.is_live && !!status?.video_id,
    video_id: status?.video_id ?? null,
    title: status?.title ?? null,
    started_at: status?.started_at ?? null,
    channel_id: status?.channel_id ?? null,
    checked_at: status?.checked_at ?? null,
    stale,
  });
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
