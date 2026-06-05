"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

interface StudentRow {
  id: string;
  department_id: string;
  student_no: number | null;
  name: string;
  student_type: string;
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
  email: string | null;
  birth_date: string | null;
  gender: string | null;
  address: string | null;
  notes: string | null;
  photo_url: string | null;
}

interface EditableStudent {
  id: string;
  member_id: string | null;
  student_no: string;
  name: string;
  student_type: string;
  grade: string;
  grade_year: number | null;
  class_no: string | null;
  phone: string;
  email: string;
  birth_date: string;
  gender: string;
  address: string;
  notes: string;
  photo_url: string | null;
}

export default function MyClassPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [myTeacherId, setMyTeacherId] = useState<string | null>(null);
  const [myClassName, setMyClassName] = useState("");
  const [students, setStudents] = useState<EditableStudent[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<EditableStudent | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

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
    if (!draft && selectedStudent) setDraft({ ...selectedStudent });
  }, [draft, selectedStudent]);

  async function loadStudents(teacherId: string) {
    setLoading(true);

    const { data: studentRows, error: studentErr } = await supabase
      .from("edu_students")
      .select("id, department_id, student_no, name, student_type, grade, grade_year, class_no, is_active, order_no, member_id, teacher_id")
      .eq("department_id", deptId)
      .eq("teacher_id", teacherId)
      .eq("is_active", true)
      .order("order_no", { ascending: true })
      .order("student_no", { ascending: true })
      .order("name", { ascending: true });

    if (studentErr) {
      showToast("조회 실패: " + studentErr.message);
      setLoading(false);
      return;
    }

    const rows = (studentRows || []) as StudentRow[];
    const memberIds = rows.map((row) => row.member_id).filter(Boolean) as string[];
    const memberMap: Record<string, MemberRow> = {};

    if (memberIds.length > 0) {
      const { data: members } = await supabase
        .from("members")
        .select("id, name, phone, email, birth_date, gender, address, notes, photo_url")
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
        student_no: student.student_no ? String(student.student_no) : "",
        name: student.name,
        student_type: student.student_type || "정",
        grade: student.grade || "",
        grade_year: student.grade_year,
        class_no: student.class_no,
        phone: member?.phone || "",
        email: member?.email || "",
        birth_date: member?.birth_date || "",
        gender: member?.gender || "",
        address: member?.address || "",
        notes: member?.notes || "",
        photo_url: member?.photo_url || null,
      };
    });

    setStudents(editable);
    setSelectedId((current) => current || editable[0]?.id || "");
    setDraft(editable[0] ? { ...editable[0] } : null);
    setMyClassName(editable[0]?.class_no || "");
    setLoading(false);
  }

  function selectStudent(student: EditableStudent) {
    setSelectedId(student.id);
    setDraft({ ...student });
  }

  function updateDraft<K extends keyof EditableStudent>(key: K, value: EditableStudent[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
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
          student_no: draft.student_no ? Number(draft.student_no) : null,
          student_type: draft.student_type,
          grade: draft.grade || null,
        },
        member: {
          id: draft.member_id,
          phone: draft.phone || null,
          email: draft.email || null,
          birth_date: draft.birth_date || null,
          gender: draft.gender || null,
          address: draft.address || null,
          notes: draft.notes || null,
        },
      }),
    });

    const result = await response.json();
    setSaving(false);

    if (!response.ok || !result.ok) {
      showToast(result.error || "저장 실패");
      return;
    }

    setStudents((current) => current.map((student) => student.id === draft.id ? { ...draft } : student));
    showToast("저장되었습니다");
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  if (!myTeacherId) {
    return (
      <div style={pageStyle}>
        <PageHeader deptId={deptId} router={router} myClassName="" />
        <main className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center">
            <div className="text-[48px]">🙇</div>
            <div className="mt-4 text-[18px] font-extrabold text-slate-800">본인이 담임으로 등록된 반이 없습니다</div>
            <div className="mt-2 text-[15px] leading-6 text-slate-500">부장 또는 전도사에게 담임 등록을 요청하세요.</div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} myClassName={myClassName} />

      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-4 md:grid-cols-[300px_1fr]">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="text-[17px] font-extrabold text-slate-900">우리반 학생</div>
            <div className="mt-1 text-[13px] font-semibold text-slate-400">{students.length}명</div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-[15px] text-slate-400">불러오는 중...</div>
          ) : students.length === 0 ? (
            <div className="px-4 py-12 text-center text-[15px] leading-6 text-slate-400">담당 반 학생이 없습니다.</div>
          ) : (
            <div className="flex gap-2 overflow-x-auto p-3 scrollbar-hide md:block md:space-y-2 md:overflow-visible">
              {students.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => selectStudent(student)}
                  className={[
                    "min-w-[160px] rounded-lg border px-3 py-3 text-left md:w-full",
                    selectedId === student.id
                      ? "border-amber-400 bg-amber-50"
                      : "border-slate-200 bg-white",
                  ].join(" ")}
                >
                  <div className="text-[16px] font-extrabold text-slate-800">{student.name}</div>
                  <div className="mt-1 text-[13px] font-semibold text-slate-400">
                    {student.student_no ? `${student.student_no}번 · ` : ""}{student.student_type}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          {!draft ? (
            <div className="py-20 text-center text-[16px] text-slate-400">학생을 선택하세요</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <div className="text-[19px] font-extrabold text-slate-900">{draft.name || "이름 없음"}</div>
                  <div className="mt-1 text-[13px] font-semibold text-slate-400">
                    {draft.grade_year ? `${draft.grade_year}학년 · ` : ""}{draft.class_no ? `${draft.class_no}반` : "반 정보 없음"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="min-h-11 rounded-md bg-slate-900 px-5 text-[16px] font-extrabold text-white disabled:opacity-60"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>

              <div className="grid gap-4 p-4 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-[16px] font-extrabold text-slate-800">기본 정보</div>
                  <Field label="이름">
                    <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} className={inputClass} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="번호">
                      <input type="number" value={draft.student_no} onChange={(event) => updateDraft("student_no", event.target.value)} className={inputClass} />
                    </Field>
                    <Field label="구분">
                      <select value={draft.student_type} onChange={(event) => updateDraft("student_type", event.target.value)} className={inputClass}>
                        <option value="정">정</option>
                        <option value="체험">체험</option>
                        <option value="소">소</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="학년/메모">
                    <input value={draft.grade} onChange={(event) => updateDraft("grade", event.target.value)} placeholder="예: 초1, 1학년" className={inputClass} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <ReadOnly label="현재 학년" value={draft.grade_year ? `${draft.grade_year}학년` : ""} />
                    <ReadOnly label="현재 반" value={draft.class_no ? `${draft.class_no}반` : ""} />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-[16px] font-extrabold text-slate-800">인적사항</div>
                  {!draft.member_id && (
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] leading-6 text-amber-900">
                      연결된 성도 정보가 없어 기본 정보만 저장됩니다.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="성별">
                      <select value={draft.gender} onChange={(event) => updateDraft("gender", event.target.value)} className={inputClass} disabled={!draft.member_id}>
                        <option value="">공란</option>
                        <option value="M">남</option>
                        <option value="F">여</option>
                      </select>
                    </Field>
                    <Field label="생년월일">
                      <input type="date" value={draft.birth_date} onChange={(event) => updateDraft("birth_date", event.target.value)} className={inputClass} disabled={!draft.member_id} />
                    </Field>
                  </div>
                  <Field label="연락처">
                    <input value={draft.phone} onChange={(event) => updateDraft("phone", event.target.value)} placeholder="010-0000-0000" className={inputClass} disabled={!draft.member_id} />
                  </Field>
                  <Field label="이메일">
                    <input value={draft.email} onChange={(event) => updateDraft("email", event.target.value)} className={inputClass} disabled={!draft.member_id} />
                  </Field>
                  <Field label="주소">
                    <input value={draft.address} onChange={(event) => updateDraft("address", event.target.value)} className={inputClass} disabled={!draft.member_id} />
                  </Field>
                  <Field label="메모">
                    <textarea value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} rows={4} className={`${inputClass} min-h-[110px] resize-y`} disabled={!draft.member_id} />
                  </Field>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function PageHeader({ deptId, router, myClassName }: { deptId: string; router: ReturnType<typeof useRouter>; myClassName: string }) {
  return (
    <div style={headerStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <HeaderLogo />
      </div>
      <div style={titleStyle}>
        👶 우리반 아이 정보 {myClassName && <span style={{ color: "#6366f1", marginLeft: 6 }}>{myClassName}반</span>}
      </div>
      <div style={{ width: 80 }} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <div className="mb-1 text-[14px] font-bold text-slate-500">{label}</div>
      {children}
    </label>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[14px] font-bold text-slate-500">{label}</div>
      <div className="min-h-11 rounded-md border border-slate-200 bg-white px-3 py-2 text-[16px] font-bold text-slate-400">
        {value || "공란"}
      </div>
    </div>
  );
}

const inputClass = "min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-800 outline-none focus:border-amber-400 disabled:bg-slate-100 disabled:text-slate-400";

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "#1e293b" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 14, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const loadingStyle: React.CSSProperties = { ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 14, fontWeight: 700, zIndex: 1100, fontFamily: "inherit", whiteSpace: "nowrap" };
