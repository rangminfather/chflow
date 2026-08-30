"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { NotebookPen, FileText, CheckCircle2, AlertTriangle } from "lucide-react";
import YmdSelect from "@/components/YmdSelect";

/** 일지 날짜에서 고를 수 있는 연도 범위 — 지난해 일지 수정까지 허용 */
const JOURNAL_MIN_YEAR = new Date().getFullYear() - 1;

interface JournalSummary {
  id: string;
  journal_date: string;
  edu_topic: string | null;
  stat_attend: number;
  offering: number;
}

interface ClassRow {
  class_no: string;
  enrolled: number;   // 재적
  attend: number;     // 출석 (출+인)
  absent: number;     // 결석
  lead: number;       // 인도 (전도)
  exemplary: number;  // 모범 (수동 입력)
  memory: number;     // 요절 (암송)
  lesson: number;     // 과제 (공과)
  bible: number;      // 성경 (성경읽기)
  quiz: number;       // 퀴즈 (수동 입력)
}

// 반별표 편집 컬럼 정의 (반명 제외한 숫자 컬럼)
const CLASS_COLS: { key: keyof Omit<ClassRow, "class_no">; label: string }[] = [
  { key: "enrolled",  label: "재적" },
  { key: "attend",    label: "출석" },
  { key: "absent",    label: "결석" },
  { key: "lead",      label: "인도" },
  { key: "exemplary", label: "모범" },
  { key: "memory",    label: "요절" },
  { key: "lesson",    label: "과제" },
  { key: "bible",     label: "성경" },
  { key: "quiz",      label: "퀴즈" },
];

interface JournalDetail {
  id: string;
  department_id: string;
  journal_date: string;
  edu_topic: string;
  scripture: string;
  leader: string;
  preacher: string;
  sermon_title: string;
  prayer_lead: string;
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
  class_stats: ClassRow[];
}

const EMPTY_FORM: Omit<JournalDetail, "id" | "department_id" | "journal_date"> = {
  edu_topic: "",
  scripture: "",
  leader: "",
  preacher: "",
  sermon_title: "",
  prayer_lead: "",
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
  class_stats: [],
};

// 부서명 -> /api/journal-prefill 의 dept_key 매핑
// 현재는 초등1부만 지원 (나중에 다른 부서 패턴 확장)
const DEPT_PREFILL_KEY: Record<string, string> = {
  "초등1부": "초등1부",
};

