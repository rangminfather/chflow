"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase, formatPhone } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Cog, FileText, Lock, Save, Search, Users, X } from "lucide-react";

interface StudentRow {
  id: string;
  student_no: number | null;
  name: string;
  student_type: string | null;
  grade: string | null;
  grade_year: number | null;
  class_no: string | null;
  order_no: number | null;
  member_id: string | null;
  teacher_id: string | null;
}

interface MemberRow {
  id: string;
  name: string;
  phone: string | null;
  birth_date: string | null;
  gender: string | null;
  address: string | null;
}

interface EditableStudent {
  id: string;
  member_id: string | null;
  student_no: number | null;
  name: string;
  student_type: string;
  grade: string;
  grade_year: number | null;
  class_no: string | null;
  order_no: number | null;
  teacher_name: string;
  phone: string;
  birth_date: string;
  gender: string;
  address: string;
}

interface FamilyRow {
  relative_id: string;
  relative_name: string;
  relative_phone: string | null;
  kind: string | null;
  role: string | null;
  direction: string | null;
}

const STUDENT_TYPE_OPTIONS = ["정", "체험", "소"];
const UNASSIGNED = "반 미배정";

export default function StudentsInfoPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<EditableStudent[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<EditableStudent | null>(null);
  const [families, setFamilies] = useState<Record<string, FamilyRow[]>>({});
  const [classFilter, setClassFilter] = useState("");
  const [search, setSearch] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);

      const { data: gradeData } = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      const grade = typeof gradeData === "number" ? gradeData : Number(gradeData);
      if (Number.isNaN(grade) || grade > 2) {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      await loadStudents();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId, router]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedId) || null,
    [students, selectedId],
  );

  useEffect(() => {
    if (selectedStudent && !editMode) setDraft({ ...selectedStudent });
  }, [selectedStudent, editMode]);

  async function loadStudents() {
    setLoading(true);

    const [studentResp, teacherResp] = await Promise.all([
      supabase
        .from("edu_students")
        .select("id, student_no, name, student_type, grade, grade_year, class_no, order_no, member_id, teacher_id")
        .eq("department_id", deptId)
        .eq("is_active", true),
      supabase
        .from("edu_teachers")
        .select("id, name")
        .eq("department_id", deptId),
    ]);

    if (studentResp.error) {
      showToast("학생 목록을 불러오지 못했습니다: " + studentResp.error.message);
      setLoading(false);
      return;
    }

    const rows = (studentResp.data || []) as StudentRow[];
    const teacherMap: Record<string, string> = {};
    ((teacherResp.data || []) as { id: string; name: string }[]).forEach((teacher) => {
      teacherMap[teacher.id] = teacher.name;
    });

    const memberIds = rows.map((row) => row.member_id).filter(Boolean) as string[];
    const memberMap: Record<string, MemberRow> = {};
    if (memberIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("id, name, phone, birth_date, gender, address")
        .in("id", memberIds);
      ((members || []) as MemberRow[]).forEach((member) => {
        memberMap[member.id] = member;
      });
    }

    const editable: EditableStudent[] = rows.map((student) => {
      const member = student.member_id ? memberMap[student.member_id] : null;
      return {
        id: student.id,
        member_id: student.member_id,
        student_no: student.student_no,
        name: student.name,
        student_type: normalizeStudentType(student.student_type),
        grade: student.grade || "",
        grade_year: student.grade_year,
        class_no: student.class_no,
        order_no: student.order_no,
        teacher_name: student.teacher_id ? teacherMap[student.teacher_id] || "" : "",
        phone: member?.phone || "",
        birth_date: member?.birth_date || "",
        gender: member?.gender || "",
        address: member?.address || "",
      };
    });

    editable.sort(compareStudents);
    setStudents(editable);
    setSelectedId((current) => (current && editable.some((s) => s.id === current) ? current : editable[0]?.id || ""));
    setEditMode(false);
    setLoading(false);
  }

  async function loadFamily(student: EditableStudent) {
    if (!student.member_id || families[student.id]) return;
    const { data } = await supabase.rpc("get_family_tree", { p_member_id: student.member_id });
    setFamilies((current) => ({ ...current, [student.id]: (data || []) as FamilyRow[] }));
  }

  useEffect(() => {
    if (selectedStudent) loadFamily(selectedStudent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudent]);

  const classOptions = useMemo(() => {
    const seen = new Map<string, { label: string; count: number }>();
    students.forEach((student) => {
      const key = classLabel(student);
      const entry = seen.get(key);
      if (entry) entry.count += 1;
      else seen.set(key, { label: key, count: 1 });
    });
    return Array.from(seen.values());
  }, [students]);

  const filtered = useMemo(() => {
    const keyword = search.trim();
    return students.filter((student) => {
      if (classFilter && classLabel(student) !== classFilter) return false;
      if (keyword && !student.name.includes(keyword)) return false;
      return true;
    });
  }, [students, classFilter, search]);

  function selectStudent(student: EditableStudent) {
    setSelectedId(student.id);
    setDraft({ ...student });
    setEditMode(false);
  }

  function updateDraft<K extends keyof EditableStudent>(key: K, value: EditableStudent[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) {
      showToast("이름을 입력하세요");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    setSaving(true);
    const response = await fetch("/api/edu/admin-student", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        dept_id: deptId,
        student_id: draft.id,
        student: {
          name: draft.name,
          student_type: draft.student_type,
          grade: draft.grade || null,
        },
        member: {
          id: draft.member_id,
          phone: draft.phone || null,
          birth_date: draft.birth_date || null,
          gender: draft.gender || null,
          address: draft.address || null,
        },
      }),
    });

    const result = await response.json();
    setSaving(false);

    if (!response.ok || !result.ok) {
      showToast(result.error || "저장에 실패했습니다");
      return;
    }

    setStudents((current) => current.map((student) => (student.id === draft.id ? { ...draft } : student)));
    setEditMode(false);
    showToast("저장되었습니다");
  }

  function cancelEdit() {
    if (selectedStudent) setDraft({ ...selectedStudent });
    setEditMode(false);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

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
              hint="학생정보관리는 임원진(전도사·부장·부부장·총무·서기)만 이용할 수 있습니다"
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} />

      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-4 md:grid-cols-[300px_1fr]">
        <section className="min-w-0 overflow-hidden rounded-lg border border-hairline bg-card">
          <div className="border-b border-hairline px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[17px] font-extrabold text-ink">학생 명부</div>
              <div className="inline-flex items-center gap-1 text-[13px] font-bold text-ink-faint">
                <Users size={14} strokeWidth={2} /> {filtered.length}명
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-hairline bg-surface px-2.5">
              <Search size={14} strokeWidth={2.2} className="shrink-0 text-ink-faint" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="이름 검색"
                className="min-h-10 w-full bg-transparent text-[15px] font-bold text-ink outline-none"
              />
            </div>
            <select
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
              className="mt-2 min-h-10 w-full rounded-md border border-hairline bg-card px-2 text-[14px] font-bold text-ink outline-none"
            >
              <option value="">전체 반 ({students.length}명)</option>
              {classOptions.map((option) => (
                <option key={option.label} value={option.label}>{option.label} ({option.count}명)</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="py-12 text-center text-[15px] text-ink-faint">불러오는 중...</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-[15px] leading-6 text-ink-faint">조건에 맞는 학생이 없습니다.</div>
          ) : (
            <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto p-3">
              {filtered.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => selectStudent(student)}
                  className={[
                    "w-full rounded-lg border px-3 py-2.5 text-left",
                    selectedId === student.id ? "border-amber-400 bg-amber-50" : "border-hairline bg-card",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[15px] font-extrabold text-ink">{student.name}</span>
                    <span className="shrink-0 text-[12px] font-bold text-ink-faint">{genderLabel(student.gender)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] font-semibold text-ink-faint">
                    {classLabel(student)}{student.teacher_name ? ` · 담임 ${student.teacher_name}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-lg border border-hairline bg-card">
          {!draft ? (
            <div className="py-20 text-center text-[16px] text-ink-faint">학생을 선택하세요</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[19px] font-extrabold text-ink">{draft.name}</div>
                  <div className="mt-1 text-[13px] font-semibold text-ink-faint">
                    {classLabel(draft)}{draft.teacher_name ? ` · 담임 ${draft.teacher_name}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditMode((value) => !value)}
                  title={editMode ? "수정 종료" : "학생 정보 수정"}
                  className={[
                    "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border",
                    editMode ? "border-amber-400 bg-amber-50 text-amber-700" : "border-hairline bg-card text-ink-soft",
                  ].join(" ")}
                >
                  <Cog size={18} strokeWidth={1.9} className={editMode ? "animate-spin" : ""} style={editMode ? { animationDuration: "3s" } : undefined} />
                </button>
              </div>

              <div className="grid gap-4 p-4 lg:grid-cols-2">
                <div className="rounded-lg border border-hairline bg-surface p-4">
                  <div className="mb-3 text-[16px] font-extrabold text-ink">학생 정보</div>
                  <InfoField label="이름" editMode={editMode} value={draft.name || "미등록"}>
                    <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} className={inputClass} />
                  </InfoField>
                  <InfoField label="성별" editMode={editMode} value={genderLabel(draft.gender)}>
                    <select value={draft.gender} onChange={(event) => updateDraft("gender", event.target.value)} className={inputClass} disabled={!draft.member_id}>
                      <option value="">미등록</option>
                      <option value="M">남</option>
                      <option value="F">여</option>
                    </select>
                  </InfoField>
                  <InfoField label="구분" editMode={editMode} value={draft.student_type}>
                    <select value={draft.student_type} onChange={(event) => updateDraft("student_type", event.target.value)} className={inputClass}>
                      {STUDENT_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </InfoField>
                  <div className="mb-0">
                    <div className="mb-1 text-[14px] font-bold text-ink-soft">학년 · 반</div>
                    <div className="min-h-11 rounded-md border border-hairline bg-card px-3 py-2 text-[16px] font-bold leading-7 text-ink">{classLabel(draft)}</div>
                    <div className="mt-1 text-[12px] leading-5 text-ink-faint">반 이동·담임 변경은 반 관리 / 진급 마법사에서 합니다.</div>
                  </div>
                </div>

                <div className="rounded-lg border border-hairline bg-surface p-4">
                  <div className="mb-3 text-[16px] font-extrabold text-ink">인적사항</div>
                  {!draft.member_id && editMode && (
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] leading-6 text-amber-900">
                      연결된 교적 정보가 없어 이름과 구분만 저장됩니다.
                    </div>
                  )}
                  <InfoField label="생년월일" editMode={editMode} value={draft.birth_date || "미등록"}>
                    <input type="date" value={draft.birth_date} onChange={(event) => updateDraft("birth_date", event.target.value)} className={inputClass} disabled={!draft.member_id} />
                  </InfoField>
                  <InfoField label="본인연락처" editMode={editMode} value={draft.phone ? formatPhone(draft.phone) : "미등록"}>
                    <input value={draft.phone} onChange={(event) => updateDraft("phone", event.target.value)} placeholder="010-0000-0000" className={inputClass} disabled={!draft.member_id} />
                  </InfoField>
                  <InfoField label="주소" editMode={editMode} value={draft.address || "미등록"}>
                    <input value={draft.address} onChange={(event) => updateDraft("address", event.target.value)} className={inputClass} disabled={!draft.member_id} />
                  </InfoField>
                </div>

                <div className="rounded-lg border border-hairline bg-surface p-4 lg:col-span-2">
                  <div className="mb-3 text-[16px] font-extrabold text-ink">가족관계</div>
                  {(families[draft.id] || []).length === 0 ? (
                    <div className="rounded-md border border-hairline bg-card px-3 py-4 text-[14px] font-semibold text-ink-faint">등록된 가족관계가 없습니다.</div>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {(families[draft.id] || []).map((family) => (
                        <div key={`${family.relative_id}-${family.kind}-${family.direction}`} className="rounded-md border border-hairline bg-card px-3 py-2">
                          <div className="text-[14px] font-extrabold text-ink">{relationLabel(family)} · {family.relative_name}</div>
                          <div className="mt-1 text-[13px] font-semibold text-ink-faint">{family.relative_phone ? formatPhone(family.relative_phone) : "연락처 없음"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {editMode && (
                  <div className="flex gap-2 lg:col-span-2">
                    <button type="button" onClick={cancelEdit} disabled={saving} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-bg-soft text-[15px] font-extrabold text-ink-mid">
                      <X size={16} strokeWidth={2.2} />
                      취소
                    </button>
                    <button type="button" onClick={handleSave} disabled={saving} className="inline-flex min-h-11 flex-[1.5] items-center justify-center gap-2 rounded-md bg-ink text-[15px] font-extrabold text-white disabled:opacity-60">
                      <Save size={16} strokeWidth={2.2} />
                      {saving ? "저장 중..." : "저장"}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function PageHeader({ deptId, router }: { deptId: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div className="app-subpage-header" style={headerStyle}>
      <HeaderLogo />
      <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <FileText size={18} strokeWidth={1.8} /> 학생정보관리
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <div className="mb-1 text-[14px] font-bold text-ink-soft">{label}</div>
      {children}
    </label>
  );
}

function InfoField({ label, value, editMode, children }: { label: string; value: string; editMode: boolean; children: ReactNode }) {
  if (editMode) return <Field label={label}>{children}</Field>;

  return (
    <div className="mb-3">
      <div className="mb-1 text-[14px] font-bold text-ink-soft">{label}</div>
      <div className="min-h-11 rounded-md border border-hairline bg-card px-3 py-2 text-[16px] font-bold leading-7 text-ink">{value}</div>
    </div>
  );
}

function classLabel(student: { grade_year: number | null; class_no: string | null }) {
  if (!student.class_no) return UNASSIGNED;
  return `${student.grade_year ? `${student.grade_year}학년 ` : ""}${student.class_no}반`;
}

function compareStudents(a: EditableStudent, b: EditableStudent) {
  const gradeA = a.grade_year ?? 99;
  const gradeB = b.grade_year ?? 99;
  if (gradeA !== gradeB) return gradeA - gradeB;
  if ((a.class_no === null) !== (b.class_no === null)) return a.class_no === null ? 1 : -1;
  if (a.class_no && b.class_no && a.class_no !== b.class_no) return a.class_no.localeCompare(b.class_no, "ko");
  const orderA = a.order_no ?? 9999;
  const orderB = b.order_no ?? 9999;
  if (orderA !== orderB) return orderA - orderB;
  const noA = a.student_no ?? 9999;
  const noB = b.student_no ?? 9999;
  if (noA !== noB) return noA - noB;
  return a.name.localeCompare(b.name, "ko");
}

function normalizeStudentType(value: string | null | undefined) {
  return STUDENT_TYPE_OPTIONS.includes(value || "") ? (value as string) : "정";
}

function genderLabel(value: string | null | undefined) {
  if (value === "M" || value === "남") return "남";
  if (value === "F" || value === "여") return "여";
  return "미등록";
}

function relationLabel(row: FamilyRow) {
  if (row.role === "father") return "부";
  if (row.role === "mother") return "모";
  if (row.kind === "spouse") return "배우자";
  if (row.direction === "descendant") return "자녀";
  if (row.direction === "sibling") return "형제";
  return row.role || row.kind || "가족";
}

const inputClass = "min-h-11 w-full rounded-md border border-hairline-strong bg-card px-3 py-2 text-[16px] font-bold text-ink outline-none focus:border-amber-400 disabled:bg-bg-soft disabled:text-ink-faint";

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", overflowX: "hidden" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const toastStyle: CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 14, fontWeight: 700, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
