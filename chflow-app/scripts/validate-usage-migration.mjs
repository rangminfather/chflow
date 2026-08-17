import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260817090000_usage_diagnostics_v2.sql");
const sql = readFileSync(migrationPath, "utf8");

// QUERY_SPIKE 기준은 TS 가 단일 출처다. 여기서 그 값을 읽어와 SQL 과 대조해 drift 를 잡는다.
const tsSource = readFileSync(resolve(here, "../lib/usageDiagnostics.ts"), "utf8");
function tsThreshold(key) {
  const match = tsSource.match(new RegExp(`\\b${key}:\\s*(\\d+)`));
  if (!match) throw new Error(`lib/usageDiagnostics.ts 에서 ${key} 를 찾지 못했습니다`);
  return match[1];
}
// 숫자 뒤에 자릿수가 더 붙은 경우(100 vs 1000)를 구분한다.
function sqlHasNumber(value) {
  return new RegExp(`>=\\s*${value}(?![0-9])`).test(sql);
}

const anomalyFn = sql.slice(sql.indexOf("function public.admin_usage_check_anomalies"));

const assertions = [
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
  [
    // 하드코딩 quota 를 되살리는 대신 책임 위치를 migration 주석에 남겼는지 확인한다.
    /SUPABASE_DB_QUOTA_BYTES/.test(sql) && /storage-cleanup/.test(sql),
    "documents where DB capacity monitoring moved to",
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
    /type = 'usage_anomaly' and created_at > now\(\) - interval '1 day'/.test(anomalyFn),
    "keeps the one-day notification dedupe",
  ],
  [!/'ops_[a-z_]+'/.test(sql), "does not rename notification types to ops_* yet"],
];

const failed = assertions.filter(([ok]) => !ok);
for (const [ok, message] of assertions) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${message}\n`);
}
if (failed.length) process.exit(1);
