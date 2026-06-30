import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || process.env.PUSH_DISPATCH_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (CRON_SECRET && token === CRON_SECRET) return true;
  return !!SERVICE_KEY && token === SERVICE_KEY;
}

function readLimit(req: NextRequest, name: string, fallback: number, max: number): number {
  const raw = Number(req.nextUrl.searchParams.get(name) || String(fallback));
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 1), max) : fallback;
}

async function callJson(url: string, authorization: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: authorization },
  });
  const body = await response.json().catch(() => ({
    ok: false,
    error: `HTTP ${response.status}`,
  }));

  return {
    ok: response.ok && body?.ok !== false,
    status: response.status,
    body,
  };
}

export async function GET(req: NextRequest) {
  return runPushMaintenance(req);
}

export async function POST(req: NextRequest) {
  return runPushMaintenance(req);
}

async function runPushMaintenance(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const dispatchLimit = readLimit(req, "dispatch_limit", 100, 500);
  const receiptLimit = readLimit(req, "receipt_limit", 300, 1000);
  const authorization = req.headers.get("Authorization") || `Bearer ${CRON_SECRET || SERVICE_KEY}`;
  const origin = req.nextUrl.origin;

  const dispatch = await callJson(
    `${origin}/api/mobile/push-dispatch?limit=${dispatchLimit}`,
    authorization
  );
  const receipts = await callJson(
    `${origin}/api/mobile/push-receipts?limit=${receiptLimit}`,
    authorization
  );
  const ok = dispatch.ok && receipts.ok;

  return NextResponse.json(
    {
      ok,
      dispatch: dispatch.body,
      receipts: receipts.body,
    },
    { status: ok ? 200 : 502 }
  );
}
