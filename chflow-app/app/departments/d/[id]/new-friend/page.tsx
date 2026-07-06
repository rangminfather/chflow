"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase, formatPhone } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Sparkles, User } from "lucide-react";

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

interface DeptStudent { id: string; name: string; class_no?: string | null; grade_year?: number | null }
interface DeptClass { class_no: string; grade_year: number | null; teacher_id: string | null }

interface FormState {
  name: string; gender: string | null; birth_date: string | null; photo_url: string | null;
  phone: string; mobile: string; address: string; email: string;
  group_pa: string; group_jik: string; group_gun: string; group_cheo: string;
  family_name: string; guide_name: string; school_district: string; join_date: string | null;
  special_notes: string; memo: string;
  guide_kind: GuideKind; guide_student_id: string | null; enroll_class_no: string;
  family: FamilyEntry[];
}

const EMPTY_FORM: FormState = {
  name: "", gender: null, birth_date: null, photo_url: null,
  phone: "", mobile: "", address: "", email: "",
  group_pa: "", group_jik: "", group_gun: "", group_cheo: "",
  family_name: "", guide_name: "", school_district: "", join_date: null,
  special_notes: "", memo: "",
  guide_kind: "other", guide_student_id: null, enroll_class_no: "",
  family: [],
};

export default function NewFriendPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;

  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [selected, setSelected] = useState<FriendDetail | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [deptStudents, setDeptStudents] = useState<DeptStudent[]>([]);
  const [deptClasses, setDeptClasses] = useState<DeptClass[]>([]);
  const [myClassNo, setMyClassNo] = useState<string | null>(null);
  const [guideGradeFilter, setGuideGradeFilter] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
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
    setDeptStudents(((studs || []) as DeptStudent[]).filter((s) => s.name));
    const classList = ((cls || []) as DeptClass[]).filter((c) => c.class_no);
    setDeptClasses(classList);
    const mine = teacher?.id ? classList.find((c) => c.teacher_id === teacher.id) : null;
    setMyClassNo(mine?.class_no ?? null);
  };

  const selectFriend = async (id: string) => {
    const { data } = await supabase.rpc("edu_get_new_friend", { p_id: id });
    if (data && data[0]) {
      const f = data[0] as FriendDetail;
      setSelected(f);
      setForm({
        name: f.name || "", gender: f.gender, birth_date: f.birth_date,
        photo_url: f.photo_url, phone: f.phone || "", mobile: f.mobile || "",
        address: f.address || "", email: f.email || "",
        group_pa: f.group_pa || "", group_jik: f.group_jik || "",
        group_gun: f.group_gun || "", group_cheo: f.group_cheo || "",
        family_name: f.family_name || "", guide_name: f.guide_name || "",
        school_district: f.school_district || "", join_date: f.join_date,
        special_notes: f.special_notes || "", memo: f.memo || "",
        guide_kind: (f.guide_kind as GuideKind) || "other",
        guide_student_id: f.guide_student_id || null,
        enroll_class_no: f.enroll_class_no || "",
        family: Array.isArray(f.family_members) ? f.family_members : [],
      });
      setIsNew(false);
    }
  };

  const newFriend = () => {
    setSelected(null);
    // 담임이면 본인 반을 기본 편입반으로 미리 채움 (행정·임원은 직접 선택)
    setForm({ ...EMPTY_FORM, enroll_class_no: myClassNo ?? "" });
    setIsNew(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showToast("이름을 입력하세요"); return; }
    if (form.guide_kind === "student" && !form.guide_student_id) { showToast("인도자 학생을 선택하세요"); return; }
    setSaving(true);
    try {
      const chosenClass = deptClasses.find((c) => c.class_no === form.enroll_class_no);
      const { error } = await supabase.rpc("edu_save_new_friend", {
        p_id:          isNew ? null : selected?.id,
        p_dept_id:     deptId,
        p_name:        form.name,
        p_gender:      form.gender,
        p_birth_date:  form.birth_date,
        p_phone:       form.phone,
        p_mobile:      form.mobile,
        p_address:     form.address,
        p_email:       form.email,
        p_group_pa:    form.group_pa,
        p_group_jik:   form.group_jik,
        p_group_gun:   form.group_gun,
        p_group_cheo:  form.group_cheo,
        p_family_name: form.family_name,
        p_guide_name:  form.guide_kind === "other" ? form.guide_name : null,
        p_school_dist: form.school_district,
        p_join_date:   form.join_date,
        p_special:     form.special_notes,
        p_memo:        form.memo,
        p_guide_kind:       form.guide_kind,
        p_guide_student_id: form.guide_kind === "student" ? form.guide_student_id : null,
        p_enroll_grade_year: chosenClass?.grade_year ?? null,
        p_enroll_class_no:  form.enroll_class_no || null,
        p_family_members:   form.family
          .map((entry) => ({ name: entry.name.trim(), relation: entry.relation, phone: entry.phone.trim() }))
          .filter((entry) => entry.name),
      });
      if (error) throw error;
      showToast("저장되었습니다");
      await loadList();
      setIsNew(false);
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

  const f = (key: keyof typeof form) => (form[key] as string) ?? "";
  const set = (key: keyof typeof form, val: string | null) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const filtered = friends.filter((fr) =>
    fr.name.includes(search) || (fr.guide_name ?? "").includes(search)
  );

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
                          <span style={{ fontSize: 9, fontWeight: 700, color: "var(--success)", background: "color-mix(in srgb, var(--success) 14%, #fff)", border: "1px solid color-mix(in srgb, var(--success) 32%, transparent)", borderRadius: 999, padding: "1px 6px" }}>등반완료</span>
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
                    <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{form.gender} · {form.join_date ?? "가입일 미정"}</div>
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

              {/* 폼 그리드 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="이름 *">
                  <input type="text" value={f("name")} onChange={(e) => set("name", e.target.value)} placeholder="이름" style={inputStyle} />
                </FormField>

                <FormField label="성별">
                  <div style={{ display: "flex", gap: 8 }}>
                    {["남", "여"].map((g) => (
                      <button
                        key={g}
                        onClick={() => set("gender", form.gender === g ? null : g)}
                        style={{
                          flex: 1, padding: "9px", borderRadius: 8, border: "1.5px solid",
                          borderColor: form.gender === g ? "var(--accent)" : "var(--hairline)",
                          background: form.gender === g ? "var(--accent-soft)" : "var(--card)",
                          color: form.gender === g ? "var(--accent)" : "var(--ink-soft)",
                          fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >{g}</button>
                    ))}
                  </div>
                </FormField>

                <FormField label="생년월일">
                  <input type="date" value={f("birth_date")} onChange={(e) => set("birth_date", e.target.value || null)} style={inputStyle} />
                </FormField>

                <FormField label="교회가입일">
                  <input type="date" value={f("join_date")} onChange={(e) => set("join_date", e.target.value || null)} style={inputStyle} />
                </FormField>

                <FormField label="전화">
                  <input type="tel" value={f("phone")} onChange={(e) => set("phone", formatPhone(e.target.value))} placeholder="전화번호" style={inputStyle} />
                </FormField>

                <FormField label="핸드폰">
                  <input type="tel" value={f("mobile")} onChange={(e) => set("mobile", formatPhone(e.target.value))} placeholder="핸드폰 번호" style={inputStyle} />
                </FormField>

                <FormField label="Email" fullWidth>
                  <input type="email" value={f("email")} onChange={(e) => set("email", e.target.value)} placeholder="이메일 주소" style={inputStyle} />
                </FormField>

                <FormField label="주소" fullWidth>
                  <input type="text" value={f("address")} onChange={(e) => set("address", e.target.value)} placeholder="주소" style={inputStyle} />
                </FormField>

                {/* 소속 */}
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 8 }}>소속</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    {[
                      { key: "group_pa",   label: "파" },
                      { key: "group_jik",  label: "직" },
                      { key: "group_gun",  label: "군" },
                      { key: "group_cheo", label: "처" },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <div style={{ fontSize: 10, color: "var(--ink-faint)", marginBottom: 3 }}>{label}</div>
                        <input type="text" value={f(key as keyof typeof form)} onChange={(e) => set(key as keyof typeof form, e.target.value)} style={inputStyle} />
                      </div>
                    ))}
                  </div>
                </div>

                <FormField label="학교">
                  <input type="text" value={f("school_district")} onChange={(e) => set("school_district", e.target.value)} placeholder="학교명" style={inputStyle} />
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
                            onChange={(e) => setForm((p) => ({ ...p, family: p.family.map((row, i) => i === index ? { ...row, relation: e.target.value } : row) }))}
                            style={{ ...inputStyle, appearance: "auto" }}
                          >
                            {FAMILY_RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
                          </select>
                          <input
                            type="text" value={entry.name} placeholder="이름"
                            onChange={(e) => setForm((p) => ({ ...p, family: p.family.map((row, i) => i === index ? { ...row, name: e.target.value } : row) }))}
                            style={inputStyle}
                          />
                          <input
                            type="tel" value={entry.phone} placeholder="연락처"
                            onChange={(e) => setForm((p) => ({ ...p, family: p.family.map((row, i) => i === index ? { ...row, phone: formatPhone(e.target.value) } : row) }))}
                            style={inputStyle}
                          />
                          <button
                            type="button" aria-label="가족 삭제"
                            onClick={() => setForm((p) => ({ ...p, family: p.family.filter((_, i) => i !== index) }))}
                            style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid var(--hairline)", background: "var(--card)", color: "var(--ink-faint)", cursor: "pointer", fontWeight: 700 }}
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, family: [...p.family, { name: "", relation: "부", phone: "" }] }))}
                    style={{ padding: "7px 12px", borderRadius: 8, border: "1.5px solid var(--hairline)", background: "var(--card)", color: "var(--ink-soft)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >+ 가족 추가</button>
                </FormField>

                {/* 반 편입 — 등록 즉시 '체험' 학생으로 출석부·통장에 편입 */}
                <FormField label="편입 반" fullWidth>
                  <select
                    value={form.enroll_class_no}
                    onChange={(e) => set("enroll_class_no", e.target.value)}
                    style={{ ...inputStyle, appearance: "auto" }}
                  >
                    <option value="">반 선택 안 함 (미배정)</option>
                    {deptClasses.map((c) => (
                      <option key={c.class_no} value={c.class_no}>
                        {c.grade_year ? `${c.grade_year}학년 ` : ""}{c.class_no}반
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 4 }}>
                    반을 선택하면 등록 즉시 ‘체험’ 학생으로 출석부·달란트통장에 나타납니다.
                  </div>
                </FormField>

                {/* 인도자 — 선택형: 학생선택 / 자진 / 기타(어른) */}
                <FormField label="인도자" fullWidth>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    {([
                      { k: "student", label: "학생 선택" },
                      { k: "self", label: "자진" },
                      { k: "other", label: "기타(어른)" },
                    ] as { k: GuideKind; label: string }[]).map(({ k, label }) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, guide_kind: k, guide_student_id: k === "student" ? p.guide_student_id : null }))}
                        style={{
                          flex: 1, padding: "9px", borderRadius: 8, border: "1.5px solid",
                          borderColor: form.guide_kind === k ? "var(--accent)" : "var(--hairline)",
                          background: form.guide_kind === k ? "var(--accent-soft)" : "var(--card)",
                          color: form.guide_kind === k ? "var(--accent)" : "var(--ink-soft)",
                          fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >{label}</button>
                    ))}
                  </div>
                  {form.guide_kind === "student" && (
                    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8 }}>
                      <select
                        value={guideGradeFilter}
                        onChange={(e) => { setGuideGradeFilter(e.target.value); set("guide_student_id", null); }}
                        style={{ ...inputStyle, appearance: "auto" }}
                      >
                        <option value="">전체 학년</option>
                        <option value="1">1학년</option>
                        <option value="2">2학년</option>
                        <option value="3">3학년</option>
                      </select>
                      <select
                        value={form.guide_student_id ?? ""}
                        onChange={(e) => set("guide_student_id", e.target.value || null)}
                        style={{ ...inputStyle, appearance: "auto" }}
                      >
                        <option value="">인도자 학생 선택…</option>
                        {deptStudents
                          .filter((s) => !guideGradeFilter || s.grade_year === Number(guideGradeFilter))
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}{s.class_no ? ` (${s.class_no}반)` : ""}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                  {form.guide_kind === "other" && (
                    <input type="text" value={f("guide_name")} onChange={(e) => set("guide_name", e.target.value)} placeholder="인도한 사람 (예: 부모, 조부모 등)" style={inputStyle} />
                  )}
                  {form.guide_kind === "student" && (
                    <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 4 }}>
                      등반 확정 시 인도자 학생에게 새친구등반 달란트가 지급됩니다.
                    </div>
                  )}
                </FormField>

                <FormField label="특기사항" fullWidth>
                  <textarea value={f("special_notes")} onChange={(e) => set("special_notes", e.target.value)} placeholder="특기사항" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
                </FormField>

                <FormField label="Memo" fullWidth>
                  <textarea value={f("memo")} onChange={(e) => set("memo", e.target.value)} placeholder="메모" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
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

const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const cardStyle: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1.5px solid var(--hairline)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap", flexShrink: 0,
};
const addBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const saveBtnStyle: React.CSSProperties = { padding: "8px 16px", background: "rgba(255,255,255,0.2)", color: "#fff", border: "1.5px solid rgba(255,255,255,0.5)", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const deleteBtnStyle: React.CSSProperties = { padding: "8px 12px", background: "rgba(168, 68, 60,0.2)", color: "#fff", border: "1px solid rgba(168, 68, 60,0.4)", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
