export type UsageSeverity = "OK" | "INFO" | "WARN" | "CRITICAL";
export type UsageCandidate =
  | "NOTIFICATION_POLLING"
  | "ATTENDANCE_POLLING"
  | "LIVE_POLLING"
  | "UNKNOWN_QUERY_SPIKE";
export type UsageConfidence = "high" | "medium" | "low";
export type UsageDataQuality =
  | "baseline_pending"
  | "complete"
  | "reset_detected"
  | "stats_evicted"
  | "interval_misaligned";

export interface UsageDailyRow {
  usage_date: string;
  interval_started_at: string | null;
  interval_ended_at: string;
  data_quality: UsageDataQuality;
  visitors: number;
  statement_calls: number | null;
  statement_rows: number | null;
  exec_time_ms: number | null;
  statements_per_visitor: number | null;
  db_size_bytes: number;
  db_growth_bytes: number | null;
  candidate: UsageCandidate | null;
  confidence: UsageConfidence | null;
  candidate_share_pct: number | null;
  primary_identifier: string | null;
  primary_display_name: string | null;
  primary_share_pct: number | null;
}

export interface UsageTopQuery {
  query_key: string;
  queryid: string | null;
  identifier: string;
  display_name: string;
  category: string;
  calls_delta: number;
  rows_delta: number;
  exec_time_delta_ms: number;
  share_pct: number;
  cause_candidate: UsageCandidate;
  confidence_basis: string;
  normalized_query: string;
}

export interface UsageComparison {
  previous_date: string | null;
  previous_calls: number | null;
  previous_day_pct: number | null;
  prior_days: number;
  prior_7d_avg_calls: number | null;
  prior_7d_median_calls: number | null;
  vs_7d_avg_pct: number | null;
  prior_7d_weighted_per_visitor: number | null;
  per_visitor_vs_7d_pct: number | null;
}

export interface UsageDiagnosticsPayload {
  latest_collection: UsageDailyRow | null;
  latest_complete: UsageDailyRow | null;
  comparison: UsageComparison | null;
  top_queries: UsageTopQuery[];
  trend: UsageDailyRow[];
  collection: {
    last_captured_at?: string | null;
    last_stats_reset?: string | null;
    ready_for_daily?: boolean;
  } | null;
  db_connections?: {
    current: number;
    active: number;
    max_configured: number;
    scope: string;
  } | null;
  db_quota_bytes: number | null;
}

export interface UsageFinding {
  code: string;
  severity: UsageSeverity;
  title: string;
  detail: string;
  candidate?: UsageCandidate;
  confidence?: UsageConfidence;
}

const SEVERITY_RANK: Record<UsageSeverity, number> = {
  OK: 0,
  INFO: 1,
  WARN: 2,
  CRITICAL: 3,
};

// QUERY_SPIKE 판정 기준 — DB 쪽 admin_usage_check_anomalies() 와 같은 값을 써야 한다.
// 두 구현이 어긋나면 scripts/validate-usage-migration.mjs 가 실패한다.
export const QUERY_SPIKE_THRESHOLDS = {
  minCalls: 1000,
  vs7dPct: 100,
  vsPreviousDayPct: 150,
  perVisitorPct: 25,
  minPriorDays: 3,
} as const;

// 원인 candidate 의 설명력(share) 구간 — collect_daily() 의 10/25/40 과 같은 값이다.
export const CANDIDATE_SHARE_THRESHOLDS = {
  candidate: 10,
  medium: 25,
  high: 40,
} as const;

// DB 용량 구간. warn(80%)은 /api/cron/storage-cleanup 의 알림 발송 기준과 공유한다.
export const DB_CAPACITY_THRESHOLDS = {
  info: 60,
  warn: 80,
  critical: 95,
} as const;

// R2 저장 임계값 구간.
// R2_STORAGE_QUOTA_BYTES 는 Cloudflare 가 강제하는 저장 한도가 아니라
// 운영자가 정하는 감시 기준값이다. 초과해도 저장이 중단되지 않고 비용·보관 정책 문제가 된다.
export const R2_CAPACITY_THRESHOLDS = {
  warn: 80,
} as const;

/**
 * quota 환경변수 파싱의 단일 구현.
 * 미설정·빈 문자열·숫자 아님·0 이하·비정수는 모두 null(판정 불가)로 취급한다.
 * 임의의 기본 quota 로 대체해 "정상"으로 판정하지 않는다.
 */
