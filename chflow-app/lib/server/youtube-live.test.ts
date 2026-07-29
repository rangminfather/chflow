import { beforeEach, describe, expect, it, vi } from "vitest";
import { umsViaCf } from "../bulletin/ums-via-cf";
import {
  extractYouTubeVideoId,
  findLiveVideo,
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

  it("keeps the automatic Korean notification title intact", () => {
    const title = worshipStartedTitle(new Date("2026-07-29T10:15:03Z"));
    expect(title).toBe("수요저녁예배가 시작되었습니다");
    expect(title).not.toContain("?");
  });
});
