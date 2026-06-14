import { NextRequest, NextResponse } from "next/server";
import { syncJuboBulletin } from "@/lib/bulletin/jubo-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

function hasCronAccess(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("Authorization") || "";
  return auth === `Bearer ${secret}`;
}

async function handler(req: NextRequest) {
  if (!hasCronAccess(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncJuboBulletin();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "주보 수집 실패" },
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
