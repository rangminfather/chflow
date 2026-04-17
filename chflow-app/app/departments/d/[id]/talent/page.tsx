"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface TalentSummary {
  student_id: string;
  student_no: number;
  student_name: string;
  student_type: string;
  total_pts: number;
  pts_attendance: number;
  pts_offering: number;
  pts_evangelism: number;
  pts_memory: number;
  pts_win: number;
  pts_other: number;
}

interface TalentRecord {
  id: string;
  record_date: string;
  pts_attendance: number;
  pts_offering: number;
  pts_evangelism: number;
  pts_memory: number;
  pts_win: number;
  pts_other: number;
  note: string | null;
  created_at: string;
}

const PT_ITEMS = [
  { key: "pts_attendance",  label: "출석",  icon: "✅", color: "#10b981" },
  { key: "pts_offering",    label: "예전",  icon: "🙏", color: "#6366f1" },
  { key: "pts_evangelism",  label: "전도",  icon: "📢", color: "#f59e0b" },
  { key: "pts_memory",      label: "암송",  icon: "📖", color: "#0ea5e9" },
  { key: "pts_win",         label: "우승",  icon: "🏆", color: "#ec4899" },
  { key: "pts_other",       label: "기타",  icon: "✨", color: "#8b5cf6" },
];

const EMPTY_RECORD = {
  date: "",
  pts_attendance: 0,
  pts_offering: 0,
  pts_evangelism: 0,
  pts_memory: 0,
  pts_win: 0,
  pts_other: 0,
  note: "",
};

