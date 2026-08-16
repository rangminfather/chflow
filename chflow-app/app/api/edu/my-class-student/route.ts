import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type StudentType = "정" | "체험";

type MgmtStatus = "정상" | "장기결석";

type FamilyPayload = {
  name?: string | null;
  relation?: string | null;
  phone?: string | null;
};

type FamilyUpdatePayload = FamilyPayload & {
  relative_id?: string | null;
  kind?: string | null;
  direction?: string | null;
};

interface SaveBody {
  dept_id: string;
  student_id: string;
  student: {
    name: string;
    student_type: StudentType;
    grade?: string | null;
    mgmt_status?: MgmtStatus;
    school_name?: string | null;
  };
  member?: {
    id: string | null;
    phone: string | null;
    birth_date: string | null;
    gender: string | null;
    address: string | null;
  };
  family?: FamilyPayload[];
  family_updates?: FamilyUpdatePayload[];
}

const STUDENT_TYPES: StudentType[] = ["정", "체험"];
const MGMT_STATUSES: MgmtStatus[] = ["정상", "장기결석"];

type AdminClient = ReturnType<typeof createAdminClient>;

function createAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function relationToKindRole(relation: string | null | undefined) {
  const value = (relation || "").trim();
  if (value === "부" || value === "아버지") return { kind: "parent", role: "father" };
  if (value === "모" || value === "어머니") return { kind: "parent", role: "mother" };
  if (["형", "오빠", "형제"].includes(value)) return { kind: "sibling", role: "brother" };
  if (["누나", "언니", "자매"].includes(value)) return { kind: "sibling", role: "sister" };
  if (value === "동생") return { kind: "sibling", role: null };
  if (value === "조부") return { kind: "grandparent", role: "grandfather" };
  if (value === "조모") return { kind: "grandparent", role: "grandmother" };
  if (value === "배우자") return { kind: "spouse", role: null };
  return { kind: "sibling", role: null };
}

async function ensureStudentMember(
  admin: AdminClient,
  deptId: string,
  studentId: string,
  studentName: string,
  memberBody: SaveBody["member"],
) {
  if (memberBody?.id) return memberBody.id;

  const { data: current, error: currentError } = await admin
    .from("edu_students")
    .select("member_id, name")
    .eq("id", studentId)
    .eq("department_id", deptId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (current?.member_id) return current.member_id as string;

  const gender = memberBody?.gender === "M" || memberBody?.gender === "F" ? memberBody.gender : null;
  const { data: member, error: memberError } = await admin
    .from("members")
    .insert({
      name: cleanText(studentName) || cleanText(current?.name) || "학생",
      phone: cleanText(memberBody?.phone),
      birth_date: cleanText(memberBody?.birth_date),
      gender,
      address: cleanText(memberBody?.address),
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

  const { data: member, error } = await admin
    .from("members")
    .insert({ name, phone, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  return member.id as string;
}

async function saveFamily(
  admin: AdminClient,
  deptId: string,
  studentId: string,
  studentName: string,
  memberBody: SaveBody["member"],
  family: FamilyPayload[] | undefined,
) {
  const rows = (family || []).filter((item) => cleanText(item.name));
  if (rows.length === 0) return;

  const studentMemberId = await ensureStudentMember(admin, deptId, studentId, studentName, memberBody);
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
  studentName: string,
  memberBody: SaveBody["member"],
  familyUpdates: FamilyUpdatePayload[] | undefined,
) {
  const rows = (familyUpdates || []).filter((item) => cleanText(item.name) && cleanText(item.relative_id));
  if (rows.length === 0) return;

  const studentMemberId = await ensureStudentMember(admin, deptId, studentId, studentName, memberBody);
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
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ ok: false, error: "로그인이 필요합니다" }, { status: 401 });

  const userClient = createClient(SUPABASE_URL, ANON_KEY);
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

  const admin = createAdminClient();

  const [{ data: callerProfile }, { data: teacher, error: teacherErr }] = await Promise.all([
    admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle(),
    admin
      .from("edu_teachers")
      .select("id")
      .eq("department_id", body.dept_id)
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle(),
  ]);
  const isMaster = ["admin", "office", "pastor"].includes(callerProfile?.role || "");

  if (teacherErr || (!isMaster && !teacher)) {
    return NextResponse.json({ ok: false, error: "담임 권한이 없습니다" }, { status: 403 });
  }

  const { data: student, error: studentErr } = await admin
    .from("edu_students")
    .select("id, teacher_id, member_id, class_no")
    .eq("id", body.student_id)
    .eq("department_id", body.dept_id)
    .maybeSingle();

  if (studentErr || !student) {
    return NextResponse.json({ ok: false, error: "학생을 찾을 수 없습니다" }, { status: 404 });
  }
  const { data: assistantClass } = !isMaster && student.class_no && teacher?.id
    ? await admin
      .from("edu_classes")
      .select("class_no")
      .eq("department_id", body.dept_id)
      .eq("class_no", student.class_no)
      .eq("assistant_teacher_id", teacher.id)
      .maybeSingle()
    : { data: null };
  if (!isMaster && student.teacher_id !== teacher?.id && !assistantClass) {
    return NextResponse.json({ ok: false, error: "담당 반 학생만 수정할 수 있습니다" }, { status: 403 });
  }

  const studentType = STUDENT_TYPES.includes(body.student.student_type) ? body.student.student_type : "정";
  const mgmtStatus = body.student.mgmt_status && MGMT_STATUSES.includes(body.student.mgmt_status)
    ? body.student.mgmt_status
    : "정상";
  const { error: updateStudentErr } = await admin
    .from("edu_students")
    .update({
      name: body.student.name.trim(),
      student_type: studentType,
      mgmt_status: mgmtStatus,
      grade: body.student.grade?.trim() || null,
      school_name: body.student.school_name?.trim() || null,
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

  try {
    await saveFamily(admin, body.dept_id, body.student_id, body.student.name, memberBody, body.family);
    await updateFamily(admin, body.dept_id, body.student_id, body.student.name, memberBody, body.family_updates);
  } catch {
    return NextResponse.json({ ok: false, error: "가족관계 저장에 실패했습니다" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
