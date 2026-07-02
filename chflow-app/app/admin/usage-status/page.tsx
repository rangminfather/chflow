"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { BarChart3, CalendarDays, Database, ExternalLink, Repeat, Users } from "lucide-react";

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

const SUPABASE_PROJECT = "https://supabase.com/dashboard/project/klsrjvvdwtofialqknng";
const FREE_PLAN_DB_LIMIT = 500 * 1024 * 1024; // 500MB

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
      if (profile?.role !== "admin") {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);

      const [summaryR, visitsR, weeklyR, dbR] = await Promise.all([
        supabase.rpc("admin_usage_summary"),
        supabase.rpc("admin_usage_visits", { p_days: 30 }),
        supabase.rpc("admin_usage_weekly", { p_weeks: 8 }),
        supabase.rpc("admin_db_health"),
      ]);
      if (summaryR.error) {
        setError(summaryR.error.message);
      } else {
        setSummary((summaryR.data || null) as UsageSummary | null);
        setVisits(((visitsR.data || []) as VisitRow[]));
        setWeekly(((weeklyR.data || []) as WeeklyRow[]));
        setDbHealth((dbR.data || null) as DbHealth | null);
      }
      setLoading(false);
      loadDeptActivity(now.getFullYear(), now.getMonth() + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, loadDeptActivity]);

  const maxVisitors = useMemo(
    () => Math.max(1, ...visits.map((v) => v.visitors)),
    [visits],
  );

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
                {visits.map((v) => (
                  <div key={v.visit_date} className="group relative flex-1">
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${Math.round((v.visitors / maxVisitors) * 100)}%`,
                        minHeight: v.visitors > 0 ? 3 : 1,
                        background: v.visitors > 0 ? "var(--accent)" : "var(--hairline)",
                      }}
                    />
                    <div className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold text-white group-hover:block">
                      {shortDate(v.visit_date)} · {v.visitors}명
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] font-bold text-ink-faint">
                <span>{visits[0] ? shortDate(visits[0].visit_date) : ""}</span>
                <span>{visits.length > 0 ? shortDate(visits[visits.length - 1].visit_date) : ""}</span>
              </div>
            </div>

            {/* 주간 방문 · 재방문율 */}
            <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
              <div className="mb-1 flex items-center gap-2 text-[15px] font-extrabold text-ink">
                <Repeat size={15} strokeWidth={2} /> 주간 방문 · 재방문율
              </div>
              <div className="mb-3 text-[12px] leading-5 text-ink-faint">
                재방문율 = 지난주 방문자 중 이번주에도 온 비율. 앱이 계속 가치를 주고 있는지 보는 핵심 지표입니다.
              </div>
              <div className="flex flex-col gap-1.5">
                {weekly.map((w) => {
                  const rate = w.prev_visitors > 0 ? Math.round((w.returning_visitors / w.prev_visitors) * 100) : null;
                  return (
                    <div key={w.week_start} className="flex items-center gap-2">
                      <span className="w-[92px] shrink-0 text-[12px] font-bold text-ink-faint">{shortDate(w.week_start)} 주</span>
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
                  전송량(egress, 월 5GB)은 SQL로 조회할 수 없어 아래 Supabase 사용량 리포트에서 확인하세요. DB 80% 초과 시 오래된 로그성 데이터 정리를 검토하세요.
                </div>
              </div>
            )}

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
                        <th className="px-2 py-2 text-right font-bold">출석 저장</th>
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
