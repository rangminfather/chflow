"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Activity, AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ClipboardCopy, Database, ExternalLink, Gauge, HardDrive, Repeat, Users } from "lucide-react";
import {
  buildUsageReportV2,
  dataQualityLabel,
  evaluateUsageDiagnostics,
  type UsageDiagnosticsPayload,
  type UsageFinding,
  type UsageSeverity,
} from "@/lib/usageDiagnostics";

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
  quotaBytes: number | null;
  buckets: { bucket: string; bytes: number; count: number; thumbBytes: number; thumbCount: number }[];
}

const SUPABASE_PROJECT = "https://supabase.com/dashboard/project/klsrjvvdwtofialqknng";

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
  const [diagnostics, setDiagnostics] = useState<UsageDiagnosticsPayload | null>(null);
  const [diagnosticsUnavailable, setDiagnosticsUnavailable] = useState(false);
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

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const diagnosticsRequest = token
        ? fetch("/api/admin/usage-diagnostics", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        })
        : Promise.resolve(null);
      const [summaryR, visitsR, weeklyR, dbR, diagnosticsR] = await Promise.all([
        supabase.rpc("admin_usage_summary"),
        supabase.rpc("admin_usage_visits", { p_days: 30 }),
        supabase.rpc("admin_usage_weekly", { p_weeks: 8 }),
        supabase.rpc("admin_db_health"),
        diagnosticsRequest,
      ]);
      if (summaryR.error) {
        setError(summaryR.error.message);
      } else {
        setSummary((summaryR.data || null) as UsageSummary | null);
        setVisits(((visitsR.data || []) as VisitRow[]));
        setWeekly(((weeklyR.data || []) as WeeklyRow[]));
        setDbHealth((dbR.data || null) as DbHealth | null);
        if (diagnosticsR?.ok) {
          setDiagnostics(await diagnosticsR.json() as UsageDiagnosticsPayload);
        } else {
          setDiagnosticsUnavailable(true);
        }
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

  const evaluation = useMemo(() => diagnostics
    ? evaluateUsageDiagnostics(diagnostics)
    : {
      severity: "INFO" as UsageSeverity,
      findings: [{
        code: "USAGE_DIAGNOSTICS_UNAVAILABLE",
        severity: "INFO" as UsageSeverity,
        title: diagnosticsUnavailable ? "Usage diagnostics v2 migration 적용 필요" : "Usage diagnostics 불러오는 중",
        detail: "기존 이용 통계는 유지되며 v2 baseline 데이터는 아직 사용할 수 없습니다.",
      }] as UsageFinding[],
      cause: { candidate: "UNKNOWN_QUERY_SPIKE" as const, confidence: "low" as const, sharePct: 0 },
    }, [diagnostics, diagnosticsUnavailable]);

  const overall = evaluation.severity;
  const findings = evaluation.findings;

  // CLI(Claude)에 붙여넣는 기계 판독용 리포트
  const reportText = useMemo(() => {
    if (diagnostics) return buildUsageReportV2(diagnostics);
    return "[chflow-usage-report v2]\ndate=unavailable\nstatus=info\ndata_quality=baseline_pending\n\nfindings:\n- USAGE_DIAGNOSTICS_UNAVAILABLE [info]";
  }, [diagnostics]);

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
            <UsageDiagnosticsCard
              diagnostics={diagnostics}
              overall={overall}
              findings={findings}
              copied={copied}
              onCopy={copyReport}
            />

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

            {/* 측정 가능한 리소스 상태 */}
            {dbHealth && (
              <div className="mb-4 rounded-lg border border-hairline bg-card p-4">
                <div className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-ink">
                  <Database size={15} strokeWidth={2} /> 데이터베이스 리소스
                </div>
                <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-ink-soft">
                  <span>DB 용량</span>
                  <span>
                    {formatBytes(dbHealth.db_size_bytes)}
                    {diagnostics?.db_quota_bytes
                      ? ` / ${formatBytes(diagnostics.db_quota_bytes)} (${Math.round((dbHealth.db_size_bytes / diagnostics.db_quota_bytes) * 100)}%)`
                      : " · 플랜 한도 미설정"}
                  </span>
                </div>
                {diagnostics?.db_quota_bytes ? (
                  <div className="h-4 overflow-hidden rounded bg-bg-soft">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.min(100, Math.round((dbHealth.db_size_bytes / diagnostics.db_quota_bytes) * 100))}%`,
                        background: dbHealth.db_size_bytes / diagnostics.db_quota_bytes >= 0.95
                          ? "var(--danger)"
                          : dbHealth.db_size_bytes / diagnostics.db_quota_bytes >= 0.8
                            ? "var(--warning)"
                            : "var(--accent)",
                      }}
                    />
                  </div>
                ) : (
                  <div className="rounded-md bg-bg-soft px-3 py-2 text-[12px] text-ink-faint">
                    Supabase Dashboard에서 실제 플랜 한도를 확인하고 서버 환경변수 SUPABASE_DB_QUOTA_BYTES를 설정하세요.
                  </div>
                )}
                <div className="mt-3 grid gap-1.5 md:grid-cols-2">
                  {dbHealth.top_tables.map((t) => (
                    <div key={t.name} className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-1.5 text-[12px]">
                      <span className="truncate font-bold text-ink-soft">{t.name}</span>
                      <span className="shrink-0 font-extrabold text-ink">{formatBytes(t.bytes)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[12px] leading-5 text-ink-faint">
                  Egress · Realtime billing messages/connections · Edge Function 호출 · MAU · CPU/메모리는 미측정입니다. 별도 Supabase 사용량 API가 필요합니다.
                </div>
                {diagnostics?.db_connections && (
                  <div className="mt-2 rounded-md bg-bg-soft px-3 py-2 text-[12px] text-ink-soft">
                    DB 직접 연결 <strong>{diagnostics.db_connections.current}/{diagnostics.db_connections.max_configured}</strong>
                    {" · "}active <strong>{diagnostics.db_connections.active}</strong>
                    <div className="mt-0.5 text-[10px] text-ink-faint">Supavisor 전체 client 연결 수는 포함하지 않습니다.</div>
                  </div>
                )}
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
                    <span>
                      {formatBytes(r2Usage.totalBytes)}
                      {r2Usage.quotaBytes
                        ? ` / ${formatBytes(r2Usage.quotaBytes)} (${(r2Usage.totalBytes / r2Usage.quotaBytes * 100).toFixed(1)}%)`
                        : " · 한도 미설정"}
                    </span>
                  </div>
                  {r2Usage.quotaBytes && (
                    <div className="h-4 overflow-hidden rounded bg-bg-soft">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${Math.max(1, Math.min(100, Math.round((r2Usage.totalBytes / r2Usage.quotaBytes) * 100)))}%`,
                          background: r2Usage.totalBytes / r2Usage.quotaBytes >= 0.95 ? "var(--danger)" : "var(--accent)",
                        }}
                      />
                    </div>
                  )}
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