export default function TalentPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [summary, setSummary] = useState<TalentSummary[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<TalentSummary | null>(null);
  const [records, setRecords] = useState<TalentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editRecord, setEditRecord] = useState<TalentRecord | null>(null);
  const [form, setForm] = useState({ ...EMPTY_RECORD, date: todayDate() });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await loadSummary();
    })();
  }, []);

  const loadSummary = async () => {
    setLoading(true);
    const { data } = await supabase.rpc("edu_get_talent_summary", { p_dept_id: deptId });
    setSummary(data || []);
    setLoading(false);
  };

  const selectStudent = async (s: TalentSummary) => {
    setSelectedStudent(s);
    setShowAddForm(false);
    setEditRecord(null);
    await loadRecords(s.student_id);
  };

  const loadRecords = async (studentId: string) => {
    const { data } = await supabase.rpc("edu_get_student_talent", { p_student_id: studentId });
    setRecords(data || []);
  };

  const openAddForm = () => {
    setEditRecord(null);
    setForm({ ...EMPTY_RECORD, date: todayDate() });
    setShowAddForm(true);
  };

  const openEditForm = (r: TalentRecord) => {
    setEditRecord(r);
    setForm({
      date: r.record_date,
      pts_attendance: r.pts_attendance,
      pts_offering: r.pts_offering,
      pts_evangelism: r.pts_evangelism,
      pts_memory: r.pts_memory,
      pts_win: r.pts_win,
      pts_other: r.pts_other,
      note: r.note ?? "",
    });
    setShowAddForm(true);
  };

  const handleSave = async () => {
    if (!selectedStudent) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("edu_save_talent", {
        p_id:         editRecord?.id ?? null,
        p_dept_id:    deptId,
        p_student_id: selectedStudent.student_id,
        p_date:       form.date,
        p_attendance: form.pts_attendance,
        p_offering:   form.pts_offering,
        p_evangelism: form.pts_evangelism,
        p_memory:     form.pts_memory,
        p_win:        form.pts_win,
        p_other:      form.pts_other,
        p_note:       form.note || null,
      });
      if (error) throw error;
      showToast("저장되었습니다 ✅");
      setShowAddForm(false);
      setEditRecord(null);
      await loadRecords(selectedStudent.student_id);
      await loadSummary();
    } catch (e: unknown) {
      showToast("오류: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 기록을 삭제하시겠습니까?")) return;
    await supabase.rpc("edu_delete_talent", { p_id: id });
    if (selectedStudent) await loadRecords(selectedStudent.student_id);
    await loadSummary();
    showToast("삭제되었습니다");
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const setN = (key: string, val: string) =>
    setForm((f) => ({ ...f, [key]: Number(val) || 0 }));

  const totalPts = (f: typeof form) =>
    f.pts_attendance + f.pts_offering + f.pts_evangelism + f.pts_memory + f.pts_win + f.pts_other;

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={headerStyle}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>🏅 달란트통장</div>
        <div />
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {!selectedStudent ? (
          /* 학생 요약 카드 목록 */
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", marginBottom: 12 }}>
              학생을 선택하면 달란트 기록을 볼 수 있습니다
            </div>
            {loading ? (
              <div style={{ color: "#94a3b8", textAlign: "center", padding: 60 }}>불러오는 중...</div>
            ) : summary.length === 0 ? (
              <div style={{ ...cardStyle, textAlign: "center", padding: 60, color: "#94a3b8" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                <div>등록된 학생이 없습니다.<br />출결 메뉴에서 학생을 먼저 추가하세요.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
                {summary.map((s) => (
                  <div
                    key={s.student_id}
                    onClick={() => selectStudent(s)}
                    style={{
                      background: "#fff",
                      borderRadius: 16,
                      padding: "20px 18px",
                      cursor: "pointer",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                      border: "2px solid transparent",
                      transition: "all 0.2s",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = "#8b5cf6";
                      e.currentTarget.style.transform = "translateY(-3px)";
                      e.currentTarget.style.boxShadow = "0 12px 28px rgba(139,92,246,0.2)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = "transparent";
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.05)";
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                          {s.student_no ? `#${s.student_no}` : ""} {s.student_type}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>{s.student_name}</div>
                      </div>
                      <div style={{
                        background: "linear-gradient(135deg, #f59e0b, #fbbf24)",
                        borderRadius: 12,
                        padding: "6px 12px",
                        fontSize: 18,
                        fontWeight: 900,
                        color: "#fff",
                        boxShadow: "0 4px 12px rgba(245,158,11,0.3)",
                      }}>
                        {s.total_pts}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {PT_ITEMS.map((item) => {
                        const val = (s as unknown as Record<string, number>)[item.key];
                        if (!val) return null;
                        return (
                          <span key={item.key} style={{
                            fontSize: 10,
                            padding: "2px 7px",
                            borderRadius: 6,
                            background: item.color + "18",
                            color: item.color,
                            fontWeight: 700,
                          }}>
                            {item.icon} {item.label} {val}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* 개인 상세 */
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <button onClick={() => setSelectedStudent(null)} style={backBtnStyle}>← 전체 보기</button>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>
                {selectedStudent.student_name}의 달란트통장
              </div>
              <div style={{
                marginLeft: "auto",
                background: "linear-gradient(135deg, #f59e0b, #fbbf24)",
                borderRadius: 12,
                padding: "6px 16px",
                fontSize: 16,
                fontWeight: 900,
                color: "#fff",
              }}>
                총 {selectedStudent.total_pts}점
              </div>
              <button onClick={openAddForm} style={addBtnStyle}>+ 달란트 추가</button>
            </div>

            {/* 항목별 요약 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 16 }}>
              {PT_ITEMS.map((item) => (
                <div key={item.key} style={{ ...cardStyle, padding: "12px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{item.icon}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: item.color }}>
                    {(selectedStudent as unknown as Record<string, number>)[item.key]}
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{item.label}</div>
                </div>
              ))}
            </div>

            {/* 추가/편집 폼 */}
            {showAddForm && (
              <div style={{ ...cardStyle, marginBottom: 16, border: "2px solid #8b5cf644" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#1e293b", marginBottom: 14 }}>
                  {editRecord ? "달란트 수정" : "달란트 추가"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 12 }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={fieldLabel}>날짜</div>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      style={{ ...inputStyle, width: 180 }}
                    />
                  </div>
                  {PT_ITEMS.map((item) => (
                    <div key={item.key}>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 700 }}>
                        {item.icon} {item.label}
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={(form as unknown as Record<string, number>)[item.key]}
                        onChange={(e) => setN(item.key, e.target.value)}
                        style={{ ...inputStyle, textAlign: "center" }}
                      />
                    </div>
                  ))}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={fieldLabel}>비고</div>
                    <input
                      type="text"
                      value={form.note}
                      onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                      placeholder="메모 (선택)"
                      style={{ ...inputStyle, width: "100%" }}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                  <div style={{ color: "#f59e0b", fontWeight: 800, fontSize: 14 }}>
                    합계: {totalPts(form)}점
                  </div>
                  <button onClick={() => setShowAddForm(false)} style={cancelBtnStyle}>취소</button>
                  <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            )}

            {/* 기록 목록 */}
            <div style={cardStyle}>
              {records.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
                  아직 기록이 없습니다. &quot;달란트 추가&quot; 버튼을 눌러 기록하세요.
                </div>
              ) : (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={thStyle("left")}>날짜</th>
                      {PT_ITEMS.map((item) => (
                        <th key={item.key} style={thStyle("center")}>{item.icon}</th>
                      ))}
                      <th style={thStyle("center")}>합계</th>
                      <th style={thStyle("left")}>비고</th>
                      <th style={thStyle("center")}>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => {
                      const total = r.pts_attendance + r.pts_offering + r.pts_evangelism + r.pts_memory + r.pts_win + r.pts_other;
                      return (
                        <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                            {formatDate(r.record_date)}
                          </td>
                          {PT_ITEMS.map((item) => (
                            <td key={item.key} style={{ textAlign: "center", padding: "10px 8px", fontSize: 13 }}>
                              <span style={{
                                color: (r as unknown as Record<string, number>)[item.key] > 0 ? item.color : "#e2e8f0",
                                fontWeight: 700,
                              }}>
                                {(r as unknown as Record<string, number>)[item.key] || "-"}
                              </span>
                            </td>
                          ))}
                          <td style={{ textAlign: "center", padding: "10px 8px" }}>
                            <span style={{
                              background: "#fef3c7",
                              color: "#92400e",
                              padding: "3px 10px",
                              borderRadius: 12,
                              fontSize: 12,
                              fontWeight: 800,
                            }}>{total}</span>
                          </td>
                          <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>{r.note || "-"}</td>
                          <td style={{ textAlign: "center", padding: "10px 8px" }}>
                            <button onClick={() => openEditForm(r)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, marginRight: 4 }}>✏️</button>
                            <button onClick={() => handleDelete(r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#ef4444" }}>🗑</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function formatDate(d: string) {
  const date = new Date(d);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

const headerStyle: React.CSSProperties = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const cardStyle: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const inputStyle: React.CSSProperties = { padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const addBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "linear-gradient(135deg, #f59e0b, #fbbf24)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const saveBtnStyle: React.CSSProperties = { padding: "9px 18px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const cancelBtnStyle: React.CSSProperties = { padding: "9px 14px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
const thStyle = (align: "left" | "center"): React.CSSProperties => ({ padding: "10px 12px", textAlign: align, fontSize: 11, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #e2e8f0", background: "#f8fafc", whiteSpace: "nowrap" });
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
const loadingStyle: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" };
