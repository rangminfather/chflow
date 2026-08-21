// 예배 생방송(YouTube Live) 상태 조회 공용 로직.
//
// 감지 우선순위:
//   1) 이미 ON AIR 인 영상 ID를 직접 재검증한다.
//   2) 명성교회 홈페이지가 관리하는 실시간 방송 링크를 읽는다.
//   3) 공개 영상은 uploads 플레이리스트와 제한적인 search.list 로 보완한다.
//
// 교회 방송은 YouTube "미등록"으로 송출되는 경우가 있어 채널 목록/검색만으로는
// 찾을 수 없다. 홈페이지의 실시간 링크가 미등록 영상 ID의 기준 원천이다.
//
// 갱신 방식: Cloudflare Worker가 /api/live/poll 을 매분 호출하고, 사용자 화면은
//   마지막 확인이 1분 이상 오래됐을 때만 보완 갱신한다. 동시 요청이 몰려도
//   조건부 update 로 한 요청만 선점해 외부 서비스를 호출한다.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { detectWorshipSession, worshipStartedTitle } from "../worshipSchedule";
import { umsViaCf } from "../bulletin/ums-via-cf";

export const DEFAULT_CHANNEL_ID = "UCGqoK8XTWHLkyU8Nt-as1og"; // 울산명성교회
/** 이 시간보다 오래된 확인 결과는 갱신 대상 */
export const REFRESH_AFTER_MS = 60 * 1000;
/** 이 시간보다 오래되면 상태를 신뢰하지 않고 '확인 불가'로 안내 */
export const STALE_AFTER_MS = 20 * 60 * 1000;

const RECENT_COUNT = 5;
const SEARCH_INTERVAL_MINUTES = 10;
const UMS_LIVE_PATH = "/libs/real_youtube/ajax_youtube_real_check.php";
const UMS_LIVE_REFERER = "http://www.ums.or.kr/m/mmenu/___blank_pc_main.php";

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

type LiveEvent = {
  event: "live_started" | "live_ended" | "notified" | "notify_skipped" | "error";
  videoId?: string | null;
  sessionKey?: string | null;
  title?: string | null;
  detail?: string | null;
  recipients?: number | null;
};

/** 관리자 확인용 이벤트 기록. 로그 실패가 본 동작을 막지 않도록 조용히 넘긴다. */
export async function logLiveEvent(admin: SupabaseClient, e: LiveEvent): Promise<void> {
  try {
    await admin.from("youtube_live_events").insert({
      event: e.event,
      video_id: e.videoId ?? null,
      session_key: e.sessionKey ?? null,
      title: e.title ?? null,
      detail: e.detail ?? null,
      recipients: e.recipients ?? null,
    });
  } catch {
    // 로그는 부가 기능이다
  }
}

/** 라이브 종료 전환 시 기존 알림 경로를 통해 사용자에게 종료를 안내한다. */
export async function notifyIfLiveEnded(
  admin: SupabaseClient,
  input: { videoId: string | null; title: string | null }
): Promise<{ sent: boolean; recipients: number }> {
  const { data: users } = await admin
    .from("profiles")
    .select("id")
    .eq("status", "active");

  const recipients = users || [];
  if (recipients.length === 0) {
    await logLiveEvent(admin, {
      event: "notify_skipped",
      videoId: input.videoId,
      detail: "라이브 종료 알림 대상자가 없습니다.",
    });
    return { sent: false, recipients: 0 };
  }

  const { error } = await admin.from("notifications").insert(
    recipients.map((user) => ({
      user_id: user.id,
      type: "notice_worship_live_ended",
      title: "예배 생방송이 종료되었습니다",
      body: input.title
        ? `「${input.title}」 방송이 종료되었습니다.`
        : "예배 생방송이 종료되었습니다.",
      link_url: "/live",
      metadata: { video_id: input.videoId, event: "live_ended" },
    }))
  );

  if (error) {
    await logLiveEvent(admin, {
      event: "error",
      videoId: input.videoId,
      detail: `라이브 종료 알림 발송 실패: ${error.message}`,
    });
    return { sent: false, recipients: 0 };
  }

  await logLiveEvent(admin, {
    event: "notified",
    videoId: input.videoId,
    title: "예배 생방송이 종료되었습니다",
    detail: "live_ended",
    recipients: recipients.length,
  });
  return { sent: true, recipients: recipients.length };
}

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

