// 예배 생방송(YouTube Live) 이상징후 판정 + Codex 상담용 리포트 생성.
//
// 순수 함수만 둔다. DB·네트워크·secret 을 모르고, 화면과 테스트가 같은 함수를 쓴다.
// credential(refresh token·client secret·access token·authorization 헤더)은
// 입력으로 받지도 않으므로 리포트에 섞일 경로 자체가 없다.

export type LiveStatusSnapshot = {
  is_live: boolean | null;
  video_id: string | null;
  title: string | null;
  started_at: string | null;
  checked_at: string | null;
  last_error: string | null;
  oauth_last_ok_at?: string | null;
  oauth_first_failed_at?: string | null;
  oauth_last_failed_at?: string | null;
  oauth_consecutive_failures?: number | null;
  oauth_last_error_code?: string | null;
  oauth_last_error_description?: string | null;
  oauth_last_failed_stage?: string | null;
  oauth_last_http_status?: number | null;
};

export type LiveEventRow = {
  id: number;
  event: string;
  video_id: string | null;
  session_key: string | null;
  detail: string | null;
  recipients?: number | null;
  created_at: string;
};

/** 서버 route 가 돌려주는 환경 정보 — 값이 아니라 "설정되어 있는지"만 담는다 */
export type LiveEnvSnapshot = {
  youtube_oauth_client_id: "configured" | "missing";
  youtube_oauth_client_secret: "configured" | "missing";
  youtube_oauth_refresh_token: "configured" | "missing";
  youtube_api_key: "configured" | "missing";
  credential_changed_at: "확인 불가";
  deploy_sha: string | null;
  deploy_ref: string | null;
  deployment_id: string | null;
};

export type LiveSeverity = "ok" | "warning" | "critical";

export type LiveHealth = {
  severity: LiveSeverity;
  headline: string;
  serviceImpact: string;
  findings: string[];
  oauthFailing: boolean;
  pollerStalled: boolean;
  fallbackHealthy: boolean;
  isLiveStuck: boolean;
};

/** 폴러가 이 시간 넘게 갱신되지 않으면 멈춘 것으로 본다 (poll 주기 1분) */
export const POLLER_STALL_MS = 5 * 60 * 1000;
/** 방송 상태가 이 시간 넘게 켜져 있으면 고착으로 본다 (가장 긴 예배도 3시간 이내) */
export const IS_LIVE_STUCK_MS = 4 * 60 * 60 * 1000;

/** OAuth 오류 코드가 last_error 문자열에 들어 있는지 (OAuth 실패와 일반 조회 실패 구분) */
function isOAuthError(lastError: string | null | undefined): boolean {
  return !!lastError && /OAuth/i.test(lastError);
}

export function evaluateLiveHealth(
  status: LiveStatusSnapshot | null,
  nowMs: number
): LiveHealth {
  if (!status) {
    return {
      severity: "critical",
      headline: "방송 상태를 확인할 수 없습니다",
      serviceImpact: "상태 캐시를 읽지 못해 방송 감지 여부를 알 수 없습니다.",
      findings: ["youtube_live_status 를 읽지 못했습니다."],
      oauthFailing: false,
      pollerStalled: true,
      fallbackHealthy: false,
      isLiveStuck: false,
    };
  }

  const checkedMs = status.checked_at ? new Date(status.checked_at).getTime() : NaN;
  const pollerStalled = Number.isNaN(checkedMs) || nowMs - checkedMs > POLLER_STALL_MS;

  const failures = status.oauth_consecutive_failures ?? 0;
  const oauthFailing = !!status.oauth_first_failed_at || failures > 0 || isOAuthError(status.last_error);

  // OAuth 오류가 아닌 last_error = 공개 경로(API 키·UMS·videos.list)까지 실패한 것
  const fallbackHealthy = !pollerStalled && !(status.last_error && !isOAuthError(status.last_error));

  const startedMs = status.started_at ? new Date(status.started_at).getTime() : NaN;
  const isLiveStuck = !!status.is_live
    && !Number.isNaN(startedMs)
    && nowMs - startedMs > IS_LIVE_STUCK_MS;

  const findings: string[] = [];
  if (pollerStalled) findings.push("폴러가 5분 넘게 상태를 갱신하지 않았습니다.");
  if (!fallbackHealthy && !pollerStalled) findings.push("공개 API 키 경로 조회도 실패하고 있습니다.");
  if (isLiveStuck) findings.push("방송 중 상태가 4시간 넘게 유지되고 있습니다 (종료 감지 실패 의심).");
  if (oauthFailing) {
    findings.push(
      `OAuth 소유자 조회 경로가 실패 중입니다 (${status.oauth_last_error_code ?? "코드 미확인"}` +
      `${status.oauth_last_failed_stage ? `, 단계: ${status.oauth_last_failed_stage}` : ""}).`
    );
  }

  if (pollerStalled || !fallbackHealthy || isLiveStuck) {
    return {
      severity: "critical",
      headline: "예배 생방송 감지에 문제가 있습니다",
      serviceImpact: "방송 시작·종료 감지가 동작하지 않을 수 있습니다. 확인이 필요합니다.",
      findings,
      oauthFailing,
      pollerStalled,
      fallbackHealthy,
      isLiveStuck,
    };
  }

  if (oauthFailing) {
    return {
      severity: "warning",
      headline: "서비스 정상 / OAuth 보조 경로 이상",
      serviceImpact:
        "공개 API 키 경로로 방송 감지는 계속 동작합니다. 미등록(Unlisted) 방송 탐색만 불가합니다.",
      findings,
      oauthFailing,
      pollerStalled,
      fallbackHealthy,
      isLiveStuck,
    };
  }

  return {
    severity: "ok",
    headline: "YouTube Live 상태 정상",
    serviceImpact: "OAuth·공개 경로 모두 정상입니다.",
    findings: [],
    oauthFailing: false,
    pollerStalled: false,
    fallbackHealthy: true,
    isLiveStuck: false,
  };
}

