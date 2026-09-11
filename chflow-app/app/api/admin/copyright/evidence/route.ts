// 저작권 증빙 이미지 프록시 스트리밍 — R2(copyright-evidence 버킷)는 비공개이므로
// 관리자 로그인 확인 후에만 바이트를 내려준다. GET /api/admin/copyright/evidence?path=<R2 키>

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { r2 } from "@/lib/r2";
import { COPYRIGHT_EVIDENCE_BUCKET } from "@/lib/copyright";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function isCallerAdmin(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const client = token
    ? createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: async () => (await cookies()).getAll(),
        setAll() {},
      },
    });

  const { data: { user } } = token ? await client.auth.getUser(token) : await client.auth.getUser();
  if (!user) return false;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return profile?.role === "admin";
}

export async function GET(req: NextRequest) {
  if (!(await isCallerAdmin(req))) {
    return new NextResponse(null, { status: 403 });
  }

  const path = req.nextUrl.searchParams.get("path") || "";
  // R2 키에는 "/"가 없으므로(업로드 시 평면 키로 생성) 경로 탈출 문자를 미리 차단한다.
  if (!path || path.includes("/") || path.includes("..")) {
    return new NextResponse(null, { status: 400 });
  }

  const { data, error } = await r2.from(COPYRIGHT_EVIDENCE_BUCKET).getObject(path);
  if (error || !data) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(data.body), {
    status: 200,
    headers: {
      "Content-Type": data.contentType,
      "Content-Length": String(data.contentLength),
      "Cache-Control": "private, max-age=300",
    },
  });
}
