import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function tokenFrom(req: NextRequest) {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export async function GET(req: NextRequest) {
  const token = tokenFrom(req);
  if (!token) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  if (!SUPABASE_URL || !ANON_KEY) {
    return NextResponse.json({ ok: false, error: "Supabase environment is not configured" }, { status: 500 });
  }

  const params = req.nextUrl.searchParams;
  const end = params.get("end") || new Date().toISOString().slice(0, 10);
  const start = params.get("start") || end;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const [attendance, absences] = await Promise.all([
    client.rpc("list_church_attendance_overview", { p_start_date: start, p_end_date: end }),
    client.rpc("list_church_absence_candidates", { p_as_of_date: end, p_weeks: 2 }),
  ]);
  if (attendance.error) return NextResponse.json({ ok: false, error: attendance.error.message }, { status: 403 });
  if (absences.error) return NextResponse.json({ ok: false, error: absences.error.message }, { status: 403 });
  return NextResponse.json({ ok: true, attendance: attendance.data ?? [], absences: absences.data ?? [] });
}

