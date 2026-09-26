// 주보 성경봉독 자동 판독의 자가 진단.
// 실행 기록(bulletin_scripture_extraction_runs)을 보고 사람이 손봐야 하는 신호를 판정한다.
// action = 설정을 바꿔야 해결되는 문제(관리자 알림), watch = 지켜볼 신호(화면 표시만).

export type RunModelResult = { model: string; ok: boolean; ms: number; status: number | string; error?: string };

export type ExtractionRun = {
  trigger: "cron" | "manual";
  started_at: string;
  duration_ms: number;
  budget_ms: number;
  models: RunModelResult[];
  result_status: "retry" | "done" | "review" | "failed" | "deferred";
  time_limited: boolean;
};

export type HealthCode = "time_limit" | "near_limit" | "model_retired" | "key_invalid" | "quota" | "overload";
export type HealthWarning = { code: HealthCode; level: "action" | "watch"; message: string };

/** 함수 제한 시간의 이 비율 이상을 쓰면 "여유 부족" 으로 본다. */
export const NEAR_LIMIT_RATIO = 0.8;
/** 최근 며칠의 기록만 본다 — 이미 고친 문제가 계속 경고로 남지 않게. */
export const HEALTH_WINDOW_DAYS = 14;

/** currentModels: 지금 설정된 모델 목록 — 이미 목록에서 뺀 단종 모델은 다시 경고하지 않는다. */
export function assessScriptureHealth(runs: ExtractionRun[], currentModels?: string[], now = Date.now()): HealthWarning[] {
  const recent = runs.filter((run) => now - new Date(run.started_at).getTime() <= HEALTH_WINDOW_DAYS * 86_400_000);
  const warnings: HealthWarning[] = [];
  const cron = recent.filter((run) => run.trigger === "cron");

  const limited = cron.filter((run) => run.time_limited || run.result_status === "deferred");
  if (limited.length) {
    warnings.push({ code: "time_limit", level: "action", message: `제한 시간(함수 maxDuration) 때문에 판독을 끝내지 못한 적이 ${limited.length}번 있습니다. /api/bulletin/sync 의 maxDuration 을 늘려야 합니다.` });
  } else {
    const near = cron.filter((run) => run.budget_ms > 0 && run.duration_ms >= run.budget_ms * NEAR_LIMIT_RATIO);
    if (near.length) warnings.push({ code: "near_limit", level: "watch", message: `판독이 제한 시간의 ${Math.round(NEAR_LIMIT_RATIO * 100)}% 이상을 쓴 적이 ${near.length}번 있습니다. 반복되면 maxDuration 을 늘리세요.` });
  }

  const results = recent.flatMap((run) => run.models);
  const retired = [...new Set(results.filter((item) => item.status === 404 && (!currentModels || currentModels.includes(item.model))).map((item) => item.model))];
  if (retired.length) warnings.push({ code: "model_retired", level: "action", message: `더 이상 제공되지 않는 모델: ${retired.join(", ")}. Vercel 환경변수 GEMINI_SCRIPTURE_MODELS 로 다른 모델을 지정하세요.` });

  if (results.some((item) => item.status === "no_key" || item.status === 401 || item.status === 403 || (item.status === 400 && /api key/i.test(item.error || "")))) {
    warnings.push({ code: "key_invalid", level: "action", message: "Gemini API 키가 없거나 거부됐습니다. Vercel 환경변수 GEMINI_API_KEY 를 확인하세요." });
  }

  const quotaRuns = recent.filter((run) => run.models.some((item) => item.status === 429)).length;
  if (quotaRuns >= 2) warnings.push({ code: "quota", level: "watch", message: `무료 한도 초과(429)가 ${quotaRuns}번의 실행에서 났습니다. 계속되면 유료 전환이나 모델 순서 변경을 검토하세요.` });

  const overloadRuns = recent.filter((run) => run.result_status !== "done" && run.models.some((item) => item.status === 503 || item.status === "timeout")).length;
  if (overloadRuns >= 2) warnings.push({ code: "overload", level: "watch", message: `Gemini 과부하·무응답으로 판독이 미뤄진 실행이 ${overloadRuns}번 있습니다(Google 쪽 문제, 재시도로 처리됨).` });

  return warnings;
}
