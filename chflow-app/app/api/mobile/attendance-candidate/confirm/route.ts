import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(req: NextRequest) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  if (!SUPABASE_URL || !ANON_KEY) {
    return NextResponse.json({ ok: false, error: "Supabase environment is not configured" }, { status: 500 });
  }

  let candidateId: string | undefined;
  try {
    candidateId = String((await req.json()).candidateId || "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!candidateId) return NextResponse.json({ ok: false, error: "Missing candidateId" }, { status: 400 });

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.rpc("confirm_attendance_candidate", {
    p_candidate_id: candidateId,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, attendance: data });
}

