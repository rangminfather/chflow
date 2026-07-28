// 예배 생방송 상태 강제 갱신 — 수동 트리거용.
//
// 주기 갱신은 여기서 하지 않는다. Vercel Hobby 플랜은 cron 을 하루 1회로 제한해
// 방송 시작을 제때 감지할 수 없기 때문이다. 실제 갱신은 사용자가 화면을 열 때
// /api/live/status 가 처리한다(3분 스로틀 + 동시요청 선점).
// 이 라우트는 CRON_SECRET 으로 보호된 수동 확인용으로 남겨둔다.

import { NextRequest, NextResponse } from "next/server";
import { readStatus, refreshIfStale, serviceClient } from "@/lib/server/youtube-live";

export const runtime = "nodejs";
export const maxDuration = 30;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.YOUTUBE_API_KEY) {
    return NextResponse.json({ ok: true, skipped: "YOUTUBE_API_KEY 없음" });
  }

  const admin = serviceClient();
  const refreshed = await refreshIfStale(admin, true);
  const status = await readStatus(admin);
  return NextResponse.json({
    ok: true,
    refreshed,
    is_live: !!status?.is_live,
    video_id: status?.video_id ?? null,
  });
}
