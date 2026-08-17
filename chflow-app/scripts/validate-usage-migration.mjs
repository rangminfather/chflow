import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260817090000_usage_diagnostics_v2.sql");
const sql = readFileSync(migrationPath, "utf8");

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
];

const failed = assertions.filter(([ok]) => !ok);
for (const [ok, message] of assertions) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${message}\n`);
}
if (failed.length) process.exit(1);