function hasYouTubeOAuthCredentials(): boolean {
  return [
    process.env.YOUTUBE_OAUTH_CLIENT_ID,
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
    process.env.YOUTUBE_OAUTH_REFRESH_TOKEN,
  ].every((value) => typeof value === "string" && value.length > 0);
}

type OAuthTokenResponse = {
  access_token?: string;
  error?: string;
};

type OAuthExchangeResult = {
  ok: boolean;
  status: number;
  accessToken?: string;
  errorCode?: string;
};

async function exchangeYouTubeOAuthToken(): Promise<OAuthExchangeResult> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const json = (await response.json()) as OAuthTokenResponse;
  if (!response.ok || !json.access_token) {
    return {
      ok: false,
      status: response.status,
      errorCode: json.error || `http_${response.status}`,
    };
  }
  return { ok: true, status: response.status, accessToken: json.access_token };
}

async function getYouTubeOAuthAccessToken(): Promise<string> {
  const result = await exchangeYouTubeOAuthToken();
  if (!result.ok || !result.accessToken) {
    throw new Error(`YouTube OAuth token exchange failed (${result.errorCode || `http_${result.status}`})`);
  }
  return result.accessToken;
}

/** 현재 라이브 중인 방송 1건. 없으면 null. */
type FoundLiveVideo = {
  videoId: string;
  title: string | null;
  thumbnailUrl: string | null;
  startedAt: string | null;
};

type LiveBroadcastsResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      channelId?: string;
      title?: string;
      actualStartTime?: string;
      scheduledStartTime?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    status?: { lifeCycleStatus?: string };
  }>;
};

async function findOwnedLiveBroadcasts(accessToken: string): Promise<LiveBroadcastsResponse> {
  const params = new URLSearchParams({
    part: "id,snippet,status,contentDetails",
    mine: "true",
    maxResults: "50",
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const json = (await response.json()) as LiveBroadcastsResponse & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(json.error?.message || `YouTube liveBroadcasts ${response.status}`);
  }
  return json;
}

async function findLiveVideoByOAuth(channelId: string): Promise<FoundLiveVideo | null> {
  if (!hasYouTubeOAuthCredentials()) return null;

  const accessToken = await getYouTubeOAuthAccessToken();
  const broadcasts = await findOwnedLiveBroadcasts(accessToken);

  const live = (broadcasts.items || []).find(
    (item) =>
      item.id &&
      item.snippet?.channelId === channelId &&
      item.status?.lifeCycleStatus === "live"
  );
  if (!live?.id) return null;

  const thumbnails = live.snippet?.thumbnails || {};
  return {
    videoId: live.id,
    title: live.snippet?.title ?? null,
    thumbnailUrl:
      thumbnails.maxres?.url ||
      thumbnails.standard?.url ||
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      null,
    startedAt: live.snippet?.actualStartTime || live.snippet?.scheduledStartTime || null,
  };
}

type SearchResponse = {
  items?: Array<{
    id?: { videoId?: string };
  }>;
};

export function extractYouTubeVideoId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host !== "youtube.com" && host !== "m.youtube.com") return null;

    const watchId = url.searchParams.get("v");
    if (watchId && /^[A-Za-z0-9_-]{11}$/.test(watchId)) return watchId;

    const parts = url.pathname.split("/").filter(Boolean);
    if (["live", "embed", "shorts"].includes(parts[0] || "")) {
      const id = parts[1];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {
    const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?[^#\s]*v=|live\/|embed\/))([A-Za-z0-9_-]{11})/i);
    return match?.[1] ?? null;
  }

  return null;
}

async function findUmsLiveVideoId(): Promise<string | null> {
  const result = await umsViaCf(UMS_LIVE_PATH, {
    referer: UMS_LIVE_REFERER,
    xRequestedWith: "XMLHttpRequest",
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`명성교회 실시간 링크 조회 실패 (${result.status})`);
  }
  return extractYouTubeVideoId(result.body.toString("utf8"));
}

async function findLiveVideoByIds(ids: string[], apiKey: string): Promise<FoundLiveVideo | null> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return null;

  const videos = await fetchJson<VideosResponse>(
    `https://www.googleapis.com/youtube/v3/videos` +
      `?part=snippet,liveStreamingDetails&id=${uniqueIds.join(",")}&key=${apiKey}`
  );
  const live = (videos.items || []).find(
    (video) =>
      video.snippet?.liveBroadcastContent === "live" &&
      !video.liveStreamingDetails?.actualEndTime
  );
  if (!live?.id) return null;

  const thumbnails = live.snippet?.thumbnails || {};
  return {
    videoId: live.id,
    title: live.snippet?.title ?? null,
    thumbnailUrl:
      thumbnails.maxres?.url ||
      thumbnails.standard?.url ||
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      null,
    startedAt: live.liveStreamingDetails?.actualStartTime ?? null,
  };
}

