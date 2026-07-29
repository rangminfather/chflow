// 지난 말씀 목록 조회 (로그인 사용자).
//
// sermon_archive 는 RLS 로 authenticated 읽기가 열려 있어 클라이언트가 직접 조회해도
// 되지만, 프록시 주소를 서버에서 붙여 내려주면 화면이 호스트를 몰라도 된다.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SERMON_BOARDS } from "@/lib/server/ums-sermons";

export const runtime = "nodejs";

const PROXY_BASE = (process.env.NEXT_PUBLIC_VOD_PROXY_URL || "").replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: userData, error: userError } = await anon.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const board = req.nextUrl.searchParams.get("board") || SERMON_BOARDS[0].id;
  if (!SERMON_BOARDS.some((b) => b.id === board)) {
    return NextResponse.json({ ok: false, error: "알 수 없는 게시판입니다." }, { status: 400 });
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 20), 50);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data } = await admin
    .from("sermon_archive")
    .select("board, post_no, title, preacher, bible, preached_on, video_path, thumb_path, byte_size")
    .eq("board", board)
    .order("preached_on", { ascending: false, nullsFirst: false })
    .order("post_no", { ascending: false })
    .limit(limit);

  const items = (data || []).map((row) => ({
    ...row,
    // 프록시가 설정돼 있으면 앱 안에서 재생 가능한 https 주소를 함께 준다
    video_url: PROXY_BASE ? `${PROXY_BASE}/vod${row.video_path}` : null,
    thumb_url: PROXY_BASE && row.thumb_path ? `${PROXY_BASE}/thumb${row.thumb_path}` : null,
  }));

  const res = NextResponse.json({
    ok: true,
    board,
    boards: SERMON_BOARDS,
    proxy_ready: !!PROXY_BASE,
    items,
  });
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
