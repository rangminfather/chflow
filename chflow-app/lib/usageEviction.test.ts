// pg_stat_statements entry 축출 시나리오. 하루 전체 통계를 버리지 않는 구조를 고정한다.
//
// SQL 수집기(admin_usage_collect_daily)는 로컬에 Postgres 가 없어 실행 검증이 불가하므로
// 마이그레이션 본문의 분기 구조를 정적으로 검증하고, TS 판정 로직은 payload 단위로 검증한다.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANALYZABLE_QUALITIES,
  SPIKE_ELIGIBLE_QUALITIES,
  buildUsageReportV2,
  dataQualityLabel,
  evaluateUsageDiagnostics,
  isAnalyzableQuality,
  isSpikeEligibleQuality,
  type UsageDailyRow,
  type UsageDataQuality,
  type UsageDiagnosticsPayload,
  type UsageTopQuery,
} from "./usageDiagnostics";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260819010000_usage_partial_evicted_stats.sql");
const sql = readFileSync(MIGRATION, "utf8");
const collector = sql.slice(
  sql.indexOf("create or replace function public.admin_usage_collect_daily"),
  sql.indexOf("revoke all on function public.admin_usage_collect_daily"),
);
const diagnostics = sql.slice(sql.indexOf("create or replace function public.admin_usage_diagnostics"));

const row = (over: Partial<UsageDailyRow> = {}): UsageDailyRow => ({
  usage_date: "2026-08-19", interval_started_at: "2026-08-18T15:10:00Z", interval_ended_at: "2026-08-19T15:10:00Z",
  data_quality: "complete", visitors: 4, statement_calls: 500, statement_rows: 900,
  exec_time_ms: 1200, statements_per_visitor: 125, db_size_bytes: 89885843,
  db_growth_bytes: 1843200, candidate: "NOTIFICATION_POLLING", confidence: "high",
  candidate_share_pct: 42, primary_identifier: "get_unread_count",
  primary_display_name: "알림 미읽음 수", primary_share_pct: 42,
  ...over,
});
const query = (over: Partial<UsageTopQuery> = {}): UsageTopQuery => ({
  query_key: "k1", queryid: "1", identifier: "get_unread_count", display_name: "알림 미읽음 수",
  category: "notification", calls_delta: 200, rows_delta: 200, exec_time_delta_ms: 300,
  share_pct: 40, cause_candidate: "NOTIFICATION_POLLING", confidence_basis: "test",
  normalized_query: "select get_unread_count()", ...over,
});
const payload = (over: Partial<UsageDiagnosticsPayload> = {}): UsageDiagnosticsPayload => ({
  latest_collection: row(), latest_complete: null, comparison: null,
  top_queries: [], trend: [], collection: { ready_for_daily: true }, db_quota_bytes: 524288000,
  ...over,
});

// ── A. dealloc 변화 없음 → complete, 기존 동작 유지 ─────────────────────
describe("A. 축출 없음 → complete", () => {
  it("dealloc_delta=0 이면 complete 로 분류하는 분기가 있다", () => {
    expect(collector).toContain("elsif coalesce(v_dealloc_delta, 0) <> 0 or v_missing then");
    expect(collector).toContain("v_quality := 'partial_evicted'");
    expect(collector).toMatch(/else\s*\n\s*v_quality := 'complete';/);
  });

  it("complete 의 query delta 계산식은 기존과 동일하다 (신규 key 의 lifetime cumulative 포함)", () => {
    expect(collector).toContain("v_quality = 'complete'");
    expect(collector).toContain("case when b.query_key is null then c.cumulative_calls else c.cumulative_calls - b.cumulative_calls end");
  });

  it("complete payload 판정은 그대로다", () => {
    const result = evaluateUsageDiagnostics(payload({ latest_collection: row() }));
    expect(result.findings.some((f) => f.code === "USAGE_DATA_PARTIAL")).toBe(false);
    expect(result.findings.some((f) => f.code === "USAGE_DATA_INCOMPLETE")).toBe(false);
  });

  it("baseline 미준비와 interval 불일치는 complete/partial 보다 먼저 차단한다", () => {
    const pendingAt = collector.indexOf("if not v_ready then");
    const intervalAt = collector.indexOf("v_quality := 'interval_misaligned'");
    const partialAt = collector.indexOf("v_quality := 'partial_evicted'");
    const completeAt = collector.indexOf("v_quality := 'complete'");
    expect(pendingAt).toBeGreaterThan(-1);
    expect(intervalAt).toBeGreaterThan(pendingAt);
    expect(partialAt).toBeGreaterThan(intervalAt);
    expect(completeAt).toBeGreaterThan(partialAt);
    expect(collector).toContain("v_quality := 'baseline_pending'");
    expect(collector).toContain("not between 82800 and 90000");
  });
});

