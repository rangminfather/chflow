import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/app-config", () => {
  it("preserves Android fields and exposes configured iOS fields", async () => {
    vi.stubEnv("MIN_ANDROID_BUILD", "5");
    vi.stubEnv("LATEST_ANDROID_BUILD", "44");
    vi.stubEnv("MIN_IOS_VERSION", "1.1.12");
    vi.stubEnv("LATEST_IOS_VERSION", "1.1.13");

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({
      min_android_build: 5,
      latest_android_build: 44,
      play_store_url: "market://details?id=com.smartmyungsung.app",
      play_store_url_web: "https://play.google.com/store/apps/details?id=com.smartmyungsung.app",
      min_ios_version: "1.1.12",
      latest_ios_version: "1.1.13",
      app_store_url: "itms-apps://apps.apple.com/app/id6795782758",
      app_store_url_web: "https://apps.apple.com/kr/app/id6795782758",
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("uses fail-open iOS defaults for missing or invalid environment values", async () => {
    vi.stubEnv("MIN_IOS_VERSION", "invalid");
    vi.stubEnv("LATEST_IOS_VERSION", "");

    const response = await GET();
    const body = await response.json();

    expect(body.min_ios_version).toBe("0.0.0");
    expect(body.latest_ios_version).toBe("1.1.12");
  });
});
