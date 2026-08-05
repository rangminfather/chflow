import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERMON_BOARDS, syncSermons } from "./ums-sermons";

const withoutVideo = `
  var playlist = [{
    zb_no: '617',
    title: '김종혁목사 2026.08.02 성도의 나그네 삶',
    vod_link: '',
    description: '본문 | 김종혁목사 | 2026.08.02'
  }];
`;

const withVideo = `
  var playlist = [{
    zb_no: '617',
    title: '김종혁목사 2026.08.02 성도의 나그네 삶',
    vod_link: '/2026_0802_sermon_am_617.mp4',
    description: '본문 | 김종혁목사 | 2026.08.02'
  }];
`;

function createFakeSync(html: string) {
  let currentHtml = html;
  const stored = new Map<string, Record<string, unknown>>();
  let upsertCalls = 0;
  let boardFetches = 0;

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("login_check.php")) {
      return {
        headers: {
          getSetCookie: () => ["PHPSESSID=test; Path=/", "login_1st=test; Path=/"],
          get: () => null,
        },
      };
    }

    boardFetches += 1;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(currentHtml).buffer as ArrayBuffer,
    };
  });

  vi.stubGlobal("fetch", fetchMock);

  const admin = {
    from: (table: string) => {
      expect(table).toBe("sermon_archive");
      return {
        upsert: async (rows: Record<string, unknown>[]) => {
          upsertCalls += 1;
          for (const row of rows) {
            const key = `${String(row.board)}:${String(row.post_no)}`;
            stored.set(key, row);
          }
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    admin,
    fetchMock,
    stored,
    get currentHtml() {
      return currentHtml;
    },
    set currentHtml(value: string) {
      currentHtml = value;
    },
    get upsertCalls() {
      return upsertCalls;
    },
    get boardFetches() {
      return boardFetches;
    },
  };
}

const creds = { userId: "test-user", password: "test-password" };

describe("UMS sermon synchronization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rechecks a recent post that had no video and saves it after a video appears", async () => {
    const fake = createFakeSync(withoutVideo);

    const first = await syncSermons(fake.admin, creds, { withSize: false });
    expect(first.every((result) => result.saved === 0)).toBe(true);
    expect(fake.stored.size).toBe(0);
    expect(fake.boardFetches).toBe(SERMON_BOARDS.length * 3);

    fake.currentHtml = withVideo;
    const second = await syncSermons(fake.admin, creds, { withSize: false });

    expect(second.every((result) => result.saved === 1)).toBe(true);
    expect(fake.stored.size).toBe(SERMON_BOARDS.length);
    expect(fake.boardFetches).toBe(SERMON_BOARDS.length * 3 * 2);
  });

  it("uses the board/post primary key when the same video is synchronized again", async () => {
    const fake = createFakeSync(withVideo);

    await syncSermons(fake.admin, creds, { withSize: false });
    await syncSermons(fake.admin, creds, { withSize: false });

    expect(fake.stored.size).toBe(SERMON_BOARDS.length);
    expect(fake.upsertCalls).toBe(SERMON_BOARDS.length * 2);
    expect([...fake.stored.values()].every((row) => row.post_no === 617)).toBe(true);
  });
});
