"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase, formatPhone } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import StudentPhotoEditor from "@/components/StudentPhotoEditor";
import PendingStudentPhotoPicker from "@/components/PendingStudentPhotoPicker";
import { saveStudentPendingPhoto } from "@/lib/studentPhotoUpload";
import { Baby, Cog, MoonStar, Plus, Save, UserPlus, X } from "lucide-react";

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
  school_name: string | null;
  is_active: boolean;
  order_no: number | null;
  member_id: string | null;
  teacher_id: string | null;
  photo_url: string | null;
}

interface MemberRow {
  id: string;
  name: string;
  phone: string | null;
  birth_date: string | null;
  gender: string | null;
  address: string | null;
  photo_url: string | null;
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
  school_name: string;
  phone: string;
  birth_date: string;
  gender: string;
  address: string;
  photo_url: string | null;
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

interface FamilyEntry {
  name: string;
  relation: string;
  phone: string;
}

interface FamilyUpdateEntry extends FamilyEntry {
  relative_id: string;
  kind: string | null;
  direction: string | null;
}

interface DeptStudentOption {
  id: string;
  name: string;
  class_no: string | null;
  grade_year: number | null;
  is_active: boolean;
}

interface NewFriendForm {
  name: string;
  gender: string;          // '남' | '여'
  gradeYear: string;       // '1' | '2' | '3'
  school: string;
  mobile: string;
  birthYear: string;
  birthMonth: string;
  birthDay: string;
  address: string;
  family: FamilyEntry[];
  guide_kind: GuideKind;
  guideGrade: string;      // 인도자 학생 학년 필터
  guide_student_id: string;
  guide_name: string;
  photo_url: string | null;
  photoFile: File | null;
  photoPreviewUrl: string | null;
}

const EMPTY_NEW_FRIEND: NewFriendForm = {
  name: "",
  gender: "",
  gradeYear: "",
  school: "",
  mobile: "",
  birthYear: "",
  birthMonth: "",
  birthDay: "",
  address: "",
  family: [],
  guide_kind: "student",
  guideGrade: "",
  guide_student_id: "",
  guide_name: "",
  photo_url: null,
  photoFile: null,
  photoPreviewUrl: null,
};

const FAMILY_RELATIONS = ["부", "모", "형", "누나", "오빠", "언니", "동생", "조부", "조모", "기타"];

/** 초등 학년 → 출생년도 (예: 2026년 초1 = 2019년생). 수정 가능한 기본값. */
function birthYearForGrade(gradeYear: number): string {
  return String(new Date().getFullYear() - 6 - gradeYear);
}

export default function MyClassPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
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
  const [detailFamilyDraft, setDetailFamilyDraft] = useState<FamilyEntry[]>([]);
  const [familyEditDrafts, setFamilyEditDrafts] = useState<Record<string, FamilyUpdateEntry>>({});
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [showNewFriend, setShowNewFriend] = useState(false);
  const [newFriend, setNewFriend] = useState<NewFriendForm>({ ...EMPTY_NEW_FRIEND });
  const [newSaving, setNewSaving] = useState(false);
  const [deptStudents, setDeptStudents] = useState<DeptStudentOption[]>([]);

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
      .select("id, department_id, student_no, name, student_type, mgmt_status, grade, grade_year, class_no, school_name, is_active, order_no, member_id, teacher_id, photo_url")
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
    const memberMap: Record<string, MemberRow & { photo_url?: string | null }> = {};