export function parseQuotaBytes(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * R2 저장 임계값의 단일 출처. 관리자 표시(/api/admin/r2-usage)와
 * 실제 경보(/api/cron/storage-cleanup)가 반드시 이 함수만 사용한다.
 */
export function r2QuotaBytes(env: Record<string, string | undefined> = process.env): number | null {
  return parseQuotaBytes(env.R2_STORAGE_QUOTA_BYTES);
}

export interface R2Evaluation {
  quotaBytes: number | null;
  /** quota 미설정이면 null — 사용률을 계산하지 않는다. */
  usagePct: number | null;
  /** quota 미설정이면 항상 false — 초과 판정을 하지 않는다. */
  overThreshold: boolean;
  /** 알릴 것이 없으면 null */
  finding: UsageFinding | null;
}

/** R2 저장 사용량 판정. 표시와 경보가 같은 결과를 보도록 한 곳에서 계산한다. */
export function evaluateR2Usage(input: { totalBytes: number; quotaBytes: number | null }): R2Evaluation {
  const { totalBytes, quotaBytes } = input;
  if (!quotaBytes) {
    return {
      quotaBytes: null,
      usagePct: null,
      overThreshold: false,
      finding: {
        code: "R2_QUOTA_UNSET",
        severity: "INFO",
        title: "R2 저장 임계값 미설정 — 판정 불가",
        detail: "R2_STORAGE_QUOTA_BYTES 가 없어 사용률과 임계값 초과를 판정하지 않았습니다. "
          + "이 값은 Cloudflare 가 강제하는 저장 한도가 아니라 운영자가 정하는 감시 기준입니다. "
          + "R2 는 임계값을 넘겨도 저장이 중단되지 않고 비용·보관 정책 문제가 되므로, "
          + "원하는 운영 임계값을 직접 설정하세요.",
      },
    };
  }

  const usagePct = totalBytes / quotaBytes * 100;
  const overThreshold = usagePct >= R2_CAPACITY_THRESHOLDS.warn;
  return {
    quotaBytes,
    usagePct,
    overThreshold,
    finding: overThreshold
      ? {
        code: "R2_CAPACITY",
        severity: "WARN",
        title: `R2 저장 임계값 접근 (${usagePct.toFixed(1)}%)`,
        detail: `R2 저장 사용량이 설정된 운영 임계값의 ${R2_CAPACITY_THRESHOLDS.warn}% 이상입니다. `
          + "비용 및 보관 정책을 확인하고 필요하면 사진 원본·버킷을 정리하세요.",
      }
      : null,
  };
}

export function classifyUsageQuery(query: string): {
  identifier: string;
  displayName: string;
  category: string;
  candidate: UsageCandidate;
} {
  const value = query.toLowerCase();
  if (value.includes("get_unread_count")) return known("get_unread_count", "알림 미읽음 수", "notification", "NOTIFICATION_POLLING");
  if (value.includes("get_my_notifications")) return known("get_my_notifications", "알림 목록", "notification", "NOTIFICATION_POLLING");
  if (value.includes("get_my_notification_preferences")) return known("get_my_notification_preferences", "알림 설정", "notification", "NOTIFICATION_POLLING");
  if (value.includes("current_member_id")) return known("current_member_id", "회원 식별", "attendance", "ATTENDANCE_POLLING");
  if (value.includes("attendance_location_candidates")) return known("attendance_location_candidates", "자동출석 후보 상태", "attendance", "ATTENDANCE_POLLING");
  if (value.includes("church_attendance") || value.includes("attendance-status")) return known("church_attendance", "자동출석 상태", "attendance", "ATTENDANCE_POLLING");
  if (value.includes("youtube_live_status") || value.includes("youtube_live_events")) return known("youtube_live_status", "Live 상태", "live", "LIVE_POLLING");
  if (value.includes("net._http_response") || value.includes("net.http_")) return known("push_webhook_response", "Push/Webhook HTTP", "push_webhook", "UNKNOWN_QUERY_SPIKE");
  if (value.includes(" as ok") || /^\s*select\s+\$\d+\s*$/i.test(value)) return known("health_probe", "Health / Probe", "health", "UNKNOWN_QUERY_SPIKE");
  return known("other_sql", "기타 SQL", "other", "UNKNOWN_QUERY_SPIKE");
}

function known(identifier: string, displayName: string, category: string, candidate: UsageCandidate) {
  return { identifier, displayName, category, candidate };
}

export function deriveUsageCause(topQueries: UsageTopQuery[], totalCalls: number): {
  candidate: UsageCandidate;
  confidence: UsageConfidence;
  sharePct: number;
} {
  const grouped = new Map<UsageCandidate, number>();
  for (const query of topQueries) {
    if (query.cause_candidate === "UNKNOWN_QUERY_SPIKE") continue;
    grouped.set(query.cause_candidate, (grouped.get(query.cause_candidate) || 0) + query.calls_delta);
  }
  const best = [...grouped.entries()].sort((a, b) => b[1] - a[1])[0];
  const sharePct = best && totalCalls > 0 ? (best[1] / totalCalls) * 100 : 0;
  if (!best || sharePct < CANDIDATE_SHARE_THRESHOLDS.candidate) {
    return { candidate: "UNKNOWN_QUERY_SPIKE", confidence: "low", sharePct };
  }
  return {
    candidate: best[0],
    confidence: sharePct >= CANDIDATE_SHARE_THRESHOLDS.high
      ? "high"
      : sharePct >= CANDIDATE_SHARE_THRESHOLDS.medium ? "medium" : "low",
    sharePct,
  };
}

export function cumulativeDelta(
  current: number,
  baseline: number | null,
  resetChanged = false,
  collectionReady = true,
): { value: number | null; quality: "complete" | "baseline_pending" | "reset_detected" } {
  if (!collectionReady) return { value: null, quality: "baseline_pending" };
  if (resetChanged) return { value: null, quality: "reset_detected" };
  if (baseline === null) return { value: current, quality: "complete" };
  if (current < baseline) return { value: null, quality: "reset_detected" };
  return { value: current - baseline, quality: "complete" };
}

export function evaluateUsageDiagnostics(payload: UsageDiagnosticsPayload): {
  severity: UsageSeverity;
  findings: UsageFinding[];
  cause: ReturnType<typeof deriveUsageCause>;
} {
  const findings: UsageFinding[] = [];
  const latestCollection = payload.latest_collection;
  const latest = payload.latest_complete;

  if (!latestCollection) {
    findings.push({
      code: "USAGE_BASELINE_PENDING",
      severity: "INFO",
      title: "일별 query baseline 초기화 전",
      detail: "migration 적용 후 첫 수집이 완료되면 baseline 상태가 표시됩니다.",
    });
  } else if (latestCollection.data_quality !== "complete") {
    findings.push({
      code: "USAGE_DATA_INCOMPLETE",
      severity: "INFO",
      title: dataQualityLabel(latestCollection.data_quality),
      detail: "불완전한 interval은 호출량 증가 판정에서 제외했습니다.",
    });
  }

  const totalCalls = latest?.statement_calls || 0;
  const cause = deriveUsageCause(payload.top_queries, totalCalls);
  const comparison = payload.comparison;

  if (latest && comparison) {
    if (comparison.prior_days < QUERY_SPIKE_THRESHOLDS.minPriorDays) {
      findings.push({
        code: "USAGE_DATA_INSUFFICIENT",
        severity: "INFO",
        title: "비교 데이터가 아직 부족함",
        detail: `완료된 이전 데이터가 ${comparison.prior_days}일뿐이어서 spike를 판정하지 않았습니다.`,
      });
    } else {
      const volumeSpike = totalCalls >= QUERY_SPIKE_THRESHOLDS.minCalls
        && ((comparison.vs_7d_avg_pct ?? -Infinity) >= QUERY_SPIKE_THRESHOLDS.vs7dPct
          || (comparison.previous_day_pct ?? -Infinity) >= QUERY_SPIKE_THRESHOLDS.vsPreviousDayPct);
      const perVisitorIncrease = comparison.per_visitor_vs_7d_pct ?? 0;
      if (volumeSpike && perVisitorIncrease >= QUERY_SPIKE_THRESHOLDS.perVisitorPct) {
        findings.push({
          code: "QUERY_SPIKE",
          severity: "WARN",
          title: `DB statements ${totalCalls.toLocaleString("ko-KR")}건 급증`,
          detail: `${cause.candidate} candidate가 ${cause.sharePct.toFixed(1)}%를 설명합니다. 호출 증가만으로 장애 또는 CRITICAL로 판정하지 않았습니다.`,
          candidate: cause.candidate,
          confidence: cause.confidence,
        });
      } else if (volumeSpike) {
        findings.push({
          code: "TRAFFIC_GROWTH",
          severity: "INFO",
          title: "방문자 증가에 비례한 DB 호출 증가",
          detail: `총 호출은 증가했지만 방문자당 호출 증가는 ${QUERY_SPIKE_THRESHOLDS.perVisitorPct}% 미만입니다.`,
        });
      }
    }
  }

  if (latest && payload.db_quota_bytes) {
    const quotaPct = latest.db_size_bytes / payload.db_quota_bytes * 100;
    if (quotaPct >= DB_CAPACITY_THRESHOLDS.critical) {
      findings.push({ code: "DB_CAPACITY", severity: "CRITICAL", title: `DB quota ${quotaPct.toFixed(1)}%`, detail: `명시적으로 설정된 DB quota의 ${DB_CAPACITY_THRESHOLDS.critical}% 이상입니다.` });
    } else if (quotaPct >= DB_CAPACITY_THRESHOLDS.warn) {
      findings.push({ code: "DB_CAPACITY", severity: "WARN", title: `DB quota ${quotaPct.toFixed(1)}%`, detail: `명시적으로 설정된 DB quota의 ${DB_CAPACITY_THRESHOLDS.warn}% 이상입니다.` });
    } else if (quotaPct >= DB_CAPACITY_THRESHOLDS.info) {
      findings.push({ code: "DB_CAPACITY", severity: "INFO", title: `DB quota ${quotaPct.toFixed(1)}%`, detail: "DB 증가 추이를 확인하세요." });
    }
  } else if (latest) {
    // quota 미설정을 "정상"으로 흘려보내지 않는다. 용량 감시가 꺼져 있음을 명시한다.
    findings.push({
      code: "DB_QUOTA_UNSET",
      severity: "INFO",
      title: "DB quota 미설정 — 용량 판정 불가",
      detail: "SUPABASE_DB_QUOTA_BYTES 가 없어 DB 용량 임계치를 판정하지 않았습니다. "
        + `설정하면 ${DB_CAPACITY_THRESHOLDS.warn}% 초과 시 관리자 알림도 함께 동작합니다.`,
    });
  }

  const severity = findings.reduce<UsageSeverity>(
    (current, finding) => SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current] ? finding.severity : current,
    "OK",
  );
  return { severity, findings, cause };
}

