import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface SaveBody {
  dept_id: string;
  student_id: string;
  student: {
    name: string;
    student_no: number | null;
    student_type: string;
    grade: string | null;
  };
  member?: {
    id: string | null;
    phone: string | null;
    email: string | null;
    birth_date: string | null;
    gender: string | null;
    address: string | null;
    notes: string | null;
  };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.dept_id || !body.student_id || !body.student?.name?.trim()) {
    return NextResponse.json({ ok: false, error: "필수값이 누락되었습니다" }, { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: teacher, error: teacherErr } = await admin
    .from("edu_teachers")
    .select("id, teacher_role")
    .eq("department_id", body.dept_id)
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (teacherErr || !teacher) {
    return NextResponse.json({ ok: false, error: "담임 권한이 없습니다" }, { status: 403 });
  }

  const { data: student, error: studentErr } = await admin
    .from("edu_students")
    .select("id, department_id, teacher_id, member_id")
    .eq("id", body.student_id)
    .eq("department_id", body.dept_id)
    .maybeSingle();

  if (studentErr || !student) {
    return NextResponse.json({ ok: false, error: "학생을 찾을 수 없습니다" }, { status: 404 });
  }
  // 전도사·부장급은 반 구분 없이 전체 학생 수정 가능
  const isLeader = teacher.teacher_role !== "교사";
  if (!isLeader && student.teacher_id !== teacher.id) {
    return NextResponse.json({ ok: false, error: "담당 반 학생만 수정할 수 있습니다" }, { status: 403 });
  }

  const studentType = ["정", "체험", "소"].includes(body.student.student_type)
    ? body.student.student_type
    : "정";

  const { error: updateStudentErr } = await admin
    .from("edu_students")
    .update({
      name: body.student.name.trim(),
      student_no: body.student.student_no,
      student_type: studentType,
      grade: body.student.grade?.trim() || null,
    })
    .eq("id", body.student_id)
    .eq("department_id", body.dept_id)
    .eq("teacher_id", teacher.id);

  if (updateStudentErr) {
    return NextResponse.json(
      { ok: false, error: "학생 정보 저장 실패" },
      { status: 500 },
    );
  }

  const memberBody = body.member;
  if (student.member_id && memberBody && memberBody.id === student.member_id) {
    const gender = memberBody.gender === "M" || memberBody.gender === "F" ? memberBody.gender : null;
    const { error: updateMemberErr } = await admin
      .from("members")
      .update({
        name: body.student.name.trim(),
        phone: memberBody.phone?.trim() || null,
        email: memberBody.email?.trim() || null,
        birth_date: memberBody.birth_date || null,
        gender,
        address: memberBody.address?.trim() || null,
        notes: memberBody.notes?.trim() || null,
      })
      .eq("id", student.member_id);

    if (updateMemberErr) {
      return NextResponse.json(
        { ok: false, error: "인적사항 저장 실패" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
