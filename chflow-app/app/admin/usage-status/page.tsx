"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Activity, AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ClipboardCopy, Database, ExternalLink, Gauge, HardDrive, Repeat, Users } from "lucide-react";

interface UsageSummary {
  today: number;
  unique7: number;
  unique30: number;
  since: string | null;
}

interface WeeklyRow {
  week_start: string;
  visitors: number;
  returning_visitors: number;
  prev_visitors: number;
}

interface DbHealth {
  db_size_bytes: number;
  top_tables: { name: string; bytes: number }[];
}

interface R2UsageResp {
  totalBytes: number;
  buckets: { bucket: string; bytes: number; count: number; thumbBytes: number; thumbCount: number }[];
}

interface TrendRow {
  snap_date: string;
  db_size_bytes: number;
  db_delta: number | null;
  calls_delta: number | null;
  exec_ms_delta: number | null;
  visitors: number;
}

interface QueryGrowth { q: string; calls_delta: number; ms_delta: number; rows_delta: number }
interface TableGrowth { name: string; bytes: number; bytes_delta: number }
interface GrowthReport { latest_date?: string; query_growth: QueryGrowth[]; table_growth: TableGrowth[] }

// 종합 진단 — 코드는 [chflow-usage-report v1] 리포트에 그대로 실려 CLI(Claude)가 해석
interface Finding {
  code: string;
  severity: "danger" | "warn";
  text: string;
  hint: string;
}

const SUPABASE_PROJECT = "https://supabase.com/dashboard/project/klsrjvvdwtofialqknng";
const FREE_PLAN_DB_LIMIT = 500 * 1024 * 1024; // 500MB
const FREE_PLAN_R2_LIMIT = 10 * 1024 * 1024 * 1024; // 10GB

// 트래픽·성능 진단이 필요할 때 쫓아갈 채널 (자체 수집 대신 전문 도구)
const DIAGNOSTIC_CHANNELS = [
  { label: "Supabase 사용량 리포트", desc: "DB 용량 · egress(5GB/월) · 요청 추이", href: `${SUPABASE_PROJECT}/reports` },
  { label: "Supabase 쿼리 성능", desc: "느린 쿼리 · 병목 진단 (pg_stat_statements)", href: `${SUPABASE_PROJECT}/advisors/query-performance` },
  { label: "Supabase API 로그", desc: "요청별 로그 탐색 (무료 플랜 보존 1일)", href: `${SUPABASE_PROJECT}/logs/explorer` },
  { label: "Vercel 대시보드", desc: "배포 상태 · 응답시간(Speed Insights)", href: "https://vercel.com/dashboard" },
];

interface VisitRow {
  visit_date: string;
  visitors: number;
}

interface DeptActivityRow {
  dept_id: string;
  dept_name: string;
  category: string;
  attendance_saves: number;
  talent_records: number;
  notices: number;
  new_friends: number;
}

