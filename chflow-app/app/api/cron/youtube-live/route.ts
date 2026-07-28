// 예배 생방송(YouTube Live) 상태 갱신 — Vercel Cron
//
// 쿼터 설계: search.list 는 호출당 100 유닛(일 10,000 = 100회)이라 쓰지 않는다.
//   uploads 플레이리스트 조회(1 유닛) → videos.list(1 유닛) = 2 유닛/회.
//   5분 간격(288회/일)이면 576 유닛/일로 여유가 크다.
//
// 채널의 uploads 플레이리스트 ID 는 채널 ID 의 접두사 UC → UU 로 바꾼 값이다.
// 라이브 방송도 uploads 에 올라오므로 최근 몇 건만 확인하면 된다.
//
// YOUTUBE_API_KEY 가 없으면 아무것도 하지 않고 skipped 를 반환한다(장애 아님).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const DEFAULT_CHANNEL_ID = "UCGqoK8XTWHLkyU8Nt-as1og"; // 울산명성교회
const RECENT_COUNT = 5;

type PlaylistItemsResponse = {
  items?: Array<{ contentDetails?: { videoId?: string } }>;
  error?: { message?: string };
};

type VideosResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      liveBroadcastContent?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    liveStreamingDetails?: {
      actualStartTime?: string;
      actualEndTime?: string;
    };
  }>;
  error?: { message?: string };
};

function uploadsPlaylistId(channelId: string): string {
  return channelId.startsWith("UC") ? `UU${channelId.slice(2)}` : channelId;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json?.error?.message || `YouTube API ${res.status}`);
  }
  return json;
}

/** 현재 라이브 중인 방송 1건을 찾는다. 없으면 null. */
async function findLiveVideo(channelId: string) {
  const playlistUrl =
    `https://www.googleapis.com/youtube/v3/playlistItems` +
    `?part=contentDetails&maxResults=${RECENT_COUNT}` +
    `&playlistId=${encodeURIComponent(uploadsPlaylistId(channelId))}` +
    `&key=${YOUTUBE_API_KEY}`;

  const playlist = await fetchJson<PlaylistItemsResponse>(playlistUrl);
  const ids = (playlist.items || [])
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => !!id);

  if (ids.length === 0) return null;

  const videosUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,liveStreamingDetails&id=${ids.join(",")}` +
    `&key=${YOUTUBE_API_KEY}`;

  const videos = await fetchJson<VideosResponse>(videosUrl);
  const live = (videos.items || []).find(
    (v) => v.snippet?.liveBroadcastContent === "live" && !v.liveStreamingDetails?.actualEndTime
  );
  if (!live?.id) return null;

  const thumbs = live.snippet?.thumbnails || {};
  const thumbnail =
    thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || null;

  return {
    videoId: live.id,
    title: live.snippet?.title ?? null,
    thumbnailUrl: thumbnail,
    startedAt: live.liveStreamingDetails?.actualStartTime ?? null,
  };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: row } = await admin
    .from("youtube_live_status")
    .select("channel_id")
    .eq("id", "main")
    .maybeSingle();
  const channelId = row?.channel_id || DEFAULT_CHANNEL_ID;
  const now = new Date().toISOString();

  // 키가 없으면 상태를 건드리지 않는다. 켜기 전 배포에서 false 로 덮어쓰지 않도록.
  if (!YOUTUBE_API_KEY) {
    return NextResponse.json({ ok: true, skipped: "YOUTUBE_API_KEY 없음" });
  }

  try {
    const live = await findLiveVideo(channelId);
    await admin
      .from("youtube_live_status")
      .upsert({
        id: "main",
        channel_id: channelId,
        is_live: !!live,
        video_id: live?.videoId ?? null,
        title: live?.title ?? null,
        thumbnail_url: live?.thumbnailUrl ?? null,
        started_at: live?.startedAt ?? null,
        checked_at: now,
        last_error: null,
        updated_at: now,
      });

    return NextResponse.json({ ok: true, is_live: !!live, video_id: live?.videoId ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "YouTube 조회 실패";
    // 조회 실패 시 is_live 는 건드리지 않는다. 일시적 오류로 방송 중 배지가 꺼지면 안 된다.
    await admin
      .from("youtube_live_status")
      .update({ checked_at: now, last_error: message, updated_at: now })
      .eq("id", "main");
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
