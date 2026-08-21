// 예배 생방송 자동 감지 폴러 — Cloudflare Workers Cron 이 1분마다 호출한다.
//
// Vercel Hobby 는 cron 이 하루 1회로 제한되어 자체 폴링을 못 한다. 그래서 외부
// 스케줄러(Cloudflare Worker)가 이 엔드포인트를 두드리고, 여기서 YouTube 를 확인해
// 라이브가 새로 시작됐으면 가입된 전 성도에게 알림을 넣는다.
//
// 워커 스크립트: chflow-app/public/cloudflare-worker-live-poll.js
//
// 쿼터: 1분 간격 = 1,440회/일 × 2유닛 = 2,880유닛/일 (기본 10,000)
//
// 인증: LIVE_POLL_SECRET (없으면 CRON_SECRET) 을 Bearer 로 요구한다.
//   시크릿이 아예 설정돼 있지 않으면 공개 노출을 막기 위해 거부한다.

import { NextRequest, NextResponse } from "next/server";
import {
  notifyIfNewlyLive,
  readStatus,
  refreshIfStale,
  serviceClient,
} from "@/lib/server/youtube-live";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.LIVE_POLL_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "폴러 시크릿이 설정되지 않았습니다." },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = serviceClient();
  // ?dry=1 — 감지까지만 하고 알림은 보내지 않는다 (예배 전 사전 점검용)
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";

  // 외부 폴러는 매분 실행된다. UMS 실시간 링크와 현재 영상 ID를 매번 확인해
  // 미등록 방송도 1분 안에 감지하고, 실제 종료 전에는 OFF로 덮지 않는다.
  const refreshed = await refreshIfStale(admin, true);
  const notify = await notifyIfNewlyLive(admin, { dryRun });
  const status = await readStatus(admin);

  const res = NextResponse.json({
    ok: true,
    refreshed,
    is_live: !!status?.is_live,
    video_id: status?.video_id ?? null,
    notify,
  });
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
