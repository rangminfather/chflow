import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function positiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return new NextResponse(null, { status: 401 });

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return new NextResponse(null, { status: 401 });

  const { data, error } = await client.rpc("admin_usage_diagnostics", { p_days: 30 });
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") {
      return NextResponse.json(
        { error: "usage_diagnostics_migration_required" },
        { status: 503 },
      );
    }
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "usage_diagnostics_forbidden" },
        { status: 403 },
      );
    }

    // SQL, schema, query text나 인증 정보를 client/log에 노출하지 않는다.
    console.error("[usage-diagnostics] RPC failed", { code: error.code || "unknown" });
    return NextResponse.json(
      { error: "usage_diagnostics_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...(data as Record<string, unknown>),
    db_quota_bytes: positiveInteger(process.env.SUPABASE_DB_QUOTA_BYTES),
  }, { headers: { "Cache-Control": "no-store" } });
}
