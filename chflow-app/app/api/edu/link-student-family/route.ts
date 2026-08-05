import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type FamilyPayload = {
  relative_id?: string | null;
  name?: string | null;
  relation?: string | null;
  phone?: string | null;
};

type Body = {
  dept_id?: string;
  student_id?: string | null;
  member_id?: string | null;
  family?: FamilyPayload[];
};

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function userClient(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function clean(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function relationToKindRole(relation: string | null | undefined) {
  const value = (relation || "").trim();
  if (value === "부" || value === "아버지") return { kind: "parent", role: "father" };
  if (value === "모" || value === "어머니") return { kind: "parent", role: "mother" };
  if (["형", "오빠", "형제"].includes(value)) return { kind: "sibling", role: "brother" };
  if (["누나", "언니", "자매"].includes(value)) return { kind: "sibling", role: "sister" };
  if (value === "동생") return { kind: "sibling", role: null };
  if (value === "조부" || value === "할아버지") return { kind: "grandparent", role: "grandfather" };
  if (value === "조모" || value === "할머니") return { kind: "grandparent", role: "grandmother" };
  return { kind: "sibling", role: null };
}

async function requireDeptMember(req: NextRequest, deptId: string) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { ok: false as const, status: 401, error: "로그인이 필요합니다" };

  const client = userClient(token);
  const { data: authData, error: authErr } = await client.auth.getUser(token);
  if (authErr || !authData.user) return { ok: false as const, status: 401, error: "로그인이 필요합니다" };

  const { data, error } = await client.rpc("is_edu_member_or_admin", { p_dept_id: deptId });
  if (error || data !== true) return { ok: false as const, status: 403, error: "부서 권한이 없습니다" };
  return { ok: true as const };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  const deptId = clean(body.dept_id);
  const studentId = clean(body.student_id);
  const memberId = clean(body.member_id);
  if (!deptId || !studentId || !memberId) {
    return NextResponse.json({ ok: false, error: "학생/교인 연결 정보가 부족합니다" }, { status: 400 });
  }

  const auth = await requireDeptMember(req, deptId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const admin = adminClient();
  const { data: student, error: studentError } = await admin
    .from("edu_students")
    .select("id")
    .eq("id", studentId)
    .eq("department_id", deptId)
    .maybeSingle();
  if (studentError) return NextResponse.json({ ok: false, error: studentError.message }, { status: 500 });
  if (!student?.id) return NextResponse.json({ ok: false, error: "해당 부서 학생을 찾을 수 없습니다" }, { status: 404 });

  const { error: updateError } = await admin
    .from("edu_students")
    .update({ member_id: memberId })
    .eq("id", studentId)
    .eq("department_id", deptId);
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });

  for (const row of body.family || []) {
    const relativeId = clean(row.relative_id);
    if (!relativeId || relativeId === memberId) continue;
    const relation = relationToKindRole(row.relation);
    const { error } = await admin
      .from("member_relations")
      .upsert(
        { subject_id: memberId, relative_id: relativeId, kind: relation.kind, role: relation.role },
        { onConflict: "subject_id,relative_id,kind" },
      );
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
