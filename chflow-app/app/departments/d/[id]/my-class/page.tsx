"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase, formatPhone } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Baby, Cog, Save, UserPlus, X } from "lucide-react";

interface StudentRow {
  id: string;
  department_id: string;
  student_no: number | null;
  name: string;
  student_type: string | null;
  mgmt_status: string | null;
  grade: string | null;
  grade_year: number | null;
  class_no: string | null;
  is_active: boolean;
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
  name: string;
  student_type: string;
  mgmt_status: string;
  grade: string;
  grade_year: number | null;
  class_no: string | null;
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

type GuideKind = "student" | "self" | "other";

interface NewFriendForm {
  name: string;
  gender: string;
  birth_date: string;
  mobile: string;
  address: string;
  family_name: string;
  guide_kind: GuideKind;
  guide_student_id: string;
  guide_name: string;
}

const EMPTY_NEW_FRIEND: NewFriendForm = {
  name: "",
  gender: "",
  birth_date: "",
  mobile: "",
  address: "",
  family_name: "",
  guide_kind: "student",
  guide_student_id: "",
  guide_name: "",
};

const MGMT_STATUS_OPTIONS = ["정상", "장기결석"];

export default function MyClassPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [myTeacherId, setMyTeacherId] = useState<string | null>(null);
  const [myClassName, setMyClassName] = useState("");
  const [myGradeYear, setMyGradeYear] = useState<number | null>(null);
  const [students, setStudents] = useState<EditableStudent[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<EditableStudent | null>(null);
  const [families, setFamilies] = useState<Record<string, FamilyRow[]>>({});
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [showNewFriend, setShowNewFriend] = useState(false);
  const [newFriend, setNewFriend] = useState<NewFriendForm>({ ...EMPTY_NEW_FRIEND });
  const [newSaving, setNewSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: teacher } = await supabase
        .from("edu_teachers")
        .select("id")
        .eq("department_id", deptId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      setMyTeacherId(teacher?.id || null);
      setAuthChecked(true);
      if (teacher?.id) await loadStudents(teacher.id);
      else setLoading(false);
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

  async function loadStudents(teacherId: string) {
    setLoading(true);

    const { data: studentRows, error: studentErr } = await supabase
      .from("edu_students")
      .select("id, department_id, student_no, name, student_type, mgmt_status, grade, grade_year, class_no, is_active, order_no, member_id, teacher_id")
      .eq("department_id", deptId)
      .eq("teacher_id", teacherId)
      .eq("is_active", true)
      .order("order_no", { ascending: true })
      .order("student_no", { ascending: true })
      .order("name", { ascending: true });

    if (studentErr) {
      showToast("학생 목록을 불러오지 못했습니다: " + studentErr.message);
      setLoading(false);
      return;
    }

    const rows = (studentRows || []) as StudentRow[];
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

    const editable = rows.map((student) => {
      const member = student.member_id ? memberMap[student.member_id] : null;
      return {
        id: student.id,
        member_id: student.member_id,
        name: student.name,
        student_type: normalizeStudentType(student.student_type),
        mgmt_status: student.mgmt_status === "장기결석" ? "장기결석" : "정상",
        grade: student.grade || "",
        grade_year: student.grade_year,
        class_no: student.class_no,
        phone: member?.phone || "",
        birth_date: member?.birth_date || "",
        gender: member?.gender || "",
        address: member?.address || "",
      };
    });

    const nextSelectedId = selectedId && editable.some((student) => student.id === selectedId)
      ? selectedId
      : editable[0]?.id || "";

    setStudents(editable);
    setSelectedId(nextSelectedId);
    setDraft(editable.find((student) => student.id === nextSelectedId) || editable[0] || null);
    setMyClassName(editable[0]?.class_no || "");
    setMyGradeYear(editable[0]?.grade_year ?? null);
    setEditMode(false);
    await loadFamilies(editable);
    setLoading(false);
  }

  async function loadFamilies(list: EditableStudent[]) {
    const entries = await Promise.all(
      list.map(async (student) => {
        if (!student.member_id) return [student.id, []] as const;
        const { data } = await supabase.rpc("get_family_tree", { p_member_id: student.member_id });
        return [student.id, (data || []) as FamilyRow[]] as const;
      }),
    );
    setFamilies(Object.fromEntries(entries));
  }

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
    const response = await fetch("/api/edu/my-class-student", {
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
          mgmt_status: draft.mgmt_status,
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

  function openNewFriend() {
    setNewFriend({
      ...EMPTY_NEW_FRIEND,
      guide_kind: students.length > 0 ? "student" : "other",
      guide_student_id: students[0]?.id || "",
    });
    setShowNewFriend(true);
  }

  async function saveNewFriend() {
    if (!newFriend.name.trim()) {
      showToast("새친구 이름을 입력하세요");
      return;
    }
    if (newFriend.guide_kind === "student" && !newFriend.guide_student_id) {
      showToast("인도자 학생을 선택하세요");
      return;
    }

    setNewSaving(true);
    const { error } = await supabase.rpc("edu_save_new_friend", {
      p_id: null,
      p_dept_id: deptId,
      p_name: newFriend.name.trim(),
      p_gender: newFriend.gender || null,
      p_birth_date: newFriend.birth_date || null,
      p_phone: "",
      p_mobile: newFriend.mobile,
      p_address: newFriend.address,
      p_email: "",
      p_group_pa: "",
      p_group_jik: "",
      p_group_gun: "",
      p_group_cheo: "",
      p_family_name: newFriend.family_name,
      p_guide_name: newFriend.guide_kind === "other" ? newFriend.guide_name : null,
      p_school_dist: "",
      p_join_date: new Date().toISOString().slice(0, 10),
      p_special: "",
      p_memo: "",
      p_guide_kind: newFriend.guide_kind,
      p_guide_student_id: newFriend.guide_kind === "student" ? newFriend.guide_student_id : null,
      p_enroll_grade_year: myGradeYear,
      p_enroll_class_no: myClassName || null,
    });
    setNewSaving(false);

    if (error) {
      showToast("새친구 등록 실패: " + error.message);
      return;
    }

    setShowNewFriend(false);
    showToast("새친구가 등록되었습니다");
    if (myTeacherId) await loadStudents(myTeacherId);
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

  if (!myTeacherId) {
    return (
      <div style={pageStyle}>
        <PageHeader deptId={deptId} router={router} myClassName="" />
        <main className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-hairline bg-card text-center">
            <EmptyState message="본인이 담임으로 등록된 반이 없습니다" hint="부장 또는 전도사에게 담임 등록을 요청하세요" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} myClassName={myClassName} />

      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-4 md:grid-cols-[280px_1fr]">
        <section className="min-w-0 overflow-hidden rounded-lg border border-hairline bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <div>
              <div className="text-[17px] font-extrabold text-ink">우리반 학생</div>
              <div className="mt-1 text-[13px] font-semibold text-ink-faint">{students.length}명</div>
            </div>
            <button type="button" onClick={openNewFriend} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-[13px] font-extrabold text-white">
              <UserPlus size={15} strokeWidth={2.2} />
              새친구등록
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-[15px] text-ink-faint">불러오는 중...</div>
          ) : students.length === 0 ? (
            <div className="px-4 py-12 text-center text-[15px] leading-6 text-ink-faint">해당 반 학생이 없습니다.</div>
          ) : (
            <div className="flex flex-col gap-2 p-3">
              {students.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => selectStudent(student)}
                  className={[
                    "w-full rounded-lg border px-3 py-3 text-left",
                    selectedId === student.id ? "border-amber-400 bg-amber-50" : "border-hairline bg-card",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[16px] font-extrabold text-ink">{student.name}</span>
                    <span className="shrink-0 text-[12px] font-bold text-ink-faint">{genderLabel(student.gender)}</span>
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
                    {myGradeYear ? `${myGradeYear}학년 · ` : ""}{myClassName ? `${myClassName}반` : "반 정보 없음"}
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
                  <InfoField label="상태" editMode={editMode} value={draft.mgmt_status}>
                    <select value={draft.mgmt_status} onChange={(event) => updateDraft("mgmt_status", event.target.value)} className={inputClass}>
                      {MGMT_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </InfoField>
                  <div className="rounded-md border border-hairline bg-card px-3 py-2 text-[13px] leading-6 text-ink-soft">
                    장기결석으로 바꾸면 등반예정 알림과 출석부 등반 안내가 표시되지 않습니다. 다시 출석을 시작하면 정상으로 되돌리세요.
                  </div>
                </div>

                <div className="rounded-lg border border-hairline bg-surface p-4">
                  <div className="mb-3 text-[16px] font-extrabold text-ink">인적사항</div>
                  {!draft.member_id && editMode && (
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] leading-6 text-amber-900">
                      연결된 교적 정보가 없어 이름과 상태만 저장됩니다.
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

      {showNewFriend && (
        <NewFriendModal
          form={newFriend}
          students={students}
          saving={newSaving}
          onChange={setNewFriend}
          onCancel={() => !newSaving && setShowNewFriend(false)}
          onSave={saveNewFriend}
        />
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function NewFriendModal({
  form,
  students,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  form: NewFriendForm;
  students: EditableStudent[];
  saving: boolean;
  onChange: (next: NewFriendForm) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof NewFriendForm>(key: K, value: NewFriendForm[K]) => onChange({ ...form, [key]: value });

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-lg bg-card p-5" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 text-[19px] font-extrabold text-ink">새친구 등록</div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="이름">
            <input value={form.name} onChange={(event) => set("name", event.target.value)} className={inputClass} />
          </Field>
          <Field label="성별">
            <select value={form.gender} onChange={(event) => set("gender", event.target.value)} className={inputClass}>
              <option value="">미등록</option>
              <option value="M">남</option>
              <option value="F">여</option>
            </select>
          </Field>
          <Field label="생년월일">
            <input type="date" value={form.birth_date} onChange={(event) => set("birth_date", event.target.value)} className={inputClass} />
          </Field>
          <Field label="본인연락처">
            <input value={form.mobile} onChange={(event) => set("mobile", event.target.value)} className={inputClass} />
          </Field>
          <Field label="주소">
            <input value={form.address} onChange={(event) => set("address", event.target.value)} className={inputClass} />
          </Field>
          <Field label="가족 이름">
            <input value={form.family_name} onChange={(event) => set("family_name", event.target.value)} className={inputClass} />
          </Field>
        </div>

        <div className="mt-2 rounded-lg border border-hairline bg-surface p-3">
          <div className="mb-2 text-[14px] font-extrabold text-ink">인도자</div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[
              { value: "student", label: "학생" },
              { value: "self", label: "자진" },
              { value: "other", label: "기타" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => set("guide_kind", option.value as GuideKind)}
                className={[
                  "min-h-10 rounded-md border text-[13px] font-extrabold",
                  form.guide_kind === option.value ? "border-amber-400 bg-amber-50 text-ink" : "border-hairline bg-card text-ink-soft",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
          {form.guide_kind === "student" && (
            <select value={form.guide_student_id} onChange={(event) => set("guide_student_id", event.target.value)} className={inputClass}>
              <option value="">인도자 학생 선택</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
            </select>
          )}
          {form.guide_kind === "other" && (
            <input value={form.guide_name} onChange={(event) => set("guide_name", event.target.value)} placeholder="인도자 이름" className={inputClass} />
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-12 flex-1 rounded-md bg-bg-soft text-[16px] font-extrabold text-ink-mid">취소</button>
          <button type="button" onClick={onSave} disabled={saving} className="min-h-12 flex-[1.4] rounded-md bg-ink text-[16px] font-extrabold text-white disabled:opacity-60">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PageHeader({ deptId, router, myClassName }: { deptId: string; router: ReturnType<typeof useRouter>; myClassName: string }) {
  return (
    <div className="app-subpage-header" style={headerStyle}>
      <HeaderLogo />
      <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Baby size={18} strokeWidth={1.8} /> 우리반 아이정보 {myClassName && <span style={{ color: "var(--accent)", marginLeft: 6 }}>{myClassName}반</span>}
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

function normalizeStudentType(value: string | null | undefined) {
  return ["정", "체험", "소"].includes(value || "") ? (value as string) : "정";
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