function UsageDiagnosticsCard({
  diagnostics,
  overall,
  findings,
  copied,
  onCopy,
}: {
  diagnostics: UsageDiagnosticsPayload | null;
  overall: UsageSeverity;
  findings: UsageFinding[];
  copied: boolean;
  onCopy: () => void;
}) {
  const latest = diagnostics?.latest_complete;
  const collection = diagnostics?.latest_collection;
  const comparison = diagnostics?.comparison;
  const topQueries = diagnostics?.top_queries || [];
  const trend = (diagnostics?.trend || []).slice(-7);
  const tone = severityTone(overall);

  return (
    <div className="mb-4 rounded-lg border bg-card p-4" style={{ borderColor: tone.color, borderWidth: overall === "OK" ? 1 : 1.5 }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[15px] font-extrabold text-ink">
          <Gauge size={15} strokeWidth={2} /> 트래픽·성능 종합 진단
          <span className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold" style={{ background: tone.background, color: tone.color }}>
            {overall}
          </span>
        </div>
        <button type="button" onClick={onCopy} className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 py-1.5 text-[12px] font-extrabold text-ink-soft" style={{ cursor: "pointer" }}>
          {copied ? <CheckCircle2 size={13} strokeWidth={2.2} style={{ color: "var(--success)" }} /> : <ClipboardCopy size={13} strokeWidth={2.2} />}
          {copied ? "복사됨" : "v2 리포트 복사"}
        </button>
      </div>

      {collection && collection.data_quality !== "complete" && (
        <div className="mb-3 rounded-md border border-hairline bg-bg-soft px-3 py-2 text-[12px] leading-5 text-ink-soft">
          <strong>{collection.usage_date} 수집 상태: {dataQualityLabel(collection.data_quality)}</strong><br />
          이 interval은 spike 비교에서 제외되며 음수 또는 lifetime 누적값으로 대체되지 않습니다.
        </div>
      )}

      {latest ? (
        <>
          <div className="mb-2 text-[12px] font-extrabold text-ink-soft">최근 완료일 · {latest.usage_date}</div>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
            <Metric label="방문자" value={`${latest.visitors.toLocaleString("ko-KR")}명`} />
            <Metric label="DB statements" value={(latest.statement_calls || 0).toLocaleString("ko-KR")} />
            <Metric label="방문자당" value={latest.statements_per_visitor?.toFixed(1) || "측정 불가"} />
            <Metric label="DB 실행시간" value={latest.exec_time_ms === null ? "측정 불가" : `${(latest.exec_time_ms / 1000).toFixed(1)}초`} />
            <Metric label="DB 용량" value={formatBytes(latest.db_size_bytes)} />
            <Metric label="DB 하루 증가" value={latest.db_growth_bytes === null ? "기준 없음" : signedBytes(latest.db_growth_bytes)} />
          </div>

          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Comparison label="전일 대비" value={signedPercent(comparison?.previous_day_pct)} />
            <Comparison label="이전 7일 평균 대비" value={signedPercent(comparison?.vs_7d_avg_pct)} sub={`완료일 ${comparison?.prior_days || 0}일 기준`} />
            <Comparison label="방문자당 7일 기준 대비" value={signedPercent(comparison?.per_visitor_vs_7d_pct)} sub="방문자 가중 평균" />
          </div>
        </>
      ) : (
        <div className="mb-3 rounded-md bg-bg-soft px-3 py-3 text-[12px] font-bold text-ink-soft">
          완료된 일별 baseline이 아직 없습니다. 첫 cron은 baseline을 정렬하고, 다음 정상 interval부터 실제 delta를 표시합니다.
        </div>
      )}

      <div className="mb-3 flex flex-col gap-1.5">
        {findings.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md bg-bg-soft px-3 py-2 text-[12.5px] font-bold text-ink-soft">
            <CheckCircle2 size={14} style={{ color: "var(--success)" }} /> 측정된 지표에서 이상 징후가 없습니다.
          </div>
        ) : findings.map((finding) => {
          const findingTone = severityTone(finding.severity);
          return (
            <div key={finding.code} className="rounded-md border border-hairline bg-surface px-3 py-2 text-[12px] leading-5">
              <div className="flex flex-wrap items-center gap-2">
                <strong style={{ color: findingTone.color }}>{finding.code} · {finding.severity}</strong>
                {finding.candidate && <span className="rounded-full bg-bg-soft px-2 py-0.5 font-bold text-ink-soft">추정 원인 {finding.candidate}</span>}
                {finding.confidence && <span className="font-bold text-ink-faint">신뢰도 {confidenceLabel(finding.confidence)}</span>}
              </div>
              <div className="font-bold text-ink">{finding.title}</div>
              <div className="text-ink-faint">{finding.detail}</div>
            </div>
          );
        })}
      </div>

      <div className="mb-3 rounded-md border border-hairline bg-surface p-3">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-extrabold text-ink"><AlertTriangle size={14} /> 호출 TOP {Math.min(10, topQueries.length)}</div>
        {topQueries.length === 0 ? (
          <div className="text-[12px] text-ink-faint">완료된 query delta가 아직 없습니다.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {topQueries.map((query) => (
              <div key={query.query_key} className="rounded-md bg-bg-soft px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-1 text-[12px]">
                  <span className="font-extrabold text-ink">{query.display_name} <span className="font-mono font-medium text-ink-faint">{query.identifier}</span></span>
                  <span className="font-extrabold text-ink">{query.calls_delta.toLocaleString("ko-KR")} · {query.share_pct.toFixed(1)}% · {(query.exec_time_delta_ms / 1000).toFixed(2)}초</span>
                </div>
                <details className="mt-1 text-[10px] text-ink-faint">
                  <summary className="cursor-pointer">정규화 SQL 보기</summary>
                  <div className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">{query.normalized_query}</div>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border border-hairline bg-surface p-3">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-extrabold text-ink"><Activity size={14} /> 최근 7일 추세</div>
        {trend.length === 0 ? <div className="text-[12px] text-ink-faint">일별 데이터가 아직 없습니다.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[11px]">
              <thead><tr className="text-left text-ink-faint"><th className="pb-1">날짜</th><th className="pb-1 text-right">방문자</th><th className="pb-1 text-right">statements</th><th className="pb-1 text-right">방문자당</th><th className="pb-1 text-right">상태</th></tr></thead>
              <tbody>{trend.map((row) => (
                <tr key={row.usage_date} className="border-t border-hairline text-ink-soft">
                  <td className="py-1.5 font-bold">{row.usage_date}</td>
                  <td className="py-1.5 text-right">{row.visitors}</td>
                  <td className="py-1.5 text-right">{row.statement_calls?.toLocaleString("ko-KR") || "—"}</td>
                  <td className="py-1.5 text-right">{row.statements_per_visitor?.toFixed(1) || "—"}</td>
                  <td className="py-1.5 text-right font-bold">{dataQualityLabel(row.data_quality)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-2 text-[11px] leading-5 text-ink-faint">
        미측정: Supabase billing egress, Realtime 월간 메시지·연결, Edge Function 호출, MAU, CPU·메모리, Supavisor 전체 연결. 별도 Supabase 사용량 API가 필요합니다.
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-bg-soft px-3 py-2"><div className="text-[10px] font-bold text-ink-faint">{label}</div><div className="mt-0.5 text-[15px] font-extrabold text-ink">{value}</div></div>;
}

function Comparison({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-md border border-hairline bg-surface px-3 py-2"><div className="text-[11px] font-bold text-ink-faint">{label}</div><div className="text-[16px] font-extrabold text-ink">{value}</div>{sub && <div className="text-[10px] text-ink-faint">{sub}</div>}</div>;
}

function severityTone(severity: UsageSeverity) {
  if (severity === "CRITICAL") return { color: "var(--danger)", background: "var(--danger-soft)" };
  if (severity === "WARN") return { color: "var(--warning)", background: "var(--warning-soft)" };
  if (severity === "INFO") return { color: "var(--accent-strong)", background: "var(--accent-soft)" };
  return { color: "var(--success)", background: "var(--success-soft)" };
}

function signedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "기준 없음";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function signedBytes(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatBytes(Math.abs(value))}`;
}

function confidenceLabel(value: "high" | "medium" | "low"): string {
  return value === "high" ? "높음" : value === "medium" ? "중간" : "낮음";
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
