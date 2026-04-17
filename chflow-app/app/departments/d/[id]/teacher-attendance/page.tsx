"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Teacher {
  id: string;
  name: string;
  teacher_role: string | null;
  order_no: number;
  is_active: boolean;
}

interface AttendRow {
  teacher_id: string;
  teacher_name: string;
  teacher_role: string | null;
  order_no: number;
  attend_date: string | null;
  is_present: boolean;
  note: string | null;
}

export default function TeacherAttendancePage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [attData, setAttData] = useState<AttendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await loadAll();
    })();
  }, []);

  useEffect(() => {
    if (authChecked) loadAttendance();
  }, [year, month, authChecked]);

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([loadTeachers(), loadAttendance()]);
    setLoading(false);
  };

  const loadTeachers = async () => {
    const { data } = await supabase.rpc("edu_list_teachers", { p_dept_id: deptId });
    setTeachers(data || []);
  };

  const loadAttendance = async () => {
    const { data } = await supabase.rpc("edu_get_teacher_attendance", {
      p_dept_id: deptId, p_year: year, p_month: month,
    });
    setAttData(data || []);
  };

  // 해당 월의 일요일 날짜 배열
  const sundays = useMemo(() => getSundaysInMonth(year, month), [year, month]);

  // teacher_id → {date → is_present} 맵
  const attMap = useMemo(() => {
    const m: Record<string, Record<string, boolean>> = {};
    attData.forEach((row) => {
      if (!row.attend_date) return;
      if (!m[row.teacher_id]) m[row.teacher_id] = {};
      m[row.teacher_id][row.attend_date] = row.is_present;
    });
    return m;
  }, [attData]);

  const toggleAttend = async (teacherId: string, date: string, current: boolean) => {
    const key = `${teacherId}-${date}`;
    setSaving(key);
    await supabase.rpc("edu_set_teacher_attendance", {
      p_teacher_id: teacherId,
      p_dept_id:    deptId,
      p_date:       date,
      p_present:    !current,
    });
    await loadAttendance();
    setSaving("");
  };

  const addTeacher = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.rpc("edu_save_teacher", {
      p_id:       null,
      p_dept_id:  deptId,
      p_name:     newName.trim(),
      p_role:     newRole.trim() || null,
      p_order_no: teachers.length,
    });
    if (!error) {
      showToast("교사가 추가되었습니다");
      setNewName(""); setNewRole(""); setShowAddForm(false);
      await loadAll();
    }
  };

  const deleteTeacher = async (id: string, name: string) => {
    if (!confirm(`"${name}" 교사를 삭제하시겠습니까?`)) return;
    await supabase.rpc("edu_delete_teacher", { p_id: id });
    await loadAll();
    showToast("삭제되었습니다");
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const monthLabel = `${year}년 ${month}월`;

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={headerStyle}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>👨‍🏫 선생임 (교사출석부)</div>
        <button onClick={() => setShowAddForm(!showAddForm)} style={addBtnStyle}>+ 교사 추가</button>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {/* 교사 추가 폼 */}
        {showAddForm && (
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={sectionLabel}>교사 추가</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="이름"
                style={{ ...inputStyle, width: 140 }}
              />
              <input
                type="text"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                placeholder="직책 (부장, 교사 등)"
                style={{ ...inputStyle, width: 180 }}
              />
              <button onClick={addTeacher} style={saveBtnStyle}>추가</button>
              <button onClick={() => setShowAddForm(false)} style={cancelBtnStyle}>취소</button>
            </div>
          </div>
        )}

        {/* 월 선택 */}
        <div style={{ ...cardStyle, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => prevMonth(year, month, setYear, setMonth)} style={navBtnStyle}>◀</button>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", minWidth: 120, textAlign: "center" }}>
            {monthLabel}
          </div>
          <button onClick={() => nextMonth(year, month, setYear, setMonth)} style={navBtnStyle}>▶</button>
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>
            일요일: {sundays.length}주
          </div>
        </div>

        {/* 출석 그리드 */}
        <div style={{ ...cardStyle, overflowX: "auto" }}>
          {loading ? (
            <div style={{ color: "#94a3b8", textAlign: "center", padding: 40 }}>불러오는 중...</div>
          ) : teachers.length === 0 ? (
            <div style={{ color: "#94a3b8", textAlign: "center", padding: 40 }}>
              교사가 없습니다. 상단 &quot;교사 추가&quot;를 눌러 추가하세요.
            </div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 400 }}>
              <thead>
                <tr>
                  <th style={thStyle("left", 120)}>이름 / 직책</th>
                  {sundays.map((d) => (
                    <th key={d} style={thStyle("center", 70)}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{formatMD(d)}</div>
                      <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 400 }}>{weekNo(d, sundays)}주</div>
                    </th>
                  ))}
                  <th style={thStyle("center", 60)}>출석수</th>
                  <th style={thStyle("center", 50)}>관리</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((t) => {
                  const tMap = attMap[t.id] || {};
                  const presentCount = sundays.filter((d) => tMap[d]).length;
                  return (
                    <tr key={t.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{t.name}</div>
                        {t.teacher_role && (
                          <div style={{ fontSize: 10, color: "#6366f1", fontWeight: 600 }}>{t.teacher_role}</div>
                        )}
                      </td>
                      {sundays.map((d) => {
                        const present = !!tMap[d];
                        const key = `${t.id}-${d}`;
                        return (
                          <td key={d} style={{ textAlign: "center", padding: "6px 4px" }}>
                            <button
                              onClick={() => toggleAttend(t.id, d, present)}
                              disabled={saving === key}
                              style={{
                                width: 32, height: 32,
                                borderRadius: "50%",
                                border: "none",
                                background: saving === key ? "#e2e8f0" : present ? "#6366f1" : "#f1f5f9",
                                color: present ? "#fff" : "#cbd5e1",
                                fontSize: 16, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                margin: "0 auto",
                                transition: "all 0.15s",
                              }}
                            >
                              {saving === key ? "·" : present ? "✓" : "·"}
                            </button>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "center", padding: "6px 4px" }}>
                        <span style={{
                          fontSize: 13, fontWeight: 800,
                          color: presentCount === sundays.length ? "#10b981" : presentCount > 0 ? "#6366f1" : "#94a3b8",
                        }}>
                          {presentCount}/{sundays.length}
                        </span>
                      </td>
                      <td style={{ textAlign: "center", padding: "6px 4px" }}>
                        <button
                          onClick={() => deleteTeacher(t.id, t.name)}
                          style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14 }}
                        >🗑</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

// 해당 월의 일요일 날짜 배열
function getSundaysInMonth(year: number, month: number): string[] {
  const sundays: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    sundays.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return sundays;
}

function formatMD(d: string) {
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function weekNo(d: string, sundays: string[]) {
  return sundays.indexOf(d) + 1;
}

function prevMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 1) { setYear(year - 1); setMonth(12); }
  else setMonth(month - 1);
}

function nextMonth(year: number, month: number, setYear: (y: number) => void, setMonth: (m: number) => void) {
  if (month === 12) { setYear(year + 1); setMonth(1); }
  else setMonth(month + 1);
}

const headerStyle: React.CSSProperties = {
  background: "#fff",
  borderBottom: "1px solid #e2e8f0",
  padding: "12px 24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
  padding: 20,
  boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: "1.5px solid #e2e8f0",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#94a3b8",
  letterSpacing: 0.5,
  marginBottom: 10,
};

const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f1f5f9",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  color: "#475569",
  cursor: "pointer",
  fontFamily: "inherit",
};

const addBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "9px 18px",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "9px 14px",
  background: "#f1f5f9",
  color: "#64748b",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};

const navBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#f1f5f9",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
  color: "#475569",
};

const thStyle = (align: "left" | "center", minWidth?: number): React.CSSProperties => ({
  padding: "10px 8px",
  textAlign: align,
  fontSize: 11,
  fontWeight: 700,
  color: "#64748b",
  borderBottom: "2px solid #e2e8f0",
  background: "#f8fafc",
  whiteSpace: "nowrap",
  minWidth: minWidth,
});

const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 40,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(15,23,42,0.88)",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  zIndex: 999,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const loadingStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};
