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

export async function GET(req: NextRequest) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  try {
    const { data, error } = await client(token).from("attendance_geofences").select("*").eq("scope", "default").maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, geofence: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  let body: { name?: string; latitude?: number; longitude?: number; radiusM?: number; dwellSeconds?: number; windowStart?: string; windowEnd?: string; timezone?: string; isActive?: boolean; locationId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  let latitude = Number(body.latitude);
  let longitude = Number(body.longitude);
  const radiusM = Number(body.radiusM);
  const dwellSeconds = Number(body.dwellSeconds);
  if (!Number.isInteger(radiusM) || radiusM < 50 || radiusM > 500) return NextResponse.json({ ok: false, error: "반경은 50~500m 사이여야 합니다." }, { status: 400 });
  if (!Number.isInteger(dwellSeconds) || dwellSeconds < 300 || dwellSeconds > 3600) return NextResponse.json({ ok: false, error: "체류 기준은 5~60분 사이여야 합니다." }, { status: 400 });
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(body.windowStart || "") || !/^\d{2}:\d{2}(:\d{2})?$/.test(body.windowEnd || "")) return NextResponse.json({ ok: false, error: "운영 시간 형식이 올바르지 않습니다." }, { status: 400 });
  try {
    const db = client(token);
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

    const requestedLocationId = body.locationId?.trim();
    let locationId: string | null = null;
    let locationName = body.name?.trim() || "본당";
    if (requestedLocationId) {
      const { data: savedLocation, error: locationError } = await db
        .from("attendance_saved_locations")
        .select("id, name, latitude, longitude")
        .eq("id", requestedLocationId)
        .maybeSingle();
      if (locationError) return NextResponse.json({ ok: false, error: locationError.message }, { status: 403 });
      if (!savedLocation) return NextResponse.json({ ok: false, error: "저장된 위치를 찾을 수 없습니다." }, { status: 404 });
      locationId = savedLocation.id;
      locationName = savedLocation.name;
      latitude = Number(savedLocation.latitude);
      longitude = Number(savedLocation.longitude);
    }

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return NextResponse.json({ ok: false, error: "좌표가 올바르지 않습니다." }, { status: 400 });
    if (latitude === 0 && longitude === 0) return NextResponse.json({ ok: false, error: "현재 위치를 먼저 입력해 주세요." }, { status: 400 });

    if (!locationId) {
      const { data: savedLocation, error: locationError } = await db
        .from("attendance_saved_locations")
        .upsert({ name: locationName, latitude, longitude, created_by: userData.user.id, updated_by: userData.user.id, updated_at: new Date().toISOString() }, { onConflict: "latitude,longitude" })
        .select("id")
        .single();
      if (locationError || !savedLocation) return NextResponse.json({ ok: false, error: locationError?.message || "위치를 저장하지 못했습니다." }, { status: 403 });
      locationId = savedLocation.id;
    }

    const { data, error } = await db.from("attendance_geofences").upsert({ scope: "default", location_id: locationId, name: locationName, latitude, longitude, radius_m: radiusM, dwell_seconds: dwellSeconds, window_start: body.windowStart, window_end: body.windowEnd, timezone: body.timezone || "Asia/Seoul", is_active: body.isActive !== false, updated_by: userData.user.id, updated_at: new Date().toISOString() }, { onConflict: "scope" }).select("*").single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, geofence: data });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}
