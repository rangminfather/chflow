import { NextRequest, NextResponse } from "next/server";
import { authorize, tokenFrom } from "@/lib/uth/access";
import { getDevice, toPublic } from "@/lib/uth/registry";
import { sendControl, sendStep, UthError } from "@/lib/uth/client";
import { deriveDisplay, type ControlCommand } from "@/lib/uth/protocol";
import { allow } from "@/lib/uth/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "icn1";
export const maxDuration = 30;

type Action = "power" | "setValue" | "lock" | "step";

export async function POST(req: NextRequest) {
  const a = await authorize(tokenFrom(req));
  if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });

  let body: { deviceId?: string; action?: Action; on?: boolean; value?: number; dir?: "up" | "down" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청" }, { status: 400 });
  }
  const device = body.deviceId ? getDevice(body.deviceId) : null;
  if (!device) return NextResponse.json({ ok: false, error: "장비를 찾을 수 없습니다" }, { status: 404 });
  if (!device.mac || device.planned || !device.controlEnabled) {
    return NextResponse.json({ ok: false, error: "아직 설치되지 않았거나 제어가 비활성화된 장비입니다" }, { status: 403 });
  }

  // per-device throttle: min gap + burst cap
  if (!allow(`ctl-gap:${device.id}`, 1, 3_000) || !allow(`ctl-min:${device.id}`, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "제어 요청이 너무 잦습니다 (잠시 후 다시)" }, { status: 429 });
  }

  const cmd: ControlCommand = {};
  let stepDir: 1 | -1 | null = null;
  if (body.action === "power") {
    if (typeof body.on !== "boolean") return NextResponse.json({ ok: false, error: "on(boolean) 필요" }, { status: 400 });
    cmd.power = body.on;
  } else if (body.action === "setValue") {
    if (typeof body.value !== "number" || body.value < 0 || body.value > 70) {
      return NextResponse.json({ ok: false, error: "value 범위 오류(0~70)" }, { status: 400 });
    }
    cmd.setValue = Math.round(body.value);
  } else if (body.action === "lock") {
    if (typeof body.on !== "boolean") return NextResponse.json({ ok: false, error: "on(boolean) 필요" }, { status: 400 });
    cmd.lock = body.on;
  } else if (body.action === "step") {
    if (body.dir !== "up" && body.dir !== "down") return NextResponse.json({ ok: false, error: "dir(up/down) 필요" }, { status: 400 });
    stepDir = body.dir === "up" ? 1 : -1;
  } else {
    return NextResponse.json({ ok: false, error: "알 수 없는 action" }, { status: 400 });
  }

  try {
    const { before, after, sent } =
      stepDir !== null ? await sendStep(device.mac, stepDir) : await sendControl(device.mac, cmd);
    // audit (interim: console; DB audit table is the church/productization step)
    console.log(
      `[UTH-AUDIT] user=${a.caller.name}(${a.caller.role}) device=${device.id}/${device.roomNo} action=${body.action} ` +
        `req=${JSON.stringify(cmd)} sent=${sent} before.pwT=${before.power} after.pwT=${after.power} run=${after.run}`
    );
    return NextResponse.json({
      ok: true,
      device: toPublic(device),
      before: deriveDisplay(before),
      after: deriveDisplay(after),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    const err = e as UthError;
    console.log(`[UTH-AUDIT] user=${a.caller.name} device=${device.id} action=${body.action} FAILED stage=${err.stage} ${err.message}`);
    return NextResponse.json({ ok: false, error: `제어 실패: ${err.message}` }, { status: 502 });
  }
}
