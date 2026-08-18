import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_SHARE_THRESHOLDS,
  DB_CAPACITY_THRESHOLDS,
  QUERY_SPIKE_THRESHOLDS,
  buildUsageReportV2,
  classifyUsageQuery,
  cumulativeDelta,
  deriveUsageCause,
  evaluateUsageDiagnostics,
  type UsageDiagnosticsPayload,
  type UsageTopQuery,
} from "./usageDiagnostics";

const migrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../MS_AX/chflow-project/supabase/migrations/20260817090000_usage_diagnostics_v2.sql",
  ),
  "utf8",
);
const anomalyFixSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../MS_AX/chflow-project/supabase/migrations/20260817223700_usage_diagnostics_v2_anomaly_monitoring_fix.sql",
  ),
  "utf8",
);

const query = (overrides: Partial<UsageTopQuery>): UsageTopQuery => ({
  query_key: "q1",
  queryid: "1",
  identifier: "other",
  display_name: "기타 SQL",
  category: "other",
  calls_delta: 0,
  rows_delta: 0,
  exec_time_delta_ms: 0,
  share_pct: 0,
  cause_candidate: "UNKNOWN_QUERY_SPIKE",
  confidence_basis: "test",
  normalized_query: "select 1",
  ...overrides,
});

const payload = (overrides: Partial<UsageDiagnosticsPayload> = {}): UsageDiagnosticsPayload => ({
  latest_collection: {
    usage_date: "2026-08-16", interval_started_at: "2026-08-15T15:10:00Z", interval_ended_at: "2026-08-16T15:10:00Z",
    data_quality: "complete", visitors: 10, statement_calls: 2584, statement_rows: 3000,
    exec_time_ms: 14600, statements_per_visitor: 258.4, db_size_bytes: 82 * 1024 * 1024,
    db_growth_bytes: 1024, candidate: "NOTIFICATION_POLLING", confidence: "high",
    candidate_share_pct: 44.7, primary_identifier: "get_unread_count",
    primary_display_name: "알림 미읽음 수", primary_share_pct: 44.7,
  },
  latest_complete: null,
  comparison: null,
  top_queries: [],
  trend: [],
  collection: { ready_for_daily: true },
  db_quota_bytes: null,
  ...overrides,
});

describe("query classification", () => {
  it("classifies notification, attendance, live and unknown groups", () => {
    expect(classifyUsageQuery("select get_unread_count()").candidate).toBe("NOTIFICATION_POLLING");
    expect(classifyUsageQuery("from attendance_location_candidates").candidate).toBe("ATTENDANCE_POLLING");
    expect(classifyUsageQuery("from youtube_live_status").candidate).toBe("LIVE_POLLING");
    expect(classifyUsageQuery("select * from unrelated_table").candidate).toBe("UNKNOWN_QUERY_SPIKE");
  });
});

describe("cumulative delta safety", () => {
  it("handles first baseline, normal delta, no calls, reset and counter decrease", () => {
    expect(cumulativeDelta(20, null, false, false)).toEqual({ value: null, quality: "baseline_pending" });
    expect(cumulativeDelta(20, null)).toEqual({ value: 20, quality: "complete" });
    expect(cumulativeDelta(120, 100)).toEqual({ value: 20, quality: "complete" });
    expect(cumulativeDelta(100, 100)).toEqual({ value: 0, quality: "complete" });
    expect(cumulativeDelta(20, 100, true)).toEqual({ value: null, quality: "reset_detected" });
    expect(cumulativeDelta(20, 100)).toEqual({ value: null, quality: "reset_detected" });
  });
});

describe("candidate confidence", () => {
  it("uses high/medium/low thresholds and unknown fallback", () => {
    const notification = query({ calls_delta: 410, cause_candidate: "NOTIFICATION_POLLING" });
    expect(deriveUsageCause([notification], 1000)).toMatchObject({ candidate: "NOTIFICATION_POLLING", confidence: "high" });
    expect(deriveUsageCause([{ ...notification, calls_delta: 300 }], 1000).confidence).toBe("medium");
    expect(deriveUsageCause([{ ...notification, calls_delta: 150 }], 1000).confidence).toBe("low");
    expect(deriveUsageCause([{ ...notification, calls_delta: 50 }], 1000).candidate).toBe("UNKNOWN_QUERY_SPIKE");
  });
});

