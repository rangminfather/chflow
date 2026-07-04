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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 이미지 썸네일 (?w=) — 최초 요청 시 webp 로 변환해 R2에 캐시, 이후 재사용.
// 사진 경로는 업로드마다 새 파일명이라 사실상 불변 → 브라우저 캐시 1일 허용.
const THUMB_PREFIX = "__thumbs";
const THUMB_WIDTHS = new Set([64, 128, 256, 512]);
const THUMB_SRC_RE = /\.(jpe?g|png|webp)$/i; // gif(애니메이션)는 원본 그대로

function imageResponse(body: Buffer | Uint8Array, contentType: string) {
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400",
    },
  });
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

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

async function requireMessengerParticipant(conversationId: string, uid: string): Promise<boolean> {
  const admin = adminClient();
  const { data } = await admin
    .from("messenger_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", uid)
    .maybeSingle();

  return !!data?.id;
}

async function canReadMessengerAttachment(storagePath: string, uid: string): Promise<boolean | null> {
  const admin = adminClient();
  const { data: attachment } = await admin
    .from("messenger_message_attachments")
    .select("conversation_id")
    .eq("file_path", storagePath)
    .maybeSingle();

  if (!attachment?.conversation_id) return null;
  return requireMessengerParticipant(attachment.conversation_id, uid);
}

async function canUploadMessengerAttachment(storagePath: string, uid: string): Promise<boolean> {
  const [ownerId, conversationId] = storagePath.split("/");
  if (ownerId !== uid || !UUID_RE.test(conversationId || "")) return false;
  return requireMessengerParticipant(conversationId, uid);
}

async function canDeleteMessengerAttachment(storagePath: string, uid: string): Promise<boolean> {
  const admin = adminClient();
  const { data: attachment } = await admin
    .from("messenger_message_attachments")
    .select("uploaded_by")
    .eq("file_path", storagePath)
    .maybeSingle();

  if (attachment?.uploaded_by) return attachment.uploaded_by === uid;

  const [ownerId, conversationId] = storagePath.split("/");
  if (ownerId !== uid || !UUID_RE.test(conversationId || "")) return false;
  return requireMessengerParticipant(conversationId, uid);
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
    const allowed = await canReadMessengerAttachment(storagePath, uid);
    if (allowed === null) return new NextResponse(null, { status: 404 });
    if (!allowed) return new NextResponse(null, { status: 403 });
  }

  // 썸네일 요청: R2 캐시 조회 → 없으면 원본을 리사이즈해 캐시 후 반환
  const wParam = Number(req.nextUrl.searchParams.get("w") || 0);
  if (THUMB_WIDTHS.has(wParam) && THUMB_SRC_RE.test(storagePath) && !storagePath.startsWith(`${THUMB_PREFIX}/`)) {
    const thumbPath = `${THUMB_PREFIX}/w${wParam}/${storagePath}.webp`;
    const cached = await r2.from(bucket).getObject(thumbPath);
    if (!cached.error && cached.data) {
      return imageResponse(cached.data.body, "image/webp");
    }
    const orig = await r2.from(bucket).getObject(storagePath);
    if (orig.error || !orig.data) return new NextResponse(null, { status: 404 });
    try {
      const sharp = (await import("sharp")).default;
      const buf = await sharp(orig.data.body)
        .rotate()
        .resize({ width: wParam, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      await r2.from(bucket).upload(thumbPath, buf, { contentType: "image/webp", upsert: true });
      return imageResponse(buf, "image/webp");
    } catch {
      // 변환 실패(손상 파일 등) — 원본으로 폴백
      return imageResponse(orig.data.body, orig.data.contentType);
    }
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
  if (bucket === "messenger-attachments" && !await canUploadMessengerAttachment(storagePath, uid)) {
    return new NextResponse(null, { status: 403 });
  }

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
  if (bucket === "messenger-attachments" && !await canDeleteMessengerAttachment(storagePath, uid)) {
    return new NextResponse(null, { status: 403 });
  }

  const { error } = await r2.from(bucket).remove([storagePath]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
