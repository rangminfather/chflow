import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type StudentType = "정" | "체험" | "소";

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
};

type SaveBody = {
  dept_id: string;
  student_id?: string | null;
  student?: StudentPayload;
  students?: StudentPayload[];
  member?: {
    id: string | null;
    phone: string | null;
    birth_date: string | null;
    gender: string | null;
    address: string | null;
  };
};

const STUDENT_TYPES: StudentType[] = ["정", "체험", "소"];

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

  const row = {
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
      .update(row)
      .eq("id", id)
      .eq("department_id", deptId);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("edu_students")
      .insert(row)
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