describe("spike evaluation", () => {
  const complete = payload().latest_collection!;
  const top = [query({ identifier: "get_unread_count", calls_delta: 1154, share_pct: 44.7, cause_candidate: "NOTIFICATION_POLLING" })];

  it("warns when visitors are similar but statements surge", () => {
    const result = evaluateUsageDiagnostics(payload({
      latest_complete: complete,
      top_queries: top,
      comparison: { previous_date: "2026-08-15", previous_calls: 584, previous_day_pct: 342, prior_days: 7, prior_7d_avg_calls: 425, prior_7d_median_calls: 410, vs_7d_avg_pct: 507, prior_7d_weighted_per_visitor: 175.8, per_visitor_vs_7d_pct: 47 },
    }));
    expect(result.severity).toBe("WARN");
    expect(result.findings.some((finding) => finding.code === "QUERY_SPIKE")).toBe(true);
  });

  it("reports proportional visitor growth as info", () => {
    const result = evaluateUsageDiagnostics(payload({
      latest_complete: complete,
      comparison: { previous_date: "2026-08-15", previous_calls: 500, previous_day_pct: 416, prior_days: 7, prior_7d_avg_calls: 500, prior_7d_median_calls: 490, vs_7d_avg_pct: 416, prior_7d_weighted_per_visitor: 250, per_visitor_vs_7d_pct: 3.4 },
    }));
    expect(result.findings.some((finding) => finding.code === "TRAFFIC_GROWTH")).toBe(true);
    expect(result.findings.some((finding) => finding.code === "QUERY_SPIKE")).toBe(false);
  });

  it("does not spike on normal traffic, pending baseline or insufficient data", () => {
    const normal = evaluateUsageDiagnostics(payload({ latest_complete: { ...complete, statement_calls: 600 }, comparison: { previous_date: null, previous_calls: null, previous_day_pct: 5, prior_days: 7, prior_7d_avg_calls: 580, prior_7d_median_calls: 570, vs_7d_avg_pct: 3, prior_7d_weighted_per_visitor: 55, per_visitor_vs_7d_pct: 9 } }));
    expect(normal.findings.some((finding) => finding.code === "QUERY_SPIKE")).toBe(false);
    expect(evaluateUsageDiagnostics(payload({ latest_collection: { ...complete, data_quality: "baseline_pending" } })).findings[0].code).toBe("USAGE_DATA_INCOMPLETE");
    const insufficient = evaluateUsageDiagnostics(payload({ latest_complete: complete, comparison: { previous_date: null, previous_calls: null, previous_day_pct: null, prior_days: 2, prior_7d_avg_calls: 600, prior_7d_median_calls: 600, vs_7d_avg_pct: 330, prior_7d_weighted_per_visitor: 100, per_visitor_vs_7d_pct: 158 } }));
    expect(insufficient.findings.some((finding) => finding.code === "USAGE_DATA_INSUFFICIENT")).toBe(true);
  });
});

describe("QUERY_SPIKE SQL/TS 기준 일치", () => {
  const anomalyFn = anomalyFixSql.slice(anomalyFixSql.indexOf("function public.admin_usage_check_anomalies"));

  it("SQL 이상감지 함수가 TS 와 같은 임계값을 쓴다", () => {
    for (const value of [
      QUERY_SPIKE_THRESHOLDS.minCalls,
      QUERY_SPIKE_THRESHOLDS.vs7dPct,
      QUERY_SPIKE_THRESHOLDS.vsPreviousDayPct,
      QUERY_SPIKE_THRESHOLDS.perVisitorPct,
    ]) {
      expect(anomalyFn).toMatch(new RegExp(`>=\\s*${value}(?![0-9])`));
    }
    expect(anomalyFn).toContain(`coalesce(v_base.days, 0) >= ${QUERY_SPIKE_THRESHOLDS.minPriorDays}`);
  });

  it("전일 대비 기준을 OR 분기로 둔다 (UI 만 민감해지는 drift 방지)", () => {
    expect(anomalyFn).toMatch(/v_calls_pct >= 100\)\s*\n?\s*or \(v_prev_day_pct is not null and v_prev_day_pct >= 150\)/);
  });

  it("candidate share 구간이 collect_daily 와 같다", () => {
    expect(CANDIDATE_SHARE_THRESHOLDS).toEqual({ candidate: 10, medium: 25, high: 40 });
    for (const value of Object.values(CANDIDATE_SHARE_THRESHOLDS)) {
      expect(migrationSql).toMatch(new RegExp(`>= ${value}\\b`));
    }
  });

  it("전일 대비만 급증해도 spike 로 잡는다 (7일 평균 대비는 미달)", () => {
    const complete = payload().latest_collection!;
    const result = evaluateUsageDiagnostics(payload({
      latest_complete: complete,
      comparison: {
        previous_date: "2026-08-15", previous_calls: 900, previous_day_pct: 187,
        prior_days: 7, prior_7d_avg_calls: 2000, prior_7d_median_calls: 2000,
        vs_7d_avg_pct: 29, prior_7d_weighted_per_visitor: 150, per_visitor_vs_7d_pct: 72,
      },
    }));
    expect(result.findings.some((finding) => finding.code === "QUERY_SPIKE")).toBe(true);
  });
});

