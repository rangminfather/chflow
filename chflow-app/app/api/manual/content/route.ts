import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type ManualContent = {
  generatedAt?: string | null;
  chapters?: unknown[];
  items?: unknown[];
};

async function getAuthUser(req: NextRequest): Promise<{ uid: string } | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { uid: data.user.id };
}

async function isManualAdmin(uid: string): Promise<boolean> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("id", uid)
    .maybeSingle();
  return ["admin", "office", "pastor"].includes(String(data?.role || ""));
}

function isValidContent(content: ManualContent): content is Required<ManualContent> {
  return !!content && Array.isArray(content.chapters) && Array.isArray(content.items);
}

export async function GET(req: NextRequest) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from("manual_content")
    .select("content")
    .eq("id", "main")
    .maybeSingle();
  const user = await getAuthUser(req);
  const canEdit = user ? await isManualAdmin(user.uid) : false;

  if (error) return NextResponse.json({ ok: true, content: null, can_edit: canEdit });
  return NextResponse.json({ ok: true, content: data?.content ?? null, can_edit: canEdit });
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  if (!(await isManualAdmin(user.uid))) {
    return NextResponse.json({ ok: false, error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  let body: { content?: ManualContent };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 JSON입니다." }, { status: 400 });
  }

  if (!body.content || !isValidContent(body.content)) {
    return NextResponse.json({ ok: false, error: "매뉴얼 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const content = {
    generatedAt: body.content.generatedAt ?? new Date().toISOString(),
    chapters: body.content.chapters,
    items: body.content.items,
  };

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { error } = await admin
    .from("manual_content")
    .upsert({
      id: "main",
      content,
      updated_by: user.uid,
      updated_at: new Date().toISOString(),
    });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, content });
}
