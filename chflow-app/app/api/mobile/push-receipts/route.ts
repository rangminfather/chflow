import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RECEIPT_SECRET = process.env.PUSH_DISPATCH_SECRET || process.env.CRON_SECRET || "";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
// Expo 는 영수증을 24시간만 보관한다. 그 시간이 지난 발송 건은 조회해도 영영 응답이 없으므로
// sent 로 남겨두면 오래된 순 정렬에 계속 먼저 걸려 새 발송 건까지 확인을 막는다(큐 고착).
const RECEIPT_WINDOW_MS = 24 * 60 * 60 * 1000;

type DeliveryRow = {
  id: string;
  push_token_id: string | null;
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
  if (RECEIPT_SECRET && token === RECEIPT_SECRET) return true;
  return token === SERVICE_KEY;
}

function readLimit(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("limit") || "300");
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 1000) : 300;
}

async function disablePushToken(admin: SupabaseClient, row: DeliveryRow, now: string) {
  if (row.push_token_id) {
    await admin
      .from("user_push_tokens")
      .update({ enabled: false, updated_at: now })
      .eq("id", row.push_token_id);
    return;
  }

  await admin
    .from("user_push_tokens")
    .update({ enabled: false, updated_at: now })
    .eq("expo_push_token", row.expo_push_token);
}

function receiptErrorMessage(receipt: ExpoReceipt): string {
  if (receipt.message) return receipt.message;
  if (receipt.details) return JSON.stringify(receipt.details);
  return "Expo push receipt failed";
}

export async function GET(req: NextRequest) {
  return pollReceipts(req);
}

export async function POST(req: NextRequest) {
  return pollReceipts(req);
}

async function pollReceipts(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const limit = readLimit(req);
  const windowStart = new Date(Date.now() - RECEIPT_WINDOW_MS).toISOString();

  // 보관 기간이 지나 확인할 수 없게 된 건은 먼저 종결시킨다. 그러지 않으면 매 실행마다
  // 같은 행만 다시 집어와 정작 새 발송 건의 영수증을 못 본다.
  const { data: expiredRows, error: expireError } = await admin
    .from("notification_push_deliveries")
    .update({
      status: "skipped",
      error_message: "Expo 영수증 보관 기간(24시간) 경과로 전달 여부 확인 불가",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "sent")
    .lt("updated_at", windowStart)
    .select("id");

  if (expireError) {
    return NextResponse.json({ ok: false, error: expireError.message }, { status: 500 });
  }
  const expired = expiredRows?.length ?? 0;

  const { data: rows, error: selectError } = await admin
    .from("notification_push_deliveries")
    .select("id, push_token_id, expo_push_token, expo_ticket_id")
    .eq("status", "sent")
    .not("expo_ticket_id", "is", null)
    .gte("updated_at", windowStart)
    .order("updated_at", { ascending: true })
    .limit(limit)
    .returns<DeliveryRow[]>();

  if (selectError) {
    return NextResponse.json({ ok: false, error: selectError.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, delivered: 0, failed: 0, pending: 0, expired, disabled_tokens: 0 });
  }

  let receipts: Record<string, ExpoReceipt>;
  try {
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: rows.map((row) => row.expo_ticket_id) }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.errors?.[0]?.message || payload?.message || `Expo receipt HTTP ${response.status}`);
    }
    receipts = payload?.data && typeof payload.data === "object" ? payload.data : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "Expo receipt request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const now = new Date().toISOString();
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  let disabledTokens = 0;

  await Promise.all(rows.map(async (row) => {
    const receipt = receipts[row.expo_ticket_id];
    if (!receipt) {
      pending += 1;
      return;
    }

    if (receipt.status === "ok") {
      delivered += 1;
      await admin
        .from("notification_push_deliveries")
        .update({ status: "delivered", error_message: null, updated_at: now })
        .eq("id", row.id);
      return;
    }

    failed += 1;
    const details = receipt.details || {};
    const shouldDisableToken = details.error === "DeviceNotRegistered";

    await admin
      .from("notification_push_deliveries")
      .update({
        status: "failed",
        error_message: receiptErrorMessage(receipt),
        updated_at: now,
      })
      .eq("id", row.id);

    if (shouldDisableToken) {
      await disablePushToken(admin, row, now);
      disabledTokens += 1;
    }
  }));

  return NextResponse.json({
    ok: true,
    checked: rows.length,
    delivered,
    failed,
    pending,
    expired,
    disabled_tokens: disabledTokens,
  });
}
