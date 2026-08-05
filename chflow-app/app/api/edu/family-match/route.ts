import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type MatchInput = {
  row?: number;
  name?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  gender?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
};

type Member = {
  id: string;
  name: string | null;
  phone: string | null;
  birth_date: string | null;
  gender: string | null;
  photo_url?: string | null;
  address?: string | null;
};

type Relation = {
  subject_id: string;
  relative_id: string;
  kind: string;
  role: string | null;
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

function digits(value: string | null | undefined) {
  return (value || "").replace(/\D/g, "");
}

function phoneMatch(a: string | null | undefined, b: string | null | undefined) {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return 0;
  if (da === db) return 28;
  if (da.length >= 4 && db.length >= 4 && da.slice(-4) === db.slice(-4)) return 16;
  return 0;
}

function relationLabel(kind: string, role: string | null) {
  if (role === "father") return "부";
  if (role === "mother") return "모";
  if (["grandfather", "paternal_grandfather", "maternal_grandfather"].includes(role || "")) return "조부";
  if (["grandmother", "paternal_grandmother", "maternal_grandmother"].includes(role || "")) return "조모";
  if (role === "brother") return "형제";
  if (role === "sister") return "자매";
  if (kind === "parent") return "부모";
  if (kind === "grandparent") return "조부모";
  if (kind === "great_grandparent") return "증조부모";
  if (kind === "spouse") return "배우자";
  return "가족";
}

async function requireDeptAdmin(req: NextRequest, deptId: string) {
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

async function fetchMembersByIds(admin: ReturnType<typeof adminClient>, ids: string[]) {
  if (ids.length === 0) return new Map<string, Member>();
  const { data, error } = await admin
    .from("members")
    .select("id,name,phone,birth_date,gender,photo_url,address")
    .in("id", Array.from(new Set(ids)));
  if (error) throw error;
  return new Map(((data || []) as Member[]).map((member) => [member.id, member]));
}

async function familyFor(admin: ReturnType<typeof adminClient>, memberId: string) {
  const { data, error } = await admin
    .from("member_relations")
    .select("subject_id,relative_id,kind,role")
    .or(`subject_id.eq.${memberId},relative_id.eq.${memberId}`);
  if (error) throw error;
  const rows = ((data || []) as Relation[]).filter((row) => ["parent", "grandparent", "great_grandparent", "spouse", "sibling"].includes(row.kind));
  const members = await fetchMembersByIds(admin, rows.map((row) => row.subject_id === memberId ? row.relative_id : row.subject_id));
  return rows.map((row) => {
    const relativeId = row.subject_id === memberId ? row.relative_id : row.subject_id;
    const relative = members.get(relativeId);
    if (!relative) return null;
    return {
      relative_id: relativeId,
      name: relative.name || "",
      relation: relationLabel(row.kind, row.role),
      phone: relative.phone || "",
      photo_url: relative.photo_url || null,
      kind: row.kind,
      role: row.role,
      default_selected: row.kind === "parent",
    };
  }).filter(Boolean);
}

async function childIdsFromParent(admin: ReturnType<typeof adminClient>, input: MatchInput) {
  const parentName = clean(input.parent_name);
  if (!parentName) return [];
  const { data: parents, error: parentError } = await admin.from("members").select("id,phone").eq("name", parentName).limit(20);
  if (parentError) throw parentError;
  const parentIds = ((parents || []) as Pick<Member, "id" | "phone">[]).filter((parent) => !input.parent_phone || phoneMatch(parent.phone, input.parent_phone) > 0).map((parent) => parent.id);
  if (parentIds.length === 0) return [];
  const { data: rels, error: relError } = await admin.from("member_relations").select("subject_id,relative_id,kind").in("relative_id", parentIds).in("kind", ["parent", "grandparent", "great_grandparent"]);
  if (relError) throw relError;
  return Array.from(new Set(((rels || []) as Relation[]).map((row) => row.subject_id)));
}

async function matchOne(admin: ReturnType<typeof adminClient>, deptId: string, input: MatchInput) {
  const name = clean(input.name);
  const candidateMap = new Map<string, Member>();
  if (name) {
    const { data, error } = await admin.from("members").select("id,name,phone,birth_date,gender,photo_url,address").eq("name", name).limit(20);
    if (error) throw error;
    ((data || []) as Member[]).forEach((member) => candidateMap.set(member.id, member));
  }
  const parentChildIds = await childIdsFromParent(admin, input);
  const parentChildren = await fetchMembersByIds(admin, parentChildIds);
  parentChildren.forEach((member) => {
    if (!name || member.name === name) candidateMap.set(member.id, member);
  });

  const candidates = await Promise.all(Array.from(candidateMap.values()).map(async (member) => {
    let score = 0;
    if (name && member.name === name) score += 50;
    if (input.birth_date && member.birth_date === input.birth_date) score += 35;
    score += phoneMatch(member.phone, input.phone);
    if (input.gender && member.gender === input.gender) score += 8;
    if (parentChildIds.includes(member.id)) score += input.parent_phone ? 35 : 20;
    return {
      member_id: member.id,
      name: member.name || "",
      phone: member.phone || "",
      birth_date: member.birth_date,
      gender: member.gender,
      photo_url: member.photo_url || null,
      address: member.address || "",
      score,
      strength: score >= 90 ? "strong" : score >= 60 ? "medium" : "weak",
      family: await familyFor(admin, member.id),
    };
  }));
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"));
  return { row: input.row ?? null, candidates: candidates.slice(0, 5) };
}

export async function POST(req: NextRequest) {
  let body: { dept_id?: string; student?: MatchInput; students?: MatchInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }
  if (!body.dept_id) return NextResponse.json({ ok: false, error: "부서 정보가 없습니다" }, { status: 400 });
  const auth = await requireDeptAdmin(req, body.dept_id);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const inputs = Array.isArray(body.students) ? body.students : body.student ? [body.student] : [];
  try {
    const admin = adminClient();
    const results = [];
    for (const input of inputs) results.push(await matchOne(admin, body.dept_id, input));
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "가족 후보 조회에 실패했습니다" }, { status: 500 });
  }
}