describe("v1 감시 6종 보존", () => {
  const anomalyFn = anomalyFixSql.slice(anomalyFixSql.indexOf("function public.admin_usage_check_anomalies"));

  it("스냅샷 기반 4종이 SQL 에 남아 있다", () => {
    expect(anomalyFn).toContain("방문자 %s명 (30일 중앙값");
    expect(anomalyFn).toContain("DB 하루 증가 %sMB (30일 중앙값");
    expect(anomalyFn).toContain("행 과다 쿼리 +%s회");
    expect(anomalyFn).toContain("테이블 주간 +%sMB");
  });

  it("하루 단위 dedupe 를 유지하고 하드코딩 quota 를 되살리지 않는다", () => {
    expect(anomalyFn).toContain("type = 'usage_anomaly' and created_at > now() - interval '1 day'");
    expect(anomalyFixSql).not.toContain("500 * 1024 * 1024");
  });

  it("아직 ops_* 로 rename 하지 않았다", () => {
    expect(anomalyFixSql).not.toMatch(/'ops_[a-z_]+'/);
  });
});

describe("DB quota 미설정 처리", () => {
  it("quota 가 없으면 정상이 아니라 판정 불가로 보고한다", () => {
    const complete = payload().latest_collection!;
    const result = evaluateUsageDiagnostics(payload({ latest_complete: complete, db_quota_bytes: null }));
    const finding = result.findings.find((item) => item.code === "DB_QUOTA_UNSET");
    expect(finding).toBeDefined();
    expect(result.severity).not.toBe("OK");
    expect(result.findings.some((item) => item.code === "DB_CAPACITY")).toBe(false);
  });

  it("quota 가 있으면 임계 구간대로 판정한다", () => {
    const complete = payload().latest_collection!;
    const at = (pct: number) => evaluateUsageDiagnostics(payload({
      latest_complete: { ...complete, db_size_bytes: pct },
      db_quota_bytes: 100,
    })).findings.find((item) => item.code === "DB_CAPACITY");

    expect(at(DB_CAPACITY_THRESHOLDS.critical)?.severity).toBe("CRITICAL");
    expect(at(DB_CAPACITY_THRESHOLDS.warn)?.severity).toBe("WARN");
    expect(at(DB_CAPACITY_THRESHOLDS.info)?.severity).toBe("INFO");
    expect(at(DB_CAPACITY_THRESHOLDS.info - 1)).toBeUndefined();
    expect(evaluateUsageDiagnostics(payload({
      latest_complete: complete, db_quota_bytes: 100,
    })).findings.some((item) => item.code === "DB_QUOTA_UNSET")).toBe(false);
  });
});

