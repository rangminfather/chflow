import { describe, expect, it } from "vitest";
import {
  buildLiveOAuthReport,
  canViewLiveDiagnostics,
  describeOAuthErrorCode,
  evaluateLiveHealth,
  type LiveEnvSnapshot,
  type LiveEventRow,
  type LiveStatusSnapshot,
} from "./liveDiagnostics";

const NOW = new Date("2026-08-27T00:20:00Z").getTime(); // 09:20 KST

const healthyStatus = (over: Partial<LiveStatusSnapshot> = {}): LiveStatusSnapshot => ({
  is_live: false,
  video_id: null,
  title: null,
  started_at: null,
  checked_at: new Date(NOW - 30_000).toISOString(),
  last_error: null,
  oauth_last_ok_at: new Date(NOW - 30_000).toISOString(),
  oauth_first_failed_at: null,
  oauth_last_failed_at: null,
  oauth_consecutive_failures: 0,
  oauth_last_error_code: null,
  oauth_last_error_description: null,
  oauth_last_failed_stage: null,
  oauth_last_http_status: null,
  ...over,
});

const oauthFailingStatus = (over: Partial<LiveStatusSnapshot> = {}): LiveStatusSnapshot =>
  healthyStatus({
    last_error: "YouTube OAuth token exchange failed (invalid_grant)",
    oauth_last_ok_at: "2026-08-23T03:23:52Z",
    oauth_first_failed_at: "2026-08-23T05:52:50Z",
    oauth_last_failed_at: new Date(NOW - 30_000).toISOString(),
    oauth_consecutive_failures: 5312,
    oauth_last_error_code: "invalid_grant",
    oauth_last_error_description: "Token has been expired or revoked.",
    oauth_last_failed_stage: "token_exchange",
    oauth_last_http_status: 400,
    ...over,
  });

const env: LiveEnvSnapshot = {
  youtube_oauth_client_id: "configured",
  youtube_oauth_client_secret: "configured",
  youtube_oauth_refresh_token: "configured",
  youtube_api_key: "configured",
  credential_changed_at: "확인 불가",
  deploy_sha: "a152044ca0924e8b0904c457228ce6214df03b3d",
  deploy_ref: "main",
  deployment_id: "dpl_TESTONLY",
};

const events: LiveEventRow[] = [
  {
    id: 1698,
    event: "error",
    video_id: null,
    session_key: null,
    detail: "YouTube OAuth token exchange failed (invalid_grant) — 공개 API 키 경로로 계속 조회 중",
    created_at: "2026-08-26T23:58:51Z",
  },
  {
    id: 1696,
    event: "notified",
    video_id: "vid_test_0001",
    session_key: null,
    detail: "live_ended",
    created_at: "2026-08-26T11:29:56Z",
  },
];

describe("evaluateLiveHealth", () => {
  it("1. OAuth 정상이면 이상징후가 없다", () => {
    const health = evaluateLiveHealth(healthyStatus(), NOW);
    expect(health.severity).toBe("ok");
    expect(health.oauthFailing).toBe(false);
    expect(health.findings).toHaveLength(0);
  });

  it("2·4. OAuth 실패 + 공개 API KEY fallback 정상 → warning, 서비스 영향 제한적", () => {
    const health = evaluateLiveHealth(oauthFailingStatus(), NOW);
    expect(health.severity).toBe("warning");
    expect(health.oauthFailing).toBe(true);
    expect(health.fallbackHealthy).toBe(true);
    expect(health.headline).toContain("OAuth 보조 경로 이상");
    expect(health.serviceImpact).toContain("공개 API 키 경로로 방송 감지는 계속 동작");
    expect(health.findings.join(" ")).toContain("invalid_grant");
  });

  it("5. OAuth 실패 + 공개 경로까지 실패 → critical", () => {
    const health = evaluateLiveHealth(
      oauthFailingStatus({ last_error: "YouTube API 403 quotaExceeded" }),
      NOW
    );
    expect(health.severity).toBe("critical");
    expect(health.fallbackHealthy).toBe(false);
    expect(health.findings.join(" ")).toContain("공개 API 키 경로");
  });

  it("5. 폴러가 멈추면 critical", () => {
    const health = evaluateLiveHealth(
      healthyStatus({ checked_at: new Date(NOW - 20 * 60 * 1000).toISOString() }),
      NOW
    );
    expect(health.severity).toBe("critical");
    expect(health.pollerStalled).toBe(true);
  });

  it("is_live 가 장시간 고착이면 critical", () => {
    const health = evaluateLiveHealth(
      healthyStatus({ is_live: true, video_id: "vid_test_0002", started_at: new Date(NOW - 9 * 60 * 60 * 1000).toISOString() }),
      NOW
    );
    expect(health.severity).toBe("critical");
    expect(health.isLiveStuck).toBe(true);
  });

  it("상태 자체를 못 읽으면 critical", () => {
    const health = evaluateLiveHealth(null, NOW);
    expect(health.severity).toBe("critical");
  });
});