// ── B. dealloc +1, 일부 query 사라짐 → partial, 살아남은 delta 저장 ────
describe("B. 축출 발생 → partial_evicted, 살아남은 query 는 저장", () => {
  it("query_daily 저장 조건이 complete 뿐 아니라 partial 도 포함한다", () => {
    expect(collector).toContain("if v_quality in ('complete', 'partial_evicted') then");
    // 이전 구조(complete 전용 게이트)가 남아 있으면 실패
    expect(collector).not.toMatch(/if v_quality = 'complete' then\s*\n\s*insert into public\.admin_usage_query_daily/);
  });

  it("partial 은 baseline 양쪽 존재 + counter 정상 증가한 key 만 센다", () => {
    expect(collector).toContain("b.query_key is not null");
    expect(collector).toContain("and c.cumulative_calls >= b.cumulative_calls");
    expect(collector).toContain("and c.cumulative_rows >= b.cumulative_rows");
    expect(collector).toContain("and c.cumulative_exec_time_ms >= b.cumulative_exec_time_ms");
  });

  it("축출을 dealloc 카운터만으로 감지하지 않는다 (소실·역행도 신호)", () => {
    expect(collector).toContain("v_missing := v_excluded_count > 0;");
    expect(collector).toMatch(/into v_regressed/);
    // dealloc 관측 불가(null) 환경에서도 partial 을 잡을 수 있어야 한다
    expect(collector).toContain("coalesce(v_dealloc_delta, 0) <> 0 or v_missing");
  });

  it("dealloc 증가량이 +1이든 +N이든 partial 분기를 탄다", () => {
    // SQL은 특정 값(1)이 아니라 0이 아닌 증가량 전체를 처리한다.
    expect(collector).toContain("coalesce(v_dealloc_delta, 0) <> 0");
    expect(collector).not.toContain("v_dealloc_delta = 1");
  });

  it("tracked/excluded 수와 known calls는 같은 usage_date에서 계산한다", () => {
    expect(collector).toContain("select count(*)::int into v_tracked_count");
    expect(collector).toContain("from public.admin_usage_query_daily where usage_date = v_date");
    expect(collector).toContain("where usage_date = v_date;");
    expect(collector).toContain("tracked_query_count = v_tracked_count");
    expect(collector).toContain("excluded_query_count");
    expect(collector).toContain("v_excluded_count := v_excluded_count + v_new_excluded_count");
    expect(collector).toMatch(/if v_quality = 'partial_evicted' then[\s\S]*not exists \([\s\S]*admin_usage_query_baselines b[\s\S]*b\.query_key = c\.query_key/);
  });

  it("partial 상태를 payload 에서 INFO 로 설명한다", () => {
    const result = evaluateUsageDiagnostics(payload({
      latest_collection: row({ data_quality: "partial_evicted", tracked_query_count: 120, excluded_query_count: 98 }),
    }));
    const finding = result.findings.find((f) => f.code === "USAGE_DATA_PARTIAL");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("INFO");
    expect(finding?.detail).toContain("집계 120건");
    expect(finding?.detail).toContain("제외 98건");
    expect(finding?.detail).toContain("자동판정에서는 제외");
  });
});

// ── C. 살아남은 고빈도 폴링 query 의 delta 가 정확 ──────────────────────
describe("C. 살아남은 폴링 query 통계", () => {
  it("partial 에서도 top_queries 가 조회된다", () => {
    const result = payload({
      latest_collection: row({ data_quality: "partial_evicted", tracked_query_count: 3, excluded_query_count: 98 }),
      top_queries: [query({ calls_delta: 288, identifier: "get_my_notification_counts" })],
      top_queries_source: {
        usage_date: "2026-08-19", data_quality: "partial_evicted",
        tracked_query_count: 3, excluded_query_count: 98, dealloc_delta: 1,
        known_statement_calls: 288, known_statement_rows: 288, known_exec_time_ms: 300,
        lower_bound: true, share_basis: "known_calls",
      },
    });
    expect(result.top_queries[0].calls_delta).toBe(288);
    expect(result.top_queries_source?.data_quality).toBe("partial_evicted");
  });

  it("고빈도 query 가 반드시 살아남는다고 가정하지 않는다 (제외 수를 노출)", () => {
    // 제외 규모를 항상 알 수 있어야 한다
    expect(collector).toContain("excluded_query_count");
    expect(collector).toContain("tracked_query_count");
    expect(diagnostics).toContain("'tracked_query_count', v_analyzable.tracked_query_count");
    expect(diagnostics).toContain("'excluded_query_count', v_analyzable.excluded_query_count");
  });
});

// ── D. counter regression → 해당 query 제외 ────────────────────────────
describe("D. counter 역행", () => {
  it("역행 key 는 제외 집계에 포함된다", () => {
    expect(collector).toMatch(/where not exists \([\s\S]*c\.cumulative_calls >= b\.cumulative_calls/);
  });

  it("counter 감소는 선택적 reset과 구분할 수 없어 reset_detected 로 처리한다", () => {
    expect(collector).toMatch(/elsif v_regressed then[\s\S]{0,300}v_quality := 'reset_detected';/);
    expect(collector).not.toContain("or v_regressed or v_missing then");
  });
});

// ── E. stats_reset → 기존 invalid 유지, partial 로 오인 금지 ───────────
describe("E. 전역 stats_reset", () => {
  it("stats_reset 변경은 reset_detected 로 유지한다", () => {
    expect(collector).toMatch(/v_prev_reset is distinct from v_reset[\s\S]{0,300}v_quality := 'reset_detected';/);
  });

  it("reset_detected 는 partial 보다 먼저 판정된다 (오인 방지)", () => {
    const resetAt = collector.indexOf("v_quality := 'reset_detected'");
    const partialAt = collector.indexOf("v_quality := 'partial_evicted'");
    expect(resetAt).toBeGreaterThan(-1);
    expect(partialAt).toBeGreaterThan(resetAt);
  });

  it("reset_detected / interval_misaligned 는 query_daily 를 저장하지 않는다", () => {
    expect(ANALYZABLE_QUALITIES).toEqual(["complete", "partial_evicted"]);
    expect(isAnalyzableQuality("reset_detected")).toBe(false);
    expect(isAnalyzableQuality("interval_misaligned")).toBe(false);
    expect(isAnalyzableQuality("stats_evicted")).toBe(false);
  });
});

// ── F. QUERY_SPIKE 는 complete 전용 ───────────────────────────────────
describe("F. QUERY_SPIKE 정책", () => {
  const spikeComparison = {
    previous_date: "2026-08-18", previous_calls: 200, previous_day_pct: 400,
    prior_days: 7, prior_7d_avg_calls: 300, prior_7d_median_calls: 300,
    vs_7d_avg_pct: 500, prior_7d_weighted_per_visitor: 60, per_visitor_vs_7d_pct: 90,
  };

  it("complete 이면 기존대로 판정한다", () => {
    const complete = row({ statement_calls: 2000, statements_per_visitor: 500 });
    const result = evaluateUsageDiagnostics(payload({
      latest_collection: complete,
      latest_analysis: complete,
      latest_complete: complete,
      comparison: spikeComparison,
    }));
    expect(result.findings.some((f) => f.code === "QUERY_SPIKE")).toBe(true);
  });

  it("partial 데이터로는 자동 판정하지 않는다", () => {
    const result = evaluateUsageDiagnostics(payload({
      latest_analysis: row({ data_quality: "partial_evicted", statement_calls: 2000, statements_per_visitor: 500 }),
      latest_complete: row({ usage_date: "2026-08-18", statement_calls: 200, statements_per_visitor: 50 }),
      comparison: spikeComparison,
    }));
    expect(result.findings.some((f) => f.code === "QUERY_SPIKE")).toBe(false);
    expect(result.findings.some((f) => f.code === "TRAFFIC_GROWTH")).toBe(false);
  });

  it("spike 허용 품질은 complete 뿐이다", () => {
    expect(SPIKE_ELIGIBLE_QUALITIES).toEqual(["complete"]);
    expect(isSpikeEligibleQuality("partial_evicted")).toBe(false);
    expect(isSpikeEligibleQuality("complete")).toBe(true);
  });

  it("이 마이그레이션은 anomaly 함수를 재정의하지 않는다", () => {
    // 주석으로 언급하는 것은 허용하되, 함수 재정의·알림 INSERT 는 없어야 한다.
    expect(sql).not.toMatch(/create or replace function public\.admin_usage_check_anomalies/);
    expect(sql).not.toMatch(/insert into public\.notifications/i);
    expect(sql).not.toMatch(/'ops_usage_anomaly'/);
  });
});

// ── G. UI/RPC contract ────────────────────────────────────────────────
describe("G. RPC / UI contract", () => {
  it("diagnostics 는 partial 도 top_queries 출처로 삼는다", () => {
    expect(diagnostics).toContain("where data_quality in ('complete', 'partial_evicted') order by usage_date desc limit 1");
    expect(diagnostics).toContain("where usage_date = v_analyzable.usage_date");
  });

  it("comparison / latest_complete 는 complete 전용을 유지한다", () => {
    expect(diagnostics).toContain("select * into v_complete from public.admin_usage_daily\n    where data_quality = 'complete'");
    expect(diagnostics).toContain("'comparison', case when v_complete.usage_date is null then null else jsonb_build_object(");
    expect(diagnostics).toContain("where data_quality = 'complete' and usage_date < v_complete.usage_date");
  });

  it("latest complete 와 latest partial 이 달라도 summary/TOP/candidate 날짜를 섞지 않는다", () => {
    const partial = row({
      usage_date: "2026-08-19", data_quality: "partial_evicted",
      statement_calls: 400, statements_per_visitor: 100,
      candidate: null, confidence: null, candidate_share_pct: null,
    });
    const complete = row({ usage_date: "2026-08-18", statement_calls: 2000, statements_per_visitor: 500 });
    const mixed = payload({
      latest_collection: partial,
      latest_analysis: partial,
      latest_complete: complete,
      comparison: {
        previous_date: "2026-08-17", previous_calls: 200, previous_day_pct: 900,
        prior_days: 7, prior_7d_avg_calls: 250, prior_7d_median_calls: 240,
        vs_7d_avg_pct: 700, prior_7d_weighted_per_visitor: 50, per_visitor_vs_7d_pct: 900,
      },
      top_queries: [query({ calls_delta: 200, share_pct: 50 })],
      top_queries_source: {
        usage_date: "2026-08-19", data_quality: "partial_evicted",
        tracked_query_count: 10, excluded_query_count: 98, dealloc_delta: 1,
        known_statement_calls: 400, known_statement_rows: 900, known_exec_time_ms: 1200,
        lower_bound: true, share_basis: "known_calls",
      },
    });
    const result = evaluateUsageDiagnostics(mixed);
    const report = buildUsageReportV2(mixed);

    expect(result.cause).toEqual({ candidate: "UNKNOWN_QUERY_SPIKE", confidence: "low", sharePct: 0 });
    expect(result.findings.some((f) => f.code === "QUERY_SPIKE")).toBe(false);
    expect(report).toContain("date=2026-08-19");
    expect(report).toContain("known_calls=400");
    expect(report).toContain("known_share=50.0%");
    expect(report).not.toContain("known_calls=2000");
    expect(report).toContain("reason=partial_evicted");
  });

  it("TOP source 날짜가 analysis 날짜와 다르면 report에서 query를 숨긴다", () => {
    const partial = row({ usage_date: "2026-08-19", data_quality: "partial_evicted", statement_calls: 400 });
    const report = buildUsageReportV2(payload({
      latest_collection: partial,
      latest_analysis: partial,
      top_queries: [query({ calls_delta: 999 })],
      top_queries_source: {
        usage_date: "2026-08-18", data_quality: "complete",
        tracked_query_count: 1, excluded_query_count: 0, dealloc_delta: 0,
        known_statement_calls: 999, known_statement_rows: 999, known_exec_time_ms: 999,
        lower_bound: false, share_basis: "total_calls",
      },
    }));
    expect(report).toContain("date=2026-08-19");
    expect(report).toContain("top_queries:\n- none");
    expect(report).not.toContain("get_unread_count 999");
  });

  it("partial daily candidate/confidence 는 확정하지 않는다", () => {
    expect(collector).toContain("when v_quality <> 'complete' then null");
    expect(collector).toMatch(/candidate = case[\s\S]*when v_quality = 'complete'[\s\S]*else null/);
    expect(collector).toMatch(/candidate_share_pct = case when v_quality = 'complete'/);
  });

  it("품질 라벨이 partial 을 구분해서 보여준다", () => {
    expect(dataQualityLabel("partial_evicted")).toContain("부분");
    expect(dataQualityLabel("complete")).toBe("완료");
  });

  it("리포트가 부분 통계임을 명시한다", () => {
    const text = buildUsageReportV2(payload({
      latest_complete: null,
      latest_collection: row({ data_quality: "partial_evicted", tracked_query_count: 3, excluded_query_count: 98 }),
      top_queries: [query()],
      top_queries_source: {
        usage_date: "2026-08-19", data_quality: "partial_evicted",
        tracked_query_count: 3, excluded_query_count: 98, dealloc_delta: 1,
        known_statement_calls: 200, known_statement_rows: 200, known_exec_time_ms: 300,
        lower_bound: true, share_basis: "known_calls",
      },
    }));
    expect(text).toContain("quality=partial_evicted");
    expect(text).toContain("excluded=98");
    expect(text).toContain("lower bound");
    expect(text).toContain("known_share=40.0%");
    expect(text).toContain("reason=partial_evicted");
  });

  it("관리자 화면이 부분 통계 경고를 렌더한다", () => {
    const page = readFileSync(resolve(here, "../app/admin/usage-status/page.tsx"), "utf8");
    expect(page).toContain("top_queries_source");
    expect(page).toContain("부분 통계");
    expect(page).toContain("최소 확인량");
    expect(page).toContain('partial_evicted');
  });
});

// ── 스키마/불변 원칙 ──────────────────────────────────────────────────
describe("스키마와 불변 원칙", () => {
  it("partial_evicted 를 두 테이블 CHECK 에 허용한다", () => {
    expect(sql).toContain("'baseline_pending', 'complete', 'partial_evicted',");
    expect(sql).toContain("check (data_quality in ('complete', 'partial_evicted'))");
  });

  it("기존 stats_evicted 값을 계속 허용한다 (2026-08-18 행 호환)", () => {
    expect(sql).toContain("'stats_evicted'");
    const qualities: UsageDataQuality[] = ["stats_evicted", "partial_evicted"];
    qualities.forEach((q) => expect(typeof dataQualityLabel(q)).toBe("string"));
  });

  it("추가 컬럼은 3개로 제한한다", () => {
    const added = [...sql.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
    expect(added.sort()).toEqual(["dealloc_delta", "excluded_query_count", "tracked_query_count"]);
  });

  it("파괴적 변경이 없고 기존 행을 backfill 하지 않는다", () => {
    expect(sql).not.toMatch(/\b(drop\s+table|drop\s+column|truncate)\b/i);
    // 기존 usage 행을 갱신하지 않는다 (2026-08-18 재구성 금지)
    expect(sql).not.toMatch(/update public\.admin_usage_daily\s+set data_quality/i);
  });

  it("quota / 알림 경로를 건드리지 않는다", () => {
    for (const forbidden of [
      "SUPABASE_DB_QUOTA_BYTES", "R2_STORAGE_QUOTA_BYTES",
      "ops_usage_db_capacity", "ops_usage_r2_capacity",
      "notification", "audience",
    ]) expect(sql, forbidden).not.toContain(forbidden);
  });

  it("cron과 legacy anomaly 함수를 바꾸거나 collector를 즉시 실행하지 않는다", () => {
    expect(sql).not.toMatch(/cron\.(schedule|unschedule)|perform\s+cron\./i);
    expect(sql).not.toMatch(/create or replace function public\.admin_usage_check_anomalies/);
    expect(sql).not.toMatch(/select\s+public\.admin_usage_collect_daily\s*\(\s*\)\s*;/i);
  });

  it("internal collector와 관리자 RPC 권한 경계를 유지한다", () => {
    expect(sql).toContain("language plpgsql security definer\nset search_path = public, extensions");
    expect(sql).toContain("revoke all on function public.admin_usage_collect_daily() from public, anon, authenticated");
    expect(sql).toContain("if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then");
    expect(sql).toContain("revoke all on function public.admin_usage_diagnostics(int) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.admin_usage_diagnostics(int) to authenticated");
  });
});
