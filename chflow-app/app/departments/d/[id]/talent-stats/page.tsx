"use client";

// 달란트통계 — 연도 단위로 넘겨 보며, 선택 연도의 상반기(1~6월)/하반기(7~12월)를
// 버튼(탭)으로 전환해 본다. 하반기가 미진행이어도 버튼은 항상 표시되고, 누르면 0으로 집계된 표가 나온다.
// 잔치 리셋과 무관한 기간 집계 화면. 리셋은 출결통합조회 > 달란트체크에서.

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import TalentPassbookPrint from "@/components/TalentPassbookPrint";
import { Lock, Medal, Printer, TrendingUp } from "lucide-react";
import {
  type StudentTotal,
  UNASSIGNED,
  fetchActiveStudents,
  buildHalfTotals,
  sortForHandout,
} from "@/lib/talentAggregate";

const MEDAL_COLORS = ["#D4A937", "#9AA3AD", "#B97B3D"]; // 1·2·3위

export default function TalentStatsPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [half, setHalf] = useState<"h1" | "h2">(new Date().getMonth() + 1 <= 6 ? "h1" : "h2"); // 기본 = 현재 반기
  const [classFilter, setClassFilter] = useState("");
  const [firstHalf, setFirstHalf] = useState<StudentTotal[]>([]);
  const [secondHalf, setSecondHalf] = useState<StudentTotal[]>([]);
  const [printMode, setPrintMode] = useState(false); // 잔치용 통장 일괄 출력

  const loadData = useCallback(async () => {
    setLoading(true);
    const students = await fetchActiveStudents(deptId);
    const [h1, h2] = await Promise.all([
      buildHalfTotals(deptId, students, `${year}-01-01`, `${year}-06-30`),
      buildHalfTotals(deptId, students, `${year}-07-01`, `${year}-12-31`),
    ]);
    setFirstHalf(h1);
    setSecondHalf(h2);
    setLoading(false);
  }, [deptId, year]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);

      const { data: gradeData } = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      const grade = typeof gradeData === "number" ? gradeData : Number(gradeData);
      if (Number.isNaN(grade) || grade > 2) {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      await loadData();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId, router]);

  useEffect(() => {
    if (authChecked && authorized) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const classOptions = useMemo(() => {
    const seen = new Set<string>();
    firstHalf.forEach((item) => seen.add(item.classLabel));
    return Array.from(seen).sort((a, b) => {
      if (a === UNASSIGNED) return 1;
      if (b === UNASSIGNED) return -1;
      return a.localeCompare(b, "ko");
    });
  }, [firstHalf]);

  const noStudents = firstHalf.length === 0 && secondHalf.length === 0;

  // 출력 대상 = 현재 선택된 반기·반 필터. 반 → 이름 순으로 정렬해 잘라서 나눠주기 쉽게.
  const printItems = useMemo(() => {
    const source = half === "h1" ? firstHalf : secondHalf;
    return sortForHandout(classFilter ? source.filter((item) => item.classLabel === classFilter) : source);
  }, [half, firstHalf, secondHalf, classFilter]);

  if (!authChecked) return <LoadingView full />;

  if (!authorized) {
    return (
      <div style={pageStyle}>
        <PageHeader deptId={deptId} router={router} />
        <main className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-hairline bg-card text-center">
            <EmptyState
              icon={<Lock size={24} strokeWidth={1.8} />}
              message="접근 권한이 없습니다"
              hint="달란트통계는 임원진(전도사·부장·부부장·총무·서기·회계 등)만 이용할 수 있습니다"
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} />

      <main className="mx-auto w-full max-w-5xl px-4 py-4">
        {/* 연도 이동 + 상/하반기 버튼 + 반 필터 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setYear(year - 1)} style={navBtnStyle}>◀</button>
              <div className="min-w-[86px] text-center text-[16px] font-extrabold text-ink">{year}년</div>
              <button type="button" onClick={() => setYear(year + 1)} style={navBtnStyle}>▶</button>
            </div>
            <div className="flex gap-1 rounded-md bg-bg-soft p-1">
              {([
                { key: "h1", label: "상반기 (1~6월)" },
                { key: "h2", label: "하반기 (7~12월)" },
              ] as const).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setHalf(option.key)}
                  className={[
                    "min-h-9 rounded px-3.5 text-[14px] font-extrabold",
                    half === option.key ? "bg-card text-ink shadow-sm" : "text-ink-faint",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
              className="min-h-10 rounded-md border border-hairline bg-card px-2 text-[14px] font-bold text-ink outline-none"
            >
              <option value="">전체 반</option>
              {classOptions.map((label) => <option key={label} value={label}>{label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setPrintMode(true)}
              disabled={loading || noStudents}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-3.5 text-[14px] font-extrabold text-white disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              <Printer size={15} strokeWidth={2.2} /> 통장 출력
            </button>
          </div>
        </div>

        {loading ? (
          <LoadingView padding={60} label="달란트 집계 중..." />
        ) : noStudents ? (
          <div className="rounded-lg border border-hairline bg-card text-center">
            <EmptyState message="집계할 학생이 없습니다" />
          </div>
        ) : (
          <>
            {half === "h1" ? (
              <HalfSection title={`${year}년 상반기`} range="1월~6월" totals={firstHalf} classFilter={classFilter} />
            ) : (
              <HalfSection title={`${year}년 하반기`} range="7월~12월" totals={secondHalf} classFilter={classFilter} />
            )}

            <div className="mt-3 px-1 text-[12px] leading-5 text-ink-faint">
              합계 = 자동적립(출석·주간 체크) + 기타(직접 입력) + 공과퀴즈. 상·하반기는 달력 기준(1~6월 / 7~12월)으로,
              잔치 리셋 시점과 무관하게 집계합니다. 리셋(잔치 정산)은 출결통합조회의 달란트체크 탭에서 할 수 있습니다.
            </div>
          </>
        )}
      </main>

      {printMode && (
        <TalentPassbookPrint
          periodLabel={`${year}년 ${half === "h1" ? "상반기" : "하반기"}`}
          items={printItems}
          onClose={() => setPrintMode(false)}
        />
      )}
    </div>
  );
}

// 반기 한 구간 — 요약 카드 + 반별 평균 + 랭킹 (하반기 미진행이어도 0으로 표시)
function HalfSection({ title, range, totals, classFilter }: {
  title: string;
  range: string;
  totals: StudentTotal[];
  classFilter: string;
}) {
  const filtered = classFilter ? totals.filter((item) => item.classLabel === classFilter) : totals;

  const grandTotal = filtered.reduce((sum, item) => sum + item.total, 0);
  const average = filtered.length > 0 ? Math.round(grandTotal / filtered.length) : 0;
  const maxTotal = filtered.length > 0 ? Math.max(...filtered.map((item) => item.total)) : 0;

  const classSummary = useMemo(() => {
    const map = new Map<string, { label: string; sum: number; count: number }>();
    totals.forEach((item) => {
      const entry = map.get(item.classLabel) || { label: item.classLabel, sum: 0, count: 0 };
      entry.sum += item.total;
      entry.count += 1;
      map.set(item.classLabel, entry);
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.label === UNASSIGNED) return 1;
      if (b.label === UNASSIGNED) return -1;
      return b.sum / b.count - a.sum / a.count;
    });
  }, [totals]);

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 className="text-[17px] font-extrabold text-ink">{title}</h2>
        <span className="text-[12px] font-bold text-ink-faint">{range}</span>
      </div>

      {/* 요약 카드 */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <SummaryCard label="합계" value={fmt(grandTotal)} accent />
        <SummaryCard label="1인 평균" value={fmt(average)} />
        <SummaryCard label="최고 기록" value={fmt(maxTotal)} />
      </div>

      {/* 반별 평균 (전체 보기 + 적립이 있을 때만) */}
      {!classFilter && classSummary.length > 1 && grandTotal > 0 && (
        <div className="mb-3 rounded-lg border border-hairline bg-card p-4">
          <div className="mb-3 text-[15px] font-extrabold text-ink">반별 1인 평균</div>
          <div className="flex flex-col gap-1.5">
            {classSummary.map((entry) => {
              const avg = Math.round(entry.sum / entry.count);
              const best = Math.round(classSummary[0].sum / classSummary[0].count) || 1;
              return (
                <div key={entry.label} className="flex items-center gap-2">
                  <span className="w-[104px] shrink-0 truncate text-[12px] font-bold text-ink-soft">{entry.label}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-bg-soft">
                    <div className="h-full rounded" style={{ width: `${Math.round((avg / best) * 100)}%`, background: "var(--accent)" }} />
                  </div>
                  <span className="w-[76px] shrink-0 text-right text-[12px] font-bold text-ink-soft">{fmt(avg)} 달란트</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 랭킹 */}
      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <div className="border-b border-hairline bg-surface px-4 py-2.5 text-[15px] font-extrabold text-ink">
          달란트 랭킹 {classFilter && <span className="ml-1 text-[13px] font-bold text-ink-faint">{classFilter}</span>}
        </div>
        {/* 기록이 없어도 학생 명단을 0으로 표시 (하반기 미진행 등) */}
        <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-ink-faint">
                  <th className="w-14 px-3 py-2 text-center font-bold">순위</th>
                  <th className="px-2 py-2 text-left font-bold">이름</th>
                  <th className="px-2 py-2 text-left font-bold">반</th>
                  <th className="px-2 py-2 text-right font-bold">자동적립</th>
                  <th className="px-2 py-2 text-right font-bold">기타</th>
                  <th className="px-2 py-2 text-right font-bold">공과퀴즈</th>
                  <th className="px-4 py-2 text-right font-bold">합계</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-hairline last:border-b-0">
                    <td className="px-3 py-2 text-center">
                      {item.rank <= 3 && item.total > 0 ? (
                        <span className="inline-flex items-center gap-1 font-extrabold" style={{ color: MEDAL_COLORS[item.rank - 1] }}>
                          <Medal size={14} strokeWidth={2.2} />{item.rank}
                        </span>
                      ) : (
                        <span className="font-bold text-ink-faint">{item.rank}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-extrabold text-ink">{item.name}</td>
                    <td className="px-2 py-2 font-semibold text-ink-soft">{item.classLabel}</td>
                    <td className="px-2 py-2 text-right font-semibold text-ink-soft">{fmt(item.auto)}</td>
                    <td className="px-2 py-2 text-right font-semibold text-ink-soft">{fmt(item.other)}</td>
                    <td className="px-2 py-2 text-right font-semibold text-ink-soft">{fmt(item.quiz)}</td>
                    <td className="px-4 py-2 text-right text-[14px] font-extrabold" style={{ color: "var(--accent)" }}>{fmt(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      </div>
    </section>
  );
}

function PageHeader({ deptId, router }: { deptId: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div className="app-subpage-header" style={headerStyle}>
      <HeaderLogo />
      <button className="app-header-back" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <TrendingUp size={18} strokeWidth={1.8} /> 달란트통계
      </div>
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

function fmt(value: number) {
  return value.toLocaleString("ko-KR");
}

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", overflowX: "hidden" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const navBtnStyle: CSSProperties = { padding: "7px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer", fontFamily: "inherit", color: "var(--ink-mid)" };