    if (memberIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("id, name, phone, birth_date, gender, address, photo_url")
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
        school_name: student.school_name || "",
        phone: member?.phone || "",
        birth_date: member?.birth_date || "",
        gender: member?.gender || "",
        address: member?.address || "",
        photo_url: member?.photo_url || student.photo_url || null,
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

  async function reloadFamilyByStudentId(studentId: string) {
    const { data: student } = await supabase
      .from("edu_students")
      .select("member_id")
      .eq("id", studentId)
      .maybeSingle();
    if (!student?.member_id) return;
    const { data } = await supabase.rpc("get_family_tree", { p_member_id: student.member_id });
    setFamilies((current) => ({ ...current, [studentId]: (data || []) as FamilyRow[] }));
  }

  async function refreshSavedFamily(studentId: string) {
    if (myTeacherId) await loadStudents(myTeacherId);
    await reloadFamilyByStudentId(studentId);
    setDetailFamilyDraft([]);
    setFamilyEditDrafts({});
  }

  function selectStudent(student: EditableStudent) {
    setSelectedId(student.id);
    setDraft({ ...student });
    setDetailFamilyDraft([]);
    setFamilyEditDrafts({});
    setEditMode(false);
  }

  function updateDraft<K extends keyof EditableStudent>(key: K, value: EditableStudent[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateDetailFamily(index: number, key: keyof FamilyEntry, value: string) {
    setDetailFamilyDraft((current) => current.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
  }

  function addDetailFamilyRow() {
    setDetailFamilyDraft((current) => [...current, { name: "", relation: "부", phone: "" }]);
  }

  function updateFamilyEdit(key: string, field: keyof FamilyEntry, value: string) {
    setFamilyEditDrafts((current) => {
      const edit = current[key];
      if (!edit) return current;
      return { ...current, [key]: { ...edit, [field]: value } };
    });
  }

  function updateStudentPhoto(studentId: string, url: string | null) {
    setStudents((current) => current.map((student) => (student.id === studentId ? { ...student, photo_url: url } : student)));
    setDraft((current) => (current?.id === studentId ? { ...current, photo_url: url } : current));
  }

  /** 학생 저장 (수정 저장 + 장기결석 토글이 공유) */
  async function persistStudent(
    data: EditableStudent,
    familyDraft: FamilyEntry[] = [],
    familyUpdates: FamilyUpdateEntry[] = [],
  ): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return false;
    }

    const response = await fetch("/api/edu/my-class-student", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        dept_id: deptId,
        student_id: data.id,
        student: {
          name: data.name,
          student_type: data.student_type,
          mgmt_status: data.mgmt_status,
          grade: data.grade || null,
          school_name: data.school_name || null,
        },
        member: {
          id: data.member_id,
          phone: data.phone || null,
          birth_date: data.birth_date || null,
          gender: data.gender || null,
          address: data.address || null,
        },
        family: familyDraft
          .map((entry) => ({ name: entry.name.trim(), relation: entry.relation, phone: entry.phone.trim() }))
          .filter((entry) => entry.name),
        family_updates: familyUpdates
          .map((entry) => ({
            relative_id: entry.relative_id,
            kind: entry.kind,
            direction: entry.direction,
            name: entry.name.trim(),
            relation: entry.relation,
            phone: entry.phone.trim(),
          }))
          .filter((entry) => entry.name && entry.relative_id),
      }),
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      showToast(result.error || "저장에 실패했습니다");
      return false;
    }
    setStudents((current) => current.map((student) => (student.id === data.id ? { ...data } : student)));
    setDetailFamilyDraft([]);
    setFamilyEditDrafts({});
    return true;
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) {
      showToast("이름을 입력하세요");
      return;
    }
    setSaving(true);
    const ok = await persistStudent(draft, detailFamilyDraft, Object.values(familyEditDrafts));
    setSaving(false);
    if (ok) {
      await refreshSavedFamily(draft.id);
      setEditMode(false);
      showToast("저장되었습니다");
    }
  }

  async function handleSaveFamily() {
    if (!draft) return;
    if (detailFamilyDraft.length === 0 && Object.keys(familyEditDrafts).length === 0) return;
    setSaving(true);
    const ok = await persistStudent(draft, detailFamilyDraft, Object.values(familyEditDrafts));
    setSaving(false);
    if (ok) {
      await refreshSavedFamily(draft.id);
      showToast("가족관계가 저장되었습니다");
    }
  }

  /** 장기결석 처리/해제 — 출석체크 명단·알림 대상에서 제외 (기록은 보존) */
  async function toggleAbsence() {
    if (!draft) return;
    const toAbsent = draft.mgmt_status !== "장기결석";
    const message = toAbsent
      ? `${draft.name} 학생을 장기결석 처리하시겠습니까?\n\n· 출석체크 명단과 알림(등반예정·미출석) 대상에서 제외됩니다.\n· 출석·달란트 기록은 그대로 보존되며, 해제하면 다시 나타납니다.`
      : `${draft.name} 학생의 장기결석을 해제하시겠습니까?\n\n출석체크 명단과 알림 대상에 다시 포함됩니다.`;
    if (!await confirm(message)) return;

    setSaving(true);
    const next = { ...draft, mgmt_status: toAbsent ? "장기결석" : "정상" };
    const ok = await persistStudent(next);
    setSaving(false);
    if (ok) {
      setDraft(next);
      showToast(toAbsent ? "장기결석 처리되었습니다" : "장기결석이 해제되었습니다");
    }
  }

  async function openNewFriend() {
    const grade = myGradeYear ? String(myGradeYear) : "";
    setNewFriend({
      ...EMPTY_NEW_FRIEND,
      gradeYear: grade,
      birthYear: myGradeYear ? birthYearForGrade(myGradeYear) : "",
      guideGrade: grade,
      family: [],
    });
    setShowNewFriend(true);

    // 인도자 선택용 — 부서 전체 학생 (학년 필터는 모달에서)
    if (deptStudents.length === 0) {
      const { data } = await supabase.rpc("edu_list_students", { p_dept_id: deptId });
      const list = ((data || []) as DeptStudentOption[]).filter((s) => s.name && s.is_active !== false);
      setDeptStudents(list);
    }
  }

  async function saveNewFriend() {
    if (!newFriend.name.trim()) { showToast("새친구 이름을 입력하세요"); return; }
    if (newFriend.gender !== "남" && newFriend.gender !== "여") { showToast("성별을 선택하세요"); return; }
    if (!newFriend.gradeYear) { showToast("학년을 선택하세요"); return; }
    if (newFriend.guide_kind === "student" && !newFriend.guide_student_id) {
      showToast("인도자 학생을 선택하세요");
      return;
    }

    const grade = Number(newFriend.gradeYear);
    // 생년월일: 학년 선택 시 연도 자동(수정 가능), 월·일 미입력이면 1월 1일로 저장
    let birthDate: string | null = null;
    const by = Number(newFriend.birthYear);
    if (newFriend.birthYear && Number.isFinite(by) && by >= 2000 && by <= 2100) {
      const bm = Math.min(12, Math.max(1, Number(newFriend.birthMonth) || 1));
      const bd = Math.min(31, Math.max(1, Number(newFriend.birthDay) || 1));
      birthDate = `${by}-${String(bm).padStart(2, "0")}-${String(bd).padStart(2, "0")}`;
    }

    const family = newFriend.family
      .map((entry) => ({ name: entry.name.trim(), relation: entry.relation, phone: entry.phone.trim() }))
      .filter((entry) => entry.name);

    setNewSaving(true);
    const { data: newFriendId, error } = await supabase.rpc("edu_save_new_friend", {
      p_id: null,
      p_dept_id: deptId,
      p_name: newFriend.name.trim(),
      p_gender: newFriend.gender,
      p_birth_date: birthDate,
      p_phone: "",
      p_mobile: newFriend.mobile,
      p_address: newFriend.address,
      p_email: "",
      p_group_pa: "",
      p_group_jik: "",
      p_group_gun: "",
      p_group_cheo: "",
      p_family_name: family[0] ? `${family[0].relation} ${family[0].name}` : "",
      p_guide_name: newFriend.guide_kind === "other" ? newFriend.guide_name : null,
      p_school_dist: newFriend.school,
      p_join_date: new Date().toISOString().slice(0, 10),
      p_special: "",
      p_memo: "",
      p_guide_kind: newFriend.guide_kind,
      p_guide_student_id: newFriend.guide_kind === "student" ? newFriend.guide_student_id : null,
      p_enroll_grade_year: grade,
      // 담임 반과 같은 학년이면 우리 반으로 편입, 다르면 미배정 (부장이 반 관리에서 배정)
      p_enroll_class_no: grade === myGradeYear ? myClassName || null : null,
      p_family_members: family,
    });
    setNewSaving(false);

    if (error) {
      showToast("새친구 등록 실패: " + error.message);
      return;
    }

    if ((newFriend.photoFile || newFriend.photo_url) && newFriendId) {
      try {
        const { data: savedFriend } = await supabase
          .from("edu_new_friends")
          .select("student_id")
          .eq("id", newFriendId)
          .maybeSingle();
        if (savedFriend?.student_id) {
          await saveStudentPendingPhoto({
            deptId,
            studentId: savedFriend.student_id,
            file: newFriend.photoFile,
            avatarUrl: newFriend.photo_url,
          });
        }
      } catch (photoError) {
        showToast(`새친구는 등록됐지만 사진 저장 실패: ${photoError instanceof Error ? photoError.message : "오류"}`);
      }
    }

    setShowNewFriend(false);
    showToast("새친구가 등록되었습니다");
    if (myTeacherId) await loadStudents(myTeacherId);
  }

  function cancelEdit() {
    if (selectedStudent) setDraft({ ...selectedStudent });
    setDetailFamilyDraft([]);
    setFamilyEditDrafts({});
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

      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[360px_1fr]">
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
            <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-1">
              {students.map((student) => (
                <div
                  key={student.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectStudent(student)}
                  onKeyDown={(event) => { if (event.key === "Enter") selectStudent(student); }}
                  className={[
                    "flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-left",
                    selectedId === student.id ? "border-amber-400 bg-amber-50" : "border-hairline bg-card",
                  ].join(" ")}
                >
                  <span onClick={(event) => event.stopPropagation()}>
                    <StudentPhotoEditor
                      deptId={deptId}
                      studentId={student.id}
                      memberId={student.member_id}
                      name={student.name}
                      gender={student.gender}
                      photoUrl={student.photo_url}
                      size={54}
                      onUpdate={(url) => updateStudentPhoto(student.id, url)}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-extrabold text-ink">{student.name}</div>
                    <div className="mt-0.5 text-[12px] font-bold text-ink-faint">{genderLabel(student.gender)}</div>
                  </div>
                </div>
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
                <div className="flex min-w-0 items-center gap-3">
                  <StudentPhotoEditor
                    deptId={deptId}
                    studentId={draft.id}
                    memberId={draft.member_id}
                    name={draft.name}
                    gender={draft.gender}
                    photoUrl={draft.photo_url}
                    size={76}
                    onUpdate={(url) => updateStudentPhoto(draft.id, url)}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[19px] font-extrabold text-ink">{draft.name}</div>
                    <div className="mt-1 text-[13px] font-semibold text-ink-faint">
                      {draft.grade_year ? `${draft.grade_year}학년 · ` : ""}{draft.class_no ? `${draft.class_no}반` : "반 정보 없음"}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleAbsence}
                    disabled={saving}
                    className={[
                      "inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-[13px] font-extrabold",
                      draft.mgmt_status === "장기결석"
                        ? "border-amber-400 bg-amber-50 text-amber-800"
                        : "border-hairline bg-card text-ink-soft",
                    ].join(" ")}
                  >
                    <MoonStar size={15} strokeWidth={2} />
                    {draft.mgmt_status === "장기결석" ? "장기결석 해제" : "장기결석 처리"}
                  </button>
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
                  <InfoField
                    label="학년 · 반"
                    editMode={false}
                    value={draft.grade_year ? `${draft.grade_year}학년${draft.class_no ? ` ${draft.class_no}반` : ""}` : "미등록"}
                  >
                    <span />
                  </InfoField>
                  <InfoField label="학교" editMode={editMode} value={draft.school_name || "미등록"}>
                    <input value={draft.school_name} onChange={(event) => updateDraft("school_name", event.target.value)} placeholder="학교명" className={inputClass} />
                  </InfoField>
                </div>

                <div className="rounded-lg border border-hairline bg-surface p-4">
                  <div className="mb-3 text-[16px] font-extrabold text-ink">연락 · 인적사항</div>
                  {!draft.member_id && editMode && (
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] leading-6 text-amber-900">
                      연결된 교적 정보가 없어 이름·학교만 저장됩니다.
                    </div>
                  )}
                  <InfoField label="본인연락처" editMode={editMode} value={draft.phone ? formatPhone(draft.phone) : "미등록"}>
                    <input value={draft.phone} onChange={(event) => updateDraft("phone", event.target.value)} placeholder="010-0000-0000" className={inputClass} disabled={!draft.member_id} />
                  </InfoField>
                  <InfoField label="생년월일" editMode={editMode} value={draft.birth_date || "미등록"}>
                    <input type="date" value={draft.birth_date} onChange={(event) => updateDraft("birth_date", event.target.value)} className={inputClass} disabled={!draft.member_id} />
                  </InfoField>
                  <InfoField label="주소" editMode={editMode} value={draft.address || "미등록"}>
                    <input value={draft.address} onChange={(event) => updateDraft("address", event.target.value)} className={inputClass} disabled={!draft.member_id} />
                  </InfoField>
                </div>

                <div className="rounded-lg border border-hairline bg-surface p-4 lg:col-span-2">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-[16px] font-extrabold text-ink">기타 — 가족관계</div>
                    <button
                      type="button"
                      onClick={addDetailFamilyRow}
                      className="inline-flex min-h-10 items-center gap-1 rounded-md bg-ink px-3 text-[13px] font-extrabold text-white"
                    >
                      <Plus size={14} strokeWidth={2.4} /> 가족관계
                    </button>
                  </div>
                  {detailFamilyDraft.length > 0 && (
                    <div className="mb-3 rounded-lg border border-hairline bg-card p-3">
                      <div className="flex flex-col gap-2">
                        {detailFamilyDraft.map((entry, index) => (
                          <div key={index} className="grid grid-cols-[76px_1fr_1fr_34px] items-center gap-1.5 max-sm:grid-cols-[72px_1fr_34px]">
                            <select value={entry.relation} onChange={(event) => updateDetailFamily(index, "relation", event.target.value)} className={inputClass}>
                              {FAMILY_RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
                            </select>
                            <input value={entry.name} onChange={(event) => updateDetailFamily(index, "name", event.target.value)} placeholder="이름" className={inputClass} />
                            <input value={entry.phone} onChange={(event) => updateDetailFamily(index, "phone", formatPhone(event.target.value))} placeholder="연락처" className={`${inputClass} max-sm:col-span-2`} />
                            <button
                              type="button"
                              onClick={() => setDetailFamilyDraft((current) => current.filter((_, i) => i !== index))}
                              aria-label="가족 삭제"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-card text-ink-faint"
                            >
                              <X size={14} strokeWidth={2.2} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(detailFamilyDraft.length > 0 || Object.keys(familyEditDrafts).length > 0) && (
                    <button type="button" onClick={handleSaveFamily} disabled={saving} className="mb-3 inline-flex min-h-9 items-center justify-center rounded-md bg-ink px-4 text-[13px] font-extrabold text-white disabled:opacity-60">
                      {saving ? "저장 중..." : "가족관계 저장"}
                    </button>
                  )}
                  {(families[draft.id] || []).length === 0 ? (
                    <div className="rounded-md border border-hairline bg-card px-3 py-4">
                      <div className="text-[14px] font-semibold text-ink-faint">등록된 가족관계가 없습니다.</div>
                    </div>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {(families[draft.id] || []).map((family) => (
                        <FamilyRelationCard
                          key={`${family.relative_id}-${family.kind}-${family.direction}`}
                          family={family}
                          edit={familyEditDrafts[familyKey(family)]}
                          onEdit={() => setFamilyEditDrafts((current) => ({
                            ...current,
                            [familyKey(family)]: familyToUpdateEntry(family),
                          }))}
                          onChange={(field, value) => updateFamilyEdit(familyKey(family), field, value)}
                          onCancel={() => setFamilyEditDrafts((current) => {
                            const next = { ...current };
                            delete next[familyKey(family)];
                            return next;
                          })}
                        />
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
          deptStudents={deptStudents}
          myClassName={myClassName}
          myGradeYear={myGradeYear}
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
  deptStudents,
  myClassName,
  myGradeYear,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  form: NewFriendForm;
  deptStudents: DeptStudentOption[];
  myClassName: string;
  myGradeYear: number | null;
  saving: boolean;
  onChange: (next: NewFriendForm) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof NewFriendForm>(key: K, value: NewFriendForm[K]) => onChange({ ...form, [key]: value });

  // 학년 선택 → 출생년도 자동 (직접 수정 가능)
  const setGrade = (value: string) => {
    const grade = Number(value);
    onChange({
      ...form,
      gradeYear: value,
      birthYear: value ? birthYearForGrade(grade) : form.birthYear,
    });
  };

  const setFamily = (index: number, key: keyof FamilyEntry, value: string) => {
    const next = form.family.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry));
    set("family", next);
  };

  const guideOptions = deptStudents
    .filter((student) => !form.guideGrade || student.grade_year === Number(form.guideGrade))
    .sort((a, b) => (a.class_no || "").localeCompare(b.class_no || "") || a.name.localeCompare(b.name));

  const enrollHint = form.gradeYear && myGradeYear && Number(form.gradeYear) === myGradeYear && myClassName
    ? `저장하면 ${myClassName}반 '체험' 학생으로 출석부·달란트통장에 나타납니다.`
    : "담임 반과 학년이 달라 반 미배정으로 등록됩니다. (반 관리에서 배정 가능)";

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50 p-4" onClick={onCancel}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card p-5" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 text-[19px] font-extrabold text-ink">새친구 등록</div>

        <div className="mb-3">
          <PendingStudentPhotoPicker
            name={form.name}
            gender={form.gender}
            seed={form.name || "new-friend"}
            photoUrl={form.photo_url}
            previewUrl={form.photoPreviewUrl}
            onAvatar={(url) => onChange({ ...form, photo_url: url, photoFile: null, photoPreviewUrl: null })}
            onFile={(file, previewUrl) => onChange({ ...form, photoFile: file, photoPreviewUrl: previewUrl, photo_url: null })}
          />
        </div>

        <div className="grid gap-x-3 md:grid-cols-2">
          <Field label="이름 *">
            <input value={form.name} onChange={(event) => set("name", event.target.value)} className={inputClass} />
          </Field>
          <Field label="성별 *">
            <div className="grid grid-cols-2 gap-2">
              {["남", "여"].map((gender) => (
                <button
                  key={gender}
                  type="button"
                  onClick={() => set("gender", gender)}
                  className={[
                    "min-h-11 rounded-md border text-[15px] font-extrabold",
                    form.gender === gender ? "border-amber-400 bg-amber-50 text-ink" : "border-hairline bg-card text-ink-soft",
                  ].join(" ")}
                >
                  {gender}
                </button>
              ))}
            </div>
          </Field>
          <Field label="학년 *">
            <select value={form.gradeYear} onChange={(event) => setGrade(event.target.value)} className={inputClass}>
              <option value="">학년 선택</option>
              <option value="1">1학년</option>
              <option value="2">2학년</option>
              <option value="3">3학년</option>
            </select>
          </Field>
          <Field label="학교">
            <input value={form.school} onChange={(event) => set("school", event.target.value)} placeholder="학교명" className={inputClass} />
          </Field>
          <Field label="본인연락처">
            <input value={form.mobile} onChange={(event) => set("mobile", formatPhone(event.target.value))} placeholder="010-0000-0000" className={inputClass} />
          </Field>
          <Field label="생년월일 — 학년 선택 시 연도 자동">
            <div className="grid grid-cols-3 gap-2">
              <input value={form.birthYear} onChange={(event) => set("birthYear", event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="년" inputMode="numeric" className={inputClass} />
              <input value={form.birthMonth} onChange={(event) => set("birthMonth", event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="월" inputMode="numeric" className={inputClass} />
              <input value={form.birthDay} onChange={(event) => set("birthDay", event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="일" inputMode="numeric" className={inputClass} />
            </div>
          </Field>
        </div>

        <Field label="주소">
          <input value={form.address} onChange={(event) => set("address", event.target.value)} placeholder="주소를 한 줄로 입력" className={inputClass} />
        </Field>

        {/* 가족 등록 — 부/모/형제/조부모 등 여러 명 */}
        <div className="mt-1 rounded-lg border border-hairline bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[14px] font-extrabold text-ink">가족</div>
            <button
              type="button"
              onClick={() => set("family", [...form.family, { name: "", relation: "부", phone: "" }])}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-hairline bg-card px-2.5 text-[12.5px] font-extrabold text-ink-soft"
            >
              <Plus size={13} strokeWidth={2.4} /> 가족 추가
            </button>
          </div>
          {form.family.length === 0 ? (
            <div className="rounded-md border border-hairline bg-card px-3 py-3 text-[13px] font-semibold text-ink-faint">
              가족 추가를 눌러 부모님·형제 연락처를 등록하세요.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {form.family.map((entry, index) => (
                <div key={index} className="grid grid-cols-[76px_1fr_1fr_34px] items-center gap-1.5">
                  <select value={entry.relation} onChange={(event) => setFamily(index, "relation", event.target.value)} className={inputClass}>
                    {FAMILY_RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
                  </select>
                  <input value={entry.name} onChange={(event) => setFamily(index, "name", event.target.value)} placeholder="이름" className={inputClass} />
                  <input value={entry.phone} onChange={(event) => setFamily(index, "phone", formatPhone(event.target.value))} placeholder="연락처" className={inputClass} />
                  <button
                    type="button"
                    onClick={() => set("family", form.family.filter((_, i) => i !== index))}
                    aria-label="가족 삭제"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-card text-ink-faint"
                  >
                    <X size={14} strokeWidth={2.2} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 인도자 */}
        <div className="mt-3 rounded-lg border border-hairline bg-surface p-3">
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
            <div className="grid grid-cols-[96px_1fr] gap-2">
              <select
                value={form.guideGrade}
                onChange={(event) => onChange({ ...form, guideGrade: event.target.value, guide_student_id: "" })}
                className={inputClass}
              >
                <option value="">전체 학년</option>
                <option value="1">1학년</option>
                <option value="2">2학년</option>
                <option value="3">3학년</option>
              </select>
              <select value={form.guide_student_id} onChange={(event) => set("guide_student_id", event.target.value)} className={inputClass}>
                <option value="">인도자 학생 선택</option>
                {guideOptions.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}{student.class_no ? ` (${student.class_no}반)` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {form.guide_kind === "other" && (
            <input value={form.guide_name} onChange={(event) => set("guide_name", event.target.value)} placeholder="인도한 사람 (예: 부모, 조부모 등)" className={inputClass} />
          )}
        </div>

        <div className="mt-3 rounded-md border border-hairline bg-bg-soft px-3 py-2 text-[12.5px] leading-5 text-ink-soft">
          {enrollHint}
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-12 flex-1 rounded-md bg-bg-soft text-[16px] font-extrabold text-ink-mid">취소</button>
          <button type="button" onClick={onSave} disabled={saving} className="min-h-12 flex-[1.4] rounded-md bg-ink text-[16px] font-extrabold text-white disabled:opacity-60">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FamilyRelationCard({
  family,
  edit,
  onEdit,
  onChange,
  onCancel,
}: {
  family: FamilyRow;
  edit?: FamilyUpdateEntry;
  onEdit: () => void;
  onChange: (field: keyof FamilyEntry, value: string) => void;
  onCancel: () => void;
}) {
  if (edit) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
        <div className="grid grid-cols-[76px_1fr_1fr] gap-1.5 max-sm:grid-cols-1">
          <select value={edit.relation} onChange={(event) => onChange("relation", event.target.value)} className={inputClass}>
            {FAMILY_RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
          </select>
          <input value={edit.name} onChange={(event) => onChange("name", event.target.value)} placeholder="이름" className={inputClass} />
          <input value={edit.phone} onChange={(event) => onChange("phone", formatPhone(event.target.value))} placeholder="연락처" className={inputClass} />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-hairline bg-card px-3 py-1.5 text-[12px] font-extrabold text-ink-soft">취소</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-hairline bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-extrabold text-ink">{relationLabel(family)} · {family.relative_name}</div>
          <div className="mt-1 text-[13px] font-semibold text-ink-faint">{family.relative_phone ? formatPhone(family.relative_phone) : "연락처 없음"}</div>
        </div>
        <button type="button" onClick={onEdit} className="shrink-0 rounded-md border border-hairline bg-surface px-2.5 py-1 text-[12px] font-extrabold text-ink-soft">
          수정
        </button>
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
  if (row.role === "brother") return "형";
  if (row.role === "sister") return "누나";
  if (row.kind === "spouse") return "배우자";
  if (row.direction === "descendant") return "자녀";
  if (row.direction === "sibling") return "형제";
  return row.role || row.kind || "가족";
}

function familyKey(row: FamilyRow) {
  return `${row.relative_id}-${row.kind || ""}-${row.direction || ""}`;
}

function familyRelationValue(row: FamilyRow) {
  const label = relationLabel(row);
  return FAMILY_RELATIONS.includes(label) ? label : "기타";
}

function familyToUpdateEntry(row: FamilyRow): FamilyUpdateEntry {
  return {
    relative_id: row.relative_id,
    kind: row.kind,
    direction: row.direction,
    relation: familyRelationValue(row),
    name: row.relative_name,
    phone: row.relative_phone ? formatPhone(row.relative_phone) : "",
  };
}

const inputClass = "min-h-11 w-full rounded-md border border-hairline-strong bg-card px-3 py-2 text-[16px] font-bold text-ink outline-none focus:border-amber-400 disabled:bg-bg-soft disabled:text-ink-faint";

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif", overflowX: "hidden" };
const headerStyle: CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const toastStyle: CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 14, fontWeight: 700, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