export default function AdminUsageStatusPage() {
  const router = useRouter();
  const now = new Date();

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [deptRows, setDeptRows] = useState<DeptActivityRow[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [weekly, setWeekly] = useState<WeeklyRow[]>([]);
  const [dbHealth, setDbHealth] = useState<DbHealth | null>(null);
  const [r2Usage, setR2Usage] = useState<R2UsageResp | null | "error">(null);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [growth, setGrowth] = useState<GrowthReport | null>(null);
  // 모바일: 막대 탭으로 날짜·인원 확인 (hover 불가 대응)
  const [selectedVisit, setSelectedVisit] = useState<VisitRow | null>(null);

  const loadDeptActivity = useCallback(async (y: number, m: number) => {
    setDeptLoading(true);
    const { data } = await supabase.rpc("admin_usage_dept_activity", { p_year: y, p_month: m });
    setDeptRows((data || []) as DeptActivityRow[]);
    setDeptLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      // 홈 관리자 메뉴 노출 범위와 동일 (admin·행정원·목사)
      if (!["admin", "office", "pastor"].includes(profile?.role || "")) {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);

      const [summaryR, visitsR, weeklyR, dbR, trendR, growthR] = await Promise.all([
        supabase.rpc("admin_usage_summary"),
        supabase.rpc("admin_usage_visits", { p_days: 30 }),
        supabase.rpc("admin_usage_weekly", { p_weeks: 8 }),
        supabase.rpc("admin_db_health"),
        supabase.rpc("admin_usage_resource_trend", { p_days: 30 }),
        supabase.rpc("admin_usage_growth_report"),
      ]);
      if (summaryR.error) {
        setError(summaryR.error.message);
      } else {
        setSummary((summaryR.data || null) as UsageSummary | null);
        setVisits(((visitsR.data || []) as VisitRow[]));
        setWeekly(((weeklyR.data || []) as WeeklyRow[]));
        setDbHealth((dbR.data || null) as DbHealth | null);
        setTrend(((trendR.data || []) as TrendRow[]));
        setGrowth((growthR.data || null) as GrowthReport | null);
      }
      setLoading(false);
      loadDeptActivity(now.getFullYear(), now.getMonth() + 1);
      // R2 집계는 목록 스캔이라 별도 로드 (페이지 표시를 막지 않음)
      fetch("/api/admin/r2-usage")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j) => setR2Usage(j as R2UsageResp))
        .catch(() => setR2Usage("error"));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, loadDeptActivity]);

  const maxVisitors = useMemo(
    () => Math.max(1, ...visits.map((v) => v.visitors)),
    [visits],
  );

  // 쿼리 호출 증분 — 이상 판정용 중앙값 (서버 이상감지와 같은 기준: 중앙값×3, 바닥 2000건)
  const callsStats = useMemo(() => {
    const deltas = trend
      .map((t) => t.calls_delta)
      .filter((v): v is number => v !== null && v >= 0);
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    return { median, max: Math.max(1, ...deltas) };
  }, [trend]);

  // 종합 진단 — 서버 이상감지와 동일 기준 + 용량·원인 신호를 한 곳에 모음
  const findings = useMemo<Finding[]>(() => {
    const out: Finding[] = [];
    if (dbHealth) {
      const pct = dbHealth.db_size_bytes / FREE_PLAN_DB_LIMIT;
      if (pct > 0.8) {
        out.push({ code: "DB_CAPACITY", severity: "danger", text: `DB 용량 ${Math.round(pct * 100)}% — 무료플랜 한도 임박`, hint: "로그성 테이블 보존기간 정리 또는 플랜 상향 확인 필요" });
      } else if (pct > 0.6) {
        out.push({ code: "DB_CAPACITY", severity: "warn", text: `DB 용량 ${Math.round(pct * 100)}%`, hint: "상위 테이블 증가 추이 확인 필요" });
      }
    }
    if (r2Usage && r2Usage !== "error") {
      const pct = r2Usage.totalBytes / FREE_PLAN_R2_LIMIT;
      if (pct > 0.8) {
        out.push({ code: "R2_CAPACITY", severity: "danger", text: `R2 저장 ${Math.round(pct * 100)}% — 무료플랜 한도 임박`, hint: "대용량 버킷(사진 원본) 정리·아카이브 확인 필요" });
      } else if (pct > 0.6) {
        out.push({ code: "R2_CAPACITY", severity: "warn", text: `R2 저장 ${Math.round(pct * 100)}%`, hint: "버킷별 용량 추이 확인 필요" });
      }
    }
    const last7 = trend.slice(-7);
    const spikes = last7.filter((t) => (t.calls_delta ?? 0) >= 2000 && (t.calls_delta ?? 0) > 3 * Math.max(callsStats.median, 100));
    if (spikes.length > 0) {
      const peak = Math.max(...spikes.map((s) => s.calls_delta ?? 0));
      out.push({ code: "QUERY_SPIKE", severity: "warn", text: `최근 7일 중 ${spikes.length}일 쿼리 호출 급증 (최대 ${peak.toLocaleString("ko-KR")}건/일)`, hint: "클라이언트 폴링·재시도 루프 쪽 확인 필요" });
    }
    const dbSpikes = last7.filter((t) => (t.db_delta ?? 0) >= 5 * 1024 * 1024);
    if (dbSpikes.length > 0) {
      out.push({ code: "DB_GROWTH_SPIKE", severity: "warn", text: `최근 7일 중 ${dbSpikes.length}일 DB가 하루 5MB 이상 증가`, hint: "원인분석 카드의 테이블 증가 항목 확인 필요" });
    }
    const heavy = (growth?.query_growth || []).find((g) => g.calls_delta > 500 && g.rows_delta / Math.max(g.calls_delta, 1) > 50);
    if (heavy) {
      out.push({ code: "QUERY_HEAVY_ROWS", severity: "warn", text: `호출당 행 과다 쿼리 감지 (+${heavy.calls_delta.toLocaleString("ko-KR")}회): ${heavy.q.slice(0, 60)}…`, hint: "해당 쿼리 인덱스·limit·페이지네이션 쪽 확인 필요" });
    }
    const bigTable = (growth?.table_growth || []).find((t) => t.bytes_delta > 20 * 1024 * 1024);
    if (bigTable) {
      out.push({ code: "TABLE_GROWTH", severity: "warn", text: `${bigTable.name} 테이블 주간 +${formatBytes(bigTable.bytes_delta)}`, hint: "로그성 적재 여부·보존기간 정리 쪽 확인 필요" });
    }
    return out;
  }, [dbHealth, r2Usage, trend, growth, callsStats]);

  const overall: "ok" | "warn" | "danger" = findings.some((f) => f.severity === "danger")
    ? "danger" : findings.length > 0 ? "warn" : "ok";

  // CLI(Claude)에 붙여넣는 기계 판독용 리포트
  const reportText = useMemo(() => {
    const lines = [`[chflow-usage-report v1] date=${new Date().toISOString().slice(0, 10)} status=${overall}`];
    if (dbHealth) lines.push(`db=${formatBytes(dbHealth.db_size_bytes)}/500MB(${Math.round((dbHealth.db_size_bytes / FREE_PLAN_DB_LIMIT) * 100)}%)`);
    if (r2Usage && r2Usage !== "error") lines.push(`r2=${formatBytes(r2Usage.totalBytes)}/10GB(${(r2Usage.totalBytes / FREE_PLAN_R2_LIMIT * 100).toFixed(1)}%)`);
    if (summary) lines.push(`visitors: today=${summary.today} 7d=${summary.unique7} 30d=${summary.unique30}`);
    if (findings.length === 0) {
      lines.push("findings: none");
    } else {
      lines.push("findings:");
      findings.forEach((f) => lines.push(`- ${f.code} [${f.severity}] ${f.text} | hint: ${f.hint}`));
    }
    return lines.join("\n");
  }, [overall, dbHealth, r2Usage, summary, findings]);

  const [copied, setCopied] = useState(false);
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard 미지원 브라우저 — 무시 */ }
  };

  // 활동이 있는 부서 우선 정렬 (전부 0인 부서는 아래로)
  const sortedDeptRows = useMemo(() => {
    const total = (r: DeptActivityRow) => r.attendance_saves + r.talent_records + r.notices + r.new_friends;
    return [...deptRows].sort((a, b) => total(b) - total(a) || a.dept_name.localeCompare(b.dept_name, "ko"));
  }, [deptRows]);

  function changeMonth(y: number, m: number) {
    setYear(y);
    setMonth(m);
    loadDeptActivity(y, m);
  }

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={pageStyle}>
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.push("/home")} style={backBtnStyle}>← 홈</button>
        <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <BarChart3 size={18} strokeWidth={1.8} /> 이용 현황
        </div>
      </div>

      <main className="mx-auto w-full max-w-5xl px-4 py-4">
        {loading ? (
          <LoadingView padding={60} label="집계 중..." />
        ) : error ? (
          <div className="rounded-lg border border-hairline bg-card text-center">
            <EmptyState message="집계를 불러오지 못했습니다" hint={error} />
          </div>
        ) : (
          <>
            {/* 종합 진단 대시보드 */}
            <div
              className="mb-4 rounded-lg border bg-card p-4"
              style={{
                borderColor: overall === "danger" ? "var(--danger)" : overall === "warn" ? "var(--warning)" : "var(--hairline)",
                borderWidth: overall === "ok" ? 1 : 1.5,
              }}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[15px] font-extrabold text-ink">
                  <Gauge size={15} strokeWidth={2} /> 트래픽·성능 종합 진단
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                    style={overall === "danger"
                      ? { background: "var(--danger-soft)", color: "var(--danger)" }
                      : overall === "warn"
                        ? { background: "var(--warning-soft)", color: "var(--warning)" }
                        : { background: "var(--success-soft)", color: "var(--success)" }}
                  >
                    {overall === "danger" ? "조치 필요" : overall === "warn" ? "확인 권장" : "정상"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={copyReport}
                  className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 py-1.5 text-[12px] font-extrabold text-ink-soft"
                  style={{ cursor: "pointer" }}
                >
                  {copied ? <CheckCircle2 size={13} strokeWidth={2.2} style={{ color: "var(--success)" }} /> : <ClipboardCopy size={13} strokeWidth={2.2} />}
                  {copied ? "복사됨" : "진단 리포트 복사"}
                </button>
              </div>
              {findings.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md bg-bg-soft px-3 py-2 text-[13px] font-bold text-ink-soft">
                  <CheckCircle2 size={14} strokeWidth={2} style={{ color: "var(--success)" }} />
                  모든 지표 정상 — 지금 조치가 필요한 항목이 없습니다.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {findings.map((f, i) => (
                    <div key={i} className="rounded-md border border-hairline bg-surface px-3 py-2 text-[12.5px] leading-5">
                      <span
                        className="mr-1.5 font-extrabold"
                        style={{ color: f.severity === "danger" ? "var(--danger)" : "var(--warning)" }}
                      >
                        {f.severity === "danger" ? "●" : "▲"}
                      </span>
                      <span className="font-bold text-ink">{f.text}</span>
                      <span className="ml-1.5 text-ink-faint">→ {f.hint}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 text-[12px] leading-5 text-ink-faint">
                Vercel 대역폭·Supabase egress는 여기서 판정 불가 — 아래 진단 채널 참고
              </div>
            </div>

            {/* 방문자 요약 */}
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <SummaryCard label="오늘 방문자" value={`${summary?.today ?? 0}명`} accent />
              <SummaryCard label="최근 7일 (고유)" value={`${summary?.unique7 ?? 0}명`} />
              <SummaryCard label="최근 30일 (고유)" value={`${summary?.unique30 ?? 0}명`} />
              <SummaryCard label="집계 시작일" value={summary?.since ? shortDate(summary.since) : "오늘부터"} />
            </div>

            {summary?.since === null && (
              <div className="mb-4 rounded-lg border border-hairline bg-card px-4 py-3 text-[13px] leading-6 text-ink-soft">
                방문 집계는 이 페이지가 배포된 시점부터 시작됩니다. 사용자가 홈 화면에 들어올 때마다 하루 1회 기록되며, 과거 데이터는 소급되지 않습니다.
              </div>
            )}

            {/* 최근 30일 방문자 추이 */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-ink">
                <Users size={15} strokeWidth={2} /> 최근 30일 일일 방문자
              </div>
              <div className="flex h-28 items-end gap-[2px]">
                {visits.map((v) => {
                  const selected = selectedVisit?.visit_date === v.visit_date;
                  return (
                    <button
                      key={v.visit_date}
                      type="button"
                      aria-label={`${shortDate(v.visit_date)} 방문자 ${v.visitors}명`}
                      onClick={() => setSelectedVisit(selected ? null : v)}
                      className="group relative h-full flex-1 cursor-pointer border-0 bg-transparent p-0"
                      style={{ display: "flex", alignItems: "flex-end" }}
                    >
                      <div
                        className="w-full rounded-t"
                        style={{
                          height: `${Math.round((v.visitors / maxVisitors) * 100)}%`,
                          minHeight: v.visitors > 0 ? 3 : 1,
                          background: selected ? "var(--accent-strong)" : v.visitors > 0 ? "var(--accent)" : "var(--hairline)",
                          outline: selected ? "1.5px solid var(--accent-strong)" : "none",
                        }}
                      />
                      <div
                        className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold group-hover:block"
                        style={{ background: "var(--ink)", color: "var(--bg)" }}
                      >
                        {shortDate(v.visit_date)} · {v.visitors}명
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[11px] font-bold text-ink-faint">
                <span>{visits[0] ? shortDate(visits[0].visit_date) : ""}</span>
                <span>{visits.length > 0 ? shortDate(visits[visits.length - 1].visit_date) : ""}</span>
              </div>
              <div className="mt-2 rounded-md bg-bg-soft px-3 py-2 text-[12px] font-bold text-ink-soft">
                {selectedVisit
                  ? `${shortDate(selectedVisit.visit_date)} 방문자 ${selectedVisit.visitors}명`
                  : "막대를 누르면 날짜별 방문자 수가 표시됩니다"}
              </div>
            </div>

            {/* 주간 방문 · 재방문율 */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-1 flex items-center gap-2 text-[15px] font-extrabold text-ink">
                <Repeat size={15} strokeWidth={2} /> 주간 방문 · 재방문율
              </div>
              <div className="mb-3 text-[12px] leading-5 text-ink-faint">
                재방문율 = 지난주 방문자 중 이번주에도 온 비율. 앱이 계속 가치를 주고 있는지 보는 핵심 지표입니다. 주는 주일(일요일)에 시작합니다.
              </div>
              <div className="flex flex-col gap-1.5">
                {weekly.map((w) => {
                  const rate = w.prev_visitors > 0 ? Math.round((w.returning_visitors / w.prev_visitors) * 100) : null;
                  const inProgress = w.week_start === kstCurrentWeekStart();
                  return (
                    <div key={w.week_start} className="flex items-center gap-2">
                      <span className="w-[92px] shrink-0 text-[12px] font-bold text-ink-faint">
                        {shortDate(w.week_start)} 주{inProgress && <span style={{ color: "var(--accent)" }}> 진행중</span>}
                      </span>
                      <span className="w-[52px] shrink-0 text-right text-[12px] font-bold text-ink-soft">{w.visitors}명</span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-bg-soft">
                        <div className="h-full rounded" style={{ width: `${rate ?? 0}%`, background: "var(--success)" }} />
                      </div>
                      <span className="w-[72px] shrink-0 text-right text-[12px] font-bold" style={{ color: rate === null ? "var(--ink-faint)" : "var(--ink-soft)" }}>
                        {rate === null ? "기준주 없음" : `재방문 ${rate}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 무료 플랜 리소스 상태 */}
            {dbHealth && (
              <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
                <div className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-ink">
                  <Database size={15} strokeWidth={2} /> 무료 플랜 리소스
                </div>
                <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-ink-soft">
                  <span>DB 용량</span>
                  <span>{formatBytes(dbHealth.db_size_bytes)} / 500MB ({Math.round((dbHealth.db_size_bytes / FREE_PLAN_DB_LIMIT) * 100)}%)</span>
                </div>
                <div className="h-4 overflow-hidden rounded bg-bg-soft">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.min(100, Math.round((dbHealth.db_size_bytes / FREE_PLAN_DB_LIMIT) * 100))}%`,
                      background: dbHealth.db_size_bytes / FREE_PLAN_DB_LIMIT > 0.8 ? "var(--danger)" : dbHealth.db_size_bytes / FREE_PLAN_DB_LIMIT > 0.6 ? "var(--warning)" : "var(--accent)",
                    }}
                  />
                </div>
                <div className="mt-3 grid gap-1.5 md:grid-cols-2">
                  {dbHealth.top_tables.map((t) => (
                    <div key={t.name} className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-1.5 text-[12px]">
                      <span className="truncate font-bold text-ink-soft">{t.name}</span>
                      <span className="shrink-0 font-extrabold text-ink">{formatBytes(t.bytes)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[12px] leading-5 text-ink-faint">
                  전송량(egress, 월 5GB)은 SQL로 조회할 수 없어 아래 Supabase 사용량 리포트에서 확인하세요. 이미지·파일은 R2로 서빙되므로 Supabase egress는 JSON만 소모합니다.
                </div>
              </div>
            )}

            {/* R2 스토리지 (Cloudflare) */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-ink">
                <HardDrive size={15} strokeWidth={2} /> R2 스토리지 (Cloudflare)
              </div>
              {r2Usage === null ? (
                <div className="text-[12px] font-bold text-ink-faint">집계 중...</div>
              ) : r2Usage === "error" ? (
                <div className="text-[12px] font-bold text-ink-faint">조회 실패 — 잠시 후 새로고침 해주세요</div>
              ) : (
                <>
                  <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-ink-soft">
                    <span>저장 용량</span>
                    <span>{formatBytes(r2Usage.totalBytes)} / 10GB ({(r2Usage.totalBytes / FREE_PLAN_R2_LIMIT * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="h-4 overflow-hidden rounded bg-bg-soft">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.max(1, Math.min(100, Math.round((r2Usage.totalBytes / FREE_PLAN_R2_LIMIT) * 100)))}%`,
                        background: r2Usage.totalBytes / FREE_PLAN_R2_LIMIT > 0.8 ? "var(--danger)" : "var(--accent)",
                      }}
                    />
                  </div>
                  <div className="mt-3 grid gap-1.5 md:grid-cols-2">
                    {r2Usage.buckets.map((b) => (
                      <div key={b.bucket} className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-1.5 text-[12px]">
                        <span className="truncate font-bold text-ink-soft">
                          {b.bucket}
                          <span className="ml-1.5 font-medium text-ink-faint">{b.count.toLocaleString("ko-KR")}개</span>
                        </span>
                        <span className="shrink-0 font-extrabold text-ink">
                          {formatBytes(b.bytes)}
                          {b.thumbBytes > 0 && <span className="ml-1 font-bold text-ink-faint">(캐시 {formatBytes(b.thumbBytes)})</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[12px] leading-5 text-ink-faint">
                    R2는 전송량(egress) 과금이 없어 저장 용량만 보면 됩니다. (캐시)는 썸네일 캐시로, 커지면 삭제해도 자동 재생성됩니다.
                  </div>
                </>
              )}
            </div>

            {/* 리소스 추이 · 이상 감지 */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-1 flex items-center gap-2 text-[15px] font-extrabold text-ink">
                <Activity size={15} strokeWidth={2} /> 리소스 추이 (일별)
              </div>
              <div className="mb-3 text-[12px] leading-5 text-ink-faint">
                매일 새벽 3:45 DB 안에서 자동 스냅샷 (외부 전송 0). 일 증분이 30일 중앙값의 3배를 넘으면 관리자에게 알림이 자동 발송됩니다.
              </div>
              {trend.length < 2 ? (
                <div className="rounded-md bg-bg-soft px-3 py-2 text-[12px] font-bold text-ink-soft">
                  스냅샷이 쌓이는 중입니다 — 내일부터 일별 추이가 표시됩니다.
                </div>
              ) : (
                <>
                  <div className="mb-1 text-[12px] font-bold text-ink-soft">DB 쿼리 호출량 (일별)</div>
                  <div className="flex h-16 items-end gap-[2px]">
                    {trend.map((t) => {
                      const v = t.calls_delta ?? 0;
                      const abnormal = v >= 2000 && v > 3 * Math.max(callsStats.median, 100);
                      return (
                        <div
                          key={t.snap_date}
                          title={`${shortDate(t.snap_date)} · ${v.toLocaleString("ko-KR")}건${abnormal ? " (이상)" : ""}`}
                          className="flex h-full flex-1 items-end"
                        >
                          <div
                            className="w-full rounded-t"
                            style={{
                              height: `${Math.round((Math.max(0, v) / callsStats.max) * 100)}%`,
                              minHeight: v > 0 ? 3 : 1,
                              background: abnormal ? "var(--danger)" : v > 0 ? "var(--accent)" : "var(--hairline)",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-bold text-ink-soft">
                    <span>DB 용량 {formatBytes(trend[0].db_size_bytes)} → {formatBytes(trend[trend.length - 1].db_size_bytes)}</span>
                    <span>기간 방문자 합 {trend.reduce((s, t) => s + t.visitors, 0).toLocaleString("ko-KR")}명</span>
                    <span className="text-ink-faint">이상 일자는 빨간 막대</span>
                  </div>
                </>
              )}
            </div>

            {/* 트래픽 원인 분석 */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-1 flex items-center gap-2 text-[15px] font-extrabold text-ink">
                <AlertTriangle size={15} strokeWidth={2} /> 트래픽 원인 분석 (전일 증가분)
              </div>
              <div className="mb-3 text-[12px] leading-5 text-ink-faint">
                어제 하루 동안 호출이 늘어난 쿼리·커진 테이블입니다. 코드/정리로 해소 가능한지 항목별로 표시합니다.
              </div>
              {!growth || (growth.query_growth.length === 0 && growth.table_growth.length === 0) ? (
                <div className="rounded-md bg-bg-soft px-3 py-2 text-[12px] font-bold text-ink-soft">
                  전일 대비 눈에 띄는 증가가 없습니다. (스냅샷 2일 이상 쌓이면 비교가 시작됩니다)
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {growth.query_growth.map((g, i) => {
                    const heavyRows = g.calls_delta > 0 && g.rows_delta / Math.max(g.calls_delta, 1) > 50;
                    return (
                      <div key={i} className="rounded-md border border-hairline bg-surface px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-extrabold text-ink">+{g.calls_delta.toLocaleString("ko-KR")}회 호출</span>
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold"
                            style={heavyRows
                              ? { background: "var(--warning-soft)", color: "var(--warning)" }
                              : { background: "var(--accent-soft)", color: "var(--accent-strong)" }}
                          >
                            {heavyRows ? "행 과다 — 인덱스·limit 검토 (해소 가능)" : "급증 시 폴링·루프 점검 (해소 가능)"}
                          </span>
                        </div>
                        <div className="mt-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-ink-faint">{g.q}</div>
                      </div>
                    );
                  })}
                  {growth.table_growth.map((t) => (
                    <div key={t.name} className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-2 text-[12px]">
                      <span className="font-bold text-ink-soft">{t.name} <span className="font-medium text-ink-faint">테이블 +{formatBytes(t.bytes_delta)}/주</span></span>
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
                        로그성이면 보존기간 정리로 해소 가능
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 text-[12px] leading-5 text-ink-faint">
                방문자 증가로 인한 상승은 결함이 아니라 성장 신호입니다 — 이 경우 해소가 아니라 플랜 상향을 판단하세요.
              </div>
            </div>

            {/* 트래픽·성능 진단 채널 */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-1 flex items-center gap-2 text-[15px] font-extrabold text-ink">
                <ExternalLink size={15} strokeWidth={2} /> 트래픽 · 성능 진단 채널
              </div>
              <div className="mb-3 text-[12px] leading-5 text-ink-faint">
                병목·응답지연·트래픽 급증이 의심될 때는 자체 수집 대신 아래 전문 도구에서 확인합니다.
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {DIAGNOSTIC_CHANNELS.map((ch) => (
                  <a
                    key={ch.label}
                    href={ch.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-hairline bg-surface px-3 py-2.5 no-underline"
                  >
                    <div className="flex items-center gap-1.5 text-[13px] font-extrabold text-ink">
                      {ch.label} <ExternalLink size={11} strokeWidth={2.2} className="text-ink-faint" />
                    </div>
                    <div className="mt-0.5 text-[11px] leading-4 text-ink-faint">{ch.desc}</div>
                  </a>
                ))}
              </div>
            </div>

            {/* 부서별 활동량 */}
            <div className="overflow-hidden rounded-lg border border-hairline bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface px-4 py-2.5">
                <div className="flex items-center gap-2 text-[15px] font-extrabold text-ink">
                  <CalendarDays size={15} strokeWidth={2} /> 부서별 활동량
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => changeMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1)} style={navBtnStyle}>◀</button>
                  <span className="px-1 text-[14px] font-extrabold text-ink">{year}년 {month}월</span>
                  <button type="button" onClick={() => changeMonth(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)} style={navBtnStyle}>▶</button>
                </div>
              </div>
              {deptLoading ? (
                <LoadingView padding={30} label="집계 중..." />
              ) : sortedDeptRows.length === 0 ? (
                <EmptyState message="부서가 없습니다" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-hairline text-ink-faint">
                        <th className="px-4 py-2 text-left font-bold">부서</th>
                        <th className="px-2 py-2 text-right font-bold">출석 기록</th>
                        <th className="px-2 py-2 text-right font-bold">달란트 기록</th>
                        <th className="px-2 py-2 text-right font-bold">공지</th>
                        <th className="px-2 py-2 text-right font-bold">새친구</th>
                        <th className="px-4 py-2 text-right font-bold">합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedDeptRows.map((row) => {
                        const total = row.attendance_saves + row.talent_records + row.notices + row.new_friends;
                        return (
                          <tr key={row.dept_id} className="border-b border-hairline last:border-b-0" style={total === 0 ? { opacity: 0.55 } : undefined}>
                            <td className="px-4 py-2">
                              <span className="font-extrabold text-ink">{row.dept_name}</span>
                              <span className="ml-2 text-[11px] font-bold text-ink-faint">{row.category}</span>
                            </td>
                            <NumCell value={row.attendance_saves} />
                            <NumCell value={row.talent_records} />
                            <NumCell value={row.notices} />
                            <NumCell value={row.new_friends} />
                            <td className="px-4 py-2 text-right font-extrabold" style={{ color: total > 0 ? "var(--accent)" : "var(--ink-faint)" }}>{total.toLocaleString("ko-KR")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="border-t border-hairline px-4 py-2.5 text-[12px] leading-5 text-ink-faint">
                기존 테이블(출석·달란트·공지·새친구) 집계라 추가 트래픽 수집이 없습니다. 개인 단위 접속 추적은 의도적으로 하지 않습니다.
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-card px-4 py-3">
      <div className="text-[12px] font-bold text-ink-faint">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold" style={{ color: accent ? "var(--accent)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

function NumCell({ value }: { value: number }) {
  return (
    <td className="px-2 py-2 text-right font-bold" style={{ color: value > 0 ? "var(--ink)" : "var(--ink-faint)" }}>
      {value.toLocaleString("ko-KR")}
    </td>
  );
}

function shortDate(key: string): string {
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 이번 주(주일 시작, KST)의 시작일 YYYY-MM-DD
function kstCurrentWeekStart(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const start = new Date(kst.getTime() - kst.getUTCDay() * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

const navBtnStyle: CSSProperties = { padding: "6px 10px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit" };
const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", overflowX: "hidden" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
