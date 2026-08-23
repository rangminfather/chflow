"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView } from "@/components/StatusViews";
import { ClipboardCheck, Lock, Info, Save } from "lucide-react";
import YmdSelect from "@/components/YmdSelect";

/** 시험일에서 고를 수 있는 연도 범위 — 지난해 기록 수정까지 허용 */
const QUIZ_MIN_YEAR = new Date().getFullYear() - 1;

interface Student {
  id: string;
  student_no: number;
  name: string;
  grade: string | null;
  is_active: boolean;
  order_no: number;
  teacher_name: string | null;
}

interface QuizRecord {
  id: string;
  student_id: string;
  quiz_date: string;
  points: number;
  total_count: number | null;
  note: string | null;
}

interface ClassMeta {
  id: string;
  class_no: string | null;
  grade_year: number | null;
}

export default function QuizTalentPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const now = new Date();
  const [authChecked, setAuthChecked] = useState(false);
  const [myGrade, setMyGrade] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [quizDate, setQuizDate] = useState(toDateKey(now));
  const [totalCount, setTotalCount] = useState("");

  const [students, setStudents] = useState<Student[]>([]);
  const [classMeta, setClassMeta] = useState<Record<string, ClassMeta>>({});
  const [records, setRecords] = useState<QuizRecord[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({}); // student_id -> 맞은개수(문자열)
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2600);
  }, []);

  const canEdit = myGrade !== null && myGrade <= 2;

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const g = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      setMyGrade(typeof g.data === "number" ? g.data : Number(g.data));
      setAuthChecked(true);
    })();
  }, [deptId, router]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [{ data: roster }, metaResp, { data: recs }] = await Promise.all([
      supabase.rpc("edu_list_students", { p_dept_id: deptId }),
      supabase.from("edu_students").select("id, class_no, grade_year").eq("department_id", deptId),
      supabase.rpc("edu_quiz_talent_list", { p_dept_id: deptId, p_year: year, p_month: month }),
    ]);

    const list = ((roster || []) as Student[])
      .filter((s) => s.is_active)
      .sort((a, b) => (a.order_no || 0) - (b.order_no || 0) || (a.student_no || 0) - (b.student_no || 0));
    setStudents(list);

    const meta: Record<string, ClassMeta> = {};
    ((metaResp.data || []) as ClassMeta[]).forEach((m) => { meta[m.id] = m; });
    setClassMeta(meta);

    setRecords((recs || []) as QuizRecord[]);
    setLoading(false);
  }, [deptId, year, month]);

  useEffect(() => {
    if (!authChecked || !canEdit) { setLoading(false); return; }
    loadAll();
  }, [authChecked, canEdit, loadAll]);

  // 선택한 시험일에 해당하는 기록을 입력칸에 반영
  useEffect(() => {
    const map: Record<string, string> = {};
    let total = "";
    records.forEach((r) => {
      if (r.quiz_date === quizDate) {
        map[r.student_id] = String(r.points);
        if (r.total_count != null) total = String(r.total_count);
      }
    });
    setInputs(map);
    setTotalCount(total);
    setDirty(new Set());
  }, [records, quizDate]);

  // 학년·반별 그룹 (반 정보 없으면 담임 기준)
  const groups = useMemo(() => {
    const byKey: Record<string, { label: string; sortKey: string; students: Student[] }> = {};
    students.forEach((s) => {
      const m = classMeta[s.id];
      const gy = m?.grade_year ?? null;
      const cls = m?.class_no ?? null;
      const label = gy != null && cls
        ? `${gy}학년 ${cls}반`
        : cls
          ? `${cls}반`
          : s.teacher_name
            ? `${s.teacher_name} 선생님 반`
            : "반 미배정";
      const sortKey = `${gy ?? 99}_${cls ?? "zz"}_${s.teacher_name ?? "zz"}`;
      if (!byKey[label]) byKey[label] = { label, sortKey, students: [] };
      byKey[label].students.push(s);
    });
    return Object.values(byKey).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [students, classMeta]);

  const enteredCount = useMemo(
    () => Object.values(inputs).filter((v) => Number(v) > 0).length,
    [inputs]
  );
  const sumPoints = useMemo(
    () => Object.values(inputs).reduce((acc, v) => acc + (Number(v) > 0 ? Number(v) : 0), 0),
    [inputs]
  );

  function setInput(studentId: string, value: string) {
    const clean = value.replace(/[^0-9]/g, "");
    setInputs((prev) => ({ ...prev, [studentId]: clean }));
    setDirty((prev) => new Set(prev).add(studentId));
  }

  async function handleSave() {
    if (!canEdit || !quizDate) return;
    const targets = students.filter((s) => dirty.has(s.id));
    if (targets.length === 0) { showToast("변경된 내용이 없습니다"); return; }

    setSaving(true);
    const totalNum = totalCount.trim() ? Number(totalCount) : null;
    try {
      for (const s of targets) {
        const pts = Number(inputs[s.id] || 0);
        const { error } = await supabase.rpc("edu_quiz_talent_save", {
          p_dept_id: deptId,
          p_student_id: s.id,
          p_date: quizDate,
          p_points: pts,
          p_total: totalNum,
          p_note: null,
        });
        if (error) throw error;
      }
      showToast(`${targets.length}명 저장되었습니다`);
      await loadAll();
    } catch (e) {
      showToast("저장 실패: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function changeMonth(delta: number) {
    let y = year;
    let m = month + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYear(y);
    setMonth(m);
    // 시험일도 해당 월 1일로 맞춤(기존 기록 있으면 그 날짜로 자동 반영됨)
    setQuizDate(`${y}-${String(m).padStart(2, "0")}-01`);
  }

  if (!authChecked) return <LoadingView full />;

  if (!canEdit) {
    return (
      <div style={pageStyle}>
        <div className="app-subpage-header" style={headerStyle}>
          <HeaderLogo />
          <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtn}>← 부서홈</button>
          <div style={titleStyle}><ClipboardCheck size={18} strokeWidth={1.8} /> 공과퀴즈 달란트</div>
          <div style={{ width: 60 }} />
        </div>
        <div style={{ maxWidth: 440, margin: "60px auto", padding: 24 }}>
          <div style={{ background: "var(--card)", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><Lock size={40} strokeWidth={1.8} color="var(--ink-faint)" /></div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>입력 권한이 없습니다</div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>공과퀴즈 달란트는 임원진(등급 0~2: 부장·총무·서기)만 입력할 수 있습니다.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtn}>← 부서홈</button>
        <div style={titleStyle}><ClipboardCheck size={18} strokeWidth={1.8} /> 공과퀴즈 달란트</div>
        <div style={{ width: 60 }} />
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 16, paddingBottom: 96 }}>
        {/* 월/시험일 선택 */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 12 }}>
            <button onClick={() => changeMonth(-1)} style={navBtn}>◀</button>
            <div style={{ minWidth: 130, textAlign: "center", fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>{year}년 {month}월</div>
            <button onClick={() => changeMonth(1)} style={navBtn}>▶</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={lbl}>시험일</label>
              <YmdSelect groupLabel="시험일" value={quizDate} onChange={setQuizDate} minYear={QUIZ_MIN_YEAR} selectStyle={input} />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label style={lbl}>총 문항 수 (선택)</label>
              <input type="number" inputMode="numeric" value={totalCount} min={0}
                onChange={(e) => setTotalCount(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="예: 12" style={input} />
            </div>
          </div>
        </div>

        {/* 안내 */}
        <div style={{ ...infoBox }}>
          <Info size={15} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>문제당 1달란트입니다. 학생별 <b>맞은 개수</b>를 입력하세요. 0이거나 비우면 미응시로 처리됩니다. 입력값은 학생 <b>달란트통장 총합</b>에 합산됩니다.</span>
        </div>

        {/* 요약 */}
        <div style={{ display: "flex", gap: 10, margin: "12px 0" }}>
          <div style={summaryChip}>응시 <b style={{ color: "var(--accent-strong)" }}>{enteredCount}</b>명</div>
          <div style={summaryChip}>합계 <b style={{ color: "var(--warning)" }}>{sumPoints}</b>달란트</div>
        </div>

        {loading ? (
          <LoadingView padding={40} label="불러오는 중..." />
        ) : students.length === 0 ? (
          <div style={{ ...card, textAlign: "center", color: "var(--ink-faint)", fontSize: 14, padding: 40 }}>등록된 학생이 없습니다.</div>
        ) : (
          groups.map((grp) => (
            <div key={grp.label} style={{ ...card, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-mid)", marginBottom: 10 }}>
                {grp.label} <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}>({grp.students.length}명)</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {grp.students.map((s) => {
                  const val = inputs[s.id] ?? "";
                  const has = Number(val) > 0;
                  return (
                    <div key={s.id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10,
                      background: has ? "color-mix(in srgb, var(--accent) 7%, var(--surface))" : "var(--surface)",
                      border: `1px solid ${has ? "color-mix(in srgb, var(--accent) 30%, transparent)" : "var(--hairline)"}`,
                    }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
                        {s.name}
                        {s.grade && <span style={{ fontSize: 11, color: "var(--ink-faint)", marginLeft: 6, fontWeight: 600 }}>{s.grade}</span>}
                      </div>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={val}
                        onChange={(e) => setInput(s.id, e.target.value)}
                        placeholder="0"
                        style={{
                          width: 72, padding: "8px 10px", textAlign: "center", fontSize: 16, fontWeight: 800,
                          border: "1.5px solid var(--hairline-strong)", borderRadius: 8, fontFamily: "inherit",
                          outline: "none", color: "var(--ink)", boxSizing: "border-box",
                        }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 700, color: has ? "var(--warning)" : "var(--ink-faint)", minWidth: 44, textAlign: "right" }}>
                        +{has ? Number(val) : 0}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 저장 (하단 고정) */}
      {!loading && students.length > 0 && (
        <div style={saveBar}>
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px", display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ flex: 1, fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>
              {dirty.size > 0 ? `${dirty.size}명 변경됨` : "변경된 내용 없음"}
            </div>
            <button onClick={handleSave} disabled={saving || dirty.size === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "11px 22px", borderRadius: 10, border: "none",
                background: dirty.size === 0 ? "var(--hairline-strong)" : "linear-gradient(135deg, var(--accent), var(--accent-muted))",
                color: "#fff", fontSize: 14, fontWeight: 800, cursor: saving || dirty.size === 0 ? "default" : "pointer", fontFamily: "inherit",
                opacity: saving ? 0.6 : 1,
              }}>
              <Save size={16} strokeWidth={2.2} /> {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 };
const backBtn: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const card: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const navBtn: React.CSSProperties = { padding: "7px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 16, cursor: "pointer", fontFamily: "inherit", color: "var(--ink-mid)" };
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "9px 12px", fontSize: 14, border: "1.5px solid var(--hairline-strong)", borderRadius: 8, fontFamily: "inherit", boxSizing: "border-box", outline: "none", color: "var(--ink)" };
const infoBox: React.CSSProperties = { display: "flex", gap: 8, background: "var(--warning-soft)", border: "1px solid color-mix(in srgb, var(--warning) 26%, transparent)", borderRadius: 10, padding: "10px 14px", marginTop: 12, fontSize: 12.5, color: "var(--ink-mid)", lineHeight: 1.6 };
const summaryChip: React.CSSProperties = { flex: 1, textAlign: "center", padding: "8px 10px", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" };
const saveBar: React.CSSProperties = { position: "fixed", bottom: 0, left: 0, right: 0, background: "color-mix(in srgb, var(--card) 92%, transparent)", backdropFilter: "blur(8px)", borderTop: "1px solid var(--hairline)", padding: "12px 0", zIndex: 900 };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
