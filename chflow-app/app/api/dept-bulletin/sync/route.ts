import { NextRequest, NextResponse } from "next/server";
import { syncDeptBulletin } from "@/lib/bulletin/dept-bulletin-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

function hasCronAccess(req: NextRequest) {
  const secrets = [
    process.env.CRON_SECRET,
    process.env.PUSH_DISPATCH_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ].filter((value): value is string => !!value);
  if (secrets.length === 0) return process.env.NODE_ENV !== "production";

  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return secrets.includes(token);
}

async function handler(req: NextRequest) {
  if (!hasCronAccess(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncDeptBulletin();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "부서 주보 수집 실패" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}
