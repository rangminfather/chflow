import { NextRequest, NextResponse } from "next/server";
import { authorize, tokenFrom } from "@/lib/uth/access";
import { listDevices, toPublic } from "@/lib/uth/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "icn1";

export async function GET(req: NextRequest) {
  const a = await authorize(tokenFrom(req));
  if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });
  return NextResponse.json({ ok: true, devices: listDevices().map(toPublic) });
}
