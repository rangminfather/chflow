import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { umsViaCf } from "../bulletin/ums-via-cf";
import {
  extractYouTubeVideoId,
  findLiveVideo,
  notifyIfLiveEnded,
  notifyIfNewlyLive,
  refreshIfStale,
} from "./youtube-live";
import { worshipStartedTitle } from "../worshipSchedule";

vi.mock("../bulletin/ums-via-cf", () => ({
  umsViaCf: vi.fn(),
}));

const umsResult = (body: string) => ({
  status: 200,
  body: Buffer.from(body, "utf8"),
  setCookies: [],
  location: null,
  contentType: "text/html",
});

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
}) as Response;

/** OAuth 환경변수 3개를 함께 세팅하고, 반환된 함수로 원래 값(없었으면 없는 상태)까지 되돌린다.
 *  하나만 복원하면 뒤에 도는 테스트가 남은 값의 영향을 받는다. */
function stubOAuthEnv(refreshToken: string) {
  const previous = {
    YOUTUBE_OAUTH_CLIENT_ID: process.env.YOUTUBE_OAUTH_CLIENT_ID,
    YOUTUBE_OAUTH_CLIENT_SECRET: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
    YOUTUBE_OAUTH_REFRESH_TOKEN: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN,
  };
  process.env.YOUTUBE_OAUTH_CLIENT_ID = "oauth-client-id";
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "oauth-client-secret";
  process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = refreshToken;
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

type MockCall = {
  table: string;
  op: "select" | "insert" | "update" | "upsert";
  payload?: unknown;
  filters: Array<{ kind: string; column: string; value: unknown }>;
  single: boolean;
};

/** PostgREST 체이닝을 흉내내는 최소 목. 각 호출을 기록하고, 결과는 resolve 로 결정한다. */
function mockSupabase(
  resolve: (call: MockCall) => { data?: unknown; error?: unknown; count?: number },
  calls: MockCall[] = []
) {
  const client = {
    from(table: string) {
      const make = (op: MockCall["op"], payload?: unknown) => {
        const call: MockCall = { table, op, payload, filters: [], single: false };
        const builder: Record<string, unknown> = {};
        const chain = (kind: string) => (column: string, value?: unknown) => {
          call.filters.push({ kind, column, value });
          return builder;
        };
        for (const kind of ["eq", "neq", "lt", "gte", "lte", "in", "is", "order", "limit"]) {
          builder[kind] = chain(kind);
        }
        builder.or = (expr: string) => {
          call.filters.push({ kind: "or", column: expr, value: null });
          return builder;
        };
        builder.select = () => builder;
        builder.maybeSingle = () => {
          call.single = true;
          return builder;
        };
        builder.single = builder.maybeSingle;
        builder.then = (onFulfilled: (value: unknown) => unknown) => {
          calls.push(call);
          const result = resolve(call);
          const data = result.data ?? null;
          const value = call.single
            ? { data: Array.isArray(data) ? (data[0] ?? null) : data, error: result.error ?? null }
            : { data, error: result.error ?? null, count: result.count };
          return Promise.resolve(onFulfilled(value));
        };
        return builder;
      };
      return {
        select: () => make("select"),
        insert: (payload: unknown) => make("insert", payload),
        update: (payload: unknown) => make("update", payload),
        upsert: (payload: unknown) => make("upsert", payload),
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const activeProfiles = [{ id: "user-a" }, { id: "user-b" }];

describe("YouTube live detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts IDs from the link formats used by YouTube live pages", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/live/kvIN5H19z20")).toBe("kvIN5H19z20");
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=kvIN5H19z20")).toBe("kvIN5H19z20");
    expect(extractYouTubeVideoId("https://youtu.be/kvIN5H19z20?t=10")).toBe("kvIN5H19z20");
    expect(extractYouTubeVideoId("https://example.com/watch?v=kvIN5H19z20")).toBeNull();
  });

  it("detects an unlisted live video from the church website link", async () => {
    vi.mocked(umsViaCf).mockResolvedValue(
      umsResult("https://www.youtube.com/live/kvIN5H19z20")
    );
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("/youtube/v3/videos");
      expect(url).toContain("id=kvIN5H19z20");
      return jsonResponse({
        items: [{
          id: "kvIN5H19z20",
          snippet: {
            title: "2026년 07월 29일 수요 2부 예배 실시간",
            liveBroadcastContent: "live",
            thumbnails: { high: { url: "https://i.ytimg.com/live.jpg" } },
          },
          liveStreamingDetails: { actualStartTime: "2026-07-29T10:15:03Z" },
        }],
      });
    }));

    await expect(findLiveVideo("channel", "api-key")).resolves.toEqual({
      videoId: "kvIN5H19z20",
      title: "2026년 07월 29일 수요 2부 예배 실시간",
      thumbnailUrl: "https://i.ytimg.com/live.jpg",
      startedAt: "2026-07-29T10:15:03Z",
    });
  });

  it("rechecks the current video ID before attempting channel discovery", async () => {
    vi.mocked(umsViaCf).mockRejectedValue(new Error("UMS should not be called"));
    const fetchMock = vi.fn(async () => jsonResponse({
      items: [{
        id: "kvIN5H19z20",
        snippet: { title: "미등록 생방송", liveBroadcastContent: "live" },
        liveStreamingDetails: { actualStartTime: "2026-07-29T10:15:03Z" },
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const live = await findLiveVideo("channel", "api-key", "kvIN5H19z20");

    expect(live?.videoId).toBe("kvIN5H19z20");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(umsViaCf).not.toHaveBeenCalled();
  });

  it("uses authenticated liveBroadcasts for an unlisted live stream", async () => {
    const previous = {
      clientId: process.env.YOUTUBE_OAUTH_CLIENT_ID,
      clientSecret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
      refreshToken: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN,
    };
    process.env.YOUTUBE_OAUTH_CLIENT_ID = "oauth-client-id";
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "oauth-client-secret";
    process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = "oauth-refresh-token";

    try {
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          expect(init?.method).toBe("POST");
          return jsonResponse({ access_token: "access-token-for-test-only" });
        }

        const parsed = new URL(url);
        expect(parsed.pathname).toBe("/youtube/v3/liveBroadcasts");
        expect(parsed.searchParams.get("part")).toBe("id,snippet,status,contentDetails");
        expect(parsed.searchParams.get("mine")).toBe("true");
        expect(parsed.searchParams.get("broadcastStatus")).toBeNull();
        expect(init?.headers).toEqual({ authorization: "Bearer access-token-for-test-only" });
        return jsonResponse({
          items: [{
            id: "kvIN5H19z20",
            snippet: {
              channelId: "channel",
              title: "미등록 예배 라이브",
              actualStartTime: "2026-08-04T07:00:00Z",
              thumbnails: { high: { url: "https://i.ytimg.com/live.jpg" } },
            },
            status: { lifeCycleStatus: "live" },
          }],
        });
      }));

      await expect(findLiveVideo("channel", null)).resolves.toEqual({
        videoId: "kvIN5H19z20",
        title: "미등록 예배 라이브",
        thumbnailUrl: "https://i.ytimg.com/live.jpg",
        startedAt: "2026-08-04T07:00:00Z",
      });
      expect(umsViaCf).not.toHaveBeenCalled();
    } finally {
      if (previous.clientId === undefined) delete process.env.YOUTUBE_OAUTH_CLIENT_ID;
      else process.env.YOUTUBE_OAUTH_CLIENT_ID = previous.clientId;
      if (previous.clientSecret === undefined) delete process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
      else process.env.YOUTUBE_OAUTH_CLIENT_SECRET = previous.clientSecret;
      if (previous.refreshToken === undefined) delete process.env.YOUTUBE_OAUTH_REFRESH_TOKEN;
      else process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = previous.refreshToken;
    }
  });

  // 2026-08-23 주일 4부: OAuth 토큰이 무효(invalid_grant)가 되자 방송이 끝났는데도 조회 실패로
  // 처리되어 종료 감지·종료 알림이 통째로 막혔다. 공개 API 키로 확인이 되면 종료로 판정해야 한다.
  it("treats a finished broadcast as ended even when OAuth refresh is broken", async () => {
    const restore = stubOAuthEnv("revoked-refresh-token");
    try {
      vi.mocked(umsViaCf).mockResolvedValue(umsResult("실시간 링크 없음"));
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) } as Response;
        }
        // 공개 경로는 정상 응답하고 "라이브 없음"을 알려준다
        return jsonResponse({ items: [] });
      }));

      const diag: { oauthError?: string } = {};
      await expect(
        findLiveVideo("channel", "api-key", "snjm2XZnecc", new Date(), diag)
      ).resolves.toBeNull();
      // OAuth 실패는 삼키지 않고 호출부(관리자 화면)로 전달한다
      expect(diag.oauthError).toContain("invalid_grant");
    } finally {
      restore();
    }
  });

  // OAuth 도 깨졌고 공개 API 키도 없으면 "종료"라고 단정할 수 없다 — 기존대로 실패로 올린다.
  it("still reports failure when neither OAuth nor an API key can confirm the state", async () => {
    const restore = stubOAuthEnv("revoked-refresh-token");
    try {
      vi.mocked(umsViaCf).mockResolvedValue(umsResult("실시간 링크 없음"));
      vi.stubGlobal("fetch", vi.fn(async () => (
        { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) } as Response
      )));
      await expect(findLiveVideo("channel", null)).rejects.toThrow("invalid_grant");
    } finally {
      restore();
    }
  });

  // API 키 조회 자체가 실패하면(쿼터·네트워크) 라이브 없음이 확인된 게 아니다 — 실패로 남아야 한다.
  it("still reports failure when the public API key lookup itself fails", async () => {
    const restore = stubOAuthEnv("revoked-refresh-token");
    try {
      vi.mocked(umsViaCf).mockResolvedValue(umsResult("실시간 링크 없음"));
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
        if (String(input) === "https://oauth2.googleapis.com/token") {
          return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) } as Response;
        }
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { message: "quotaExceeded" } }),
        } as Response;
      }));
      await expect(findLiveVideo("channel", "api-key", "snjm2XZnecc")).rejects.toThrow("quotaExceeded");
    } finally {
      restore();
    }
  });

  it("creates a user notification when a live broadcast ends", async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const events: Array<Record<string, unknown>> = [];
    const admin = {
      from(table: string) {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: async () => ({ data: [{ id: "user-a" }, { id: "user-b" }], error: null }),
            }),
          };
        }
        if (table === "notifications") {
          return {
            insert: async (rows: Array<Record<string, unknown>>) => {
              notifications.push(...rows);
              return { error: null };
            },
          };
        }
        if (table === "youtube_live_events") {
          return {
            insert: async (row: Record<string, unknown>) => {
              events.push(row);
              return { error: null };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    await expect(notifyIfLiveEnded(admin, {
      videoId: "kvIN5H19z20",
      title: "주일 3부 예배",
    })).resolves.toEqual({ sent: true, recipients: 2 });

    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({
      user_id: "user-a",
      type: "notice_worship_live_ended",
      title: "예배 생방송이 종료되었습니다",
      body: "「주일 3부 예배」 방송이 종료되었습니다.",
      link_url: "/live",
    });
    expect(events.at(-1)).toMatchObject({ event: "notified", detail: "live_ended", recipients: 2 });
  });

  // ── 호출부(refreshIfStale)까지 포함한 종료 처리 흐름 ──────────────────────────
  // OAuth invalid_grant + 공개 API 키 정상 응답(라이브 없음) + 직전 상태 is_live=true
  const endToEndFixture = (startedAt: string, apiKey: string | null) => {
    const prev = {
      channel_id: "channel",
      is_live: true,
      video_id: "snjm2XZnecc",
      title: "주일 4부 예배 실시간",
      started_at: startedAt,
      last_error: null,
    };
    const notifications: Array<Record<string, unknown>> = [];
    const events: Array<Record<string, unknown>> = [];
    const statusWrites: Array<Record<string, unknown>> = [];
    const { client } = mockSupabase((call) => {
      if (call.table === "youtube_live_status" && call.op === "update") {
        // 선점(claim)만 checked_at 조건(lt)을 함께 건다
        if (call.filters.some((f) => f.kind === "lt")) return { data: [prev] };
        statusWrites.push(call.payload as Record<string, unknown>);
        return { data: [{ id: "main" }] };
      }
      if (call.table === "youtube_live_events" && call.op === "insert") {
        events.push(call.payload as Record<string, unknown>);
        return { data: null };
      }
      if (call.table === "profiles") return { data: activeProfiles };
      if (call.table === "notifications" && call.op === "insert") {
        notifications.push(...(call.payload as Array<Record<string, unknown>>));
        return { data: null };
      }
      throw new Error(`Unexpected call: ${call.table}.${call.op}`);
    });

    const previousApiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) process.env.YOUTUBE_API_KEY = apiKey;
    else delete process.env.YOUTUBE_API_KEY;
    const restoreOAuth = stubOAuthEnv("revoked-refresh-token");

    vi.mocked(umsViaCf).mockResolvedValue(umsResult("실시간 링크 없음"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "https://oauth2.googleapis.com/token") {
        return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) } as Response;
      }
      return jsonResponse({ items: [] });
    }));

    return {
      client,
      notifications,
      events,
      statusWrites,
      restore: () => {
        restoreOAuth();
        if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
        else process.env.YOUTUBE_API_KEY = previousApiKey;
      },
    };
  };

  it("ends the broadcast and notifies when OAuth is broken but the public lookup confirms it", async () => {
    // 90분 진행된 방송이 끝난 경우 — 종료 처리 + 종료 알림
    const f = endToEndFixture(new Date(Date.now() - 90 * 60 * 1000).toISOString(), "api-key");
    try {
      await expect(refreshIfStale(f.client)).resolves.toBe(true);

      const stateWrite = f.statusWrites.at(-1)!;
      expect(stateWrite.is_live).toBe(false);
      expect(String(stateWrite.last_error)).toContain("invalid_grant");
      expect(f.events.map((e) => e.event)).toContain("live_ended");
      expect(f.notifications).toHaveLength(2);
      expect(f.notifications[0]).toMatchObject({ type: "notice_worship_live_ended" });
    } finally {
      f.restore();
    }
  });

  it("ends the broadcast but skips the notice when it ran under five minutes", async () => {
    const f = endToEndFixture(new Date(Date.now() - 2 * 60 * 1000).toISOString(), "api-key");
    try {
      await expect(refreshIfStale(f.client)).resolves.toBe(true);

      expect(f.statusWrites.at(-1)!.is_live).toBe(false);
      expect(f.events.map((e) => e.event)).toContain("live_ended");
      expect(f.notifications).toHaveLength(0);
      expect(f.events.some((e) => e.event === "notify_skipped")).toBe(true);
    } finally {
      f.restore();
    }
  });

  it("keeps the previous state when nothing can confirm the broadcast ended", async () => {
    // OAuth 실패 + API 키 없음 → 종료로 추정하지 않고 '확인 실패'로 남긴다
    const f = endToEndFixture(new Date(Date.now() - 90 * 60 * 1000).toISOString(), null);
    try {
      await expect(refreshIfStale(f.client)).resolves.toBe(false);

      expect(f.statusWrites.every((write) => !("is_live" in write))).toBe(true);
      expect(String(f.statusWrites.at(-1)!.last_error)).toContain("invalid_grant");
      expect(f.events.map((e) => e.event)).toContain("error");
      expect(f.notifications).toHaveLength(0);
    } finally {
      f.restore();
    }
  });

  // ── 같은 예배 송출 재시작 알림 정책 ────────────────────────────────────────────
  const SESSION_START = "2026-08-23T04:34:07Z"; // 일요일 13:34 KST = 주일 4부
  const restartFixture = (notices: Array<{ detail: string | null; session_key: string | null; created_at: string }>) => {
    const row = {
      is_live: true,
      video_id: "restarted-video",
      title: "주일 4부 예배 실시간",
      started_at: SESSION_START,
      notified_video_id: "first-video",
    };
    const notifications: Array<Record<string, unknown>> = [];
    const events: Array<Record<string, unknown>> = [];
    const { client } = mockSupabase((call) => {
      if (call.table === "youtube_live_status" && call.op === "select") return { data: [row] };
      if (call.table === "youtube_live_status" && call.op === "update") return { data: [{ id: "main" }] };
      if (call.table === "youtube_live_events" && call.op === "select") return { data: notices };
      if (call.table === "youtube_live_events" && call.op === "insert") {
        events.push(call.payload as Record<string, unknown>);
        return { data: null };
      }
      if (call.table === "profiles") return { data: activeProfiles };
      if (call.table === "notifications" && call.op === "insert") {
        notifications.push(...(call.payload as Array<Record<string, unknown>>));
        return { data: null };
      }
      throw new Error(`Unexpected call: ${call.table}.${call.op}`);
    });
    return { client, notifications, events };
  };

  it("skips the start notice when this service was already announced and never ended", async () => {
    vi.setSystemTime(new Date("2026-08-23T04:44:00Z"));
    const f = restartFixture([
      { detail: null, session_key: "sun_4", created_at: "2026-08-23T04:34:53Z" },
    ]);
    const result = await notifyIfNewlyLive(f.client);
    expect(result.sent).toBe(false);
    expect(f.notifications).toHaveLength(0);
    expect(f.events.at(-1)).toMatchObject({ event: "notify_skipped", session_key: "sun_4" });
    vi.useRealTimers();
  });

  it("announces the restart when an end notice already went out", async () => {
    vi.setSystemTime(new Date("2026-08-23T04:44:00Z"));
    const f = restartFixture([
      { detail: "live_ended", session_key: null, created_at: "2026-08-23T04:40:00Z" },
      { detail: null, session_key: "sun_4", created_at: "2026-08-23T04:34:53Z" },
    ]);
    const result = await notifyIfNewlyLive(f.client);
    expect(result.sent).toBe(true);
    expect(f.notifications).toHaveLength(2);
    expect(f.notifications[0]).toMatchObject({ type: "notice_worship_live" });
    vi.useRealTimers();
  });

  it("is not confused by a later notice from a different service", async () => {
    vi.setSystemTime(new Date("2026-08-23T04:44:00Z"));
    const f = restartFixture([
      // 다른 예배(수요예배) 시작 알림이 더 최근에 있어도 이 예배의 중복 판정은 유지된다
      { detail: null, session_key: "wed_pm", created_at: "2026-08-23T04:41:00Z" },
      { detail: null, session_key: "sun_4", created_at: "2026-08-23T04:34:53Z" },
    ]);
    const result = await notifyIfNewlyLive(f.client);
    expect(result.sent).toBe(false);
    expect(f.notifications).toHaveLength(0);
    vi.useRealTimers();
  });

  // ── OAuth 진단 상태 전이 ────────────────────────────────────────────────────
  // prev 상태(장애 누적 여부)를 바꿔가며 refreshIfStale 이 쓰는 진단 필드를 검증한다.
  const diagnosticsFixture = (prevOver: Record<string, unknown>, oauthOk: boolean) => {
    const prev = {
      channel_id: "channel",
      is_live: false,
      video_id: null,
      title: null,
      started_at: null,
      last_error: null,
      oauth_first_failed_at: null,
      oauth_last_failed_at: null,
      oauth_consecutive_failures: 0,
      oauth_last_error_code: null,
      oauth_last_failed_stage: null,
      ...prevOver,
    };
    const events: Array<Record<string, unknown>> = [];
    const statusWrites: Array<Record<string, unknown>> = [];
    const { client } = mockSupabase((call) => {
      if (call.table === "youtube_live_status" && call.op === "update") {
        if (call.filters.some((f) => f.kind === "lt")) return { data: [prev] };
        statusWrites.push(call.payload as Record<string, unknown>);
        return { data: [{ id: "main" }] };
      }
      if (call.table === "youtube_live_events" && call.op === "insert") {
        events.push(call.payload as Record<string, unknown>);
        return { data: null };
      }
      if (call.table === "profiles") return { data: activeProfiles };
      if (call.table === "notifications" && call.op === "insert") return { data: null };
      throw new Error(`Unexpected call: ${call.table}.${call.op}`);
    });

    const previousApiKey = process.env.YOUTUBE_API_KEY;
    process.env.YOUTUBE_API_KEY = "api-key";
    const restoreOAuth = stubOAuthEnv(oauthOk ? "working-refresh-token" : "revoked-refresh-token");
    vi.mocked(umsViaCf).mockResolvedValue(umsResult("실시간 링크 없음"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        if (oauthOk) return jsonResponse({ access_token: "access-token-for-test-only" });
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          }),
        } as Response;
      }
      return jsonResponse({ items: [] }); // liveBroadcasts / videos / playlist 모두 0건
    }));

    return {
      client,
      events,
      statusWrites,
      restore: () => {
        restoreOAuth();
        if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
        else process.env.YOUTUBE_API_KEY = previousApiKey;
      },
    };
  };

  it("2. OAuth 실패 시 최초 실패 시각·오류 코드·실패 단계를 기록한다", async () => {
    const f = diagnosticsFixture({}, false);
    try {
      await refreshIfStale(f.client);
      const w = f.statusWrites.at(-1)!;
      expect(w.oauth_first_failed_at).toBeTruthy();
      expect(w.oauth_last_failed_at).toBeTruthy();
      expect(w.oauth_consecutive_failures).toBe(1);
      expect(w.oauth_last_error_code).toBe("invalid_grant");
      expect(w.oauth_last_failed_stage).toBe("token_exchange");
      expect(w.oauth_last_http_status).toBe(400);
      expect(String(w.oauth_last_error_description)).toContain("expired or revoked");
      expect(w.oauth_last_ok_at).toBeUndefined(); // 성공 시각은 건드리지 않는다
    } finally {
      f.restore();
    }
  });

  it("3. 동일 오류가 반복되면 최초 실패 시각은 유지하고 연속 실패만 늘린다", async () => {
    const firstFailed = "2026-08-23T05:52:50.000Z";
    const f = diagnosticsFixture({
      oauth_first_failed_at: firstFailed,
      oauth_consecutive_failures: 7,
      oauth_last_error_code: "invalid_grant",
      last_error: "YouTube OAuth token exchange failed (invalid_grant)",
    }, false);
    try {
      await refreshIfStale(f.client);
      const w = f.statusWrites.at(-1)!;
      expect(w.oauth_first_failed_at).toBe(firstFailed);
      expect(w.oauth_consecutive_failures).toBe(8);
      // 같은 오류 문자열이면 이벤트를 다시 적립하지 않는다
      expect(f.events.filter((e) => e.event === "error")).toHaveLength(0);
    } finally {
      f.restore();
    }
  });

  it("6. OAuth 정상화 시 장애 상태를 해제하고 회복 이벤트를 1건만 남긴다", async () => {
    const f = diagnosticsFixture({
      oauth_first_failed_at: "2026-08-23T05:52:50.000Z",
      oauth_last_failed_at: "2026-08-27T00:00:00.000Z",
      oauth_consecutive_failures: 5312,
      oauth_last_error_code: "invalid_grant",
      oauth_last_failed_stage: "token_exchange",
      last_error: "YouTube OAuth token exchange failed (invalid_grant)",
    }, true);
    try {
      await refreshIfStale(f.client);
      const w = f.statusWrites.at(-1)!;
      expect(w.oauth_last_ok_at).toBeTruthy();
      expect(w.oauth_first_failed_at).toBeNull();
      expect(w.oauth_consecutive_failures).toBe(0);
      expect(w.oauth_last_error_code).toBeNull();
      expect(w.last_error).toBeNull();

      const recovered = f.events.filter((e) => e.event === "oauth_recovered");
      expect(recovered).toHaveLength(1);
      const detail = String(recovered[0].detail);
      expect(detail).toContain("first_failed=2026-08-23T05:52:50.000Z");
      expect(detail).toContain("last_failed=2026-08-27T00:00:00.000Z");
      expect(detail).toContain("failures=5312");
      expect(detail).toContain("last_error=invalid_grant");
      expect(detail).toContain("stage=token_exchange");
      expect(detail).toMatch(/duration=\d+h\d{2}m/);
    } finally {
      f.restore();
    }
  });

  it("6. 이미 정상인 상태에서는 회복 이벤트를 만들지 않는다", async () => {
    const f = diagnosticsFixture({ oauth_first_failed_at: null }, true);
    try {
      await refreshIfStale(f.client);
      expect(f.events.filter((e) => e.event === "oauth_recovered")).toHaveLength(0);
      expect(f.statusWrites.at(-1)!.oauth_last_ok_at).toBeTruthy();
    } finally {
      f.restore();
    }
  });

  it("liveBroadcasts.list 실패는 실패 단계를 live_broadcasts_list 로 남긴다", async () => {
    const restoreOAuth = stubOAuthEnv("working-refresh-token");
    const previousApiKey = process.env.YOUTUBE_API_KEY;
    process.env.YOUTUBE_API_KEY = "api-key";
    const statusWrites: Array<Record<string, unknown>> = [];
    const { client } = mockSupabase((call) => {
      if (call.table === "youtube_live_status" && call.op === "update") {
        if (call.filters.some((f) => f.kind === "lt")) {
          return { data: [{ channel_id: "channel", is_live: false, oauth_consecutive_failures: 0 }] };
        }
        statusWrites.push(call.payload as Record<string, unknown>);
        return { data: [{ id: "main" }] };
      }
      if (call.table === "youtube_live_events" && call.op === "insert") return { data: null };
      if (call.table === "profiles") return { data: activeProfiles };
      throw new Error(`Unexpected call: ${call.table}.${call.op}`);
    });
    try {
      vi.mocked(umsViaCf).mockResolvedValue(umsResult("실시간 링크 없음"));
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          return jsonResponse({ access_token: "access-token-for-test-only" });
        }
        if (url.includes("/youtube/v3/liveBroadcasts")) {
          return {
            ok: false,
            status: 403,
            json: async () => ({ error: { message: "Insufficient permission", status: "PERMISSION_DENIED" } }),
          } as Response;
        }
        return jsonResponse({ items: [] });
      }));

      await refreshIfStale(client);
      const w = statusWrites.at(-1)!;
      expect(w.oauth_last_failed_stage).toBe("live_broadcasts_list");
      expect(w.oauth_last_error_code).toBe("PERMISSION_DENIED");
      expect(w.oauth_last_http_status).toBe(403);
    } finally {
      restoreOAuth();
      if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
      else process.env.YOUTUBE_API_KEY = previousApiKey;
    }
  });

  it("진단 필드에 credential 이 섞이지 않는다", async () => {
    const f = diagnosticsFixture({}, false);
    try {
      await refreshIfStale(f.client);
      const serialized = JSON.stringify(f.statusWrites) + JSON.stringify(f.events);
      expect(serialized).not.toContain("revoked-refresh-token");
      expect(serialized).not.toContain("oauth-client-secret");
      expect(serialized).not.toContain("access-token-for-test-only");
      expect(serialized).not.toMatch(/Bearer/);
    } finally {
      f.restore();
    }
  });

  it("keeps the automatic Korean notification title intact", () => {
    const title = worshipStartedTitle(new Date("2026-07-29T10:15:03Z"));
    expect(title).toBe("수요일 2부 예배가 시작되었습니다");
    expect(title).not.toContain("?");
  });
});
