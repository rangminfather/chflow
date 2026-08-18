import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260817090000_usage_diagnostics_v2.sql");
const sql = readFileSync(migrationPath, "utf8");
const anomalyFixPath = resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260817223700_usage_diagnostics_v2_anomaly_monitoring_fix.sql");
const anomalyFixSql = readFileSync(anomalyFixPath, "utf8");
// 알림 user/ops 분리 마이그레이션이 anomaly 함수를 다시 CREATE OR REPLACE 하므로
// 감시 퇴행 검사는 "가장 마지막 정의"를 대상으로 해야 한다.
const audiencePath = resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260818093000_notification_user_ops_audience.sql");
const audienceSql = readFileSync(audiencePath, "utf8");
const sha256 = (value) => createHash("sha256").update(value.replace(/\r\n/g, "\n")).digest("hex");
const appliedMigrationSha256 = sha256(sql);
const expectedAppliedMigrationSha256 = "073729a674673d29475a8454705a324b0a645d9cc8ea6c14672dcc49f232b397";
// 20260817223700 도 운영 DB 에 적용됐다. 두 파일 모두 불변으로 고정한다.
const appliedAnomalyFixSha256 = sha256(anomalyFixSql);
const expectedAppliedAnomalyFixSha256 = "5701d48d3d685aee13ce8c4689a901fe2c7281ee1744289d515ef75e7569beba";

// admin_usage_check_anomalies() 의 최신 정의를 고른다.
const latestAnomalySql = audienceSql.includes("function public.admin_usage_check_anomalies")
  ? audienceSql
  : anomalyFixSql;

// admin_usage_diagnostics() 의 미할당 record 버그를 고친 forward migration.
const priorFixPath = resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260818220000_fix_admin_usage_diagnostics_unassigned_prior.sql");
const priorFixSql = readFileSync(priorFixPath, "utf8");
// 20260818093000 도 운영 DB 에 적용됐다. 불변으로 고정한다.
const appliedAudienceSha256 = sha256(audienceSql);
const expectedAppliedAudienceSha256 = "668fd5f2f2fe0cff024e38ed08e88617db0d0566af83084b4da72b0fe9827140";

/** 지정 파일에서 함수 정의 본문만 잘라낸다. */
function functionBody(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return "";
  const end = source.indexOf("\n$$;", start);
  return end < 0 ? source.slice(start) : source.slice(start, end + 4);
}
// 축출 내성 수집기 + partial_evicted 도입 마이그레이션.
const partialPath = resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260819010000_usage_partial_evicted_stats.sql");
const partialSql = readFileSync(partialPath, "utf8");
// 20260818220000 도 운영 DB 에 적용됐다. 불변으로 고정한다.
const appliedPriorFixSha256 = sha256(priorFixSql);
const expectedAppliedPriorFixSha256 = "4c0fc32995444030f9b24ef0390f69688a7b1df64a4ddaeb63b0db99a443a135";

const DIAG_SIGNATURE = "create or replace function public.admin_usage_diagnostics";
const diagOriginal = functionBody(sql, DIAG_SIGNATURE);
// admin_usage_diagnostics 의 최신 정의를 고른다 (partial 지원 마이그레이션이 다시 교체한다).
const diagLatest = functionBody(partialSql, DIAG_SIGNATURE)
  || functionBody(priorFixSql, DIAG_SIGNATURE)
  || diagOriginal;
// admin_usage_collect_daily 의 최신 정의
const COLLECT_SIGNATURE = "create or replace function public.admin_usage_collect_daily";
const collectLatest = functionBody(partialSql, COLLECT_SIGNATURE) || functionBody(sql, COLLECT_SIGNATURE);
const diagDeclare = diagLatest.slice(diagLatest.indexOf("declare"), diagLatest.indexOf("begin"));
/**
 * 반환 jsonb 의 **최상위** 키만 뽑는다 (응답 contract 비교용).
 * 최상위 키는 4칸 들여쓰기로 쓰여 있고, 중첩 객체 키(6칸 이상)나
 * `data_quality in ('complete', ...)` 같은 SQL 리터럴은 제외된다.
 */
const jsonKeys = (body) => [...body.matchAll(/\n {4}'([a-z0-9_]+)',/g)].map((m) => m[1]).sort().join(",");

