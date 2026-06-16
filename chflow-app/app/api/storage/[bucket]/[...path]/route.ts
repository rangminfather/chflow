// Storage proxy — auth 확인 후 R2 presigned URL로 302 redirect
// GET  /api/storage/[bucket]/[...path] — 파일 읽기
// POST /api/storage/[bucket]/[...path] — 파일 업로드 (FormData: file, contentType)
// DELETE /api/storage/[bucket]/[...path] — 파일 삭제

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { r2 } from "@/lib/r2";

export const runtime = "nodejs";

const ALLOWED_BUCKETS = new Set([
  "member-photos",
  "feedback-attachments",
  "messenger-attachments",
  "dept-notice-attachments",
  "bulletins",
  "monthly-plans",
  "review-problems",
]);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    const client = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await client.auth.getUser(token);
    if (!error && data.user) return data.user.id;
  }

  const cookieStore = await cookies();
  const ssrClient = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });
  const { data: { user } } = await ssrClient.auth.getUser();
  if (user) return user.id;

  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> }
) {
  const { bucket, path } = await params;

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const uid = await getAuthUserId(req);
  if (!uid) return new NextResponse(null, { status: 401 });

  const storagePath = path.join("/");

  // messenger-attachments: 대화 참여자만 접근 가능
  if (bucket === "messenger-attachments") {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: attachment } = await admin
      .from("messenger_message_attachments")
      .select("conversation_id")
      .eq("file_path", storagePath)
      .maybeSingle();

    if (!attachment?.conversation_id) return new NextResponse(null, { status: 404 });

    const { data: participant } = await admin
      .from("messenger_participants")
      .select("id")
      .eq("conversation_id", attachment.conversation_id)
      .eq("user_id", uid)
      .maybeSingle();

    if (!participant?.id) return new NextResponse(null, { status: 403 });
  }

  const { data, error } = await r2.from(bucket).createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(data.signedUrl, { status: 302 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> }
) {
  const { bucket, path } = await params;

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const uid = await getAuthUserId(req);
  if (!uid) return new NextResponse(null, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const storagePath = path.join("/");
  const bytes = await file.arrayBuffer();
  const { error } = await r2.from(bucket).upload(storagePath, bytes, {
    contentType: file.type || "application/octet-stream",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, path: storagePath });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> }
) {
  const { bucket, path } = await params;

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const uid = await getAuthUserId(req);
  if (!uid) return new NextResponse(null, { status: 401 });

  const storagePath = path.join("/");
  const { error } = await r2.from(bucket).remove([storagePath]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