/** 오류 코드별 설명 — 근거 없이 원인을 단정하지 않는다 */
export function describeOAuthErrorCode(code: string | null | undefined): {
  meaning: string;
  candidates: string[];
  caution: string;
} {
  switch (code) {
    case "invalid_grant":
      return {
        meaning: "Refresh Token 이 Google 에서 더 이상 유효한 grant 로 인정되지 않습니다.",
        candidates: [
          "사용자가 Google 계정에서 앱 접근 권한을 취소",
          "Google 측에서 token 만료·무효화",
          "token 발급 시 사용한 credential 조합과 현재 credential 이 다름",
          "기타 Google OAuth 정책에 의한 무효화",
        ],
        caution: "Google 이 정확히 왜 해당 token 을 무효화했는지는 현재 응답만으로 확정할 수 없습니다.",
      };
    case "unauthorized_client":
      return {
        meaning:
          "Refresh Token 과 현재 OAuth Client credential 조합이 일치하지 않거나, 해당 client 가 refresh grant 를 사용할 수 없는 상태일 가능성이 있습니다.",
        candidates: [
          "token 을 발급한 OAuth Client 와 현재 CLIENT_ID/SECRET 이 서로 다른 client",
          "해당 client 유형이 refresh_token grant 를 허용하지 않는 상태",
        ],
        caution: "어느 쪽인지는 client 설정을 직접 확인해야 확정할 수 있습니다.",
      };
    case "invalid_client":
      return {
        meaning: "Client ID / Client Secret 조합 검증에 실패했을 가능성이 높습니다.",
        candidates: [
          "CLIENT_ID 와 CLIENT_SECRET 이 서로 다른 client 의 값",
          "Client Secret 이 재생성되어 기존 값이 더 이상 유효하지 않음",
        ],
        caution: "실제 값은 확인하지 않았으므로 조합 불일치 여부는 콘솔 대조가 필요합니다.",
      };
    default:
      return {
        meaning: `OAuth 경로가 실패했습니다 (코드: ${code ?? "미확인"}).`,
        candidates: ["원인 미확정 — Google 응답 코드만으로는 분류할 수 없습니다."],
        caution: "원인 미확정. 추가 증거(콘솔 설정·계정 보안 활동) 확인이 필요합니다.",
      };
  }
}

const KST = "Asia/Seoul";

function fmt(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("ko-KR", { timeZone: KST, dateStyle: "short", timeStyle: "medium" });
}

function durationText(fromIso: string | null | undefined, toMs: number): string {
  if (!fromIso) return "-";
  const fromMs = new Date(fromIso).getTime();
  if (Number.isNaN(fromMs)) return "-";
  const min = Math.max(0, Math.round((toMs - fromMs) / 60000));
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  return [days ? `${days}일` : null, hours ? `${hours}시간` : null, `${mins}분`]
    .filter(Boolean)
    .join(" ");
}

/** 리포트에 담을 이벤트만 고른다 (핵심 전이·오류·수동 복구) */
const REPORT_EVENTS = new Set([
  "error",
  "notified",
  "live_ended",
  "live_started",
  "notify_skipped",
  "oauth_recovered",
]);