// QUERY_SPIKE 기준은 TS 가 단일 출처다. 여기서 그 값을 읽어와 SQL 과 대조해 drift 를 잡는다.
const tsSource = readFileSync(resolve(here, "../lib/usageDiagnostics.ts"), "utf8");
function tsThreshold(key) {
  const match = tsSource.match(new RegExp(`\\b${key}:\\s*(\\d+)`));
  if (!match) throw new Error(`lib/usageDiagnostics.ts 에서 ${key} 를 찾지 못했습니다`);
  return match[1];
}
// 숫자 뒤에 자릿수가 더 붙은 경우(100 vs 1000)를 구분한다.
function sqlHasNumber(value) {
  return new RegExp(`>=\\s*${value}(?![0-9])`).test(latestAnomalySql);
}

const anomalyFn = latestAnomalySql.slice(latestAnomalySql.indexOf("function public.admin_usage_check_anomalies"));

const assertions = [
  [appliedMigrationSha256 === expectedAppliedMigrationSha256, "keeps the applied v2 migration content immutable"],
  [appliedAnomalyFixSha256 === expectedAppliedAnomalyFixSha256, "keeps the applied anomaly fix migration content immutable"],
  [!/\bdrop\s+table\b/i.test(sql), "must not drop tables"],
  [!/\bdrop\s+column\b/i.test(sql), "must not drop columns"],
  [!/\btruncate\b/i.test(sql), "must not truncate production data"],
  [sql.includes("create table if not exists public.admin_usage_query_baselines"), "creates query baselines"],
  [sql.includes("create table if not exists public.admin_usage_query_daily"), "creates daily query deltas"],
  [sql.includes("create table if not exists public.admin_usage_daily"), "creates daily summary"],
  [sql.includes("baseline_pending"), "guards the first baseline"],
  [sql.includes("reset_detected"), "guards pg_stat_statements reset"],
  [sql.includes("stats_evicted"), "guards statement eviction"],
  [sql.includes("c.cumulative_calls < b.cumulative_calls"), "guards decreasing counters"],
  [sql.includes("case when b.query_key is null then c.cumulative_calls"), "handles new queries"],
  [sql.includes("check (calls_delta >= 0)"), "prevents negative call deltas"],
  [sql.includes("at time zone 'Asia/Seoul'"), "uses KST dates"],
  [sql.includes("cron.unschedule"), "removes the existing cron before replacement"],
  [(sql.match(/cron\.schedule\(/g) || []).length === 1, "creates exactly one cron schedule"],
  [sql.includes("'10 15 * * *'"), "runs daily at KST 00:10"],
  [sql.includes("revoke all on public.admin_usage_query_daily from public, anon, authenticated"), "blocks direct daily query access"],
  [sql.includes("set search_path = public"), "fixes SECURITY DEFINER search_path"],
  [/if\s+coalesce\(public\.get_user_role\(\),\s*''\)\s+not in\s*\('admin',\s*'office',\s*'pastor'\)/i.test(sql), "fails closed when the caller has no role"],
  [/errcode\s*=\s*'42501'[\s\S]*message\s*=\s*'usage_diagnostics_forbidden'/i.test(sql), "uses a stable insufficient privilege code"],
  [!/if\s+public\.get_user_role\(\)\s+not in/i.test(sql), "does not reintroduce a NULL-unsafe role check"],
  [/r\.rolname in\s*\([^)]*'service_role'[^)]*\)/i.test(sql), "collects service role statements"],
  [/sum\(s\.calls\)::bigint[\s\S]*group by s\.queryid, s\.query/i.test(sql), "aggregates each role-specific statement into one query identity"],
  [sql.includes("s.query !~* 'pg_stat_statements|pg_database_size|admin_usage_'"), "excludes diagnostics and pg_stat_statements queries"],
  [!sql.includes("500 * 1024 * 1024"), "does not hardcode a Supabase DB quota"],
  [sql.includes("select public.admin_usage_initialize_query_baseline()"), "initializes only the baseline"],
  [!/\b(drop|truncate)\b/i.test(anomalyFixSql), "forward anomaly migration is additive and non-destructive"],
  [anomalyFixSql.includes("create or replace function public.admin_usage_check_anomalies()"), "forward migration replaces only the anomaly function"],
  [anomalyFixSql.includes("revoke all on function public.admin_usage_check_anomalies() from public, anon, authenticated"), "forward migration preserves anomaly function execute restrictions"],

  // ── v1 감시 6종이 조용히 사라지지 않았는지 ──
  [/방문자 %s명 \(30일 중앙값/.test(anomalyFn), "keeps the visitor spike alert"],
  [/DB 하루 증가 %sMB \(30일 중앙값/.test(anomalyFn), "keeps the daily DB growth alert"],
  [/행 과다 쿼리 \+%s회/.test(anomalyFn), "keeps the row-heavy query alert"],
  [/테이블 주간 \+%sMB/.test(anomalyFn), "keeps the weekly table growth alert"],
  [/DB statements %s건/.test(anomalyFn), "keeps the query volume spike alert"],
  [
    /calls_delta is not null and calls_delta >= 0/.test(anomalyFn)
      && /coalesce\(v_snap\.n, 0\) >= 7/.test(anomalyFn),
    "keeps the v1 30-day median baseline gate",
  ],
  [
    /admin_usage_snapshots/.test(anomalyFn),
    "evaluates snapshot-based alerts independently of the pg_stat_statements baseline",
  ],
  // ── QUERY_SPIKE 기준이 TS 와 일치하는지 (drift 감지) ──
  [sqlHasNumber(tsThreshold("minCalls")), `QUERY_SPIKE minCalls matches TS (${tsThreshold("minCalls")})`],
  [sqlHasNumber(tsThreshold("vs7dPct")), `QUERY_SPIKE vs7dPct matches TS (${tsThreshold("vs7dPct")})`],
  [sqlHasNumber(tsThreshold("vsPreviousDayPct")), `QUERY_SPIKE vsPreviousDayPct matches TS (${tsThreshold("vsPreviousDayPct")})`],
  [sqlHasNumber(tsThreshold("perVisitorPct")), `QUERY_SPIKE perVisitorPct matches TS (${tsThreshold("perVisitorPct")})`],
  [
    new RegExp(`coalesce\\(v_base\\.days, 0\\) >= ${tsThreshold("minPriorDays")}`).test(anomalyFn),
    `keeps the prior_days >= ${tsThreshold("minPriorDays")} guard`,
  ],
  [
    /v_prev_day_pct is not null and v_prev_day_pct >= 150/.test(anomalyFn),
    "uses the previous-day branch the UI already had (OR, not AND)",
  ],

  // ── dedupe 와 알림 타입 ──
  [
    /type = 'ops_usage_anomaly' and created_at > now\(\) - interval '1 day'/.test(anomalyFn),
    "keeps the one-day notification dedupe",
  ],
  [
    /'ops_usage_anomaly'/.test(anomalyFn) && !/'usage_anomaly'/.test(anomalyFn),
    "emits ops_usage_anomaly only (no leftover pre-rename type)",
  ],

  // ── 알림 user/ops 분리 마이그레이션이 감시를 다시 퇴행시키지 않았는지 ──
  [
    !/\b(drop\s+table|drop\s+column|truncate)\b/i.test(audienceSql),
    "audience migration is additive and non-destructive",
  ],
  [
    audienceSql.includes("add column if not exists audience text not null default 'user'"),
    "audience column keeps existing rows working",
  ],
  [
    /check\s*\(audience in \('user', 'ops'\)\)/.test(audienceSql),
    "audience values are constrained in the database",
  ],
  [
    !/set\s+audience\s*=\s*'ops'\s+where\s+true/i.test(audienceSql)
      && !/else\s+'ops'/.test(audienceSql),
    "backfill uses explicit type mapping (no else -> ops)",
  ],
  [
    /audience = 'user' or public\.can_view_ops_notifications\(\)/.test(audienceSql),
    "ops rows stay hidden from non-ops roles in RLS and RPCs",
  ],
  [
    (audienceSql.match(/notification_audience_of/g) || []).length >= 4,
    "audience is derived from the notification type, not set per insert site",
  ],
  [
    // 감사 로그의 action 값 messenger_log_action('message_report', ...) 은 알림 타입이 아니라 그대로 둔다.
    !/'usage_r2_capacity'|'usage_db_capacity'|'bulletin_sync_error'|'signup_pending'|'feedback_new'/.test(
      audienceSql.slice(audienceSql.indexOf("-- 7)")),
    ),
    "producers emit only ops_* types after the rename",
  ],
  [
    ["ops_signup_pending", "ops_feedback_new", "ops_message_report", "ops_bulletin_sync_error"].every(
      (type) => audienceSql.includes(`'${type}'`),
    ),
    "every renamed producer emits its ops_* type",
  ],
  [
    /messenger_log_action\(\s*\n?\s*'message_report'/.test(audienceSql),
    "keeps the messenger audit log action value unchanged",
  ],
  [appliedAudienceSha256 === expectedAppliedAudienceSha256, "keeps the applied audience migration content immutable"],

  // ── admin_usage_diagnostics: 데이터가 없을 때도 안전해야 한다 ──
  [
    !/\b(drop\s+table|drop\s+column|truncate)\b/i.test(priorFixSql),
    "prior-fix migration is additive and non-destructive",
  ],
  [
    priorFixSql.includes(DIAG_SIGNATURE)
      && !priorFixSql.includes("admin_usage_check_anomalies")
      && !priorFixSql.includes("admin_usage_collect_daily"),
    "prior-fix migration replaces only the diagnostics read RPC",
  ],
  [
    // 핵심: 조건부로만 할당되는 bare record 를 참조하지 않는 구조여야 한다.
    !/^\s*v_\w+\s+record\s*;/m.test(diagDeclare),
    "admin_usage_diagnostics declares no conditionally-assigned record variable",
  ],
  [
    !/v_prior\./.test(diagLatest),
    "admin_usage_diagnostics never dereferences an unassigned v_prior record",
  ],
  [
    ["v_prior_days int := 0", "v_prior_avg_calls numeric := null",
      "v_prior_median_calls numeric := null", "v_prior_weighted_per_visitor numeric := null"]
      .every((decl) => diagDeclare.includes(decl)),
    "prior aggregates are scalars with safe initial values",
  ],
  [
    // 응답 contract: 기존 키는 하나도 사라지거나 이름이 바뀌지 않아야 한다.
    // 추가는 아래 명시한 키만 허용한다 (암묵적 확장 금지).
    (() => {
      const ALLOWED_ADDITIONS = [
        "latest_analysis", "top_queries_source",
        "known_statement_calls", "known_statement_rows", "known_exec_time_ms",
        "lower_bound", "share_basis",
      ];
      const original = new Set(jsonKeys(diagOriginal).split(","));
      const latest = new Set(jsonKeys(diagLatest).split(","));
      const removed = [...original].filter((k) => !latest.has(k));
      const added = [...latest].filter((k) => !original.has(k));
      return removed.length === 0 && added.every((k) => ALLOWED_ADDITIONS.includes(k));
    })(),
    "diagnostics JSON contract keeps every original key and only adds partial-analysis metadata",
  ],
  [
    // 계산식·가드는 원본과 동일하게 유지
    diagLatest.includes("case when v_complete.usage_date is null then null else jsonb_build_object(")
      && diagLatest.includes("least(greatest(coalesce(p_days, 30), 7), 30)")
      && diagLatest.includes("percentile_cont(0.5) within group (order by statement_calls)")
      && diagLatest.includes("order by usage_date desc\n      limit 7"),
    "diagnostics calculations and guards are preserved",
  ],
  [
    /if coalesce\(public\.get_user_role\(\), ''\) not in \('admin', 'office', 'pastor'\)/.test(diagLatest)
      && diagLatest.includes("'usage_diagnostics_forbidden'"),
    "diagnostics still fails closed on role",
  ],
  [
    /revoke all on function public\.admin_usage_diagnostics\(int\) from public, anon, authenticated/.test(priorFixSql)
      && /grant execute on function public\.admin_usage_diagnostics\(int\) to authenticated/.test(priorFixSql),
    "prior-fix migration restates diagnostics execute privileges",
  ],
  [appliedPriorFixSha256 === expectedAppliedPriorFixSha256, "keeps the applied prior-fix migration content immutable"],

  // ── 축출 내성: 하루 전체 통계를 버리지 않는다 ──
  [
    !/\b(drop\s+table|drop\s+column|truncate)\b/i.test(partialSql),
    "partial-evicted migration is additive and non-destructive",
  ],
  [
    collectLatest.includes("if v_quality in ('complete', 'partial_evicted') then")
      && !/if v_quality = 'complete' then\s*\n\s*insert into public\.admin_usage_query_daily/.test(collectLatest),
    "query deltas are stored for partial intervals, not only complete ones",
  ],
  [
    collectLatest.includes("coalesce(v_dealloc_delta, 0) <> 0 or v_missing"),
    "eviction is detected from the dealloc counter or missing baseline keys",
  ],
  [
    /b\.query_key is not null\s*\n\s*and c\.cumulative_calls >= b\.cumulative_calls/.test(collectLatest),
    "partial deltas only count keys present in both baseline and current with non-regressing counters",
  ],
  [
    /elsif v_regressed then[\s\S]{0,300}v_quality := 'reset_detected';/.test(collectLatest),
    "a regressed counter remains fail-closed as reset_detected",
  ],
  [
    collectLatest.indexOf("v_quality := 'reset_detected'") > -1
      && collectLatest.indexOf("v_quality := 'partial_evicted'") > collectLatest.indexOf("v_quality := 'reset_detected'"),
    "global stats_reset is still classified before partial (never mistaken for partial)",
  ],
  [
    ["dealloc_delta", "tracked_query_count", "excluded_query_count"]
      .every((c) => partialSql.includes(`add column if not exists ${c}`))
      && partialSql.includes("v_excluded_count := v_excluded_count + v_new_excluded_count")
      && /if v_quality = 'partial_evicted' then[\s\S]*not exists \([\s\S]*admin_usage_query_baselines b[\s\S]*b\.query_key = c\.query_key/.test(collectLatest),
    "partial intervals record how much was tracked and excluded",
  ],
  [
    partialSql.includes("'baseline_pending', 'complete', 'partial_evicted',")
      && partialSql.includes("'stats_evicted'"),
    "data_quality allows partial_evicted while keeping the legacy stats_evicted value",
  ],
  [
    // 자동 anomaly 는 계속 기존 함수(complete 전용)에 맡긴다.
    !/create or replace function public\.admin_usage_check_anomalies/.test(partialSql)
      && !/insert into public\.notifications/i.test(partialSql),
    "partial-evicted migration does not touch anomaly notifications",
  ],
  [
    // 조회는 partial 도 허용하되 comparison 은 complete 전용 유지
    diagLatest.includes("where data_quality in ('complete', 'partial_evicted') order by usage_date desc limit 1")
      && diagLatest.includes("'comparison', case when v_complete.usage_date is null then null"),
    "diagnostics exposes partial top_queries while keeping comparison complete-only",
  ],
  [
    diagLatest.includes("'latest_analysis'")
      && diagLatest.includes("'top_queries_source'")
      && diagLatest.includes("'known_statement_calls'")
      && diagLatest.includes("'lower_bound'")
      && diagLatest.includes("'share_basis'"),
    "diagnostics reports a same-date analysis row and explicit lower-bound TOP source",
  ],
  [
    /candidate = case\s+when v_quality = 'complete'[\s\S]*else null/.test(collectLatest)
      && /confidence = case\s+when v_quality <> 'complete' then null/.test(collectLatest)
      && /candidate_share_pct = case when v_quality = 'complete'/.test(collectLatest),
    "partial intervals do not publish complete-style candidate or confidence",
  ],
  [
    /drop constraint admin_usage_daily_data_quality_check,/.test(partialSql)
      && /drop constraint admin_usage_query_daily_data_quality_check,/.test(partialSql)
      && !/drop constraint if exists admin_usage_(daily|query_daily)_data_quality_check/.test(partialSql),
    "partial migration replaces only the two exact data-quality constraints",
  ],
  [
    /language plpgsql security definer\s+set search_path = public, extensions/.test(collectLatest)
      && /revoke all on function public\.admin_usage_collect_daily\(\) from public, anon, authenticated/.test(partialSql)
      && /if coalesce\(public\.get_user_role\(\), ''\) not in \('admin', 'office', 'pastor'\)/.test(diagLatest)
      && /revoke all on function public\.admin_usage_diagnostics\(int\) from public, anon, authenticated/.test(partialSql),
    "partial functions retain fixed search_path, fail-closed role checks, and execute restrictions",
  ],
  [
    !/cron\.(schedule|unschedule)|perform\s+cron\./i.test(partialSql)
      && !/select\s+public\.admin_usage_collect_daily\s*\(\s*\)\s*;/i.test(partialSql),
    "partial migration neither changes cron nor immediately runs the collector",
  ],
  [
    // 기존 Production 행을 재구성하지 않는다
    !/update public\.admin_usage_daily\s+set data_quality/i.test(partialSql),
    "does not backfill or rewrite existing usage rows",
  ],
  [
    ["SUPABASE_DB_QUOTA_BYTES", "R2_STORAGE_QUOTA_BYTES", "ops_usage_db_capacity", "ops_usage_r2_capacity", "audience"]
      .every((t) => !partialSql.includes(t)),
    "partial-evicted migration does not touch quota or notification paths",
  ],
];

const failed = assertions.filter(([ok]) => !ok);
for (const [ok, message] of assertions) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${message}\n`);
}
if (failed.length) process.exit(1);
