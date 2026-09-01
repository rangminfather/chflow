import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  OPS_NOTIFICATION_ROLES,
  notificationAllowed,
  type NotificationPreferences,
} from "@/lib/notificationPreferences";

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

async function disablePushToken(admin: SupabaseClient, row: DeliveryRow, now: string) {
  await admin
    .from("user_push_tokens")
    .update({ enabled: false, updated_at: now })
    .eq("expo_push_token", row.expo_push_token);
}

// 휴대폰 배지 숫자는 알림벨이 보여주는 개수와 같아야 한다.
// service role 은 RLS 를 우회하므로 audience 조건을 여기서 직접 맞춘다.
// (운영 권한이 없는 사용자는 자신의 과거 ops 알림까지 배지에 세지 않는다)
async function getUnreadCounts(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, number>> {
  const uniqueUserIds = Array.from(new Set(userIds));
  const { data: roleRows } = await admin
    .from("profiles")
    .select("id, role")
    .in("id", uniqueUserIds);
  const opsRoles = OPS_NOTIFICATION_ROLES as readonly string[];
  const opsViewers = new Set(
    ((roleRows ?? []) as Array<{ id: string; role: string | null }>)
      .filter((row) => opsRoles.includes(row.role ?? ""))
      .map((row) => row.id),
  );

  const entries = await Promise.all(uniqueUserIds.map(async (userId) => {
    let query = admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (!opsViewers.has(userId)) query = query.eq("audience", "user");
    const { count } = await query;

    return [userId, count || 0] as const;
  }));

  return new Map(entries);
}

export async function GET(req: NextRequest) {
  return dispatchPush(req, null);
}

export async function POST(req: NextRequest) {
  let deliveryId: string | null = null;
  try {
    const body = await req.json() as { delivery_id?: unknown };
    if (typeof body.delivery_id === "string" && body.delivery_id.trim()) {
      deliveryId = body.delivery_id.trim();
    }
  } catch {
    // Manual dispatch requests may intentionally omit a JSON body.
  }

  return dispatchPush(req, deliveryId);
}

async function dispatchPush(req: NextRequest, requestedDeliveryId: string | null) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit") || "100");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
  const now = new Date().toISOString();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let deliveryQuery = admin
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
    .order("created_at", { ascending: true });

  if (requestedDeliveryId) {
    deliveryQuery = deliveryQuery.eq("id", requestedDeliveryId);
  }

  const { data: rows, error: selectError } = await deliveryQuery
    .limit(requestedDeliveryId ? 1 : limit)
    .returns<DeliveryRow[]>();

  if (selectError) {
    return NextResponse.json({ ok: false, error: selectError.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, picked: 0, sent: 0, failed: 0 });
  }

  const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
  const { data: preferenceRows, error: preferenceError } = await admin
    .from("notification_preferences")
    .select("user_id, enabled, push_enabled, in_app_enabled, message_enabled, worship_enabled, worship_end_enabled, notice_enabled, department_enabled, education_enabled, pasture_enabled, feedback_enabled, account_enabled, system_enabled, ops_signup_enabled, ops_feedback_enabled")
    .in("user_id", userIds);
  if (preferenceError) {
    return NextResponse.json({ ok: false, error: preferenceError.message }, { status: 500 });
  }
  const preferenceMap = new Map(
    (preferenceRows || []).map((row) => [row.user_id, row as NotificationPreferences & { user_id: string }] as const),
  );
  const allowedRows = rows.filter((row) => notificationAllowed(
    preferenceMap.get(row.user_id) || DEFAULT_NOTIFICATION_PREFERENCES,
    row.notifications?.type || "notification",
    "push",
  ));
  const skippedRows = rows.filter((row) => !allowedRows.some((allowed) => allowed.id === row.id));
  if (skippedRows.length > 0) {
    await admin
      .from("notification_push_deliveries")
      .update({ status: "skipped", error_message: "Disabled by notification preferences", updated_at: now })
      .in("id", skippedRows.map((row) => row.id))
      .in("status", ["queued", "failed"]);
  }
  if (allowedRows.length === 0) {
    return NextResponse.json({ ok: true, picked: rows.length, skipped: skippedRows.length, sent: 0, failed: 0 });
  }

  // A notification INSERT creates one database webhook per delivery row. Those
  // webhooks can reach this route concurrently, so claim every row with a
  // conditional update before sending. Only the request that changes queued or
  // failed -> sending owns the delivery.
  const { data: claimedRows, error: claimError } = await admin
    .from("notification_push_deliveries")
    .update({ status: "sending", updated_at: now })
    .in("id", allowedRows.map((row) => row.id))
    .in("status", ["queued", "failed"])
    .select("id, attempts")
    .returns<Array<{ id: string; attempts: number }>>();

  if (claimError) {
    return NextResponse.json({ ok: false, error: claimError.message }, { status: 500 });
  }

  const claimedAttempts = new Map(
    (claimedRows || []).map((row) => [row.id, row.attempts] as const)
  );
  const claimed = allowedRows
    .filter((row) => claimedAttempts.has(row.id))
    .map((row) => ({ ...row, attempts: claimedAttempts.get(row.id)! }));

  if (claimed.length === 0) {
    return NextResponse.json({ ok: true, picked: rows.length, skipped: skippedRows.length, claimed: 0, sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;
  const unreadCounts = await getUnreadCounts(admin, claimed.map((row) => row.user_id));

  for (const batch of chunk(claimed, MAX_BATCH)) {
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

    await Promise.all(batch.map(async (row, index) => {
      const ticket = tickets[index];
      const ok = ticket?.status === "ok";
      if (ok) sent += 1;
      else failed += 1;

      const errorMessage = ok
        ? null
        : ticket?.message || JSON.stringify(ticket?.details || {}) || "Expo push ticket failed";

      await admin
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

      if (!ok && ticket?.details?.error === "DeviceNotRegistered") {
        await disablePushToken(admin, row, new Date().toISOString());
      }
    }));
  }

  return NextResponse.json({
    ok: true,
    picked: rows.length,
    skipped: skippedRows.length,
    claimed: claimed.length,
    sent,
    failed,
  });
}
