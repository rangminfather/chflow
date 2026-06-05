"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";

interface PreviewRow {
  student_id: string;
  member_id: string | null;
  name: string;
  current_grade: number;
  current_class: string | null;
  next_grade: number;
  will_graduate: boolean;
  next_dept_id: string | null;
  next_dept_name: string | null;
}

interface Teacher {
  id: string;
  name: string;
  teacher_role: string | null;
}

interface Assignment {
  class_no: string | null;
  teacher_id: string | null;
}

const STEPS = [
  { n: 1, label: "미리보기" },
  { n: 2, label: "반 편성" },
  { n: 3, label: "담임 배정" },
  { n: 4, label: "확정" },
];

export default function PromotePage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);

  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());

  // 학년별 반 개수 (다음 학년 기준): grade_year → count
  const [classCount, setClassCount] = useState<Record<number, number>>({});
  // student_id → { class_no, teacher_id }
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});

  const [finalizing, setFinalizing] = useState(false);
  const [toast, setToast] = useState("");
  const [done, setDone] = useState<{ promoted: number; graduated: number } | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2800);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);

      const [gradeR, prevR, teachR] = await Promise.all([
        supabase.rpc("get_user_grade", { p_dept_id: deptId }),
        supabase.rpc("promote_preview", { p_dept_id: deptId }),
        supabase.rpc("edu_list_teachers", { p_dept_id: deptId }),
      ]);

      const myGrade = typeof gradeR.data === "number" ? gradeR.data : Number(gradeR.data);
      if (myGrade === null || myGrade > 1) {
        setAuthorized(false); setLoading(false); return;
      }
      setAuthorized(true);

      if (prevR.error) {
        showToast("미리보기 실패: " + prevR.error.message);
        setLoading(false);
        return;
      }
      const rows = (prevR.data as PreviewRow[]) || [];
      setPreview(rows);
      setTeachers((teachR.data as Teacher[]) || []);

      // 기본 반 개수: 학년별 학생 수 / 5명 (반올림 올림)
      const stayingByNextGrade: Record<number, number> = {};
      rows.filter(r => !r.will_graduate).forEach(r => {
        stayingByNextGrade[r.next_grade] = (stayingByNextGrade[r.next_grade] || 0) + 1;
      });
      const cc: Record<number, number> = {};
      Object.entries(stayingByNextGrade).forEach(([g, n]) => {
        cc[Number(g)] = Math.max(1, Math.ceil(n / 5));
      });
      setClassCount(cc);

      // 자동 균등 분배 1회 (라운드로빈)
      const init: Record<string, Assignment> = {};
      const sortedRows = [...rows].filter(r => !r.will_graduate).sort((a, b) => {
        if (a.next_grade !== b.next_grade) return a.next_grade - b.next_grade;
        return a.name.localeCompare(b.name);
      });
      const idx: Record<number, number> = {};
      for (const r of sortedRows) {
        const ng = r.next_grade;
        const total = cc[ng] || 1;
        const i = (idx[ng] = (idx[ng] || 0) + 1);
        const classIdx = ((i - 1) % total) + 1;
        init[r.student_id] = { class_no: `${ng}-${classIdx}`, teacher_id: null };
      }
      setAssignments(init);

      setLoading(false);
    })();
  }, [deptId, router, showToast]);

  // 학년별 반 개수 변경 시 재분배
  function changeClassCount(g: number, n: number) {
    const safeN = Math.max(1, Math.min(20, n));
    const newCC = { ...classCount, [g]: safeN };
    setClassCount(newCC);
    // 라운드로빈 재배치 (해당 학년만)
    const studentsOfGrade = preview
      .filter(r => !r.will_graduate && r.next_grade === g)
      .sort((a, b) => a.name.localeCompare(b.name));
    const newAssign = { ...assignments };
    studentsOfGrade.forEach((r, i) => {
      const classIdx = (i % safeN) + 1;
      newAssign[r.student_id] = {
        ...newAssign[r.student_id],
        class_no: `${g}-${classIdx}`,
      };
    });
    setAssignments(newAssign);
  }

  function changeStudentClass(studentId: string, classNo: string) {
    setAssignments(a => ({ ...a, [studentId]: { ...a[studentId], class_no: classNo, teacher_id: null } }));
  }

  function changeClassTeacher(classNo: string, teacherId: string) {
    // 같은 반의 모든 학생에게 담임 일괄 적용
    const next = { ...assignments };
    Object.entries(next).forEach(([sid, a]) => {
      if (a.class_no === classNo) next[sid] = { ...a, teacher_id: teacherId || null };
    });
    setAssignments(next);
  }

  async function handleFinalize() {
    if (!confirm(`${year}년도 진급을 확정합니다.\n\n진급 후 학년/반/담임이 일괄 변경되며 이력이 저장됩니다.\n되돌리기는 어렵습니다. 계속할까요?`)) return;
    setFinalizing(true);
    const payload = Object.entries(assignments).map(([sid, a]) => ({
      student_id: sid,
      new_class_no: a.class_no,
      new_teacher_id: a.teacher_id,
    }));
    const { data, error } = await supabase.rpc("promote_finalize", {
      p_dept_id: deptId,
      p_year: year,
      p_assignments: payload,
    });
    setFinalizing(false);
    if (error) {
      showToast("확정 실패: " + error.message);
      return;
    }
    const r = (data as any)?.[0] || data;
    setDone({ promoted: r?.promoted_cnt || 0, graduated: r?.graduated_cnt || 0 });
  }

  const staying = useMemo(() => preview.filter(r => !r.will_graduate), [preview]);
  const graduating = useMemo(() => preview.filter(r => r.will_graduate), [preview]);
  const nextDeptName = preview[0]?.next_dept_name;

  // 진급 후 학년별 그룹
  const byNextGrade = useMemo(() => {
    const m: Record<number, PreviewRow[]> = {};
    staying.forEach(r => { (m[r.next_grade] = m[r.next_grade] || []).push(r); });
    return m;
  }, [staying]);

  // 진급 후 모든 반 목록 (담임 배정용)
  const allClasses = useMemo(() => {
    const map = new Map<string, { count: number; currentTeacherId: string | null }>();
    staying.forEach(r => {
      const a = assignments[r.student_id];
      if (!a?.class_no) return;
      const cur = map.get(a.class_no) || { count: 0, currentTeacherId: null };
      cur.count += 1;
      if (a.teacher_id) cur.currentTeacherId = a.teacher_id;
      map.set(a.class_no, cur);
    });
    return Array.from(map.entries())
      .map(([classNo, v]) => ({ classNo, count: v.count, currentTeacherId: v.currentTeacherId }))
      .sort((a, b) => a.classNo.localeCompare(b.classNo));
  }, [staying, assignments]);

  if (!authChecked || loading) {
    return <div style={loadingStyle}>로딩 중...</div>;
  }
  if (!authorized) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>접근 권한이 없습니다</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>진급 마법사는 등급 0~1 (전도사·교육사·부장) 만 가능합니다</div>
            <button onClick={() => router.push(`/departments/d/${deptId}`)} style={primaryBtn}>← 부서홈</button>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 520, margin: "60px auto", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 14 }}>🎓</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 12 }}>{year}년도 진급 완료</div>
            <div style={{ fontSize: 13, color: "#475569", marginBottom: 18, lineHeight: 1.8 }}>
              재학 → 진급: <b>{done.promoted}명</b><br />
              {nextDeptName ? `${nextDeptName}으로 전출` : "졸업 보관"}: <b>{done.graduated}명</b>
            </div>
            <button onClick={() => router.push(`/departments/d/${deptId}`)} style={primaryBtn}>부서홈으로</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>

      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtn}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>🎓 진급 마법사</div>
        <div style={{ width: 60 }} />
      </div>

      {/* 단계 표시 */}
      <div style={{ maxWidth: 720, margin: "16px auto 0", padding: "0 16px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {STEPS.map(s => (
            <div key={s.n} style={{
              flex: 1, padding: "8px 10px", borderRadius: 8, textAlign: "center",
              fontSize: 11, fontWeight: 700,
              background: step === s.n ? "#6366f1" : step > s.n ? "#dcfce7" : "#f1f5f9",
              color: step === s.n ? "#fff" : step > s.n ? "#15803d" : "#64748b",
            }}>
              {step > s.n ? "✓ " : `${s.n}. `}{s.label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>

        {/* Step 1: 미리보기 */}
        {step === 1 && (
          <div style={card}>
            <div style={sectionLabel}>1. 미리보기</div>
            <div style={{ background: "#f8fafc", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
              <b>{year}년도 → {year + 1}년도 진급 결과</b>
              <div style={{ marginTop: 6 }}>
                재학 진급: <b>{staying.length}명</b> · {nextDeptName ? <>전출(→ {nextDeptName}): <b>{graduating.length}명</b></> : <>졸업: <b>{graduating.length}명</b></>}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: "#64748b" }}>스냅샷 연도:</span>
              <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || year)}
                style={{ width: 80, padding: "5px 8px", fontSize: 13, border: "1.5px solid #cbd5e1", borderRadius: 6, fontFamily: "inherit" }} />
              <span style={{ fontSize: 11, color: "#94a3b8" }}>(이력 저장 기준)</span>
            </div>

            {/* 현재 학년별로 묶어서 진급 카드 표시 */}
            {(() => {
              const byCurrent: Record<number, PreviewRow[]> = {};
              preview.forEach(r => { (byCurrent[r.current_grade] = byCurrent[r.current_grade] || []).push(r); });
              return Object.keys(byCurrent).sort((a, b) => Number(a) - Number(b)).map(gKey => {
                const cg = Number(gKey);
                const list = byCurrent[cg];
                const willGrad = list[0].will_graduate;
                const ng = list[0].next_grade;
                const dest = list[0].next_dept_name;

                const accent = willGrad ? "#f97316" : "#6366f1";
                const accentBg = willGrad ? "#fff7ed" : "#eef2ff";
                const accentBorder = willGrad ? "#fed7aa" : "#c7d2fe";

                return (
                  <div key={cg} style={{
                    background: accentBg,
                    border: `1.5px solid ${accentBorder}`,
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: 12,
                  }}>
                    {/* 진급 화살표 헤더 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                      <div style={{
                        background: "#fff", border: `1.5px solid ${accentBorder}`,
                        borderRadius: 10, padding: "8px 14px",
                        fontSize: 18, fontWeight: 800, color: "#1e293b",
                        minWidth: 70, textAlign: "center",
                      }}>
                        {cg}학년
                      </div>
                      <div style={{ fontSize: 24, color: accent, fontWeight: 800 }}>→</div>
                      <div style={{
                        background: accent, color: "#fff",
                        borderRadius: 10, padding: "8px 14px",
                        fontSize: 18, fontWeight: 800,
                        minWidth: 70, textAlign: "center",
                      }}>
                        {ng}학년
                      </div>
                      <div style={{ flex: 1, minWidth: 80, textAlign: "right" }}>
                        <span style={{
                          padding: "4px 10px", borderRadius: 999,
                          background: "#fff", color: accent,
                          fontSize: 12, fontWeight: 700,
                          border: `1.5px solid ${accent}`,
                        }}>
                          {list.length}명
                        </span>
                      </div>
                    </div>

                    {/* 처리 방식 안내 */}
                    <div style={{
                      background: "#fff", borderRadius: 8, padding: "8px 12px",
                      marginBottom: 10, fontSize: 12, fontWeight: 600,
                      color: willGrad ? "#9a3412" : "#3730a3",
                    }}>
                      {willGrad
                        ? (dest ? `🎓 졸업 → ${dest}으로 전출` : "🎓 졸업 보관 (다음 부서 미지정)")
                        : "📚 본 부서에서 진급(잔류)"}
                    </div>

                    {/* 학생 이름들 */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {list.map(r => (
                        <span key={r.student_id} style={{
                          display: "inline-block", padding: "4px 10px",
                          background: "#fff", borderRadius: 999,
                          fontSize: 12, color: "#1e293b", fontWeight: 600,
                          border: `1px solid ${accentBorder}`,
                        }}>
                          {r.name}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {/* Step 2: 반 편성 */}
        {step === 2 && (
          <div style={card}>
            <div style={sectionLabel}>2. 반 편성</div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14, lineHeight: 1.7 }}>
              학년별 반 개수를 정하면 자동 균등 분배됩니다. 학생 카드의 <span style={{ color: "#6366f1", fontWeight: 700 }}>반 번호</span>를 탭하면 그 반 박스로 이동합니다.
            </div>
            {Object.keys(byNextGrade).sort((a, b) => Number(a) - Number(b)).map(gKey => {
              const g = Number(gKey);
              const list = byNextGrade[g];
              const cnt = classCount[g] || 1;
              const classOptions = Array.from({ length: cnt }, (_, i) => `${g}-${i + 1}`);
              // 반별로 학생 그룹핑
              const byClass: Record<string, PreviewRow[]> = {};
              classOptions.forEach(c => { byClass[c] = []; });
              list.forEach(r => {
                const c = assignments[r.student_id]?.class_no;
                if (c && byClass[c]) byClass[c].push(r);
              });
              return (
                <div key={g} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px dashed #e2e8f0" }}>
                  {/* 학년 헤더 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>📚 {g}학년 ({list.length}명)</div>
                    <span style={{ fontSize: 11, color: "#64748b" }}>반 수:</span>
                    <input type="number" min={1} max={20} value={cnt}
                      onChange={(e) => changeClassCount(g, parseInt(e.target.value, 10) || 1)}
                      style={{ width: 56, padding: "4px 6px", fontSize: 12, border: "1.5px solid #cbd5e1", borderRadius: 6, fontFamily: "inherit" }} />
                    <button onClick={() => changeClassCount(g, cnt)} style={smallBtn}>↻ 재분배</button>
                  </div>

                  {/* 반별 박스 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {classOptions.map(c => {
                      const classNum = c.split("-")[1];
                      const members = byClass[c];
                      return (
                        <div key={c} style={{
                          background: "#f8fafc",
                          border: "1.5px solid #e2e8f0",
                          borderRadius: 12,
                          padding: 12,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 28, height: 28, borderRadius: 8,
                                background: "#6366f1", color: "#fff",
                                fontSize: 13, fontWeight: 800,
                              }}>{classNum}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                                {classNum}반
                              </span>
                            </div>
                            <span style={{
                              padding: "3px 10px", borderRadius: 999,
                              background: members.length === 0 ? "#fee2e2" : "#eef2ff",
                              color: members.length === 0 ? "#b91c1c" : "#4338ca",
                              fontSize: 11, fontWeight: 700,
                            }}>{members.length}명</span>
                          </div>
                          {members.length === 0 ? (
                            <div style={{ padding: "14px 8px", textAlign: "center", color: "#94a3b8", fontSize: 11 }}>
                              비어 있음
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {members.map(r => (
                                <div key={r.student_id} style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  background: "#fff",
                                  borderRadius: 8,
                                  padding: "7px 10px",
                                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                                }}>
                                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#1e293b", minWidth: 0 }}>
                                    {r.name}
                                  </div>
                                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                    {classOptions.map(opt => {
                                      const active = opt === c;
                                      const optNum = opt.split("-")[1];
                                      return (
                                        <button
                                          key={opt}
                                          onClick={() => !active && changeStudentClass(r.student_id, opt)}
                                          disabled={active}
                                          style={{
                                            minWidth: 30, padding: "5px 8px",
                                            background: active ? "#6366f1" : "#f1f5f9",
                                            color: active ? "#fff" : "#64748b",
                                            border: "none", borderRadius: 6,
                                            fontSize: 11, fontWeight: 700,
                                            cursor: active ? "default" : "pointer",
                                            fontFamily: "inherit",
                                            transition: "background 0.12s",
                                          }}
                                        >{optNum}</button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Step 3: 담임 배정 */}
        {step === 3 && (
          <div style={card}>
            <div style={sectionLabel}>3. 담임 배정</div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14, lineHeight: 1.7 }}>
              반 ↔ 선생님 매칭. 선생님 목록은 부서 교사진(edu_teachers) 기준입니다.
              새 선생님은 <a href={`/departments/d/${deptId}/members-grade`} style={{ color: "#6366f1", fontWeight: 600 }}>임명 메뉴</a>에서 추가 후 다시 들어오세요.
            </div>
            {allClasses.map(({ classNo, count, currentTeacherId }) => (
              <div key={classNo} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{classNo}반</div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{count}명</div>
                </div>
                <select value={currentTeacherId || ""} onChange={(e) => changeClassTeacher(classNo, e.target.value)} style={{ ...selectStyle, minWidth: 140 }}>
                  <option value="">담임 미정</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.teacher_role ? ` (${t.teacher_role})` : ""}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {/* Step 4: 확정 */}
        {step === 4 && (
          <div style={card}>
            <div style={sectionLabel}>4. 확정</div>
            <div style={{ background: "#fef3c7", borderRadius: 8, padding: 14, fontSize: 12, color: "#92400e", lineHeight: 1.7, marginBottom: 14 }}>
              <b>⚠️ 확정 시 일어나는 일</b>
              <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                <li>모든 학생 학년 +1</li>
                <li>{year}년도 상태가 이력 테이블에 스냅샷 저장</li>
                <li>{graduating.length}명 → {nextDeptName ? `${nextDeptName}으로 전출` : "졸업(비활성)"}</li>
                {nextDeptName && <li>{nextDeptName} 부장에게 알림 전송</li>}
                <li>되돌리기 어려움 (수동 보정 가능)</li>
              </ul>
            </div>
            <div style={{ background: "#f8fafc", borderRadius: 8, padding: 14, marginBottom: 14, fontSize: 13, color: "#475569" }}>
              <b>요약</b>
              <div style={{ marginTop: 8, lineHeight: 1.8 }}>
                재학 진급: <b>{staying.length}명</b><br />
                {nextDeptName ? `전출 (→ ${nextDeptName})` : "졸업"}: <b>{graduating.length}명</b><br />
                반 수: <b>{allClasses.length}개</b><br />
                담임 미정: <b>{allClasses.filter(c => !c.currentTeacherId).length}개 반</b>
              </div>
            </div>
            <button onClick={handleFinalize} disabled={finalizing} style={{
              width: "100%", padding: "12px", background: finalizing ? "#94a3b8" : "linear-gradient(135deg, #dc2626, #b91c1c)",
              color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800,
              cursor: finalizing ? "wait" : "pointer", fontFamily: "inherit",
            }}>
              {finalizing ? "처리 중..." : `${year}년도 진급 확정`}
            </button>
          </div>
        )}

        {/* 단계 이동 버튼 */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={step === 1} onClick={() => setStep(step - 1)} style={{ ...navBtn, opacity: step === 1 ? 0.4 : 1 }}>← 이전</button>
          {step < 4 && <button onClick={() => setStep(step + 1)} style={{ ...navBtn, background: "#6366f1", color: "#fff" }}>다음 →</button>}
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" };
const loadingStyle: React.CSSProperties = { ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" };
const headerStyle: React.CSSProperties = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const card: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "#475569", letterSpacing: 0.5, marginBottom: 12 };
const summaryStyle: React.CSSProperties = { cursor: "pointer", padding: "8px 12px", background: "#f1f5f9", borderRadius: 6, fontSize: 12, fontWeight: 700, color: "#1e293b" };
const chip: React.CSSProperties = { display: "inline-block", padding: "2px 8px", margin: "2px", background: "#eef2ff", borderRadius: 12, fontSize: 11, color: "#4338ca" };
const selectStyle: React.CSSProperties = { padding: "5px 8px", fontSize: 12, border: "1.5px solid #cbd5e1", borderRadius: 6, fontFamily: "inherit", background: "#fff" };
const smallBtn: React.CSSProperties = { padding: "4px 10px", background: "#f1f5f9", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const navBtn: React.CSSProperties = { flex: 1, padding: "12px", background: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const backBtn: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const primaryBtn: React.CSSProperties = { padding: "10px 20px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
