// 사용자 본인의 UMS 자격증명 등록/수정/삭제
//
// GET    /api/ums-credentials/mine          → 메타 (등록 여부 + ums_user_id + updated_at)
// POST   /api/ums-credentials/mine          → 등록/수정 (비번은 암호화해서 저장)
// DELETE /api/ums-credentials/mine          → 삭제
//
// 인증: Supabase JWT (Authorization 헤더). 본인만 본인 자격증명 만짐.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { encryptString } from "@/lib/bulletin/creds-crypto";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getAuthUser(req: NextRequest): Promise<{ uid: string } | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { uid: data.user.id };
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from("user_ums_credentials")
    .select("ums_user_id, updated_at")
    .eq("user_id", user.uid)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    has_credentials: !!data,
    ums_user_id: data?.ums_user_id || null,
    updated_at: data?.updated_at || null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  let body: { ums_user_id?: string; ums_password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const umsUserId = (body.ums_user_id || "").trim();
  const umsPassword = body.ums_password || "";
  if (!umsUserId || !umsPassword) {
    return NextResponse.json(
      { ok: false, error: "UMS 아이디와 비밀번호를 모두 입력하세요" },
      { status: 400 },
    );
  }

  let encrypted: string;
  try {
    encrypted = encryptString(umsPassword);
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: `암호화 실패: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { error } = await admin
    .from("user_ums_credentials")
    .upsert({
      user_id: user.uid,
      ums_user_id: umsUserId,
      ums_password_encrypted: encrypted,
      updated_at: new Date().toISOString(),
    });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { error } = await admin
    .from("user_ums_credentials")
    .delete()
    .eq("user_id", user.uid);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
