"use client";

// ─────────────────────────────────────────────────────────────────
// 새친구 등록카드 (행정관리)
//  - 등록 폼은 담임메뉴 '우리반 아이정보 → 새친구 등록'과 동일한 새 컨셉:
//    사진 · 이름/성별/학년(필수) · 학교 · 본인연락처 · 생년월일(학년→연도 자동) ·
//    주소 · 가족(여러 명) · 인도자(학생/자진/기타)
//  - 행정용 추가: 편입 반을 직접 선택 (담임메뉴는 본인 반 자동)
//  - 저장은 양쪽 모두 edu_save_new_friend RPC — 학생(edu_students) 생성·반 배정·
//    학교 동기화가 서버에서 처리되어 어느 화면에서 입력해도 정합성 동일
//  - 구 컨셉 필드(전화·이메일·파직군처·특기사항·메모)는 폼에서 제거하되,
//    기존 레코드 수정 시 저장값을 그대로 보존한다
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase, formatPhone } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import PendingStudentPhotoPicker from "@/components/PendingStudentPhotoPicker";
import { saveStudentPendingPhoto } from "@/lib/studentPhotoUpload";
import { Sparkles, User, Plus, X } from "lucide-react";
import { isAgeBasedDept, ageOptionsFor, birthYearForGrade as birthYearForDeptGrade, gradeFieldLabel, gradeText, schoolFieldLabel, schoolFieldPlaceholder } from "@/lib/eduAge";

interface FriendSummary {
  id: string;
  name: string;
  gender: string | null;
  birth_date: string | null;
  mobile: string | null;
  join_date: string | null;
  guide_name: string | null;
  guide_kind: string | null;
  guide_display: string | null;
  enroll_class_no: string | null;
  student_id: string | null;
  promoted: boolean | null;
  created_at: string;
}

interface FamilyEntry { name: string; relation: string; phone: string }

const FAMILY_RELATIONS = ["부", "모", "형", "누나", "오빠", "언니", "동생", "조부", "조모", "기타"];

interface FriendDetail extends FriendSummary {
  department_id: string;
  photo_url: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  group_pa: string | null;
  group_jik: string | null;
  group_gun: string | null;
  group_cheo: string | null;
  family_name: string | null;
  school_district: string | null;
  special_notes: string | null;
  memo: string | null;
  guide_student_id: string | null;
  guide_student_name: string | null;
  enroll_grade_year: number | null;
  family_members: FamilyEntry[] | null;
}

// 인도자 유형 — 학생선택 / 자진(스스로 옴) / 기타(어른 등 직접입력)
type GuideKind = "student" | "self" | "other";

interface DeptStudent { id: string; name: string; class_no?: string | null; grade_year?: number | null; is_active?: boolean; photo_url?: string | null }
interface DeptClass { class_no: string; grade_year: number | null; teacher_id: string | null }

interface FormState {
  name: string;
  gender: string;          // '남' | '여' | ''
  gradeYear: string;       // '1' | '2' | '3' | ''
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
  enroll_class_no: string;
  photo_url: string | null;
  photoFile: File | null;
  photoPreviewUrl: string | null;
}

const EMPTY_FORM: FormState = {
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
  enroll_class_no: "",
  photo_url: null,
  photoFile: null,
  photoPreviewUrl: null,
};

