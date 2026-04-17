"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface JournalSummary {
  id: string;
  journal_date: string;
  edu_topic: string | null;
  stat_attend: number;
  offering: number;
}

interface JournalDetail {
  id: string;
  department_id: string;
  journal_date: string;
  edu_topic: string;
  praise: string;
  joint_activity: string;
  lesson_content: string;
  events: string;
  stat_reg_male: number;
  stat_reg_female: number;
  stat_reg_total: number;
  stat_enrolled: number;
  stat_attend: number;
  stat_absent: number;
  offering: number;
  volunteers: string;
  prayer_requests: string;
}

const EMPTY_FORM: Omit<JournalDetail, "id" | "department_id" | "journal_date"> = {
  edu_topic: "",
  praise: "",
  joint_activity: "",
  lesson_content: "",
  events: "",
  stat_reg_male: 0,
  stat_reg_female: 0,
  stat_reg_total: 0,
  stat_enrolled: 0,
  stat_attend: 0,
  stat_absent: 0,
  offering: 0,
  volunteers: "",
  prayer_requests: "",
};

export default function JournalPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [journals, setJournals] = useState<JournalSummary[]>([]);
  const [selected, setSelected] = useState<JournalDetail | null>(null);
  const [form, setForm] = useState({ date: todayDate(), ...EMPTY_FORM });
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await loadList();
    })();
  }, []);

  const loadList = async () => {
    setLoading(true);
    const { data } = await supabase.rpc("edu_list_journals", { p_dept_id: deptId });
    setJournals(data || []);
    setLoading(false);
  };

  const selectJournal = async (id: string) => {
    const { data } = await supabase.rpc("edu_get_journal", { p_id: id });
    if (data && data[0]) {
      const j = data[0];
      setSelected(j);
      setForm({
        date: j.journal_date,
        edu_topic: j.edu_topic || "",
        praise: j.praise || "",
        joint_activity: j.joint_activity || "",
        lesson_content: j.lesson_content || "",
        events: j.events || "",
        stat_reg_male: j.stat_reg_male || 0,
        stat_reg_female: j.stat_reg_female || 0,
        stat_reg_total: j.stat_reg_total || 0,
        stat_enrolled: j.stat_enrolled || 0,
        stat_attend: j.stat_attend || 0,
        stat_absent: j.stat_absent || 0,
        offering: j.offering || 0,
        volunteers: j.volunteers || "",
        prayer_requests: j.prayer_requests || "",
      });
      setIsNew(false);
    }
  };

  const newJournal = () => {
    setSelected(null);
    setForm({ date: todayDate(), ...EMPTY_FORM });
    setIsNew(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("edu_upsert_journal", {
        p_dept_id:    deptId,
        p_date:       form.date,
        p_topic:      form.edu_topic,
        p_praise:     form.praise,
        p_joint:      form.joint_activity,
        p_lesson:     form.lesson_content,
        p_events:     form.events,
        p_reg_male:   form.stat_reg_male,
        p_reg_female: form.stat_reg_female,
        p_reg_total:  form.stat_reg_total,
        p_enrolled:   form.stat_enrolled,
        p_attend:     form.stat_attend,
        p_absent:     form.stat_absent,
        p_offering:   form.offering,
        p_volunteers: form.volunteers,
        p_prayer:     form.prayer_requests,
      });
      if (error) throw error;
      showToast("저장되었습니다 ✅");
      await loadList();
      setIsNew(false);
    } catch (e: unknown) {
      showToast("저장 실패: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm("이 일지를 삭제하시겠습니까?")) return;
    const { error } = await supabase.rpc("edu_delete_journal", { p_id: selected.id });
    if (!error) {
      showToast("삭제되었습니다");
      setSelected(null);
      setIsNew(false);
      await loadList();
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const setN = (key: string, val: string) => {
    setForm((f) => ({ ...f, [key]: Number(val) || 0 }));
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  const showForm = isNew || selected;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={headerStyle}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>📓 일지작성</div>
        <button onClick={newJournal} style={addBtnStyle}>+ 새 일지</button>
      </div>

      <div style={{ display: "flex", maxWidth: 1100, margin: "0 auto", padding: 16, gap: 16 }}>
        {/* 목록 */}
        <div style={{ width: 240, flexShrink: 0 }}>
          <div style={cardStyle}>
            <div style={sectionLabel}>일지 목록</div>
            {loading ? (
              <div style={{ color: "#94a3b8", fontSize: 12, padding: 12 }}>불러오는 중...</div>
            ) : journals.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: 12, padding: 12 }}>작성된 일지가 없습니다</div>
            ) : (
              journals.map((j) => (
                <div
                  key={j.id}
                  onClick={() => selectJournal(j.id)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    marginBottom: 4,
                    cursor: "pointer",
                    background: selected?.id === j.id ? "#eef2ff" : "transparent",
                    border: selected?.id === j.id ? "1.5px solid #6366f1" : "1.5px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>
                    {formatDate(j.journal_date)}
                  </div>
                  {j.edu_topic && (
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{j.edu_topic}</div>
                  )}
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                    출석 {j.stat_attend}명 · 헌금 {j.offering?.toLocaleString()}원
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 폼 */}
        <div style={{ flex: 1 }}>
          {!showForm ? (
            <div style={{ ...cardStyle, textAlign: "center", padding: 60, color: "#94a3b8" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📓</div>
              <div style={{ fontSize: 14 }}>왼쪽에서 일지를 선택하거나<br />새 일지를 작성하세요</div>
            </div>
          ) : (
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={sectionLabel}>{isNew ? "새 일지 작성" : "일지 편집"}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!isNew && (
                    <button onClick={handleDelete} style={deleteBtnStyle}>삭제</button>
                  )}
                  <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>

              {/* 날짜 */}
              <FormRow label="날짜">
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  style={inputStyle}
                />
              </FormRow>

              {/* 교육주제 */}
              <FormRow label="교육주제">
                <input
                  type="text"
                  value={form.edu_topic}
                  onChange={(e) => setForm((f) => ({ ...f, edu_topic: e.target.value }))}
                  placeholder="이번 주 교육 주제"
                  style={inputStyle}
                />
              </FormRow>

              {/* 찬양 */}
              <FormRow label="찬양">
                <input
                  type="text"
                  value={form.praise}
                  onChange={(e) => setForm((f) => ({ ...f, praise: e.target.value }))}
                  placeholder="찬양 제목"
                  style={inputStyle}
                />
              </FormRow>

              {/* 합동 */}
              <FormRow label="합동">
                <input
                  type="text"
                  value={form.joint_activity}
                  onChange={(e) => setForm((f) => ({ ...f, joint_activity: e.target.value }))}
                  placeholder="합동 내용"
                  style={inputStyle}
                />
              </FormRow>

              {/* 공과내용 */}
              <FormRow label="공과내용">
                <textarea
                  value={form.lesson_content}
                  onChange={(e) => setForm((f) => ({ ...f, lesson_content: e.target.value }))}
                  placeholder="공과 내용을 입력하세요"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </FormRow>

              {/* 행사 */}
              <FormRow label="행사">
                <input
                  type="text"
                  value={form.events}
                  onChange={(e) => setForm((f) => ({ ...f, events: e.target.value }))}
                  placeholder="행사 내용"
                  style={inputStyle}
                />
              </FormRow>

              {/* 통계 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>통계</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {[
                    { key: "stat_reg_male",   label: "등록 남" },
                    { key: "stat_reg_female", label: "등록 여" },
                    { key: "stat_reg_total",  label: "등록 계" },
                    { key: "stat_enrolled",   label: "재적" },
                    { key: "stat_attend",     label: "출석" },
                    { key: "stat_absent",     label: "결석" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>{label}</div>
                      <input
                        type="number"
                        min={0}
                        value={(form as Record<string, unknown>)[key] as number}
                        onChange={(e) => setN(key, e.target.value)}
                        style={{ ...inputStyle, textAlign: "center" }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* 헌금 */}
              <FormRow label="헌금 (원)">
                <input
                  type="number"
                  min={0}
                  value={form.offering}
                  onChange={(e) => setN("offering", e.target.value)}
                  style={inputStyle}
                />
              </FormRow>

              {/* 봉사 */}
              <FormRow label="봉사">
                <input
                  type="text"
                  value={form.volunteers}
                  onChange={(e) => setForm((f) => ({ ...f, volunteers: e.target.value }))}
                  placeholder="봉사자 명단"
                  style={inputStyle}
                />
              </FormRow>

              {/* 기도제목 */}
              <FormRow label="기도제목">
                <textarea
                  value={form.prayer_requests}
                  onChange={(e) => setForm((f) => ({ ...f, prayer_requests: e.target.value }))}
                  placeholder="기도제목을 입력하세요"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </FormRow>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={toastStyle}>{toast}</div>
      )}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(d: string) {
  if (!d) return "";
  const date = new Date(d);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
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
  width: "100%",
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
  marginBottom: 12,
};

const saveBtnStyle: React.CSSProperties = {
  padding: "8px 18px",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const deleteBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fef2f2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
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