export function buildLiveOAuthReport(input: {
  status: LiveStatusSnapshot | null;
  events: LiveEventRow[];
  env: LiveEnvSnapshot | null;
  health: LiveHealth;
  nowMs: number;
}): string {
  const { status, events, env, health, nowMs } = input;
  const nowIso = new Date(nowMs).toISOString();
  const code = status?.oauth_last_error_code ?? null;
  const desc = describeOAuthErrorCode(code);

  const oauthState = health.oauthFailing
    ? `실패 (${code ?? "코드 미확인"})`
    : status?.oauth_last_ok_at
      ? "정상"
      : "상태 미기록";

  const recent = events
    .filter((e) => REPORT_EVENTS.has(e.event))
    .slice(0, 12)
    .map((e) =>
      `${fmt(e.created_at)} | ${e.event} | ${e.session_key ?? "-"} | ${e.video_id ?? "-"} | ${(e.detail ?? "").slice(0, 90)}`
    );

  const lines: string[] = [
    "[CHFlow YouTube Live 이상징후 진단 리포트]",
    "",
    "■ 현재 상태",
    `- 발생 시각: ${fmt(status?.oauth_first_failed_at)}`,
    `- 현재 시각: ${fmt(nowIso)}`,
    `- 장애 지속 시간: ${health.oauthFailing ? durationText(status?.oauth_first_failed_at, nowMs) : "-"}`,
    `- 서비스 영향: ${health.severity === "critical" ? "있음" : health.severity === "warning" ? "제한적 (공개 라이브 감지 정상)" : "없음"}`,
    `- OAuth 상태: ${oauthState}`,
    `- 공개 API KEY fallback: ${health.fallbackHealthy ? "정상" : "실패"}`,
    `- YouTube Poller: ${health.pollerStalled ? "갱신 중단" : "정상 (매분 갱신)"}`,
    `- is_live: ${status?.is_live ?? "-"}`,
    `- video_id: ${status?.video_id ?? "null"}`,
    "",
    "■ OAuth 진단",
    `- 마지막 정상 OAuth: ${fmt(status?.oauth_last_ok_at)}`,
    `- 최초 실패: ${fmt(status?.oauth_first_failed_at)}`,
    `- 최근 실패: ${fmt(status?.oauth_last_failed_at)}`,
    `- 연속 실패 횟수: ${status?.oauth_consecutive_failures ?? 0}`,
    `- 오류 코드: ${code ?? "-"}`,
    `- 오류 설명: ${status?.oauth_last_error_description ?? "-"}`,
    `- HTTP status: ${status?.oauth_last_http_status ?? "-"}`,
    `- 실패 단계: ${status?.oauth_last_failed_stage ?? "-"}`,
    "",
    "■ 환경 상태",
    `- YOUTUBE_OAUTH_CLIENT_ID: ${env?.youtube_oauth_client_id ?? "확인 불가"}`,
    `- YOUTUBE_OAUTH_CLIENT_SECRET: ${env?.youtube_oauth_client_secret ?? "확인 불가"}`,
    `- YOUTUBE_OAUTH_REFRESH_TOKEN: ${env?.youtube_oauth_refresh_token ?? "확인 불가"}`,
    `- YOUTUBE_API_KEY: ${env?.youtube_api_key ?? "확인 불가"}`,
    "- credential 변경 시각: 확인 불가 (런타임에서 조회 불가)",
    "※ 실제 credential 값은 보안상 포함하지 않음",
    "",
    "■ Production",
    `- Git SHA: ${env?.deploy_sha ?? "확인 불가"}`,
    `- Branch: ${env?.deploy_ref ?? "확인 불가"}`,
    `- Deployment: ${env?.deployment_id ?? "확인 불가"}`,
    `- checked_at: ${fmt(status?.checked_at)}`,
    "",
    "■ 최근 YouTube Live 이벤트",
    ...(recent.length ? recent : ["- 기록 없음"]),
    "",
    "■ 자동 진단",
    `- 가장 가능성 높은 범주: ${health.oauthFailing ? desc.meaning : "이상징후 없음"}`,
    `- 가능한 원인: ${health.oauthFailing ? desc.candidates.join(" / ") : "-"}`,
    `- 배제 가능한 원인: ${health.oauthFailing ? "일시적 네트워크 오류 (동일 오류가 연속 지속)" : "-"}`,
    `- 확인 불가: ${health.oauthFailing ? desc.caution : "-"}`,
    ...(health.findings.length ? ["- 관찰된 이상:", ...health.findings.map((f) => `  · ${f}`)] : []),
    "",
    "■ 운영 영향",
    `- 공개 라이브 탐지: ${health.fallbackHealthy && !health.pollerStalled ? "정상" : "이상"}`,
    `- 미등록(Unlisted) 라이브 탐지: ${health.oauthFailing ? "불가 (OAuth 전용 경로)" : "정상"}`,
    `- 시작 감지: ${health.pollerStalled ? "불가" : health.oauthFailing ? "공개 방송만 가능" : "정상"}`,
    `- 종료 감지: ${health.pollerStalled ? "불가" : "정상"}`,
    `- 알림: ${health.pollerStalled ? "발송 불가" : "정상"}`,
    `- Push: ${health.pollerStalled ? "영향 있음" : "영향 없음"}`,
    "",
    "■ Codex 요청",
    "위 기록을 기준으로 원인을 분석해 주세요.",
    "확정할 수 없는 원인은 추측으로 단정하지 말고,",
    "1. 확인된 사실",
    "2. 가능한 원인",
    "3. 추가로 확인할 증거",
    "4. 서비스 영향",
    "5. 가장 안전한 조치 순서",
    "로 정리해 주세요.",
    "",
    "Production 코드를 바로 수정하지 말고 먼저 원인을 진단해 주세요.",
  ];

  return lines.join("\n");
}

/** 운영 알림을 볼 수 있는 역할 — diagnostics API 와 화면이 같은 기준을 쓴다 */
export const LIVE_DIAGNOSTICS_ROLES = ["admin", "office", "pastor"] as const;

export function canViewLiveDiagnostics(role: unknown): boolean {
  return typeof role === "string" && (LIVE_DIAGNOSTICS_ROLES as readonly string[]).includes(role);
}
