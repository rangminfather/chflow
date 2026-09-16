import { NextRequest, NextResponse } from "next/server";
import { authorize, tokenFrom } from "@/lib/uth/access";
import { getDevice, toPublic } from "@/lib/uth/registry";
import { readStatus, UthError } from "@/lib/uth/client";
import { deriveDisplay } from "@/lib/uth/protocol";
import { allow } from "@/lib/uth/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "icn1";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const a = await authorize(tokenFrom(req));
  if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });

  let body: { deviceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청" }, { status: 400 });
  }
  const device = body.deviceId ? getDevice(body.deviceId) : null;
  if (!device) return NextResponse.json({ ok: false, error: "장비를 찾을 수 없습니다" }, { status: 404 });

  if (!device.mac || device.planned) {
    return NextResponse.json({ ok: true, device: toPublic(device), online: false, planned: true, state: null });
  }

  if (!allow(`status:${device.id}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "요청이 너무 잦습니다" }, { status: 429 });
  }

  try {
    const { state } = await readStatus(device.mac);
    return NextResponse.json({
      ok: true,
      device: toPublic(device),
      online: true,
      state: deriveDisplay(state),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    const err = e as UthError;
    const offline = err.stage === "status" || err.stage === "connect" || err.stage === "lookup";
    return NextResponse.json({
      ok: true,
      device: toPublic(device),
      online: false,
      state: null,
      error: err.message,
      offline,
      updatedAt: new Date().toISOString(),
    });
  }
}
