import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { localDateInTimeZone } from "@/lib/server/attendance-window";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function bearer(req: NextRequest): string | null {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

export async function GET(req: NextRequest) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  if (!SUPABASE_URL || !ANON_KEY) {
    return NextResponse.json(
      { ok: false, error: "Supabase environment is not configured" },
      { status: 500 },
    );
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const now = new Date();
  const { data: geofence, error: geofenceError } = await client
    .from("attendance_geofences")
    .select("id, name, radius_m, dwell_seconds, window_start, window_end, timezone, is_active")
    .eq("scope", "default")
    .eq("is_active", true)
    .maybeSingle();
  if (geofenceError) {
    return NextResponse.json({ ok: false, error: geofenceError.message }, { status: 400 });
  }

  const timezone = String(geofence?.timezone || "Asia/Seoul");
  const localDate = localDateInTimeZone(now, timezone);
  const { data: memberId, error: memberError } = await client.rpc("current_member_id");
  if (memberError) {
    return NextResponse.json({ ok: false, error: memberError.message }, { status: 400 });
  }

  let candidate = null;
  let attendance = null;
  if (memberId) {
    const [candidateResult, attendanceResult] = await Promise.all([
      client
        .from("attendance_location_candidates")
        .select("status, entered_at, last_seen_at, dwell_seconds, updated_at")
        .eq("member_id", memberId)
        .eq("local_date", localDate)
        .maybeSingle(),
      client
        .from("church_attendance")
        .select("source, recorded_at")
        .eq("member_id", memberId)
        .eq("attend_date", localDate)
        .maybeSingle(),
    ]);
    if (candidateResult.error) {
      return NextResponse.json({ ok: false, error: candidateResult.error.message }, { status: 400 });
    }
    if (attendanceResult.error) {
      return NextResponse.json({ ok: false, error: attendanceResult.error.message }, { status: 400 });
    }
    candidate = candidateResult.data;
    attendance = attendanceResult.data;
  }

  return NextResponse.json({
    ok: true,
    serverTime: now.toISOString(),
    localDate,
    memberLinked: Boolean(memberId),
    geofence: geofence
      ? {
          name: geofence.name,
          radiusM: geofence.radius_m,
          dwellSeconds: geofence.dwell_seconds,
          windowStart: String(geofence.window_start).slice(0, 5),
          windowEnd: String(geofence.window_end).slice(0, 5),
          timezone,
        }
      : null,
    candidate,
    attendance,
  });
}