async function findLiveVideoSearch(
  channelId: string,
  apiKey: string
): Promise<FoundLiveVideo | null> {
  const search = await fetchJson<SearchResponse>(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&eventType=live&maxResults=1` +
      `&channelId=${encodeURIComponent(channelId)}&key=${apiKey}`
  );
  const videoId = search.items?.[0]?.id?.videoId;
  return videoId ? findLiveVideoByIds([videoId], apiKey) : null;
}

function shouldUseSearchFallback(now = new Date()): boolean {
  if (!detectWorshipSession(now)) return false;
  return now.getUTCMinutes() % SEARCH_INTERVAL_MINUTES === 0;
}

export async function findLiveVideo(
  channelId: string,
  apiKey: string | null,
  currentVideoId: string | null = null,
  now = new Date()
): Promise<FoundLiveVideo | null> {
  let oauthFailure: Error | null = null;

  if (hasYouTubeOAuthCredentials()) {
    try {
      const oauthLive = await findLiveVideoByOAuth(channelId);
      if (oauthLive) return oauthLive;
    } catch (error) {
      oauthFailure = error instanceof Error ? error : new Error("YouTube OAuth discovery failed");
    }
  }

  // 방송 중인 영상은 채널에서 다시 "발견"하려 하지 않고 ID 자체를 확인한다.
  // 미등록 영상도 ID를 알고 있으면 videos.list 로 방송 종료 여부를 확인할 수 있다.
  if (currentVideoId && apiKey) {
    const current = await findLiveVideoByIds([currentVideoId], apiKey);
    if (current) return current;
  }

  // 명성교회 홈페이지의 실시간 버튼이 미등록 YouTube 주소를 보유한다.
  try {
    const umsVideoId = await findUmsLiveVideoId();
    if (umsVideoId && apiKey) {
      const umsLive = await findLiveVideoByIds([umsVideoId], apiKey);
      if (umsLive) return umsLive;
    }
  } catch {
    // UMS가 일시적으로 응답하지 않아도 공개 YouTube 경로로 계속 확인한다.
  }

  if (apiKey) {
    const playlist = await fetchJson<PlaylistItemsResponse>(
      `https://www.googleapis.com/youtube/v3/playlistItems` +
        `?part=contentDetails&maxResults=${RECENT_COUNT}` +
        `&playlistId=${encodeURIComponent(uploadsPlaylistId(channelId))}&key=${apiKey}`
    );
    const ids = (playlist.items || [])
      .map((i) => i.contentDetails?.videoId)
      .filter((id): id is string => !!id);
    const uploadedLive = await findLiveVideoByIds(ids, apiKey);
    if (uploadedLive) return uploadedLive;
  }

  // search.list 는 100유닛이므로 예배 시간대에 10분마다만 보조적으로 쓴다.
  if (apiKey && shouldUseSearchFallback(now)) {
    const searchedLive = await findLiveVideoSearch(channelId, apiKey);
    if (searchedLive) return searchedLive;
  }

  if (oauthFailure) throw oauthFailure;
  return null;
}

/**
 * 캐시가 오래됐으면 한 요청만 선점해서 갱신한다.
 * @returns 갱신을 수행했는지 (false = 캐시가 신선하거나 다른 요청이 이미 선점)
 */
