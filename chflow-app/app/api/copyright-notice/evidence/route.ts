// 저작권 안내 증빙 이미지 프록시 — 로그인한 성도 누구나 볼 수 있되, 실제로 공개(승인·라이선스
// 구매) 상태인 항목의 증빙 이미지만 내려준다. GET /api/copyright-notice/evidence?path=<R2 키>

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { r2 } from "@/lib/r2";
import { COPYRIGHT_EVIDENCE_BUCKET, fromPublicRow } from "@/lib/copyright";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function callerClient(req: NextRequest) {
  const token = tokenFrom(req);
  if (token) {
    return createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: async () => (await cookies()).getAll(),
      setAll() {},
    },
  });
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") || "";
  if (!path || path.includes("/") || path.includes("..")) {
    return new NextResponse(null, { status: 400 });
  }

  const client = await callerClient(req);
  const { data, error } = await client.rpc("get_public_copyright_notices", { p_slug: null });
  if (error) return new NextResponse(null, { status: error.message.includes("로그인") ? 401 : 403 });

  const isPublicEvidence = (data ?? []).map(fromPublicRow).some((item: { evidenceImagePath: string | null }) => item.evidenceImagePath === path);
  if (!isPublicEvidence) return new NextResponse(null, { status: 404 });

  const { data: object, error: r2Error } = await r2.from(COPYRIGHT_EVIDENCE_BUCKET).getObject(path);
  if (r2Error || !object) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "Content-Type": object.contentType,
      "Content-Length": String(object.contentLength),
      "Cache-Control": "private, max-age=300",
    },
  });
}
