"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Lock, Medal, TrendingUp } from "lucide-react";

interface StudentRow {
  id: string;
  name: string;
  student_no: number | null;
  order_no: number | null;
  class_no: string | null;
  grade_year: number | null;
}

interface AutoTalentRow {
  rule_id: string;
  rule_key: string;
  label: string;
  source: string;
  count_hits: number;
  per_hit: number;
  total: number;
}

interface StudentTotal {
  id: string;
  name: string;
  classLabel: string;
  auto: number;
  other: number;
  quiz: number;
  total: number;
  rank: number;
}

type Period = "all" | "year" | "month";

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "all", label: "전체 기간" },
  { key: "year", label: "올해" },
  { key: "month", label: "이번 달" },
];

const MEDAL_COLORS = ["#D4A937", "#9AA3AD", "#B97B3D"]; // 1·2·3위
const UNASSIGNED = "반 미배정";

export default function TalentStatsPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("all");
  const [classFilter, setClassFilter] = useState("");
  const [totals, setTotals] = useState<StudentTotal[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);

    const now = new Date();
    const range = period === "all"
      ? { yearFrom: 2000, monthFrom: 1, yearTo: 2100, monthTo: 12 }
      : period === "year"
        ? { yearFrom: now.getFullYear(), monthFrom: 1, yearTo: now.getFullYear(), monthTo: 12 }
        : { yearFrom: now.getFullYear(), monthFrom: now.getMonth() + 1, yearTo: now.getFullYear(), monthTo: now.getMonth() + 1 };
    const dateFrom = `${range.yearFrom}-${String(range.monthFrom).padStart(2, "0")}-01`;
    const lastDay = new Date(range.yearTo, range.monthTo, 0).getDate();
    const dateTo = `${range.yearTo}-${String(range.monthTo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const { data: studentData, error: studentErr } = await supabase
      .from("edu_students")
      .select("id, name, student_no, order_no, class_no, grade_year")
      .eq("department_id", deptId)
      .eq("is_active", true);

    if (studentErr) {
      setTotals([]);
      setLoading(false);
      return;
    }

    const students = (studentData || []) as StudentRow[];

    let otherQuery = supabase
      .from("edu_talent_records")
      .select("student_id, pts_other, record_date")
      .eq("department_id", deptId);
    let quizQuery = supabase
      .from("edu_quiz_talent")
      .select("student_id, points, quiz_date")
      .eq("department_id", deptId);
    if (period !== "all") {
      otherQuery = otherQuery.gte("record_date", dateFrom).lte("record_date", dateTo);
      quizQuery = quizQuery.gte("quiz_date", dateFrom).lte("quiz_date", dateTo);
    }

    const [otherResp, quizResp, ...autoResults] = await Promise.all([
      otherQuery,
      quizQuery,
      ...students.map((student) =>
        supabase.rpc("get_student_auto_talent", {
          p_student_id: student.id,
          p_year_from: range.yearFrom,
          p_month_from: range.monthFrom,
          p_year_to: range.yearTo,
          p_month_to: range.monthTo,
        }),
      ),
    ]);

    const otherMap: Record<string, number> = {};
    ((otherResp.data || []) as { student_id: string; pts_other: number | null }[]).forEach((row) => {
      otherMap[row.student_id] = (otherMap[row.student_id] || 0) + (row.pts_other || 0);
    });

    const quizMap: Record<string, number> = {};
    ((quizResp.data || []) as { student_id: string; points: number | null }[]).forEach((row) => {
      quizMap[row.student_id] = (quizMap[row.student_id] || 0) + (row.points || 0);
    });

    const list: StudentTotal[] = students.map((student, index) => {
      const autoRows = (autoResults[index]?.data || []) as AutoTalentRow[];
      const auto = autoRows.reduce((sum, row) => sum + (row.total || 0), 0);
      const other = otherMap[student.id] || 0;
      const quiz = quizMap[student.id] || 0;
      return {
        id: student.id,
        name: student.name,
        classLabel: classLabel(student),
        auto,
        other,
        quiz,
        total: auto + other + quiz,
        rank: 0,
      };
    });

    // 동점자 동일 순위 (경쟁 순위)
    list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"));
    list.forEach((item, index) => {
      item.rank = index > 0 && list[index - 1].total === item.total ? list[index - 1].rank : index + 1;
    });

    setTotals(list);
    setLoading(false);
  }, [deptId, period]);

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
  }, [period]);

  const classOptions = useMemo(() => {
    const seen = new Set<string>();
    totals.forEach((item) => seen.add(item.classLabel));
    return Array.from(seen).sort((a, b) => {
      if (a === UNASSIGNED) return 1;
      if (b === UNASSIGNED) return -1;
      return a.localeCompare(b, "ko");
    });
  }, [totals]);

  const filtered = useMemo(
    () => (classFilter ? totals.filter((item) => item.classLabel === classFilter) : totals),
    [totals, classFilter],
  );

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

  if (!authChecked) return <LoadingView full />;

  if (!authorized) {
    return (
      <div style={pageStyle}>
        <PageHeader deptId={deptId} router={router} />
        <main className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-hairline bg-white text-center">
            <EmptyState
              icon={<Lock size={24} strokeWidth={1.8} />}
              message="접근 권한이 없습니다"
              hint="달란트통계는 임원진(전도사·부장·부부장·총무·서기)만 이용할 수 있습니다"
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
        {/* 기간 + 반 필터 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-white px-4 py-3">
          <div className="flex gap-1 rounded-md bg-bg-soft p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setPeriod(option.key)}
                className={[
                  "min-h-9 rounded px-3.5 text-[14px] font-extrabold",
                  period === option.key ? "bg-white text-ink shadow-sm" : "text-ink-faint",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
          <select
            value={classFilter}
            onChange={(event) => setClassFilter(event.target.value)}
            className="min-h-10 rounded-md border border-hairline bg-white px-2 text-[14px] font-bold text-ink outline-none"
          >
            <option value="">전체 반</option>
            {classOptions.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </div>

        {loading ? (
          <LoadingView padding={60} label="달란트 집계 중..." />
        ) : totals.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-white text-center">
            <EmptyState message="집계할 학생이 없습니다" />
          </div>
        ) : (
          <>
            {/* 요약 카드 */}
            <div className="mb-4 grid grid-cols-3 gap-2">
              <SummaryCard label="합계" value={fmt(grandTotal)} accent />
              <SummaryCard label="1인 평균" value={fmt(average)} />
              <SummaryCard label="최고 기록" value={fmt(maxTotal)} />
            </div>

            {/* 반별 평균 (전체 보기일 때만) */}
            {!classFilter && classSummary.length > 1 && (
              <div className="mb-4 rounded-lg border border-hairline bg-white p-4">
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
            <div className="overflow-hidden rounded-lg border border-hairline bg-white">
              <div className="border-b border-hairline bg-surface px-4 py-2.5 text-[15px] font-extrabold text-ink">
                달란트 랭킹 {classFilter && <span className="ml-1 text-[13px] font-bold text-ink-faint">{classFilter}</span>}
              </div>
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

            <div className="mt-3 px-1 text-[12px] leading-5 text-ink-faint">
              합계 = 자동적립(출석·주간 체크) + 기타(직접 입력) + 공과퀴즈. 달란트통장 잔액과 동일한 기준으로 집계합니다.
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function PageHeader({ deptId, router }: { deptId: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div className="app-subpage-header" style={headerStyle}>
      <HeaderLogo />
      <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <TrendingUp size={18} strokeWidth={1.8} /> 달란트통계
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-white px-4 py-3">
      <div className="text-[12px] font-bold text-ink-faint">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold" style={{ color: accent ? "var(--accent)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

function classLabel(student: { grade_year: number | null; class_no: string | null }) {
  if (!student.class_no) return UNASSIGNED;
  return `${student.grade_year ? `${student.grade_year}학년 ` : ""}${student.class_no}반`;
}

function fmt(value: number) {
  return value.toLocaleString("ko-KR");
}

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", overflowX: "hidden" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
