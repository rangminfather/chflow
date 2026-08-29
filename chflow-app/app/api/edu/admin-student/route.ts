import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type StudentType = "정" | "체험";

type StudentPayload = {
  id?: string | null;
  name: string;
  student_type?: string | null;
  student_no?: number | string | null;
  grade?: string | null;
  grade_year?: number | string | null;
  class_no?: string | null;
  order_no?: number | string | null;
  school_name?: string | null;
  member_id?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  address?: string | null;
  family?: FamilyPayload[];
};

type FamilyPayload = {
  relative_id?: string | null;
  name?: string | null;
  relation?: string | null;
  phone?: string | null;
};

type FamilyUpdatePayload = FamilyPayload & {
  relative_id?: string | null;
  kind?: string | null;
  direction?: string | null;
};

type SaveBody = {
  dept_id: string;
  student_id?: string | null;
  student?: StudentPayload;
  students?: StudentPayload[];
  family?: FamilyPayload[];
  family_updates?: FamilyUpdatePayload[];
  member?: {
    id: string | null;
    phone: string | null;
    birth_date: string | null;
    gender: string | null;
    address: string | null;
  };
};

type DeactivateBody = {
  dept_id?: string;
  student_id?: string;
};

const STUDENT_TYPES: StudentType[] = ["정", "체험"];

function createAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type AdminClient = ReturnType<typeof createAdminClient>;

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function cleanNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStudentType(value: unknown): StudentType {
  return STUDENT_TYPES.includes(value as StudentType) ? (value as StudentType) : "정";
}

function normalizeGender(value: unknown) {
  if (value === "M" || value === "남" || value === "남자") return "M";
  if (value === "F" || value === "여" || value === "여자") return "F";
  return null;
}

function gradeLabel(gradeYear: number | null, classNo: string | null) {
  if (gradeYear && classNo) return `${gradeYear}학년 ${classNo}반`;
  if (gradeYear) return `${gradeYear}학년`;
  if (classNo) return `${classNo}반`;
  return null;
}

async function requireDeptAdmin(req: NextRequest, deptId: string) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { ok: false as const, status: 401, error: "로그인이 필요합니다" };

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) return { ok: false as const, status: 401, error: "로그인이 필요합니다" };

  const { data: gradeData, error: gradeErr } = await userClient.rpc("get_user_grade", { p_dept_id: deptId });
  const grade = typeof gradeData === "number" ? gradeData : Number(gradeData);
  if (gradeErr || Number.isNaN(grade) || grade > 2) {
    return { ok: false as const, status: 403, error: "학생정보관리 권한이 없습니다" };
  }

  return { ok: true as const };
}

async function teacherForClass(admin: AdminClient, deptId: string, classNo: string | null) {
  if (!classNo) return null;
  const { data } = await admin
    .from("edu_classes")
    .select("teacher_id")
    .eq("department_id", deptId)
    .eq("class_no", classNo)
    .maybeSingle();
  return data?.teacher_id ?? null;
}

async function ensureClass(admin: AdminClient, deptId: string, classNo: string | null, gradeYear: number | null) {
  if (!classNo) return;
  await admin
    .from("edu_classes")
    .upsert(
      {
        department_id: deptId,
        class_no: classNo,
        grade_year: gradeYear,
        sort_order: 0,
      },
      { onConflict: "department_id,class_no", ignoreDuplicates: true },
    );
}

