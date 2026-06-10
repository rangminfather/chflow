"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { FileSearch, Search } from "lucide-react";

interface Student {
  id: string;
  student_no: number;
  name: string;
  student_type: string;
}

interface HistoryRow {
  attend_date: string;
  had_prayer: boolean;
  had_church_sch: boolean;
  had_worship: boolean;
  had_lesson: boolean;
  had_bible: boolean;
  attend_status: string;
  memo: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  출: "var(--success)", 빠: "var(--warning)", 결: "var(--danger)", 인: "var(--accent)",
};

const CHECKS = [
  { key: "had_prayer",     label: "기도" },
  { key: "had_church_sch", label: "교회학교" },
  { key: "had_worship",    label: "예배" },
  { key: "had_lesson",     label: "공과" },
  { key: "had_bible",      label: "성경읽기" },
];

export default function StudentRecordPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const now = new Date();
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [yearFrom, setYearFrom] = useState(now.getFullYear());
  const [monthFrom, setMonthFrom] = useState(1);
  const [yearTo, setYearTo] = useState(now.getFullYear());
  const [monthTo, setMonthTo] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const { data } = await supabase.rpc("edu_list_students", { p_dept_id: deptId });
      setStudents(data || []);
    })();
  }, []);

  const loadHistory = async () => {
    if (!selectedId) return;
    setLoading(true);
    const { data } = await supabase.rpc("edu_get_student_history", {
      p_student_id: selectedId,
      p_year_from:  yearFrom,
      p_month_from: monthFrom,
      p_year_to:    yearTo,
      p_month_to:   monthTo,
    });
    setHistory(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (selectedId && authChecked) loadHistory();
  }, [selectedId]);

  const selectedStudent = students.find((s) => s.id === selectedId);

  const totalAttend = history.filter((h) => h.attend_status === "출").length;
  const totalAbsent = history.filter((h) => h.attend_status === "결").length;
  const totalSkip   = history.filter((h) => h.attend_status === "빠").length;
  const totalAll    = history.length;

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>

      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}><FileSearch size={18} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 학생출결 이력</div>
        <div />
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
        {/* 검색 조건 */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <div style={fieldLabel}>학생 선택</div>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{ ...inputStyle, width: 180 }}
              >
                <option value="">-- 학생 선택 --</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.student_no ? `${s.student_no}. ` : ""}{s.name} ({s.student_type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={fieldLabel}>시작 기간</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" value={yearFrom} onChange={(e) => setYearFrom(Number(e.target.value))} style={{ ...inputStyle, width: 80 }} />
                <select value={monthFrom} onChange={(e) => setMonthFrom(Number(e.target.value))} style={{ ...inputStyle, width: 70 }}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ alignSelf: "flex-end", paddingBottom: 2, color: "var(--ink-faint)", fontWeight: 700 }}>~</div>

            <div>
              <div style={fieldLabel}>종료 기간</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" value={yearTo} onChange={(e) => setYearTo(Number(e.target.value))} style={{ ...inputStyle, width: 80 }} />
                <select value={monthTo} onChange={(e) => setMonthTo(Number(e.target.value))} style={{ ...inputStyle, width: 70 }}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>
            </div>

            <button onClick={loadHistory} disabled={!selectedId} style={{ ...searchBtnStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Search size={14} strokeWidth={1.8} /> 조회
            </button>
          </div>
        </div>

        {/* 결과 */}
        {selectedStudent && history.length > 0 && (
          <>
            {/* 요약 카드 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
              {[
                { label: "전체 주일", value: totalAll, color: "var(--ink-soft)" },
                { label: "출석", value: totalAttend, color: "var(--success)" },
                { label: "빠짐", value: totalSkip, color: "var(--warning)" },
                { label: "결석", value: totalAbsent, color: "var(--danger)" },
              ].map((s) => (
                <div key={s.label} style={{ ...cardStyle, textAlign: "center", padding: "16px 12px" }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* 이력 테이블 */}
            <div style={{ ...cardStyle, overflowX: "auto" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", marginBottom: 12 }}>
                {selectedStudent.name} 출결 이력 ({totalAll}개 주일)
              </div>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ background: "var(--surface)" }}>
                    <th style={thStyle("left")}>날짜</th>
                    {CHECKS.map((c) => (
                      <th key={c.key} style={thStyle("center")}>{c.label}</th>
                    ))}
                    <th style={thStyle("center")}>상태</th>
                    <th style={thStyle("left")}>MEMO</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.attend_date} style={{ borderBottom: "1px solid var(--bg-soft)" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                        {formatDate(h.attend_date)}
                      </td>
                      {CHECKS.map((c) => (
                        <td key={c.key} style={{ textAlign: "center", padding: 8 }}>
                          <span style={{
                            fontSize: 16,
                            color: (h as unknown as Record<string, boolean>)[c.key] ? "var(--accent)" : "var(--hairline)",
                          }}>
                            {(h as unknown as Record<string, boolean>)[c.key] ? "✓" : "·"}
                          </span>
                        </td>
                      ))}
                      <td style={{ textAlign: "center", padding: 8 }}>
                        <span style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 800,
                          background: STATUS_COLOR[h.attend_status] + "22",
                          color: STATUS_COLOR[h.attend_status],
                        }}>
                          {h.attend_status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--ink-soft)" }}>
                        {h.memo || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {selectedStudent && !loading && history.length === 0 && (
          <div style={{ ...cardStyle, padding: 16 }}>
            <EmptyState message="선택한 기간에 출결 기록이 없습니다" />
          </div>
        )}

        {!selectedId && (
          <div style={{ ...cardStyle, padding: 16 }}>
            <EmptyState icon={<Search size={24} strokeWidth={1.6} />} message="학생을 선택하고 조회 버튼을 누르세요" />
          </div>
        )}

        {loading && (
          <LoadingView padding={40} label="불러오는 중..." />
        )}
      </div>
    </div>
  );
}

function formatDate(d: string) {
  const date = new Date(d);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const cardStyle: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const inputStyle: React.CSSProperties = { padding: "9px 12px", border: "1.5px solid var(--hairline)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit" };
const searchBtnStyle: React.CSSProperties = { padding: "10px 20px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const thStyle = (align: "left" | "center"): React.CSSProperties => ({ padding: "10px 12px", textAlign: align, fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", borderBottom: "2px solid var(--hairline)", background: "var(--surface)", whiteSpace: "nowrap" });
