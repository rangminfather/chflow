// GET /api/storage/list/[bucket]?prefix=xxx — 인증 사용자에게 파일 목록 반환
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
]);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
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
    cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
  });
  const { data: { user } } = await ssrClient.auth.getUser();
  return user?.id ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bucket: string }> }
) {
  const { bucket } = await params;
  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const uid = await getAuthUserId(req);
  if (!uid) return new NextResponse(null, { status: 401 });

  const prefix = req.nextUrl.searchParams.get("prefix") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");

  const { data, error } = await r2.from(bucket).list(prefix, { limit });
  if (error) return NextResponse.json({ error: "목록 조회 실패" }, { status: 500 });

  return NextResponse.json({ data });
}