function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function NewFriendPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;

  const [deptName, setDeptName] = useState("");
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [selected, setSelected] = useState<FriendDetail | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [isNew, setIsNew] = useState(false);
  const [photoDirty, setPhotoDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [deptStudents, setDeptStudents] = useState<DeptStudent[]>([]);
  const [deptClasses, setDeptClasses] = useState<DeptClass[]>([]);
  const [myClass, setMyClass] = useState<DeptClass | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      supabase.rpc("get_department_info", { p_dept_id: deptId }).then(({ data }) => {
        if (data?.[0]?.name) setDeptName(data[0].name as string);
      });
      await Promise.all([loadList(), loadStudentsAndClasses(session.user.id)]);
    })();
  }, []);

  const loadList = async () => {
    setLoading(true);
    const { data } = await supabase.rpc("edu_list_new_friends", { p_dept_id: deptId });
    setFriends(data || []);
    setLoading(false);
  };

  // 인도자 학생 선택 + 반 편입 선택지 + 내 담임반(있으면 신규 등록 기본 반)
  const loadStudentsAndClasses = async (userId: string) => {
    const [{ data: studs }, { data: cls }, { data: teacher }] = await Promise.all([
      supabase.rpc("edu_list_students", { p_dept_id: deptId }),
      supabase.rpc("list_dept_classes_full", { p_dept_id: deptId }),
      supabase.from("edu_teachers").select("id").eq("department_id", deptId).eq("user_id", userId).eq("is_active", true).maybeSingle(),
    ]);
    const studentList = ((studs || []) as DeptStudent[]).filter((s) => s.name && s.is_active !== false);
    setDeptStudents(studentList);
    const classList = ((cls || []) as DeptClass[]).filter((c) => c.class_no);
    setDeptClasses(classList);
    const mine = teacher?.id ? classList.find((c) => c.teacher_id === teacher.id) : null;
    setMyClass(mine ?? null);
    return studentList;
  };

  const selectFriend = async (id: string) => {
    const { data } = await supabase.rpc("edu_get_new_friend", { p_id: id });
    if (data && data[0]) {
      const f = data[0] as FriendDetail;
      const [by, bm, bd] = (f.birth_date || "").split("-");
      // 사진은 편입 학생 레코드에 저장됨 — 학생 목록에서 찾아 표시
      const studentPhoto = deptStudents.find((s) => s.id === f.student_id)?.photo_url ?? f.photo_url ?? null;
      setSelected(f);
      setForm({
        name: f.name || "",
        gender: f.gender === "남" || f.gender === "여" ? f.gender : "",
        gradeYear: f.enroll_grade_year ? String(f.enroll_grade_year) : "",
        school: f.school_district || "",
        mobile: f.mobile || "",
        birthYear: by || "",
        birthMonth: bm ? String(Number(bm)) : "",
        birthDay: bd ? String(Number(bd)) : "",
        address: f.address || "",
        family: Array.isArray(f.family_members) ? f.family_members : [],
        guide_kind: (f.guide_kind as GuideKind) || "other",
        guideGrade: "",
        guide_student_id: f.guide_student_id || "",
        guide_name: f.guide_kind === "other" ? (f.guide_name || "") : "",
        enroll_class_no: f.enroll_class_no || "",
        photo_url: studentPhoto,
        photoFile: null,
        photoPreviewUrl: null,
      });
      setPhotoDirty(false);
      setIsNew(false);
    }
  };

  const newFriend = () => {
    setSelected(null);
    // 담임이면 본인 반·학년을 기본값으로 미리 채움 (행정·임원은 직접 선택)
    const grade = myClass?.grade_year ? String(myClass.grade_year) : "";
    setForm({
      ...EMPTY_FORM,
      gradeYear: grade,
      birthYear: myClass?.grade_year ? birthYearForDeptGrade(deptName, myClass.grade_year) : "",
      guideGrade: grade,
      enroll_class_no: myClass?.class_no ?? "",
      family: [],
    });
    setPhotoDirty(false);
    setIsNew(true);
  };

  // 학년(유아부: 나이) 선택 → 출생년도 자동 + 학년이 다른 반 선택은 해제
  // 유아부는 반(목장)이 나이와 독립이라 반 선택을 유지한다
  const setGrade = (value: string) => {
    setForm((p) => {
      const chosen = deptClasses.find((c) => c.class_no === p.enroll_class_no);
      const classOk = chosen && (isAgeBasedDept(deptName) || !value || chosen.grade_year === Number(value));
      return {
        ...p,
        gradeYear: value,
        birthYear: value ? birthYearForDeptGrade(deptName, Number(value)) : p.birthYear,
        enroll_class_no: classOk ? p.enroll_class_no : "",
      };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showToast("새친구 이름을 입력하세요"); return; }
    if (form.gender !== "남" && form.gender !== "여") { showToast("성별을 선택하세요"); return; }
    if (!form.gradeYear) { showToast(`${gradeFieldLabel(deptName)}를 선택하세요`); return; }
    if (form.guide_kind === "student" && !form.guide_student_id) { showToast("인도자 학생을 선택하세요"); return; }

    const grade = Number(form.gradeYear);
    // 생년월일: 학년 선택 시 연도 자동(수정 가능), 월·일 미입력이면 1월 1일로 저장
    let birthDate: string | null = null;
    const by = Number(form.birthYear);
    if (form.birthYear && Number.isFinite(by) && by >= 2000 && by <= 2100) {
      const bm = Math.min(12, Math.max(1, Number(form.birthMonth) || 1));
      const bd = Math.min(31, Math.max(1, Number(form.birthDay) || 1));
      birthDate = `${by}-${String(bm).padStart(2, "0")}-${String(bd).padStart(2, "0")}`;
    }

    const family = form.family
      .map((entry) => ({ name: entry.name.trim(), relation: entry.relation, phone: entry.phone.trim() }))
      .filter((entry) => entry.name);

    setSaving(true);
    try {
      const { data: savedId, error } = await supabase.rpc("edu_save_new_friend", {
        p_id: isNew ? null : selected?.id,
        p_dept_id: deptId,
        p_name: form.name.trim(),
        p_gender: form.gender,
        p_birth_date: birthDate,
        // 구 컨셉 필드 — 폼에는 없지만 기존 레코드 값은 보존
        p_phone: selected?.phone ?? "",
        p_mobile: form.mobile,
        p_address: form.address,
        p_email: selected?.email ?? "",
        p_group_pa: selected?.group_pa ?? "",
        p_group_jik: selected?.group_jik ?? "",
        p_group_gun: selected?.group_gun ?? "",
        p_group_cheo: selected?.group_cheo ?? "",
        p_family_name: family[0] ? `${family[0].relation} ${family[0].name}` : (selected?.family_name ?? ""),
        p_guide_name: form.guide_kind === "other" ? form.guide_name : null,
        p_school_dist: form.school,
        p_join_date: isNew ? todayLocalISO() : (selected?.join_date ?? todayLocalISO()),
        p_special: selected?.special_notes ?? "",
        p_memo: selected?.memo ?? "",
        p_guide_kind: form.guide_kind,
        p_guide_student_id: form.guide_kind === "student" ? form.guide_student_id : null,
        p_enroll_grade_year: grade,
        p_enroll_class_no: form.enroll_class_no || null,
        p_family_members: family,
      });
      if (error) throw error;

      // 사진: 편입 학생 레코드에 저장 (담임메뉴 새친구 등록과 동일 경로)
      if (photoDirty && (form.photoFile || form.photo_url)) {
        try {
          let studentId = selected?.student_id ?? null;
          if (!studentId && savedId) {
            const { data: savedFriend } = await supabase
              .from("edu_new_friends")
              .select("student_id")
              .eq("id", savedId)
              .maybeSingle();
            studentId = savedFriend?.student_id ?? null;
          }
          if (studentId) {
            await saveStudentPendingPhoto({
              deptId,
              studentId,
              file: form.photoFile,
              avatarUrl: form.photo_url,
            });
          }
        } catch (photoError) {
          showToast(`저장은 됐지만 사진 저장 실패: ${photoError instanceof Error ? photoError.message : "오류"}`);
        }
      }

      showToast("저장되었습니다");
      setIsNew(false);
      await loadList();
      const { data: { session } } = await supabase.auth.getSession();
      if (session) await loadStudentsAndClasses(session.user.id);
      if (savedId) await selectFriend(savedId as string);
    } catch (e: unknown) {
      showToast("오류: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!await confirm(`"${selected.name}"을(를) 삭제하시겠습니까?`)) return;
    await supabase.rpc("edu_delete_new_friend", { p_id: selected.id });
    showToast("삭제되었습니다");
    setSelected(null);
    setIsNew(false);
    await loadList();
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const setFamily = (index: number, key: keyof FamilyEntry, value: string) =>
    setForm((p) => ({ ...p, family: p.family.map((row, i) => (i === index ? { ...row, [key]: value } : row)) }));

  const filtered = friends.filter((fr) =>
    fr.name.includes(search) || (fr.guide_name ?? "").includes(search)
  );

  const guideOptions = deptStudents
    .filter((s) => !form.guideGrade || s.grade_year === Number(form.guideGrade))
    .sort((a, b) => (a.class_no || "").localeCompare(b.class_no || "") || a.name.localeCompare(b.name));

  const classOptions = deptClasses
    .filter((c) => isAgeBasedDept(deptName) || !form.gradeYear || c.grade_year === Number(form.gradeYear));

  const enrollHint = form.enroll_class_no
    ? `저장하면 ${form.enroll_class_no}반 '체험' 학생으로 출석부·달란트통장에 나타납니다.`
    : "반 미배정으로 등록됩니다. (반 관리에서 배정 가능)";

  if (!authChecked) return <LoadingView full />;

  const showForm = isNew || selected;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>

      {/* Header */}
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}><Sparkles size={18} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 새친구 등록카드</div>
        <button className="app-header-actions" onClick={newFriend} style={addBtnStyle}>+ 새 등록</button>
      </div>

      <div className="mx-auto grid max-w-[1200px] gap-4 p-4 md:grid-cols-[260px_1fr]">
        {/* 목록 패널 */}
        <div>
          <div style={cardStyle}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름 / 인도자 검색"
              style={{ ...inputStyle, width: "100%", marginBottom: 12, boxSizing: "border-box" }}
            />
            <div style={{ fontSize: 10, color: "var(--ink-faint)", marginBottom: 8 }}>
              총 {filtered.length}명
            </div>
            {loading ? (
              <LoadingView padding={12} label="불러오는 중..." />
            ) : filtered.length === 0 ? (
              <div style={{ color: "var(--ink-faint)", fontSize: 12, padding: 12 }}>등록된 새친구가 없습니다</div>
            ) : (
              filtered.map((fr) => (
                <div
                  key={fr.id}
                  onClick={() => selectFriend(fr.id)}
                  style={{
                    padding: "12px",
                    borderRadius: 10,
                    marginBottom: 6,
                    cursor: "pointer",
                    background: selected?.id === fr.id ? "var(--accent-soft)" : "var(--surface)",
                    border: selected?.id === fr.id ? "1.5px solid var(--accent)" : "1.5px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: fr.gender === "남" ? "var(--accent-soft)" : fr.gender === "여" ? "#F5E5EB" : "var(--bg-soft)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18, flexShrink: 0,
                    }}>
                      <User size={18} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{fr.name}</div>
                        {fr.promoted && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: "var(--success)", background: "color-mix(in srgb, var(--success) 14%, var(--card))", border: "1px solid color-mix(in srgb, var(--success) 32%, transparent)", borderRadius: 999, padding: "1px 6px" }}>등반완료</span>
                        )}
                      </div>
                      {fr.guide_display && (
                        <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>인도자: {fr.guide_display}</div>
                      )}
                      {fr.enroll_class_no && (
                        <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>{fr.enroll_class_no}반</div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 등록카드 폼 */}
        <div>
          {!showForm ? (
            <div style={{ ...cardStyle, padding: 24 }}>
              <EmptyState
                icon={<Sparkles size={24} strokeWidth={1.6} />}
                message="왼쪽에서 새친구를 선택하거나 새 등록 버튼을 눌러 카드를 작성하세요"
              />
            </div>
          ) : (
            <div style={cardStyle}>
              {/* 카드 헤더 */}
              <div style={{
                background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
                borderRadius: 12,
                padding: "20px 24px",
                marginBottom: 20,
                color: "#fff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 4 }}>새친구 등록카드</div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {form.name || "이름 미입력"}
                  </div>
                  {form.gender && (
                    <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                      {form.gender}{form.gradeYear ? ` · ${gradeText(deptName, Number(form.gradeYear))}` : ""} · {isNew ? "오늘 등록" : (selected?.join_date ?? "가입일 미정")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!isNew && (
                    <button onClick={handleDelete} style={deleteBtnStyle}>삭제</button>
                  )}
                  <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>

              {/* 사진 */}
              <div style={{ marginBottom: 16 }}>
                <PendingStudentPhotoPicker
                  name={form.name}
                  gender={form.gender}
                  seed={form.name || "new-friend"}
                  photoUrl={form.photo_url}
                  previewUrl={form.photoPreviewUrl}
                  onAvatar={(url) => { setForm((p) => ({ ...p, photo_url: url, photoFile: null, photoPreviewUrl: null })); setPhotoDirty(true); }}
                  onFile={(file, previewUrl) => { setForm((p) => ({ ...p, photoFile: file, photoPreviewUrl: previewUrl, photo_url: null })); setPhotoDirty(true); }}
                />
              </div>

              {/* 폼 그리드 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="이름 *">
                  <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="이름" style={inputStyle} />
                </FormField>

                <FormField label="성별 *">
                  <div style={{ display: "flex", gap: 8 }}>
                    {["남", "여"].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => set("gender", g)}
                        style={toggleBtnStyle(form.gender === g)}
                      >{g}</button>
                    ))}
                  </div>
                </FormField>

                <FormField label={`${gradeFieldLabel(deptName)} *`}>
                  <select value={form.gradeYear} onChange={(e) => setGrade(e.target.value)} style={{ ...inputStyle, appearance: "auto" }}>
                    <option value="">{gradeFieldLabel(deptName)} 선택</option>
                    {(isAgeBasedDept(deptName) ? ageOptionsFor(deptName) : [1, 2, 3]).map((g) => (
                      <option key={g} value={String(g)}>{gradeText(deptName, g)}</option>
                    ))}
                  </select>
                </FormField>

                <FormField label={schoolFieldLabel(deptName)}>
                  <input type="text" value={form.school} onChange={(e) => set("school", e.target.value)} placeholder={schoolFieldPlaceholder(deptName)} style={inputStyle} />
                </FormField>

                <FormField label="본인연락처">
                  <input type="tel" value={form.mobile} onChange={(e) => set("mobile", formatPhone(e.target.value))} placeholder="010-0000-0000" style={inputStyle} />
                </FormField>

                <FormField label={`생년월일 — ${gradeFieldLabel(deptName)} 선택 시 연도 자동`}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <input value={form.birthYear} onChange={(e) => set("birthYear", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="년" inputMode="numeric" style={inputStyle} />
                    <input value={form.birthMonth} onChange={(e) => set("birthMonth", e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="월" inputMode="numeric" style={inputStyle} />
                    <input value={form.birthDay} onChange={(e) => set("birthDay", e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="일" inputMode="numeric" style={inputStyle} />
                  </div>
                </FormField>

                <FormField label="주소" fullWidth>
                  <input type="text" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="주소를 한 줄로 입력" style={inputStyle} />
                </FormField>

                {/* 가족 — 부/모/형제/조부모 등 여러 명 등록 */}
                <FormField label="가족" fullWidth>
                  {form.family.length === 0 ? (
                    <div style={{ fontSize: 11, color: "var(--ink-faint)", padding: "6px 0" }}>가족 추가 버튼으로 부모님·형제 연락처를 등록하세요.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
                      {form.family.map((entry, index) => (
                        <div key={index} style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 32px", gap: 6, alignItems: "center" }}>
                          <select
                            value={entry.relation}
                            onChange={(e) => setFamily(index, "relation", e.target.value)}
                            style={{ ...inputStyle, appearance: "auto" }}
                          >
                            {FAMILY_RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
                          </select>
                          <input
                            type="text" value={entry.name} placeholder="이름"
                            onChange={(e) => setFamily(index, "name", e.target.value)}
                            style={inputStyle}
                          />
                          <input
                            type="tel" value={entry.phone} placeholder="연락처"
                            onChange={(e) => setFamily(index, "phone", formatPhone(e.target.value))}
                            style={inputStyle}
                          />
                          <button
                            type="button" aria-label="가족 삭제"
                            onClick={() => setForm((p) => ({ ...p, family: p.family.filter((_, i) => i !== index) }))}
                            style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid var(--hairline)", background: "var(--card)", color: "var(--ink-faint)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          ><X size={14} strokeWidth={2.2} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, family: [...p.family, { name: "", relation: "부", phone: "" }] }))}
                    style={{ padding: "7px 12px", borderRadius: 8, border: "1.5px solid var(--hairline)", background: "var(--card)", color: "var(--ink-soft)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 4 }}
                  ><Plus size={13} strokeWidth={2.4} /> 가족 추가</button>
                </FormField>

                {/* 인도자 — 선택형: 학생선택 / 자진 / 기타(어른) */}
                <FormField label="인도자" fullWidth>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    {([
                      { k: "student", label: "학생" },
                      { k: "self", label: "자진" },
                      { k: "other", label: "기타" },
                    ] as { k: GuideKind; label: string }[]).map(({ k, label }) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, guide_kind: k, guide_student_id: k === "student" ? p.guide_student_id : "" }))}
                        style={toggleBtnStyle(form.guide_kind === k)}
                      >{label}</button>
                    ))}
                  </div>
                  {form.guide_kind === "student" && (
                    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8 }}>
                      <select
                        value={form.guideGrade}
                        onChange={(e) => setForm((p) => ({ ...p, guideGrade: e.target.value, guide_student_id: "" }))}
                        style={{ ...inputStyle, appearance: "auto" }}
                      >
                        <option value="">전체 {gradeFieldLabel(deptName)}</option>
                        {(isAgeBasedDept(deptName) ? ageOptionsFor(deptName) : [1, 2, 3]).map((g) => (
                          <option key={g} value={String(g)}>{gradeText(deptName, g)}</option>
                        ))}
                      </select>
                      <select
                        value={form.guide_student_id}
                        onChange={(e) => set("guide_student_id", e.target.value)}
                        style={{ ...inputStyle, appearance: "auto" }}
                      >
                        <option value="">인도자 학생 선택…</option>
                        {guideOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}{s.class_no ? ` (${s.class_no}반)` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {form.guide_kind === "other" && (
                    <input type="text" value={form.guide_name} onChange={(e) => set("guide_name", e.target.value)} placeholder="인도한 사람 (예: 부모, 조부모 등)" style={inputStyle} />
                  )}
                  {form.guide_kind === "student" && (
                    <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 4 }}>
                      등반 확정 시 인도자 학생에게 새친구등반 달란트가 지급됩니다.
                    </div>
                  )}
                </FormField>

                {/* 반 편입 — 담임메뉴는 본인 반 자동, 행정관리는 직접 선택 */}
                <FormField label="편입 반" fullWidth>
                  <select
                    value={form.enroll_class_no}
                    onChange={(e) => set("enroll_class_no", e.target.value)}
                    style={{ ...inputStyle, appearance: "auto" }}
                  >
                    <option value="">반 선택 안 함 (미배정)</option>
                    {classOptions.map((c) => (
                      <option key={c.class_no} value={c.class_no}>
                        {c.grade_year ? `${gradeText(deptName, c.grade_year)} ` : ""}{c.class_no}반
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 4 }}>
                    {enrollHint}
                  </div>
                </FormField>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function FormField({ label, children, fullWidth }: { label: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div style={{ gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
  flex: 1, padding: "9px", borderRadius: 8, border: "1.5px solid",
  borderColor: active ? "var(--accent)" : "var(--hairline)",
  background: active ? "var(--accent-soft)" : "var(--card)",
  color: active ? "var(--accent)" : "var(--ink-soft)",
  fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
});

const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const cardStyle: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1.5px solid var(--hairline)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "var(--card)", color: "var(--ink)" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap", flexShrink: 0,
};
const addBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const saveBtnStyle: React.CSSProperties = { padding: "8px 16px", background: "rgba(255,255,255,0.2)", color: "#fff", border: "1.5px solid rgba(255,255,255,0.5)", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const deleteBtnStyle: React.CSSProperties = { padding: "8px 12px", background: "rgba(168, 68, 60,0.2)", color: "#fff", border: "1px solid rgba(168, 68, 60,0.4)", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
