import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DISPATCH_SECRET = process.env.PUSH_DISPATCH_SECRET || process.env.CRON_SECRET || "";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH = 100;

type DeliveryRow = {
  id: string;
  notification_id: string;
  user_id: string;
  expo_push_token: string;
  attempts: number;
  notifications: {
    type: string;
    title: string;
    body: string | null;
    link_url: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
};

type ExpoTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: Record<string, unknown>;
};

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (DISPATCH_SECRET && token === DISPATCH_SECRET) return true;
  return token === SERVICE_KEY;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function buildExpoMessage(row: DeliveryRow, badgeCount: number) {
  const notification = row.notifications;
  return {
    to: row.expo_push_token,
    title: notification?.title || "스마트명성",
    body: notification?.body || "",
    sound: "default",
    priority: "high",
    channelId: "default",
    badge: badgeCount,
    data: {
      notificationId: row.notification_id,
      deliveryId: row.id,
      type: notification?.type || "notification",
      linkUrl: notification?.link_url || "/home",
      badge: badgeCount,
      metadata: notification?.metadata || {},
    },
  };
}

async function getUnreadCounts(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, number>> {
  const uniqueUserIds = Array.from(new Set(userIds));
  const entries = await Promise.all(uniqueUserIds.map(async (userId) => {
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    return [userId, count || 0] as const;
  }));

  return new Map(entries);
}

export async function GET(req: NextRequest) {
  return dispatchPush(req);
}

export async function POST(req: NextRequest) {
  return dispatchPush(req);
}

async function dispatchPush(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit") || "100");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
  const now = new Date().toISOString();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: rows, error: selectError } = await admin
    .from("notification_push_deliveries")
    .select(`
      id,
      notification_id,
      user_id,
      expo_push_token,
      attempts,
      notifications:notification_id (
        type,
        title,
        body,
        link_url,
        metadata
      )
    `)
    .in("status", ["queued", "failed"])
    .lt("attempts", 3)
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<DeliveryRow[]>();

  if (selectError) {
    return NextResponse.json({ ok: false, error: selectError.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, picked: 0, sent: 0, failed: 0 });
  }

  const ids = rows.map((row) => row.id);
  await admin
    .from("notification_push_deliveries")
    .update({ status: "sending", updated_at: now })
    .in("id", ids);

  let sent = 0;
  let failed = 0;
  const unreadCounts = await getUnreadCounts(admin, rows.map((row) => row.user_id));

  for (const batch of chunk(rows, MAX_BATCH)) {
    const messages = batch.map((row) => buildExpoMessage(row, unreadCounts.get(row.user_id) || 0));
    let tickets: ExpoTicket[];

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.errors?.[0]?.message || payload?.message || `Expo push HTTP ${response.status}`);
      }
      tickets = Array.isArray(payload?.data) ? payload.data : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : "Expo push request failed";
      failed += batch.length;
      await Promise.all(batch.map((row) =>
        admin
          .from("notification_push_deliveries")
          .update({
            status: row.attempts + 1 >= 3 ? "failed" : "queued",
            attempts: row.attempts + 1,
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
      ));
      continue;
    }

    await Promise.all(batch.map((row, index) => {
      const ticket = tickets[index];
      const ok = ticket?.status === "ok";
      if (ok) sent += 1;
      else failed += 1;

      const errorMessage = ok
        ? null
        : ticket?.message || JSON.stringify(ticket?.details || {}) || "Expo push ticket failed";

      return admin
        .from("notification_push_deliveries")
        .update({
          status: ok ? "sent" : "failed",
          attempts: row.attempts + 1,
          expo_ticket_id: ticket?.id || null,
          error_message: errorMessage,
          sent_at: ok ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }));
  }

  return NextResponse.json({
    ok: true,
    picked: rows.length,
    sent,
    failed,
  });
}