export async function refreshIfStale(admin: SupabaseClient, force = false): Promise<boolean> {
  const apiKey = process.env.YOUTUBE_API_KEY || null;
  if (!apiKey && !hasYouTubeOAuthCredentials()) return false;

  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - REFRESH_AFTER_MS).toISOString();

  // 선점: checked_at 이 cutoff 보다 오래된 행만 잡는다. 동시 요청 중 하나만 성공한다.
  let claim = admin
    .from("youtube_live_status")
    .update({ checked_at: nowIso })
    .eq("id", "main");
  if (!force) claim = claim.lt("checked_at", cutoff);
  // 이전 상태를 함께 받아 "방송 시작/종료" 전환만 로그로 남긴다
  const { data: claimed, error: claimError } = await claim.select("channel_id, is_live, video_id, title");

  if (claimError || !claimed || claimed.length === 0) return false;

  const channelId = claimed[0].channel_id || DEFAULT_CHANNEL_ID;
  const prev = claimed[0] as { is_live?: boolean; video_id?: string | null; title?: string | null };

  try {
    const currentVideoId = prev.is_live ? prev.video_id ?? null : null;
    const live = await findLiveVideo(channelId, apiKey, currentVideoId);
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

    // 상태가 바뀐 순간만 기록한다 (매분 로그를 쌓지 않기 위해)
    if (live && (!prev.is_live || prev.video_id !== live.videoId)) {
      const session = detectWorshipSession(live.startedAt ? new Date(live.startedAt) : new Date());
      await logLiveEvent(admin, {
        event: "live_started",
        videoId: live.videoId,
        sessionKey: session?.key ?? null,
        title: live.title,
      });
    } else if (!live && prev.is_live) {
      const endedVideoId = prev.video_id ?? null;
      await logLiveEvent(admin, { event: "live_ended", videoId: endedVideoId, title: prev.title ?? null });
      await notifyIfLiveEnded(admin, { videoId: endedVideoId, title: prev.title ?? null });
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "YouTube 조회 실패";
    // 조회 실패 시 is_live 는 건드리지 않는다. 방송 중인데 꺼지면 안 된다.
    await admin
      .from("youtube_live_status")
      .update({ last_error: message, updated_at: nowIso })
      .eq("id", "main");
    await logLiveEvent(admin, { event: "error", detail: message });
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

  const startedAt = row.started_at ? new Date(row.started_at) : new Date();
  const session = detectWorshipSession(startedAt);

  if (row.started_at) {
    const startedMs = startedAt.getTime();
    if (!Number.isNaN(startedMs) && Date.now() - startedMs > NOTIFY_WITHIN_MS) {
      // 오래 전에 시작한 방송이면 알림 없이 발송 기록만 남겨 이후 재검사를 막는다
      await admin
        .from("youtube_live_status")
        .update({ notified_video_id: row.video_id, notified_at: new Date().toISOString() })
        .eq("id", "main");
      const reason = "시작 후 30분 초과 — 알림 생략";
      await logLiveEvent(admin, {
        event: "notify_skipped",
        videoId: row.video_id,
        sessionKey: session?.key ?? null,
        detail: reason,
      });
      return { sent: false, reason };
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

  // 회차를 알면 "주일 3부 예배가 시작되었습니다", 모르면 일반 문구
  const title = worshipStartedTitle(startedAt);
  const body = row.title ? String(row.title) : "지금 예배 생방송을 시청하실 수 있습니다.";

  const { error } = await admin.from("notifications").insert(
    recipients.map((u) => ({
      user_id: u.id,
      type: "notice_worship_live",
      title,
      body,
      link_url: "/live",
      metadata: { video_id: row.video_id, session: session?.key ?? null },
    }))
  );

  if (error) {
    // 발송에 실패했으면 재시도할 수 있게 선점 기록을 되돌린다
    await admin
      .from("youtube_live_status")
      .update({ notified_video_id: null, notified_at: null })
      .eq("id", "main");
    await logLiveEvent(admin, { event: "error", videoId: row.video_id, detail: `알림 저장 실패: ${error.message}` });
    return { sent: false, reason: `알림 저장 실패: ${error.message}` };
  }

  await logLiveEvent(admin, {
    event: "notified",
    videoId: row.video_id,
    sessionKey: session?.key ?? null,
    title,
    recipients: recipients.length,
  });
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
