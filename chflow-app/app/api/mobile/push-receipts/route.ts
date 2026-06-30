import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DISPATCH_SECRET = process.env.PUSH_DISPATCH_SECRET || process.env.CRON_SECRET || "";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

type DeliveryRow = {
  id: string;
  user_id: string;
  expo_push_token: string;
  expo_ticket_id: string;
};

type ExpoReceipt = {
  status?: "ok" | "error";
  message?: string;
  details?: Record<string, unknown>;
};

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (DISPATCH_SECRET && token === DISPATCH_SECRET) return true;
  return token === SERVICE_KEY;
}

function isDeviceNotRegistered(receipt: ExpoReceipt | undefined): boolean {
  return receipt?.details?.error === "DeviceNotRegistered";
}

export async function GET(req: NextRequest) {
  return fetchPushReceipts(req);
}

export async function POST(req: NextRequest) {
  return fetchPushReceipts(req);
}

async function fetchPushReceipts(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit") || "100");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 300) : 100;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: rows, error: selectError } = await admin
    .from("notification_push_deliveries")
    .select("id, user_id, expo_push_token, expo_ticket_id")
    .eq("status", "sent")
    .not("expo_ticket_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit)
    .returns<DeliveryRow[]>();

  if (selectError) {
    return NextResponse.json({ ok: false, error: selectError.message }, { status: 500 });
  }

  const ids = (rows || []).map((row) => row.expo_ticket_id).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, failed: 0, disabled_tokens: 0 });
  }

  let payload: { data?: Record<string, ExpoReceipt>; errors?: Array<{ message?: string }>; message?: string };
  try {
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.errors?.[0]?.message || payload?.message || `Expo receipts HTTP ${response.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Expo receipt request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  let failed = 0;
  let disabledTokens = 0;
  const now = new Date().toISOString();
  const receiptMap = payload.data || {};

  await Promise.all((rows || []).map(async (row) => {
    const receipt = receiptMap[row.expo_ticket_id];
    if (!receipt) return;

    const failedReceipt = receipt.status === "error";
    if (failedReceipt) failed += 1;

    if (isDeviceNotRegistered(receipt)) {
      const { error: disableError } = await admin
        .from("user_push_tokens")
        .update({ enabled: false, updated_at: now })
        .eq("user_id", row.user_id)
        .eq("expo_push_token", row.expo_push_token);
      if (!disableError) disabledTokens += 1;
    }

    const errorMessage = failedReceipt
      ? receipt.message || JSON.stringify(receipt.details || {}) || "Expo push receipt failed"
      : null;

    await admin
      .from("notification_push_deliveries")
      .update({
        status: failedReceipt ? "failed" : "sent",
        error_message: errorMessage,
        updated_at: now,
      })
      .eq("id", row.id);
  }));

  return NextResponse.json({
    ok: true,
    checked: rows?.length || 0,
    failed,
    disabled_tokens: disabledTokens,
  });
}