// admin_usage_diagnostics 가 complete 행 없이도 200 을 주도록 고쳤다(20260818220000).
// 그때 오는 응답 모양(comparison=null, latest_complete=null)을 TS 쪽이 안전하게 다루는지 고정한다.
describe("baseline 데이터가 없을 때의 응답 처리", () => {
  const pendingOnly = (): UsageDiagnosticsPayload => ({
    latest_collection: {
      ...payload().latest_collection!,
      data_quality: "baseline_pending",
      statement_calls: null,
      statements_per_visitor: null,
      candidate: null,
      confidence: null,
      candidate_share_pct: null,
    },
    latest_complete: null,
    comparison: null,
    top_queries: [],
    trend: [],
    collection: { ready_for_daily: false },
    db_quota_bytes: null,
  });

  it("complete 행이 0건이어도 예외 없이 판정한다", () => {
    const result = evaluateUsageDiagnostics(pendingOnly());
    expect(result.severity).toBe("INFO");
    expect(result.findings.some((f) => f.code === "USAGE_DATA_INCOMPLETE")).toBe(true);
    // 비교 데이터가 없으니 spike 판정은 하지 않는다
    expect(result.findings.some((f) => f.code === "QUERY_SPIKE")).toBe(false);
    expect(result.findings.some((f) => f.code === "TRAFFIC_GROWTH")).toBe(false);
  });

  it("수집 자체가 처음이면 baseline_pending 안내를 준다", () => {
    const fresh = { ...pendingOnly(), latest_collection: null };
    const result = evaluateUsageDiagnostics(fresh);
    expect(result.findings.some((f) => f.code === "USAGE_BASELINE_PENDING")).toBe(true);
  });

  it("quota 가 설정돼 있으면 complete 행이 없어도 용량 판정은 별개로 동작한다", () => {
    const withQuota: UsageDiagnosticsPayload = {
      ...pendingOnly(),
      latest_complete: { ...payload().latest_collection!, db_size_bytes: 88042643 },
      db_quota_bytes: 524288000,
    };
    const result = evaluateUsageDiagnostics(withQuota);
    // 16.79% → 60% 미만이라 DB_CAPACITY 없음, quota 는 설정돼 있으므로 UNSET 도 없음
    expect(result.findings.some((f) => f.code === "DB_QUOTA_UNSET")).toBe(false);
    expect(result.findings.some((f) => f.code === "DB_CAPACITY")).toBe(false);
  });

  it("prior_days 가 3 미만이면 비교 부족으로 처리한다", () => {
    for (const priorDays of [0, 1, 2]) {
      const result = evaluateUsageDiagnostics(payload({
        latest_complete: payload().latest_collection!,
        comparison: {
          previous_date: null, previous_calls: null, previous_day_pct: null,
          prior_days: priorDays, prior_7d_avg_calls: null, prior_7d_median_calls: null,
          vs_7d_avg_pct: null, prior_7d_weighted_per_visitor: null, per_visitor_vs_7d_pct: null,
        },
      }));
      expect(result.findings.some((f) => f.code === "USAGE_DATA_INSUFFICIENT"), `prior_days=${priorDays}`).toBe(true);
      expect(result.findings.some((f) => f.code === "QUERY_SPIKE")).toBe(false);
    }
  });

  it("리포트도 comparison 없이 렌더된다", () => {
    const text = buildUsageReportV2(pendingOnly());
    expect(text).toContain("[chflow-usage-report v2]");
    expect(text).toContain("data_quality=baseline_pending");
    expect(text).toContain("- vs_previous_day=unavailable");
    expect(text).toContain("- vs_7d_average=unavailable");
  });
});

describe("usage report v2", () => {
  it("renders an AI-readable report with measured values and cause", () => {
    const complete = payload().latest_collection!;
    const text = buildUsageReportV2(payload({
      latest_complete: complete,
      top_queries: [query({ identifier: "get_unread_count", calls_delta: 1154, share_pct: 44.7, exec_time_delta_ms: 1200, cause_candidate: "NOTIFICATION_POLLING" })],
      comparison: { previous_date: "2026-08-15", previous_calls: 584, previous_day_pct: 342, prior_days: 7, prior_7d_avg_calls: 425, prior_7d_median_calls: 410, vs_7d_avg_pct: 507, prior_7d_weighted_per_visitor: 175.8, per_visitor_vs_7d_pct: 47 },
    }));
    expect(text).toContain("[chflow-usage-report v2]");
    expect(text).toContain("db_statements=2584");
    expect(text).toContain("candidate=NOTIFICATION_POLLING");
    expect(text).toContain("get_unread_count 1154 (44.7%)");
    expect(text).toContain("db_quota=unset");
  });
});
