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

/** 방송 시작 후 이 시간이 지난 뒤 처음 감지된 방송은 알림을 보내지 않는다.
 *  (폴러가 멈췄다 재개된 경우 한참 전에 시작한 예배로 "지금 시작" 알림이 가면 안 됨) */
export const NOTIFY_WITHIN_MS = 30 * 60 * 1000;

export type NotifyResult =
  | { sent: false; reason: string; wouldNotify?: number }
  | { sent: true; videoId: string; recipients: number };

/**
 * 새로 시작된 라이브를 감지하면 가입된 전 성도에게 알림을 넣는다.
 *
 * 중복 방지: notified_video_id 를 조건부로 갱신해 선점한 호출만 발송한다.
 * 1분 간격 폴러가 여러 번 겹쳐 돌아도 한 방송당 한 번만 나간다.
 * 알림 행이 들어가면 기존 트리거가 푸시 배달을 만들고 웹훅이 Expo 로 보낸다.
 */
export async function notifyIfNewlyLive(
  admin: SupabaseClient,
  opts: { dryRun?: boolean } = {}
): Promise<NotifyResult> {
  const { data: row } = await admin
    .from("youtube_live_status")
    .select("is_live, video_id, title, started_at, notified_video_id")
    .eq("id", "main")
    .maybeSingle();

  if (!row?.is_live || !row.video_id) return { sent: false, reason: "방송 중 아님" };
  if (row.notified_video_id === row.video_id) return { sent: false, reason: "이미 발송한 방송" };

  if (row.started_at) {
    const startedMs = new Date(row.started_at).getTime();
    if (!Number.isNaN(startedMs) && Date.now() - startedMs > NOTIFY_WITHIN_MS) {
      // 오래 전에 시작한 방송이면 알림 없이 발송 기록만 남겨 이후 재검사를 막는다
      await admin
        .from("youtube_live_status")
        .update({ notified_video_id: row.video_id, notified_at: new Date().toISOString() })
        .eq("id", "main");
      return { sent: false, reason: "시작 후 30분 초과 — 알림 생략" };
    }
  }

  // 점검용: 실제 발송 없이 대상자 수만 계산한다 (예배 전 사전 확인·검증용)
  if (opts.dryRun) {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    return { sent: false, reason: "dryRun — 실제 발송 안 함", wouldNotify: count ?? 0 };
  }

  // 선점: notified_video_id 가 아직 이 방송이 아닌 행만 잡는다
  const { data: claimed } = await admin
    .from("youtube_live_status")
    .update({ notified_video_id: row.video_id, notified_at: new Date().toISOString() })
    .eq("id", "main")
    .or(`notified_video_id.is.null,notified_video_id.neq.${row.video_id}`)
    .select("id");

  if (!claimed || claimed.length === 0) return { sent: false, reason: "다른 호출이 이미 선점" };

  const { data: users } = await admin
    .from("profiles")
    .select("id")
    .eq("status", "active");

  const recipients = users || [];
  if (recipients.length === 0) return { sent: false, reason: "대상자 없음" };

  const title = "예배 생방송이 시작되었습니다";
  const body = row.title ? String(row.title) : "지금 예배 생방송을 시청하실 수 있습니다.";

  const { error } = await admin.from("notifications").insert(
    recipients.map((u) => ({
      user_id: u.id,
      type: "notice_worship_live",
      title,
      body,
      link_url: "/live",
      metadata: { video_id: row.video_id },
    }))
  );

  if (error) {
    // 발송에 실패했으면 재시도할 수 있게 선점 기록을 되돌린다
    await admin
      .from("youtube_live_status")
      .update({ notified_video_id: null, notified_at: null })
      .eq("id", "main");
    return { sent: false, reason: `알림 저장 실패: ${error.message}` };
  }

  return { sent: true, videoId: row.video_id, recipients: recipients.length };
}

export async function readStatus(admin: SupabaseClient): Promise<LiveStatusRow | null> {
  const { data } = await admin
    .from("youtube_live_status")
    .select("channel_id, is_live, video_id, title, started_at, checked_at")
    .eq("id", "main")
    .maybeSingle();
  return (data as LiveStatusRow) ?? null;
}
