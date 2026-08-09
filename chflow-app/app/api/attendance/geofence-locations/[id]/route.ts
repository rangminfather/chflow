import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getToken(req: NextRequest) {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function client(token: string) {
  if (!URL || !ANON) throw new Error("Supabase environment is not configured");
  return createClient(URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  try {
    const db = client(token);
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

    const { id } = await params;
    const { data: active, error: activeError } = await db
      .from("attendance_geofences")
      .select("location_id, latitude, longitude")
      .eq("scope", "default")
      .maybeSingle();
    if (activeError) return NextResponse.json({ ok: false, error: activeError.message }, { status: 403 });

    const { data: target, error: targetError } = await db
      .from("attendance_saved_locations")
      .select("id, latitude, longitude")
      .eq("id", id)
      .maybeSingle();
    if (targetError) return NextResponse.json({ ok: false, error: targetError.message }, { status: 403 });
    if (!target) return NextResponse.json({ ok: false, error: "저장된 위치를 찾을 수 없습니다." }, { status: 404 });

    if (active?.location_id === id || (
      active
      && Number(target.latitude) === Number(active.latitude)
      && Number(target.longitude) === Number(active.longitude)
    )) {
      return NextResponse.json({ ok: false, error: "현재 등록지점은 먼저 다른 위치로 변경한 뒤 삭제해 주세요." }, { status: 409 });
    }

    const { data, error } = await db
      .from("attendance_saved_locations")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    if (!data) return NextResponse.json({ ok: false, error: "저장된 위치를 찾을 수 없습니다." }, { status: 404 });

    return NextResponse.json({ ok: true, id: data.id });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
