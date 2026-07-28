// 예배 생방송(YouTube Live) 상태 조회 공용 로직.
//
// 쿼터 설계: search.list 는 호출당 100 유닛(일 10,000 = 100회)이라 쓰지 않는다.
//   uploads 플레이리스트 조회(1) → videos.list(1) = 2 유닛/회.
//
// 갱신 방식: Vercel Hobby 플랜은 cron 을 하루 1회로 제한하므로 주기적 폴링을 쓸 수 없다.
//   대신 사용자가 화면을 열 때 서버에서 "마지막 확인이 오래됐으면" 한 번만 갱신한다.
//   동시 요청이 몰려도 조건부 update 로 한 요청만 선점해 YouTube 를 호출한다.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_CHANNEL_ID = "UCGqoK8XTWHLkyU8Nt-as1og"; // 울산명성교회
/** 이 시간보다 오래된 확인 결과는 갱신 대상 */
export const REFRESH_AFTER_MS = 3 * 60 * 1000;
/** 이 시간보다 오래되면 상태를 신뢰하지 않고 '확인 불가'로 안내 */
export const STALE_AFTER_MS = 20 * 60 * 1000;

const RECENT_COUNT = 5;

export type LiveStatusRow = {
  channel_id: string;
  is_live: boolean;
  video_id: string | null;
  title: string | null;
  started_at: string | null;
  checked_at: string | null;
};

type PlaylistItemsResponse = {
  items?: Array<{ contentDetails?: { videoId?: string } }>;
};

type VideosResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      liveBroadcastContent?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string };
  }>;
};

export function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function uploadsPlaylistId(channelId: string): string {
  return channelId.startsWith("UC") ? `UU${channelId.slice(2)}` : channelId;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message || `YouTube API ${res.status}`);
  return json;
}

/** 현재 라이브 중인 방송 1건. 없으면 null. */
export async function findLiveVideo(channelId: string, apiKey: string) {
  const playlist = await fetchJson<PlaylistItemsResponse>(
    `https://www.googleapis.com/youtube/v3/playlistItems` +
      `?part=contentDetails&maxResults=${RECENT_COUNT}` +
      `&playlistId=${encodeURIComponent(uploadsPlaylistId(channelId))}&key=${apiKey}`
  );
  const ids = (playlist.items || [])
    .map((i) => i.contentDetails?.videoId)
    .filter((id): id is string => !!id);
  if (ids.length === 0) return null;

  const videos = await fetchJson<VideosResponse>(
    `https://www.googleapis.com/youtube/v3/videos` +
      `?part=snippet,liveStreamingDetails&id=${ids.join(",")}&key=${apiKey}`
  );
  const live = (videos.items || []).find(
    (v) => v.snippet?.liveBroadcastContent === "live" && !v.liveStreamingDetails?.actualEndTime
  );
  if (!live?.id) return null;

  const t = live.snippet?.thumbnails || {};
  return {
    videoId: live.id,
    title: live.snippet?.title ?? null,
    thumbnailUrl: t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || null,
    startedAt: live.liveStreamingDetails?.actualStartTime ?? null,
  };
}

/**
 * 캐시가 오래됐으면 한 요청만 선점해서 갱신한다.
 * @returns 갱신을 수행했는지 (false = 캐시가 신선하거나 다른 요청이 이미 선점)
 */
export async function refreshIfStale(admin: SupabaseClient, force = false): Promise<boolean> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return false;

  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - REFRESH_AFTER_MS).toISOString();

  // 선점: checked_at 이 cutoff 보다 오래된 행만 잡는다. 동시 요청 중 하나만 성공한다.
  let claim = admin
    .from("youtube_live_status")
    .update({ checked_at: nowIso })
    .eq("id", "main");
  if (!force) claim = claim.lt("checked_at", cutoff);
  const { data: claimed, error: claimError } = await claim.select("channel_id");

  if (claimError || !claimed || claimed.length === 0) return false;

  const channelId = claimed[0].channel_id || DEFAULT_CHANNEL_ID;
  try {
    const live = await findLiveVideo(channelId, apiKey);
    await admin
      .from("youtube_live_status")
      .update({
        is_live: !!live,
        video_id: live?.videoId ?? null,
        title: live?.title ?? null,
        thumbnail_url: live?.thumbnailUrl ?? null,
        started_at: live?.startedAt ?? null,
        last_error: null,
        updated_at: nowIso,
      })
      .eq("id", "main");
    return true;
  } catch (err) {
    // 조회 실패 시 is_live 는 건드리지 않는다. 방송 중인데 꺼지면 안 된다.
    await admin
      .from("youtube_live_status")
      .update({
        last_error: err instanceof Error ? err.message : "YouTube 조회 실패",
        updated_at: nowIso,
      })
      .eq("id", "main");
    return false;
  }
}

export async function readStatus(admin: SupabaseClient): Promise<LiveStatusRow | null> {
  const { data } = await admin
    .from("youtube_live_status")
    .select("channel_id, is_live, video_id, title, started_at, checked_at")
    .eq("id", "main")
    .maybeSingle();
  return (data as LiveStatusRow) ?? null;
}
