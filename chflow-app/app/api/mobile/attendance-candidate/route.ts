import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isWithinAttendanceWindow,
  localDateInTimeZone,
} from "@/lib/server/attendance-window";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type CandidateBody = {
  geofenceId?: string;
  localDate?: string;
  source?: "android_geofence" | "ios_region" | "foreground_check";
  enteredAt?: string;
  lastSeenAt?: string;
  dwellSeconds?: number;
  distanceM?: number | null;
  accuracyM?: number | null;
  deviceEventId?: string | null;
};

function bearer(req: NextRequest): string | null {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

function clientFor(token: string) {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error("Supabase environment is not configured");
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function POST(req: NextRequest) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  let body: CandidateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.geofenceId || !body.localDate || !body.source || !body.enteredAt || !body.lastSeenAt) {
    return NextResponse.json({ ok: false, error: "Missing attendance event fields" }, { status: 400 });
  }
  const dwellSeconds = Number(body.dwellSeconds ?? 0);
  if (!Number.isInteger(dwellSeconds) || dwellSeconds < 0 || dwellSeconds > 86400) {
    return NextResponse.json({ ok: false, error: "Invalid dwellSeconds" }, { status: 400 });
  }
  if (Number.isNaN(Date.parse(body.enteredAt)) || Number.isNaN(Date.parse(body.lastSeenAt))) {
    return NextResponse.json({ ok: false, error: "Invalid event timestamp" }, { status: 400 });
  }

  const client = clientFor(token);
  const { data: geofence, error: geofenceError } = await client
    .from("attendance_geofences")
    .select("id, window_start, window_end, timezone")
    .eq("id", body.geofenceId)
    .eq("is_active", true)
    .maybeSingle();
  if (geofenceError) {
    return NextResponse.json({ ok: false, error: geofenceError.message }, { status: 400 });
  }
  if (!geofence) {
    return NextResponse.json({ ok: false, error: "활성화된 자동출석 위치가 없습니다." }, { status: 409 });
  }

  const requestTime = new Date();
  if (!isWithinAttendanceWindow(
    requestTime,
    String(geofence.window_start),
    String(geofence.window_end),
    String(geofence.timezone || "Asia/Seoul"),
  )) {
    return NextResponse.json({ ok: false, error: "자동출석 운영시간이 아닙니다." }, { status: 409 });
  }
  const expectedLocalDate = localDateInTimeZone(
    requestTime,
    String(geofence.timezone || "Asia/Seoul"),
  );
  if (body.localDate !== expectedLocalDate) {
    return NextResponse.json({ ok: false, error: "출석 날짜가 올바르지 않습니다." }, { status: 400 });
  }

  const { data, error } = await client.rpc("submit_attendance_candidate", {
    p_geofence_id: body.geofenceId,
    p_local_date: body.localDate,
    p_source: body.source,
    p_entered_at: body.enteredAt,
    p_last_seen_at: body.lastSeenAt,
    p_dwell_seconds: dwellSeconds,
    p_distance_m: body.distanceM ?? null,
    p_accuracy_m: body.accuracyM ?? null,
    p_device_event_id: body.deviceEventId ?? null,
  });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, candidate: data });
}

