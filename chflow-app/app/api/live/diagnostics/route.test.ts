import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// supabase 클라이언트를 목으로 바꿔 토큰 검증·role 조회만 흉내낸다.
// 실제 secret 은 어떤 fixture 에도 넣지 않는다 (placeholder 문자열만 사용).
const state = {
  user: null as { id: string } | null,
  role: null as string | null,
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === "valid-token" && state.user
          ? { data: { user: state.user }, error: null }
          : { data: { user: null }, error: new Error("invalid token") },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.role ? { role: state.role } : null }),
        }),
      }),
    }),
  }),
}));

const { GET } = await import("./route");

const request = (authHeader?: string) =>
  new NextRequest("https://example.test/api/live/diagnostics", {
    headers: authHeader ? { Authorization: authHeader } : undefined,
  });

describe("GET /api/live/diagnostics", () => {
  beforeEach(() => {
    state.user = { id: "user-1" };
    state.role = "admin";
    process.env.YOUTUBE_OAUTH_CLIENT_ID = "placeholder-not-a-secret";
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "placeholder-not-a-secret";
    process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = "placeholder-not-a-secret";
    delete process.env.YOUTUBE_API_KEY;
  });

  it("토큰이 없으면 401 이고 환경 정보를 주지 않는다", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.env).toBeUndefined();
  });

  it("토큰이 유효하지 않으면 401", async () => {
    const res = await GET(request("Bearer wrong-token"));
    expect(res.status).toBe(401);
  });

  it("member 는 403 이고 환경·배포 정보를 주지 않는다", async () => {
    state.role = "member";
    const res = await GET(request("Bearer valid-token"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.env).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("configured");
  });

  it("프로필이 없으면 401", async () => {
    state.role = null;
    const res = await GET(request("Bearer valid-token"));
    expect(res.status).toBe(401);
  });

  it.each(["admin", "office", "pastor"])("%s 는 configured/missing 만 받는다", async (role) => {
    state.role = role;
    const res = await GET(request("Bearer valid-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.env.youtube_oauth_client_id).toBe("configured");
    expect(body.env.youtube_oauth_client_secret).toBe("configured");
    expect(body.env.youtube_oauth_refresh_token).toBe("configured");
    expect(body.env.youtube_api_key).toBe("missing"); // 위에서 지웠다
    expect(body.env.credential_changed_at).toBe("확인 불가");
  });

  it("응답에 credential 값이 실리지 않는다", async () => {
    const res = await GET(request("Bearer valid-token"));
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("placeholder-not-a-secret");
    expect(raw).not.toMatch(/Bearer/);
    expect(raw).not.toContain("valid-token");
  });
});
