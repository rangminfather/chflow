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
    const db = client(token);
    const [{ data: locations, error: locationsError }, { data: active, error: activeError }] = await Promise.all([
      db.from("attendance_saved_locations").select("id, name, latitude, longitude, created_at, updated_at").order("updated_at", { ascending: false }),
      db.from("attendance_geofences").select("location_id, latitude, longitude").eq("scope", "default").maybeSingle(),
    ]);
    if (locationsError) return NextResponse.json({ ok: false, error: locationsError.message }, { status: 403 });
    if (activeError) return NextResponse.json({ ok: false, error: activeError.message }, { status: 403 });

    const activeLocationId = active?.location_id ?? null;
    return NextResponse.json({
      ok: true,
      locations: (locations || []).map((location) => ({
        ...location,
        isRegistered: activeLocationId === location.id || (
          !activeLocationId
          && active
          && Number(location.latitude) === Number(active.latitude)
          && Number(location.longitude) === Number(active.longitude)
        ),
      })),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
