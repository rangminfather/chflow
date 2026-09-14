import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function token(req: NextRequest) { const value = req.headers.get("authorization") || ""; return value.startsWith("Bearer ") ? value.slice(7) : null; }

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const accessToken = token(req);
  if (!accessToken) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  const db = createClient(URL, KEY, { global: { headers: { Authorization: `Bearer ${accessToken}` } }, auth: { persistSession: false } });
  const { data: user } = await db.auth.getUser(accessToken);
  if (!user.user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  const { id } = await context.params;
  const { data, error } = await db.from("bulletin_scripture_readings")
    .select("id,service_type,raw_reference,normalized_label,sort_order")
    .eq("bulletin_id", id).eq("status", "verified").order("service_type").order("sort_order");
  // The feature code can be deployed before its additive migration. Keep the
  // bulletin viewer fail-open only for PostgREST's explicit missing-table code.
  if (error?.code === "PGRST205") return NextResponse.json({ ok: true, readings: [] });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, readings: data || [] });
}
