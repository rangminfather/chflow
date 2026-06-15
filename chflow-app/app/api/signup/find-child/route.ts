import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const rl = new Map<string, { n: number; reset: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rl.get(ip);
  if (!entry || now > entry.reset) {
    rl.set(ip, { n: 1, reset: now + 60_000 });
    return true;
  }
  if (entry.n >= 10) return false;
  entry.n++;
  return true;
}

const PHOTO_PREFIX = "/api/storage/member-photos/";
async function resolvePhotoUrl(row: Record<string, unknown>) {
  const raw = row.photo_url;
  if (typeof raw !== "string" || !raw.startsWith(PHOTO_PREFIX)) return row;
  const storagePath = raw.slice(PHOTO_PREFIX.length);
  const { data } = await supabaseAdmin.storage.from("member-photos").createSignedUrl(storagePath, 300);
  return { ...row, photo_url: data?.signedUrl ?? null };
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const childName = typeof body?.childName === "string" ? body.childName.trim() : "";
  const parentName = typeof body?.parentName === "string" ? body.parentName.trim() : "";
  const parentPhone = typeof body?.parentPhone === "string" ? body.parentPhone.trim() : "";
  if (!childName || !parentName || !parentPhone) {
    return NextResponse.json({ error: "자녀 이름, 부모 이름, 부모 전화번호를 입력하세요." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("find_child_for_signup", {
    p_child_name: childName,
    p_parent_name: parentName,
    p_parent_phone: parentPhone,
  });
  if (error) return NextResponse.json({ error: "조회 중 오류가 발생했습니다." }, { status: 500 });

  const rows = await Promise.all((data ?? []).map(resolvePhotoUrl));
  return NextResponse.json({ data: rows });
}