describe("describeOAuthErrorCode", () => {
  it("invalid_grant 는 원인을 단정하지 않는다", () => {
    const d = describeOAuthErrorCode("invalid_grant");
    expect(d.meaning).toContain("유효한 grant 로 인정되지 않습니다");
    expect(d.caution).toContain("확정할 수 없습니다");
    // 특정 원인을 단정하는 문구가 없어야 한다
    expect(d.meaning).not.toContain("사용자가 revoke");
  });

  it("unauthorized_client / invalid_client 를 구분해 설명한다", () => {
    expect(describeOAuthErrorCode("unauthorized_client").meaning).toContain("일치하지 않거나");
    expect(describeOAuthErrorCode("invalid_client").meaning).toContain("Client ID / Client Secret");
  });

  it("미등록 코드는 원인 미확정으로 남긴다", () => {
    const d = describeOAuthErrorCode("something_new");
    expect(d.candidates.join(" ")).toContain("원인 미확정");
    expect(d.caution).toContain("원인 미확정");
  });
});

describe("buildLiveOAuthReport", () => {
  const report = buildLiveOAuthReport({
    status: oauthFailingStatus(),
    events,
    env,
    health: evaluateLiveHealth(oauthFailingStatus(), NOW),
    nowMs: NOW,
  });

  it("8. 핵심 진단 섹션과 필드를 모두 포함한다", () => {
    for (const section of [
      "■ 현재 상태",
      "■ OAuth 진단",
      "■ 환경 상태",
      "■ Production",
      "■ 최근 YouTube Live 이벤트",
      "■ 자동 진단",
      "■ 운영 영향",
      "■ Codex 요청",
    ]) {
      expect(report).toContain(section);
    }
    expect(report).toContain("오류 코드: invalid_grant");
    expect(report).toContain("실패 단계: token_exchange");
    expect(report).toContain("연속 실패 횟수: 5312");
    expect(report).toContain("HTTP status: 400");
    expect(report).toContain("YOUTUBE_OAUTH_REFRESH_TOKEN: configured");
    expect(report).toContain("Git SHA: a152044ca0924e8b0904c457228ce6214df03b3d");
    expect(report).toContain("공개 API KEY fallback: 정상");
    expect(report).toContain("미등록(Unlisted) 라이브 탐지: 불가");
  });

  it("7. credential 값이 어디에도 포함되지 않는다", () => {
    // credential 환경변수를 값처럼 출력하는 줄은 configured/missing/확인 불가 로만 끝나야 한다
    const credentialLines = report
      .split("\n")
      .filter((line) => /(YOUTUBE_OAUTH_[A-Z_]+|YOUTUBE_API_KEY)\s*:/.test(line));
    expect(credentialLines).toHaveLength(4);
    for (const line of credentialLines) {
      expect(line).toMatch(/(configured|missing|확인 불가)$/);
    }
    // 실제 credential 형태가 섞여 들어오는지 (fixture 에도 실제 secret 을 넣지 않는다)
    expect(report).not.toMatch(/Bearer\s+\S+/);
    expect(report).not.toMatch(/GOCSPX-/);        // Google client secret 접두
    expect(report).not.toMatch(/1\/\/0[\w-]{20,}/); // Google refresh token 형태
    expect(report).not.toMatch(/ya29\./);         // Google access token 접두
    expect(report).not.toContain("apps.googleusercontent.com");
    expect(report).not.toMatch(/authorization/i);
  });

  it("원인을 단정하지 않고 '확인 불가'를 명시한다", () => {
    expect(report).toContain("확인 불가:");
    expect(report).toContain("credential 변경 시각: 확인 불가");
  });

  it("정상 상태에서는 이상징후 문구를 넣지 않는다", () => {
    const ok = buildLiveOAuthReport({
      status: healthyStatus(),
      events: [],
      env,
      health: evaluateLiveHealth(healthyStatus(), NOW),
      nowMs: NOW,
    });
    expect(ok).toContain("가장 가능성 높은 범주: 이상징후 없음");
    expect(ok).toContain("미등록(Unlisted) 라이브 탐지: 정상");
  });

  it("환경 정보를 못 받았으면 '확인 불가'로 표기한다", () => {
    const noEnv = buildLiveOAuthReport({
      status: oauthFailingStatus(),
      events,
      env: null,
      health: evaluateLiveHealth(oauthFailingStatus(), NOW),
      nowMs: NOW,
    });
    expect(noEnv).toContain("YOUTUBE_OAUTH_CLIENT_ID: 확인 불가");
    expect(noEnv).toContain("Git SHA: 확인 불가");
  });
});

describe("canViewLiveDiagnostics", () => {
  it("admin·office·pastor 만 허용한다", () => {
    expect(canViewLiveDiagnostics("admin")).toBe(true);
    expect(canViewLiveDiagnostics("office")).toBe(true);
    expect(canViewLiveDiagnostics("pastor")).toBe(true);
  });

  it("그 외 역할과 비정상 입력은 차단한다", () => {
    for (const role of ["member", "leader", "", null, undefined, 0, {}]) {
      expect(canViewLiveDiagnostics(role)).toBe(false);
    }
  });
});