export default function JournalPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState<string>("");
  const [journals, setJournals] = useState<JournalSummary[]>([]);
  const [selected, setSelected] = useState<JournalDetail | null>(null);
  const [form, setForm] = useState({ date: todayDate(), ...EMPTY_FORM });
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [prefillAttempt, setPrefillAttempt] = useState(0);   // 1..MAX
  const [prefillStatus, setPrefillStatus] = useState<"idle" | "trying" | "waiting" | "done" | "failed">("idle");
  const [prefillLastError, setPrefillLastError] = useState<string>("");
  const prefillCancelRef = useState<{ cancelled: boolean }>({ cancelled: false })[0];
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [rollupLoading, setRollupLoading] = useState(false);

  const MAX_PREFILL_ATTEMPTS = 5;
  const RETRY_DELAYS_MS = [0, 5000, 8000, 10000, 12000]; // 1차~5차 시도 직전 대기

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const { data: deptInfo } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
      if (deptInfo && deptInfo[0]) setDeptName(deptInfo[0].name || "");
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
        scripture: j.scripture || "",
        leader: j.leader || "",
        preacher: j.preacher || "",
        sermon_title: j.sermon_title || "",
        prayer_lead: j.prayer_lead || "",
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
        class_stats: normalizeClassRows(j.class_stats),
      });
      setIsNew(false);
    }
  };

  const newJournal = () => {
    setSelected(null);
    setForm({ date: todayDate(), ...EMPTY_FORM });
    setIsNew(true);
  };

  const cancelPrefill = () => {
    prefillCancelRef.cancelled = true;
    setPrefilling(false);
    setPrefillStatus("idle");
  };

  const applyPrefillData = (d: {
    source_date?: string;
    edu_topic?: string;
    scripture?: string;
    leader?: string;
    preacher?: string;
    sermon_title?: string;
    prayer_lead?: string;
    praise?: string;
    joint_activity?: string;
    lesson_content?: string;
    events?: string;
  }) => {
    setForm((f) => ({
      ...f,
      date: d.source_date || f.date,
      edu_topic: d.edu_topic || f.edu_topic,
      scripture: d.scripture || f.scripture,
      leader: d.leader || f.leader,
      preacher: d.preacher || f.preacher,
      sermon_title: d.sermon_title || f.sermon_title,
      prayer_lead: d.prayer_lead || f.prayer_lead,
      praise: d.praise || f.praise,
      joint_activity: d.joint_activity || f.joint_activity,
      lesson_content: d.lesson_content || f.lesson_content,
      events: d.events || f.events,
    }));
  };

  const tryPrefillFromBulletinDraft = async () => {
    const { data, error } = await supabase.rpc("bulletin_get_draft", {
      p_dept_id: deptId,
      p_issue_date: form.date,
    });
    if (error) return false;
    const row = data && data[0];
    if (!row?.exists_) return false;

    const draft = row.form_data as Partial<{
      theme: string;
      scripture: string;
      leader: string;
      preacher: string;
      sermonTitle: string;
      prayerClass: string;
      praise1: string;
      praise2: string;
      twoPartActivity: string;
      lessonNum: string;
      versePassage: string;
    }>;
    const praise = [draft.praise1, draft.praise2].filter(Boolean).join(" ");
    applyPrefillData({
      source_date: form.date,
      edu_topic: draft.theme,
      scripture: draft.scripture,
      leader: draft.leader,
      preacher: draft.preacher,
      sermon_title: draft.sermonTitle,
      prayer_lead: draft.prayerClass,
      praise,
      events: draft.twoPartActivity,
      lesson_content: [draft.lessonNum ? `${draft.lessonNum}과` : "", draft.versePassage].filter(Boolean).join(" / "),
    });
    return true;
  };

  const handlePrefill = async () => {
    const key = DEPT_PREFILL_KEY[deptName];
    if (!key) {
      showToast("이 부서는 아직 자동 불러오기를 지원하지 않습니다");
      return;
    }
    prefillCancelRef.cancelled = false;
    setPrefilling(true);
    setPrefillLastError("");
    setPrefillStatus("trying");

    const filledFromDraft = await tryPrefillFromBulletinDraft();
    if (prefillCancelRef.cancelled) return;
    if (filledFromDraft) {
      setPrefillStatus("done");
      showToast("주보 작성 임시저장본에서 불러옴 - 확인 후 저장하세요");
      setTimeout(() => {
        setPrefilling(false);
        setPrefillStatus("idle");
        setPrefillAttempt(0);
      }, 800);
      return;
    }

    for (let i = 1; i <= MAX_PREFILL_ATTEMPTS; i++) {
      if (prefillCancelRef.cancelled) return;

      // 시도 직전 대기 (1차는 0, 2차부터 cold start 유도용 5~12초)
      if (RETRY_DELAYS_MS[i - 1] > 0) {
        setPrefillStatus("waiting");
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i - 1]));
        if (prefillCancelRef.cancelled) return;
      }

      setPrefillAttempt(i);
      setPrefillStatus("trying");

      try {
        const res = await fetch("/api/journal-prefill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dept_key: key, issue_date: form.date }),
        });
        const json = await res.json();
        if (prefillCancelRef.cancelled) return;

        if (json.ok) {
          const d = json.data;
          applyPrefillData(d);
          setPrefillStatus("done");
          showToast(`주보 #${d.source_no} 불러옴 - 확인 후 저장하세요`);
          // 성공 모달 잠깐 보이고 닫기
          setTimeout(() => {
            setPrefilling(false);
            setPrefillStatus("idle");
            setPrefillAttempt(0);
          }, 800);
          return;
        }
        setPrefillLastError(json.error || "알 수 없는 오류");
      } catch (e: unknown) {
        setPrefillLastError((e as Error).message);
      }
    }

    // 5번 다 실패
    setPrefillStatus("failed");
  };

  // 반별 자동집계 불러오기 (기존 출결/달란트에서 합산)
  const loadClassRollup = async () => {
    setRollupLoading(true);
    try {
      const { data, error } = await supabase.rpc("edu_journal_class_rollup", {
        p_dept_id: deptId,
        p_date: form.date,
      });
      if (error) throw error;
      const rows = normalizeClassRows(data);
      if (rows.length === 0) {
        showToast("집계할 반/출결 데이터가 없습니다");
      } else {
        setForm((f) => ({ ...f, class_stats: rows }));
        showToast(`반별 ${rows.length}개 자동집계 완료 - 확인 후 저장하세요`);
      }
    } catch (e: unknown) {
      showToast("자동집계 실패: " + (e as Error).message);
    } finally {
      setRollupLoading(false);
    }
  };

  const updateClassCell = (idx: number, key: keyof ClassRow, val: string) => {
    setForm((f) => {
      const next = f.class_stats.map((r) => ({ ...r }));
      if (key === "class_no") next[idx].class_no = val;
      else next[idx][key] = Number(val) || 0;
      return { ...f, class_stats: next };
    });
  };

  const addClassRow = () => {
    setForm((f) => ({
      ...f,
      class_stats: [
        ...f.class_stats,
        { class_no: "", enrolled: 0, attend: 0, absent: 0, lead: 0, exemplary: 0, memory: 0, lesson: 0, bible: 0, quiz: 0 },
      ],
    }));
  };

  const removeClassRow = (idx: number) => {
    setForm((f) => ({ ...f, class_stats: f.class_stats.filter((_, i) => i !== idx) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("edu_upsert_journal", {
        p_dept_id:      deptId,
        p_date:         form.date,
        p_topic:        form.edu_topic,
        p_scripture:    form.scripture,
        p_leader:       form.leader,
        p_preacher:     form.preacher,
        p_sermon_title: form.sermon_title,
        p_prayer_lead:  form.prayer_lead,
        p_praise:       form.praise,
        p_joint:        form.joint_activity,
        p_lesson:       form.lesson_content,
        p_events:       form.events,
        p_reg_male:     form.stat_reg_male,
        p_reg_female:   form.stat_reg_female,
        p_reg_total:    form.stat_reg_total,
        p_enrolled:     form.stat_enrolled,
        p_attend:       form.stat_attend,
        p_absent:       form.stat_absent,
        p_offering:     form.offering,
        p_volunteers:   form.volunteers,
        p_prayer:       form.prayer_requests,
        p_class_stats:  form.class_stats,
      });
      if (error) throw error;
      showToast("저장되었습니다");
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
    if (!await confirm("이 일지를 삭제하시겠습니까?")) return;
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
    setTimeout(() => setToast(""), 2800);
  };

  const setN = (key: string, val: string) => {
    setForm((f) => ({ ...f, [key]: Number(val) || 0 }));
  };

  if (!authChecked) return <LoadingView full />;

  const showForm = isNew || selected;
  const canPrefill = !!showForm && !!DEPT_PREFILL_KEY[deptName];

  return (
    <div className="app-shell journal-page" style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>

      {/* Header */}
      <div className="journal-header app-subpage-header" style={headerStyle}>
          <HeaderLogo />
          <button className="app-header-back" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}><NotebookPen size={18} strokeWidth={1.8} /> 일지작성</div>
        <button className="app-header-actions" onClick={newJournal} style={addBtnStyle}>+ 새 일지</button>
      </div>

      <div className="journal-layout mx-auto grid w-full max-w-[1100px] gap-4 p-4 md:grid-cols-[240px_1fr]">
        {/* 목록 */}
        <div className="journal-sidebar">
          <div style={cardStyle}>
            <div style={sectionLabel}>일지 목록</div>
            {loading ? (
              <LoadingView padding={12} label="불러오는 중..." />
            ) : journals.length === 0 ? (
              <EmptyState message="작성된 일지가 없습니다" padding={16} />
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
                    background: selected?.id === j.id ? "var(--accent-soft)" : "transparent",
                    border: selected?.id === j.id ? "1.5px solid var(--accent)" : "1.5px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>
                    {formatDate(j.journal_date)}
                  </div>
                  {j.edu_topic && (
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{j.edu_topic}</div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>
                    출석 {j.stat_attend}명 · 헌금 {j.offering?.toLocaleString()}원
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 폼 */}
        <div className="journal-content min-w-0">
          {!showForm ? (
            <div style={{ ...cardStyle, textAlign: "center" }}>
              <EmptyState message="왼쪽에서 일지를 선택하거나 새 일지를 작성하세요" padding={60} />
            </div>
          ) : (
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
                <div style={sectionLabel}>{isNew ? "새 일지 작성" : "일지 편집"}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {canPrefill && (
                    <button onClick={handlePrefill} disabled={prefilling} style={{ ...prefillBtnStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {prefilling ? "불러오는 중..." : <><FileText size={14} strokeWidth={1.8} /> 주보에서 불러오기</>}
                    </button>
                  )}
                  {!isNew && (
                    <button onClick={handleDelete} style={deleteBtnStyle}>삭제</button>
                  )}
                  <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>

              {/* ===== 종이 일지 순서대로 ===== */}

              {/* 1) 날짜 */}
              <FormRow label="날짜">
                <YmdSelect
                  groupLabel="일지 날짜"
                  value={form.date}
                  onChange={(next) => setForm((f) => ({ ...f, date: next }))}
                  minYear={JOURNAL_MIN_YEAR}
                  selectStyle={inputStyle}
                />
              </FormRow>

              {/* 2) 주제 */}
              <FormRow label="주제">
                <input
                  type="text"
                  value={form.edu_topic}
                  onChange={(e) => setForm((f) => ({ ...f, edu_topic: e.target.value }))}
                  placeholder="주보 헤더의 주제"
                  style={inputStyle}
                />
              </FormRow>

              {/* 3) 본문 (성경) */}
              <FormRow label="본문 (성경)">
                <input
                  type="text"
                  value={form.scripture}
                  onChange={(e) => setForm((f) => ({ ...f, scripture: e.target.value }))}
                  placeholder="예: 창세기 11장 1~9절"
                  style={inputStyle}
                />
              </FormRow>

              {/* 4) 인도자 */}
              <FormRow label="인도자">
                <input
                  type="text"
                  value={form.leader}
                  onChange={(e) => setForm((f) => ({ ...f, leader: e.target.value }))}
                  placeholder="예배 인도자"
                  style={inputStyle}
                />
              </FormRow>

              {/* 5) 설교자 */}
              <FormRow label="설교자">
                <input
                  type="text"
                  value={form.preacher}
                  onChange={(e) => setForm((f) => ({ ...f, preacher: e.target.value }))}
                  placeholder="강론자"
                  style={inputStyle}
                />
              </FormRow>

              {/* 6) 설교제목 */}
              <FormRow label="설교제목">
                <input
                  type="text"
                  value={form.sermon_title}
                  onChange={(e) => setForm((f) => ({ ...f, sermon_title: e.target.value }))}
                  placeholder="강론 제목"
                  style={inputStyle}
                />
              </FormRow>

              {/* 7) 기도 */}
              <FormRow label="기도">
                <input
                  type="text"
                  value={form.prayer_lead}
                  onChange={(e) => setForm((f) => ({ ...f, prayer_lead: e.target.value }))}
                  placeholder="기도 담당 (예: 2-3반)"
                  style={inputStyle}
                />
              </FormRow>

              {/* 8) 찬양 */}
              <FormRow label="찬양">
                <input
                  type="text"
                  value={form.praise}
                  onChange={(e) => setForm((f) => ({ ...f, praise: e.target.value }))}
                  placeholder="찬양 인도/곡명"
                  style={inputStyle}
                />
              </FormRow>

              {/* 9) 합동 */}
              <FormRow label="합동">
                <input
                  type="text"
                  value={form.joint_activity}
                  onChange={(e) => setForm((f) => ({ ...f, joint_activity: e.target.value }))}
                  placeholder="합동 내용"
                  style={inputStyle}
                />
              </FormRow>

              {/* 10) 공과내용 */}
              <FormRow label="공과내용">
                <textarea
                  value={form.lesson_content}
                  onChange={(e) => setForm((f) => ({ ...f, lesson_content: e.target.value }))}
                  placeholder="공과 내용을 입력하세요"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </FormRow>

              {/* 11) 행사 */}
              <FormRow label="행사">
                <input
                  type="text"
                  value={form.events}
                  onChange={(e) => setForm((f) => ({ ...f, events: e.target.value }))}
                  placeholder="행사 내용"
                  style={inputStyle}
                />
              </FormRow>

              {/* 11.5) 반별 출결표 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)" }}>반별 출결</div>
                  <button
                    onClick={loadClassRollup}
                    disabled={rollupLoading}
                    style={{ ...prefillBtnStyle, display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    {rollupLoading ? "집계 중..." : <><FileText size={14} strokeWidth={1.8} /> 자동집계 불러오기</>}
                  </button>
                </div>

                {form.class_stats.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", padding: "12px 0", lineHeight: 1.5 }}>
                    출결·달란트에서 반별로 자동집계하려면 <b>자동집계 불러오기</b>를 누르세요.
                    불러온 뒤 값 수정·저장이 가능합니다.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto", maxWidth: "100%" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 640 }}>
                      <thead>
                        <tr>
                          <th style={classThStyle}>반명</th>
                          {CLASS_COLS.map((c) => (
                            <th key={c.key} style={classThStyle}>{c.label}</th>
                          ))}
                          <th style={classThStyle}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.class_stats.map((row, idx) => (
                          <tr key={idx}>
                            <td style={classTdStyle}>
                              <input
                                type="text"
                                value={row.class_no}
                                onChange={(e) => updateClassCell(idx, "class_no", e.target.value)}
                                style={{ ...classCellInput, width: 60, textAlign: "center" }}
                              />
                            </td>
                            {CLASS_COLS.map((c) => (
                              <td key={c.key} style={classTdStyle}>
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  value={row[c.key] || ""}
                                  onChange={(e) => updateClassCell(idx, c.key, e.target.value)}
                                  placeholder="0"
                                  style={classCellInput}
                                />
                              </td>
                            ))}
                            <td style={classTdStyle}>
                              <button onClick={() => removeClassRow(idx)} style={classRowDelBtn} title="반 삭제">×</button>
                            </td>
                          </tr>
                        ))}
                        {/* 합계 */}
                        <tr>
                          <td style={{ ...classTdStyle, fontWeight: 700, color: "var(--ink-soft)", textAlign: "center" }}>합계</td>
                          {CLASS_COLS.map((c) => (
                            <td key={c.key} style={{ ...classTdStyle, fontWeight: 700, textAlign: "center", color: "var(--ink)" }}>
                              {form.class_stats.reduce((s, r) => s + (r[c.key] || 0), 0)}
                            </td>
                          ))}
                          <td style={classTdStyle}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                <button onClick={addClassRow} style={{ ...addRowBtnStyle, marginTop: 8 }}>+ 반 추가</button>
              </div>

              {/* 12) 통계 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 8 }}>통계</div>
                <div className="journal-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  {[
                    { key: "stat_reg_male",   label: "등록 남" },
                    { key: "stat_reg_female", label: "등록 여" },
                    { key: "stat_reg_total",  label: "등록 계" },
                    { key: "stat_enrolled",   label: "재적" },
                    { key: "stat_attend",     label: "출석" },
                    { key: "stat_absent",     label: "결석" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <div style={{ fontSize: 10, color: "var(--ink-faint)", marginBottom: 3 }}>{label}</div>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={((form as Record<string, unknown>)[key] as number) || ""}
                        onChange={(e) => setN(key, e.target.value)}
                        placeholder="0"
                        style={{ ...inputStyle, textAlign: "center" }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* 13) 헌금 */}
              {/* 금액은 자릿수를 눈으로 확인하기 쉽도록 천 단위 콤마를 붙여 보여준다.
                  type="number" 는 콤마가 들어간 값을 표시하지 못해 text + inputMode="numeric" 으로 둔다.
                  (인원수 입력들은 콤마가 필요 없어 그대로 number 를 쓴다) */}
              <FormRow label="헌금 (원)">
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.offering ? form.offering.toLocaleString("ko-KR") : ""}
                  onChange={(e) => setN("offering", e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  style={inputStyle}
                />
              </FormRow>

              {/* 14) 봉사 */}
              <FormRow label="봉사">
                <input
                  type="text"
                  value={form.volunteers}
                  onChange={(e) => setForm((f) => ({ ...f, volunteers: e.target.value }))}
                  placeholder="봉사자 명단"
                  style={inputStyle}
                />
              </FormRow>

              {/* 15) 기도제목 */}
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

      {/* 자동 재시도 모달 */}
      {prefilling && (
        <div style={modalBackdropStyle}>
          <div style={modalCardStyle}>
            <div style={{ marginBottom: 6, display: "flex", justifyContent: "center" }}>
              {prefillStatus === "done" ? <CheckCircle2 size={32} strokeWidth={1.8} color="var(--success)" /> : prefillStatus === "failed" ? <AlertTriangle size={32} strokeWidth={1.8} color="var(--warning)" /> : <FileText size={32} strokeWidth={1.8} color="var(--ink-faint)" />}
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", marginBottom: 6 }}>
              {prefillStatus === "done"
                ? "주보 데이터 불러오기 성공"
                : prefillStatus === "failed"
                ? "5번 시도했지만 실패했어요"
                : prefillStatus === "waiting"
                ? `잠시 대기 중... (${prefillAttempt + 1}/${MAX_PREFILL_ATTEMPTS}회차 준비)`
                : `주보 데이터 불러오는 중... (${prefillAttempt}/${MAX_PREFILL_ATTEMPTS})`}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 14 }}>
              {prefillStatus === "done"
                ? "폼이 자동으로 채워졌어요. 확인 후 저장하세요."
                : prefillStatus === "failed" ? (
                  <>
                    잠시 후 다시 시도해주세요. 사이트의 일시 차단으로 시간이 좀 지나야 풀립니다.
                    {prefillLastError && (
                      <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink-faint)" }}>
                        마지막 오류: {prefillLastError.slice(0, 80)}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    명성교회 사무실 게시판이 짧은 시간 같은 IP의 반복 요청을 일시 차단합니다.
                    그래서 5번까지 자동으로 다시 시도합니다 (성공률 ~97%).
                    {prefillLastError && prefillAttempt > 1 && (
                      <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink-faint)" }}>
                        직전 오류: {prefillLastError.slice(0, 60)}
                      </div>
                    )}
                  </>
                )}
            </div>

            {/* 진행 바 */}
            {prefillStatus !== "done" && prefillStatus !== "failed" && (
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {Array.from({ length: MAX_PREFILL_ATTEMPTS }).map((_, idx) => (
                  <div
                    key={idx}
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      background:
                        idx < prefillAttempt
                          ? "var(--accent)"
                          : idx === prefillAttempt && prefillStatus === "trying"
                          ? "var(--accent-line)"
                          : "var(--hairline)",
                    }}
                  />
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {prefillStatus === "failed" ? (
                <>
                  <button onClick={cancelPrefill} style={modalSecondaryBtnStyle}>닫기</button>
                  <button onClick={handlePrefill} style={modalPrimaryBtnStyle}>다시 시도</button>
                </>
              ) : prefillStatus === "done" ? null : (
                <button onClick={cancelPrefill} style={modalSecondaryBtnStyle}>종료하기</button>
              )}
            </div>
          </div>
        </div>
      )}

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
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

// RPC/저장본의 class_stats(jsonb | 배열)를 안전하게 ClassRow[] 로 정규화
function normalizeClassRows(raw: unknown): ClassRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r || {}) as Record<string, unknown>;
    const num = (v: unknown) => Number(v) || 0;
    return {
      class_no: String(o.class_no ?? ""),
      enrolled: num(o.enrolled),
      attend: num(o.attend),
      absent: num(o.absent),
      lead: num(o.lead),
      exemplary: num(o.exemplary),
      memory: num(o.memory),
      lesson: num(o.lesson),
      bible: num(o.bible),
      quiz: num(o.quiz),
    };
  });
}

function todayDate() {
  // toISOString은 UTC라 KST 자정~오전9시에 하루 전 날짜가 됨 — 로컬 날짜로 포맷
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(d: string) {
  if (!d) return "";
  const date = new Date(d);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

const headerStyle: React.CSSProperties = {
  background: "var(--card)",
  borderBottom: "1px solid var(--hairline)",
  padding: "10px clamp(12px,4vw,20px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  minWidth: 0,
};

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 14,
  padding: 20,
  boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "9px 12px",
  border: "1.5px solid var(--hairline)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const classThStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--ink-soft)",
  padding: "6px 6px",
  borderBottom: "1.5px solid var(--hairline)",
  whiteSpace: "nowrap",
  textAlign: "center",
};

const classTdStyle: React.CSSProperties = {
  padding: "4px 4px",
  borderBottom: "1px solid var(--hairline)",
  textAlign: "center",
};

const classCellInput: React.CSSProperties = {
  width: 52,
  padding: "6px 6px",
  border: "1.5px solid var(--hairline)",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
  textAlign: "center",
  boxSizing: "border-box",
};

const classRowDelBtn: React.CSSProperties = {
  background: "var(--danger-soft)",
  color: "var(--danger)",
  border: "none",
  borderRadius: 6,
  width: 24,
  height: 24,
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1,
};

const addRowBtnStyle: React.CSSProperties = {
  padding: "7px 14px",
  background: "var(--bg-soft)",
  color: "var(--ink-mid)",
  border: "1.5px dashed var(--hairline)",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--ink-faint)",
  letterSpacing: 0.5,
  marginBottom: 12,
};

const saveBtnStyle: React.CSSProperties = {
  padding: "8px 18px",
  background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const prefillBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#E2EDF2",
  color: "#3E6A85",
  border: "1.5px solid #C9DEE8",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const deleteBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--danger-soft)",
  color: "var(--danger)",
  border: "1px solid var(--danger-soft)",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const addBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
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
  background: "var(--bg-soft)",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--ink-mid)",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap" as const, flexShrink: 0,
};

const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 40,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(43, 39, 34,0.88)",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  zIndex: 999,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};


const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(43, 39, 34,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 1000,
};

const modalCardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: "22px 22px 18px",
  width: "100%",
  maxWidth: 360,
  boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
  textAlign: "center",
};

const modalPrimaryBtnStyle: React.CSSProperties = {
  padding: "8px 18px",
  background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const modalSecondaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--bg-soft)",
  color: "var(--ink-mid)",
  border: "1.5px solid var(--hairline)",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};
