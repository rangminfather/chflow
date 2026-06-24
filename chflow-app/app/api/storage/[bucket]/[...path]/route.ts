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

const IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const DOCS = [
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/x-hwp",
  "application/haansofthwp",
];

const BUCKET_RULES: Record<string, { mimes: string[]; maxBytes: number }> = {
  "member-photos":          { mimes: IMAGES,          maxBytes: 10 * 1024 * 1024 },
  "feedback-attachments":   { mimes: IMAGES,          maxBytes: 10 * 1024 * 1024 },
  "messenger-attachments":  { mimes: [...IMAGES, ...DOCS], maxBytes: 25 * 1024 * 1024 },
  "dept-notice-attachments":{ mimes: [...IMAGES, ...DOCS], maxBytes: 20 * 1024 * 1024 },
};

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

  const isStream = req.nextUrl.searchParams.get("stream") === "1";
  const isDownload = req.nextUrl.searchParams.get("download") === "1";

  // 기본: 302 리디렉트 (이미지 <img> 등) — R2에서 직접 병렬 다운로드라 빠름.
  // pdf.js·fetch 처럼 same-origin 이 필요한 경우만 ?stream=1 로 바이트 스트리밍(CORS 우회).
  if (!isStream && !isDownload) {
    const { data, error } = await r2.from(bucket).createSignedUrl(storagePath, 300);
    if (error || !data?.signedUrl) return new NextResponse(null, { status: 404 });
    return NextResponse.redirect(data.signedUrl, { status: 302 });
  }

  const { data, error } = await r2.from(bucket).getObject(storagePath);
  if (error || !data) return new NextResponse(null, { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", data.contentType);
  headers.set("Content-Length", String(data.contentLength));
  headers.set("Cache-Control", "private, max-age=300");

  if (isDownload) {
    const filename = storagePath.split("/").pop() || "file";
    headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
  }

  return new NextResponse(new Uint8Array(data.body), { status: 200, headers });
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

  const rules = BUCKET_RULES[bucket];
  if (rules) {
    if (file.size > rules.maxBytes) {
      return NextResponse.json(
        { error: `파일 크기 초과 (최대 ${rules.maxBytes / 1024 / 1024}MB)` },
        { status: 413 }
      );
    }
    const mime = file.type.toLowerCase().split(";")[0].trim();
    if (!rules.mimes.includes(mime)) {
      return NextResponse.json(
        { error: `허용되지 않는 파일 형식입니다 (${mime})` },
        { status: 415 }
      );
    }
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
