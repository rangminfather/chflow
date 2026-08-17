import { describe, expect, it } from "vitest";
import {
  buildUsageReportV2,
  classifyUsageQuery,
  cumulativeDelta,
  deriveUsageCause,
  evaluateUsageDiagnostics,
  type UsageDiagnosticsPayload,
  type UsageTopQuery,
} from "./usageDiagnostics";

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
