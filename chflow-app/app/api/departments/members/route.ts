import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { executiveGradeForRole, isExecutiveRole } from "@/lib/deptRoles";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function tokenFrom(request: NextRequest) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function fallbackRole(grade: number) {
  if (grade === 0) return "전도사·교육사";
  if (grade === 1) return "부장";
  return "임원";
}

function displayRole(role: string | null, grade: number) {
  const value = role?.trim() || "";
  return ["", "member", "teacher", "parent", "교사", "학부모"].includes(value)
    ? fallbackRole(grade)
    : value;
}

export async function GET(request: NextRequest) {
  const token = tokenFrom(request);
  const departmentId = request.nextUrl.searchParams.get("department_id")?.trim() || "";

  if (!token) return NextResponse.json({ ok: false, error: "로그인이 필요합니다" }, { status: 401 });
  if (!departmentId) return NextResponse.json({ ok: false, error: "부서 정보가 필요합니다" }, { status: 400 });
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return NextResponse.json({ ok: false, error: "서버 설정을 확인할 수 없습니다" }, { status: 500 });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, error: "로그인이 만료되었습니다" }, { status: 401 });
  }

  const { data: allowed, error: allowedError } = await userClient.rpc("is_edu_member_or_admin", {
    p_dept_id: departmentId,
  });
  if (allowedError || allowed !== true) {
    return NextResponse.json({ ok: false, error: "이 부서의 구성원만 볼 수 있습니다" }, { status: 403 });
  }

  const [classResult, departmentResult] = await Promise.all([
    userClient.rpc("list_dept_classes_full", { p_dept_id: departmentId }),
    userClient.from("departments").select("name").eq("id", departmentId).maybeSingle(),
  ]);
  if (classResult.error) {
    return NextResponse.json({ ok: false, error: classResult.error.message }, { status: 500 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: executiveRows, error: executiveError }, { data: teacherRows, error: teacherError }] = await Promise.all([
    admin
      .from("department_members")
      .select("user_id, member_role, grade")
      .eq("department_id", departmentId)
      .eq("status", "approved")
      .lte("grade", 2)
      .order("grade", { ascending: true }),
    // 앱 계정 없이 교사 명부에만 등록된 임원도 구성원 안내에 나와야 한다
    // (department_members 는 계정이 있어야 생기므로 미가입 임원이 통째로 빠졌다)
    admin
      .from("edu_teachers")
      .select("id, user_id, name, teacher_role, order_no")
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .order("order_no", { ascending: true }),
  ]);
  if (executiveError || teacherError) {
    return NextResponse.json({ ok: false, error: executiveError?.message || teacherError?.message }, { status: 500 });
  }

  const userIds = [...new Set((executiveRows || []).map((row) => row.user_id).filter(Boolean))];
  const [memberResult, profileResult] = userIds.length > 0
    ? await Promise.all([
      admin.from("members").select("app_user_id, name").in("app_user_id", userIds),
      admin.from("profiles").select("id, name").in("id", userIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (memberResult.error || profileResult.error) {
    return NextResponse.json({ ok: false, error: memberResult.error?.message || profileResult.error?.message }, { status: 500 });
  }

  const names = new Map<string, string>();
  for (const row of profileResult.data || []) {
    if (row.name) names.set(row.id, row.name);
  }
  for (const row of memberResult.data || []) {
    if (row.app_user_id && row.name) names.set(row.app_user_id, row.name);
  }

  const executives = (executiveRows || []).map((row) => ({
    id: row.user_id,
    user_id: row.user_id,
    name: names.get(row.user_id) || "이름 미등록",
    role: displayRole(row.member_role, row.grade),
    grade: row.grade,
  }));

  // 교사 명부(edu_teachers)의 임원 중 위 목록에 없는 사람 — 계정 미가입자가 대부분이다.
  // 계정이 있는 사람은 department_members 쪽이 권한 기준이므로 그쪽을 남기고 여기서는 건너뛴다.
  const linkedUserIds = new Set(executives.map((row) => row.user_id).filter(Boolean));
  for (const row of teacherRows || []) {
    if (!isExecutiveRole(row.teacher_role)) continue;
    if (row.user_id && linkedUserIds.has(row.user_id)) continue;
    executives.push({
      id: `teacher:${row.id}`,
      user_id: row.user_id,
      name: row.name?.trim() || "이름 미등록",
      role: (row.teacher_role || "").trim(),
      grade: executiveGradeForRole(row.teacher_role),
    });
  }
  const classes = (classResult.data || []).map((row: Record<string, unknown>) => ({
    class_no: row.class_no,
    grade_year: row.grade_year,
    in_registry: row.in_registry,
    label: row.label,
    teacher_name: row.teacher_name,
    assistant_teacher_name: row.assistant_teacher_name,
  }));

  return NextResponse.json({
    ok: true,
    department_name: departmentResult.data?.name || "부서",
    executives,
    classes,
  });
}