async function findExistingStudentId(
  admin: AdminClient,
  deptId: string,
  payload: StudentPayload,
) {
  if (payload.id) return payload.id;

  const no = cleanNumber(payload.student_no);
  if (no !== null) {
    const { data } = await admin
      .from("edu_students")
      .select("id")
      .eq("department_id", deptId)
      .eq("student_no", no)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  return null;
}

async function saveOne(
  admin: AdminClient,
  deptId: string,
  payload: StudentPayload,
  fallbackMember?: SaveBody["member"],
) {
  const name = cleanText(payload.name);
  if (!name) throw new Error("학생 이름을 입력하세요");

  const id = await findExistingStudentId(admin, deptId, payload);
  const gradeYear = cleanNumber(payload.grade_year);
  const classNo = cleanText(payload.class_no);
  const studentNo = cleanNumber(payload.student_no);
  const orderNo = cleanNumber(payload.order_no);
  const studentType = normalizeStudentType(payload.student_type);
  const grade = cleanText(payload.grade) || gradeLabel(gradeYear, classNo);

  await ensureClass(admin, deptId, classNo, gradeYear);
  const teacherId = await teacherForClass(admin, deptId, classNo);

  const row: {
    department_id: string;
    student_no: number | null;
    name: string;
    student_type: StudentType;
    grade: string | null;
    grade_year: number | null;
    class_no: string | null;
    order_no: number | null;
    school_name: string | null;
    gender: string | null;
    birth_date: string | null;
    phone: string | null;
    address: string | null;
    teacher_id: string | null;
    is_active: boolean;
    member_id?: string | null;
  } = {
    department_id: deptId,
    student_no: studentNo,
    name,
    student_type: studentType,
    grade,
    grade_year: gradeYear,
    class_no: classNo,
    order_no: orderNo,
    school_name: cleanText(payload.school_name),
    gender: normalizeGender(payload.gender),
    birth_date: cleanText(payload.birth_date),
    phone: cleanText(payload.phone),
    address: cleanText(payload.address),
    teacher_id: teacherId,
    is_active: true,
  };

  let savedId = id;
  let memberId = payload.member_id || null;
  if (id) {
    const { data: current } = await admin
      .from("edu_students")
      .select("member_id")
      .eq("id", id)
      .eq("department_id", deptId)
      .maybeSingle();
    memberId = memberId || current?.member_id || null;

    const { error } = await admin
      .from("edu_students")
      .update(cleanText(payload.member_id) ? { ...row, member_id: cleanText(payload.member_id) } : row)
      .eq("id", id)
      .eq("department_id", deptId);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("edu_students")
      .insert(cleanText(payload.member_id) ? { ...row, member_id: cleanText(payload.member_id) } : row)
      .select("id")
      .single();
    if (error) throw error;
    savedId = data.id as string;
  }

  const memberBody = fallbackMember || {
    id: memberId,
    phone: payload.phone ?? null,
    birth_date: payload.birth_date ?? null,
    gender: payload.gender ?? null,
    address: payload.address ?? null,
  };

  if (memberId && memberBody?.id === memberId) {
    const { error } = await admin
      .from("members")
      .update({
        name,
        phone: cleanText(memberBody.phone),
        birth_date: cleanText(memberBody.birth_date),
        gender: normalizeGender(memberBody.gender),
        address: cleanText(memberBody.address),
      })
      .eq("id", memberId);
    if (error) throw error;
  }

  return { id: savedId };
}

async function ensureStudentMember(
  admin: AdminClient,
  deptId: string,
  studentId: string,
  payload: StudentPayload,
) {
  const currentMemberId = cleanText(payload.member_id);
  if (currentMemberId) return currentMemberId;

  const { data: current, error: currentError } = await admin
    .from("edu_students")
    .select("member_id, name, phone, birth_date, gender, address")
    .eq("id", studentId)
    .eq("department_id", deptId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (current?.member_id) return current.member_id as string;

  const { data: member, error: memberError } = await admin
    .from("members")
    .insert({
      name: cleanText(payload.name) || cleanText(current?.name) || "학생",
      phone: cleanText(payload.phone) || cleanText(current?.phone),
      birth_date: cleanText(payload.birth_date) || cleanText(current?.birth_date),
      gender: normalizeGender(payload.gender) || normalizeGender(current?.gender),
      address: cleanText(payload.address) || cleanText(current?.address),
      status: "active",
    })
    .select("id")
    .single();
  if (memberError) throw memberError;

  const memberId = member.id as string;
  const { error: updateError } = await admin
    .from("edu_students")
    .update({ member_id: memberId })
    .eq("id", studentId)
    .eq("department_id", deptId);
  if (updateError) throw updateError;

  return memberId;
}

async function findOrCreateFamilyMember(admin: AdminClient, family: FamilyPayload) {
  const relativeId = cleanText(family.relative_id);
  if (relativeId) return relativeId;

  const name = cleanText(family.name);
  if (!name) return null;
  const phone = cleanText(family.phone);

  if (phone) {
    const { data: existing, error } = await admin
      .from("members")
      .select("id")
      .eq("name", name)
      .eq("phone", phone)
      .maybeSingle();
    if (error) throw error;
    if (existing?.id) return existing.id as string;
  }

  const { data: member, error: insertError } = await admin
    .from("members")
    .insert({
      name,
      phone,
      status: "active",
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return member.id as string;
}

function relationToKindRole(relation: string | null | undefined) {
  const value = (relation || "").trim();
  if (value === "부" || value === "아버지") return { kind: "parent", role: "father" };
  if (value === "모" || value === "어머니") return { kind: "parent", role: "mother" };
  if (["형", "오빠", "형제"].includes(value)) return { kind: "sibling", role: "brother" };
  if (["누나", "언니", "자매"].includes(value)) return { kind: "sibling", role: "sister" };
  if (value === "동생" || value === "남매") return { kind: "sibling", role: null };
  if (value === "배우자") return { kind: "spouse", role: null };
  if (value === "조부" || value === "할아버지") return { kind: "grandparent", role: "grandfather" };
  if (value === "조모" || value === "할머니") return { kind: "grandparent", role: "grandmother" };
  return { kind: "sibling", role: null };
}

async function saveFamily(
  admin: AdminClient,
  deptId: string,
  studentId: string,
  payload: StudentPayload,
  family: FamilyPayload[] | undefined,
) {
  const rows = (family || []).filter((item) => cleanText(item.name));
  if (rows.length === 0) return;

  const studentMemberId = await ensureStudentMember(admin, deptId, studentId, payload);
  for (const row of rows) {
    const relativeId = await findOrCreateFamilyMember(admin, row);
    if (!relativeId || relativeId === studentMemberId) continue;
    const relation = relationToKindRole(row.relation);
    const { data: existing, error: existingError } = await admin
      .from("member_relations")
      .select("id")
      .eq("subject_id", studentMemberId)
      .eq("relative_id", relativeId)
      .eq("kind", relation.kind)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing?.id) {
      if (!relation.role) continue;
      const { error } = await admin
        .from("member_relations")
        .update({ role: relation.role })
        .eq("id", existing.id);
      if (error) throw error;
      continue;
    }

    const { error } = await admin
      .from("member_relations")
      .insert({
        subject_id: studentMemberId,
        relative_id: relativeId,
        kind: relation.kind,
        role: relation.role,
      });
    if (error) throw error;
  }
}

async function updateFamily(
  admin: AdminClient,
  deptId: string,
  studentId: string,
  payload: StudentPayload,
  familyUpdates: FamilyUpdatePayload[] | undefined,
) {
  const rows = (familyUpdates || []).filter((item) => cleanText(item.name) && cleanText(item.relative_id));
  if (rows.length === 0) return;

  const studentMemberId = await ensureStudentMember(admin, deptId, studentId, payload);
  for (const row of rows) {
    const relativeId = cleanText(row.relative_id);
    if (!relativeId || relativeId === studentMemberId) continue;

    const { error: memberError } = await admin
      .from("members")
      .update({
        name: cleanText(row.name),
        phone: cleanText(row.phone),
      })
      .eq("id", relativeId);
    if (memberError) throw memberError;

    const oldSubjectId = row.direction === "descendant" ? relativeId : studentMemberId;
    const oldRelativeId = row.direction === "descendant" ? studentMemberId : relativeId;
    const oldKind = cleanText(row.kind);
    const relation = relationToKindRole(row.relation);

    if (oldKind && oldKind !== relation.kind) {
      const { error: deleteError } = await admin
        .from("member_relations")
        .delete()
        .eq("subject_id", oldSubjectId)
        .eq("relative_id", oldRelativeId)
        .eq("kind", oldKind);
      if (deleteError) throw deleteError;
    }

    const { data: existing, error: existingError } = await admin
      .from("member_relations")
      .select("id")
      .eq("subject_id", studentMemberId)
      .eq("relative_id", relativeId)
      .eq("kind", relation.kind)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing?.id) {
      const { error } = await admin
        .from("member_relations")
        .update({ role: relation.role })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await admin
        .from("member_relations")
        .insert({
          subject_id: studentMemberId,
          relative_id: relativeId,
          kind: relation.kind,
          role: relation.role,
        });
      if (error) throw error;
    }
  }
}

export async function POST(req: NextRequest) {
  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  if (!body.dept_id) {
    return NextResponse.json({ ok: false, error: "부서 정보가 없습니다" }, { status: 400 });
  }

  const auth = await requireDeptAdmin(req, body.dept_id);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const admin = createAdminClient();

  const inputs = Array.isArray(body.students)
    ? body.students
    : body.student
      ? [{ ...body.student, id: body.student_id ?? body.student.id ?? null }]
      : [];

  if (inputs.length === 0) {
    return NextResponse.json({ ok: false, error: "저장할 학생 정보가 없습니다" }, { status: 400 });
  }

  const results: Array<{ row: number; id?: string | null; error?: string }> = [];
  for (let i = 0; i < inputs.length; i++) {
    try {
      const saved = await saveOne(admin, body.dept_id, inputs[i], Array.isArray(body.students) ? undefined : body.member);
      const familyRows = Array.isArray(body.students) ? inputs[i].family : body.family;
      if (familyRows?.length && saved.id) {
        await saveFamily(admin, body.dept_id, saved.id, inputs[i], familyRows);
      }
      if (!Array.isArray(body.students) && body.family_updates?.length && saved.id) {
        await updateFamily(admin, body.dept_id, saved.id, inputs[i], body.family_updates);
      }
      results.push({ row: i + 1, id: saved.id });
    } catch (e) {
      results.push({ row: i + 1, error: e instanceof Error ? e.message : "저장 실패" });
    }
  }

  const failed = results.filter((r) => r.error);
  return NextResponse.json({
    ok: failed.length === 0,
    saved: results.length - failed.length,
    failed: failed.length,
    results,
  }, { status: failed.length === inputs.length ? 400 : 200 });
}

export async function DELETE(req: NextRequest) {
  let body: DeactivateBody;
  try {
    body = (await req.json()) as DeactivateBody;
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  const deptId = cleanText(body.dept_id);
  const studentId = cleanText(body.student_id);
  if (!deptId || !studentId) {
    return NextResponse.json({ ok: false, error: "부서 또는 학생 정보가 없습니다" }, { status: 400 });
  }

  const auth = await requireDeptAdmin(req, deptId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("edu_students")
    .update({ is_active: false })
    .eq("id", studentId)
    .eq("department_id", deptId)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: "학생 비활성화에 실패했습니다" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "활성 학생을 찾을 수 없습니다" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
