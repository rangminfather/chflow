import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type StudentType = "정" | "체험" | "소";

interface SaveBody {
  dept_id: string;
  student_id: string;
  student: {
    name: string;
    student_type: StudentType;
    grade?: string | null;
  };
  member?: {
    id: string | null;
    phone: string | null;
    birth_date: string | null;
    gender: string | null;
    address: string | null;
  };
}

const STUDENT_TYPES: StudentType[] = ["정", "체험", "소"];

export async function POST(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ ok: false, error: "로그인이 필요합니다" }, { status: 401 });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다" }, { status: 401 });
  }

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  if (!body.dept_id || !body.student_id || !body.student?.name?.trim()) {
    return NextResponse.json({ ok: false, error: "이름을 입력하세요" }, { status: 400 });
  }

  // 행정관리 권한 (등급 0~2: 전도사·부장·부부장·총무·서기) — get_user_grade 로 동일 정책 재사용
  const { data: gradeData, error: gradeErr } = await userClient.rpc("get_user_grade", {
    p_dept_id: body.dept_id,
  });
  const grade = typeof gradeData === "number" ? gradeData : Number(gradeData);
  if (gradeErr || Number.isNaN(grade) || grade > 2) {
    return NextResponse.json({ ok: false, error: "학생정보관리 권한이 없습니다 (임원진 전용)" }, { status: 403 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: student, error: studentErr } = await admin
    .from("edu_students")
    .select("id, member_id")
    .eq("id", body.student_id)
    .eq("department_id", body.dept_id)
    .maybeSingle();

  if (studentErr || !student) {
    return NextResponse.json({ ok: false, error: "학생을 찾을 수 없습니다" }, { status: 404 });
  }

  const studentType = STUDENT_TYPES.includes(body.student.student_type) ? body.student.student_type : "정";
  const { error: updateStudentErr } = await admin
    .from("edu_students")
    .update({
      name: body.student.name.trim(),
      student_type: studentType,
      grade: body.student.grade?.trim() || null,
    })
    .eq("id", body.student_id)
    .eq("department_id", body.dept_id);

  if (updateStudentErr) {
    return NextResponse.json({ ok: false, error: "학생 정보 저장에 실패했습니다" }, { status: 500 });
  }

  const memberBody = body.member;
  if (student.member_id && memberBody && memberBody.id === student.member_id) {
    const gender = memberBody.gender === "M" || memberBody.gender === "F" ? memberBody.gender : null;
    const { error: updateMemberErr } = await admin
      .from("members")
      .update({
        name: body.student.name.trim(),
        phone: memberBody.phone?.trim() || null,
        birth_date: memberBody.birth_date || null,
        gender,
        address: memberBody.address?.trim() || null,
      })
      .eq("id", student.member_id);

    if (updateMemberErr) {
      return NextResponse.json({ ok: false, error: "인적사항 저장에 실패했습니다" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
