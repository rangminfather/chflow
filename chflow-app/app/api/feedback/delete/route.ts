// POST /api/feedback/delete  { postIds: string[], reason?: string }
// 관리자만. delete_feedback_posts RPC 호출(작성자 알림+DB삭제) 후 R2 첨부 정리.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { r2 } from "@/lib/r2";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const postIds: string[] = Array.isArray(body?.postIds) ? body.postIds.filter((x: unknown) => typeof x === "string") : [];
  const reason: string | null = typeof body?.reason === "string" ? body.reason : null;
  if (postIds.length === 0) {
    return NextResponse.json({ error: "삭제할 글을 선택하세요." }, { status: 400 });
  }

  // 사용자 인증 토큰으로 RPC 실행 (auth.uid()/get_user_role() 동작)
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  let userClient;
  if (token) {
    userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
  } else {
    const cookieStore = await cookies();
    userClient = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
    });
  }

  const { data, error } = await userClient.rpc("delete_feedback_posts", {
    p_post_ids: postIds,
    p_reason: reason,
  });

  if (error) {
    const status = /관리자/.test(error.message) ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  // R2 첨부 파일 정리 (실패해도 삭제 자체는 성공으로 처리)
  const filePaths: string[] = (data || [])
    .map((r: { file_path?: string }) => r.file_path)
    .filter((p: unknown): p is string => typeof p === "string" && p.length > 0);
  if (filePaths.length > 0) {
    try { await r2.from("feedback-attachments").remove(filePaths); } catch {}
  }

  return NextResponse.json({ ok: true, deleted: postIds.length, attachmentsRemoved: filePaths.length });
}
