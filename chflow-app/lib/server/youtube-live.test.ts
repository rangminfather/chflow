import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { umsViaCf } from "../bulletin/ums-via-cf";
import {
  extractYouTubeVideoId,
  findLiveVideo,
  notifyIfLiveEnded,
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

  it("keeps the automatic Korean notification title intact", () => {
    const title = worshipStartedTitle(new Date("2026-07-29T10:15:03Z"));
    expect(title).toBe("수요일 2부 예배가 시작되었습니다");
    expect(title).not.toContain("?");
  });
});