export function buildUsageReportV2(payload: UsageDiagnosticsPayload): string {
  const result = evaluateUsageDiagnostics(payload);
  const latest = payload.latest_complete;
  const comparison = payload.comparison;
  const lines = [
    "[chflow-usage-report v2]",
    `date=${latest?.usage_date || "unavailable"}`,
    `status=${result.severity.toLowerCase()}`,
    "",
  ];

  if (latest) {
    lines.push(`db=${formatMegabytes(latest.db_size_bytes)}`);
    lines.push(`db_quota=${payload.db_quota_bytes ? formatMegabytes(payload.db_quota_bytes) : "unset"}`);
    lines.push(`visitors=${latest.visitors}`);
    lines.push(`db_statements=${latest.statement_calls ?? "unavailable"}`);
    lines.push(`statements_per_visitor=${formatNumber(latest.statements_per_visitor)}`);
    lines.push(`db_exec_time=${latest.exec_time_ms === null ? "unavailable" : `${(latest.exec_time_ms / 1000).toFixed(1)}s`}`);
    if (payload.db_connections) {
      lines.push(`db_connections=${payload.db_connections.current}/${payload.db_connections.max_configured} active=${payload.db_connections.active}`);
    }
  } else {
    lines.push("data_quality=baseline_pending");
  }

  lines.push("", "comparison:");
  lines.push(`- vs_previous_day=${formatPercent(comparison?.previous_day_pct)}`);
  lines.push(`- vs_7d_average=${formatPercent(comparison?.vs_7d_avg_pct)}`);
  lines.push(`- per_visitor_vs_7d=${formatPercent(comparison?.per_visitor_vs_7d_pct)}`);
  lines.push("", "top_queries:");
  if (payload.top_queries.length === 0) lines.push("- none");
  payload.top_queries.forEach((query, index) => {
    lines.push(`${index + 1}. ${query.identifier} ${query.calls_delta} (${query.share_pct.toFixed(1)}%) exec=${(query.exec_time_delta_ms / 1000).toFixed(2)}s`);
  });
  lines.push("", "findings:");
  if (result.findings.length === 0) lines.push("- none");
  for (const finding of result.findings) {
    lines.push(`- ${finding.code} [${finding.severity.toLowerCase()}]`);
    if (finding.candidate) lines.push(`  candidate=${finding.candidate}`);
    if (finding.confidence) lines.push(`  confidence=${finding.confidence}`);
    if (latest?.primary_identifier) lines.push(`  primary=${latest.primary_identifier}`);
    if (latest?.primary_share_pct !== null && latest?.primary_share_pct !== undefined) lines.push(`  share=${latest.primary_share_pct.toFixed(1)}%`);
    lines.push(`  detail=${finding.detail}`);
  }
  return lines.join("\n");
}

export function dataQualityLabel(quality: UsageDataQuality): string {
  const labels: Record<UsageDataQuality, string> = {
    baseline_pending: "Query baseline 초기화 중",
    complete: "완료",
    reset_detected: "pg_stat_statements reset 감지",
    stats_evicted: "pg_stat_statements 항목 교체 감지",
    interval_misaligned: "일일 수집 interval 불일치",
  };
  return labels[quality];
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unavailable";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatNumber(value: number | null): string {
  return value === null ? "unavailable" : value.toFixed(1);
}
