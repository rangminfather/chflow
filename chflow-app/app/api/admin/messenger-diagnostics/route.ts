import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProfileRow = {
  id: string;
  name: string | null;
  username: string | null;
  role: string | null;
  sub_role: string | null;
  avatar_url: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

type ConversationRow = {
  id: string;
  type: string;
  title: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_message_id: string | null;
};

type ParticipantRow = {
  conversation_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  last_read_at: string | null;
  archived_at: string | null;
  muted_until: string | null;
};

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link_url: string | null;
  is_read: boolean | null;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
};

type DeliveryRow = {
  id: string;
  notification_id: string;
  user_id: string;
  push_token_id: string | null;
  expo_push_token: string;
  status: string;
  attempts: number;
  expo_ticket_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type TokenRow = {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: string;
  device_id: string | null;
  app_id: string;
  enabled: boolean;
  last_seen_at: string;
  updated_at: string;
};

type BlockRow = {
  blocker_id: string;
  blocked_id: string;
};

async function getCaller(req: NextRequest): Promise<{ id: string; role: string } | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const userClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !["admin", "office", "pastor"].includes(profile.role)) return null;
  return { id: profile.id, role: profile.role };
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

async function loadProfiles(admin: SupabaseClient, userIds: string[]) {
  const ids = unique(userIds);
  if (ids.length === 0) return new Map<string, ProfileRow>();

  const { data } = await admin
    .from("profiles")
    .select("id, name, username, role, sub_role, avatar_url")
    .in("id", ids);

  return new Map(((data || []) as ProfileRow[]).map((row) => [row.id, row]));
}

// .or() 문자열은 검색어에 쉼표·괄호가 들어가면 문법이 깨지므로 개별 쿼리로 분리
async function searchProfiles(admin: SupabaseClient, query: string, uuid: boolean): Promise<ProfileRow[]> {
  const select = "id, name, username, role, sub_role, avatar_url";
  if (uuid) {
    const { data } = await admin.from("profiles").select(select).eq("id", query).limit(20);
    return (data || []) as ProfileRow[];
  }
  const [byName, byUsername] = await Promise.all([
    admin.from("profiles").select(select).ilike("name", `%${query}%`).limit(20),
    admin.from("profiles").select(select).ilike("username", `%${query}%`).limit(20),
  ]);
  return uniqueRows<ProfileRow>([
    ...((byName.data || []) as ProfileRow[]),
    ...((byUsername.data || []) as ProfileRow[]),
  ]).slice(0, 20);
}

function metadataValue(row: NotificationRow, key: string): string | null {
  const value = row.metadata?.[key];
  return typeof value === "string" ? value : null;
}

function buildFlags(
  messages: MessageRow[],
  participants: ParticipantRow[],
  notifications: NotificationRow[],
  deliveries: DeliveryRow[],
  tokens: TokenRow[],
  blocks: BlockRow[]
) {
  const flags: { level: "warn" | "error" | "info"; text: string }[] = [];
  const activeTokenUsers = new Set(tokens.filter((token) => token.enabled).map((token) => token.user_id));
  const blockedPairs = new Set<string>();
  for (const block of blocks) {
    blockedPairs.add(`${block.blocker_id}:${block.blocked_id}`);
    blockedPairs.add(`${block.blocked_id}:${block.blocker_id}`);
  }
  const tokenWarned = new Set<string>();

  for (const message of messages) {
    const sentAt = new Date(message.created_at).getTime();
    // 발송 RPC(send_messenger_message_v2)와 동일 기준:
    //   mute 중·차단 관계는 알림을 만들지 않음 / archived 는 알림 받음 / 발송 이후 참여자는 대상 아님
    const expectedRecipients = participants
      .filter((row) =>
        row.conversation_id === message.conversation_id
        && row.user_id !== message.sender_id
        && new Date(row.joined_at).getTime() <= sentAt
        && !(row.muted_until && new Date(row.muted_until).getTime() > sentAt)
        && !blockedPairs.has(`${message.sender_id}:${row.user_id}`))
      .map((row) => row.user_id);
    const messageNotifications = notifications.filter((row) => metadataValue(row, "message_id") === message.id);
    const notifiedUsers = new Set(messageNotifications.map((row) => row.user_id));

    for (const userId of expectedRecipients) {
      if (!notifiedUsers.has(userId)) {
        flags.push({ level: "error", text: `message ${message.id} recipient ${userId} has no message_new notification` });
      }
      if (!activeTokenUsers.has(userId) && !tokenWarned.has(userId)) {
        tokenWarned.add(userId);
        flags.push({ level: "warn", text: `recipient ${userId} has no active push token` });
      }
    }
  }

  const duplicateKeys = new Map<string, number>();
  for (const row of notifications) {
    const messageId = metadataValue(row, "message_id");
    if (!messageId || row.type !== "message_new") continue;
    const key = `${row.user_id}:${messageId}`;
    duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
  }
  for (const [key, count] of duplicateKeys) {
    if (count > 1) flags.push({ level: "error", text: `duplicate message_new notifications: ${key} (${count})` });
  }

  const failed = deliveries.filter((row) => row.status === "failed");
  if (failed.length > 0) flags.push({ level: "warn", text: `${failed.length} push delivery rows are failed` });

  const queued = deliveries.filter((row) => row.status === "queued" || row.status === "sending");
  if (queued.length > 0) flags.push({ level: "info", text: `${queued.length} push delivery rows are still pending dispatch` });

  const activeDeviceKeys = new Map<string, number>();
  for (const token of tokens.filter((row) => row.enabled && row.device_id)) {
    const key = `${token.user_id}:${token.platform}:${token.app_id}:${token.device_id}`;
    activeDeviceKeys.set(key, (activeDeviceKeys.get(key) || 0) + 1);
  }
  for (const [key, count] of activeDeviceKeys) {
    if (count > 1) flags.push({ level: "warn", text: `multiple active push tokens for one user/device: ${key} (${count})` });
  }

  const participantByUserConversation = new Map(
    participants.map((row) => [`${row.user_id}:${row.conversation_id}`, row])
  );
  for (const delivery of deliveries.filter((row) => row.status !== "skipped")) {
    const notification = notifications.find((row) => row.id === delivery.notification_id);
    const conversationId = notification ? metadataValue(notification, "conversation_id") : null;
    if (!conversationId) continue;
    const participant = participantByUserConversation.get(`${delivery.user_id}:${conversationId}`);
    // 발송 시점 기준으로 mute 였는지 판정 (지금 mute 라고 과거 발송이 잘못은 아님)
    if (participant?.muted_until && new Date(participant.muted_until).getTime() > new Date(delivery.created_at).getTime()) {
      flags.push({ level: "warn", text: `push delivery exists while recipient is muted: ${delivery.user_id}:${conversationId}` });
    }
  }

  return flags;
}

export async function GET(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const recent = req.nextUrl.searchParams.get("recent") === "1";
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!recent && q.length < 2) {
    return NextResponse.json({ ok: false, error: "Query must be at least 2 characters" }, { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const uuid = !recent && isUuid(q);
  const matchedProfiles = recent ? [] : await searchProfiles(admin, q, uuid);
  const matchedUserIds = matchedProfiles.map((row) => row.id);

  let messages: MessageRow[] = [];
  if (recent) {
    // 자동 점검 모드 — 최근 48시간 메시지 전수 (검색어 불필요)
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("messenger_messages")
      .select("id, conversation_id, sender_id, kind, body, created_at, edited_at, deleted_at")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(50);
    messages = (data || []) as MessageRow[];
  } else if (uuid) {
    const { data } = await admin
      .from("messenger_messages")
      .select("id, conversation_id, sender_id, kind, body, created_at, edited_at, deleted_at")
      .or(`id.eq.${q},conversation_id.eq.${q},sender_id.eq.${q}`)
      .order("created_at", { ascending: false })
      .limit(30);
    messages = (data || []) as MessageRow[];
  } else {
    const { data } = await admin
      .from("messenger_messages")
      .select("id, conversation_id, sender_id, kind, body, created_at, edited_at, deleted_at")
      .ilike("body", `%${q}%`)
      .order("created_at", { ascending: false })
      .limit(20);
    messages = (data || []) as MessageRow[];
  }

  let notifications: NotificationRow[] = [];
  if (recent) {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("notifications")
      .select("id, user_id, type, title, body, link_url, is_read, created_by, metadata, created_at, read_at")
      .eq("type", "message_new")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(300);
    notifications = (data || []) as NotificationRow[];
  } else if (uuid) {
    const [byId, byMessage, byConversation, byUser] = await Promise.all([
      admin
        .from("notifications")
        .select("id, user_id, type, title, body, link_url, is_read, created_by, metadata, created_at, read_at")
        .eq("id", q)
        .limit(1),
      admin
        .from("notifications")
        .select("id, user_id, type, title, body, link_url, is_read, created_by, metadata, created_at, read_at")
        .contains("metadata", { message_id: q })
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("notifications")
        .select("id, user_id, type, title, body, link_url, is_read, created_by, metadata, created_at, read_at")
        .contains("metadata", { conversation_id: q })
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("notifications")
        .select("id, user_id, type, title, body, link_url, is_read, created_by, metadata, created_at, read_at")
        .eq("user_id", q)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    notifications = uniqueRows<NotificationRow>([
      ...((byId.data || []) as NotificationRow[]),
      ...((byMessage.data || []) as NotificationRow[]),
      ...((byConversation.data || []) as NotificationRow[]),
      ...((byUser.data || []) as NotificationRow[]),
    ]);
  } else {
    const [byTitle, byBody, byUsers] = await Promise.all([
      admin
        .from("notifications")
        .select("id, user_id, type, title, body, link_url, is_read, created_by, metadata, created_at, read_at")
        .ilike("title", `%${q}%`)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("notifications")
        .select("id, user_id, type, title, body, link_url, is_read, created_by, metadata, created_at, read_at")
        .ilike("body", `%${q}%`)
        .order("created_at", { ascending: false })
        .limit(50),
      matchedUserIds.length > 0
        ? admin
          .from("notifications")
          .select("id, user_id, type, title, body, link_url, is_read, created_by, metadata, created_at, read_at")
          .in("user_id", matchedUserIds)
          .order("created_at", { ascending: false })
          .limit(100)
        : Promise.resolve({ data: [] }),
    ]);
    notifications = uniqueRows<NotificationRow>([
      ...((byTitle.data || []) as NotificationRow[]),
      ...((byBody.data || []) as NotificationRow[]),
      ...((byUsers.data || []) as NotificationRow[]),
    ]);
  }

  let conversationIds = unique([
    ...messages.map((row) => row.conversation_id),
    ...notifications.map((row) => metadataValue(row, "conversation_id")).filter((value): value is string => !!value),
    uuid ? q : "",
  ]);
  const messageIds = unique([
    ...messages.map((row) => row.id),
    ...notifications.map((row) => metadataValue(row, "message_id")).filter((value): value is string => !!value),
    uuid ? q : "",
  ]);

  if (matchedUserIds.length > 0) {
    const { data: userParticipantRows } = await admin
      .from("messenger_participants")
      .select("conversation_id")
      .in("user_id", matchedUserIds)
      .order("joined_at", { ascending: false })
      .limit(100);

    conversationIds = unique([
      ...conversationIds,
      ...((userParticipantRows || []) as Pick<ParticipantRow, "conversation_id">[]).map((row) => row.conversation_id),
    ]);
  }

  if (messages.length === 0 && messageIds.length > 0) {
    const { data } = await admin
      .from("messenger_messages")
      .select("id, conversation_id, sender_id, kind, body, created_at, edited_at, deleted_at")
      .in("id", messageIds)
      .order("created_at", { ascending: false })
      .limit(30);
    messages = (data || []) as MessageRow[];
  }

  // recent 모드는 48시간 창으로 이미 완결 — 대화 전체로 확장하면 알림 조회 창(48h) 밖
  // 메시지가 "알림 누락" 오탐을 만들므로 검색 모드에서만 확장
  if (!recent && conversationIds.length > 0) {
    const { data } = await admin
      .from("messenger_messages")
      .select("id, conversation_id, sender_id, kind, body, created_at, edited_at, deleted_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(50);
    messages = uniqueRows<MessageRow>([
      ...messages,
      ...((data || []) as MessageRow[]),
    ]);
  }

  const [conversationResult, participantResult] = await Promise.all([
    conversationIds.length > 0
      ? admin
        .from("messenger_conversations")
        .select("id, type, title, created_by, created_at, updated_at, last_message_id")
        .in("id", conversationIds)
      : Promise.resolve({ data: [] }),
    conversationIds.length > 0
      ? admin
        .from("messenger_participants")
        .select("conversation_id, user_id, role, joined_at, last_read_at, archived_at, muted_until")
        .in("conversation_id", conversationIds)
        .order("joined_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const notificationIds = notifications.map((row) => row.id);
  const { data: deliveryData } = notificationIds.length > 0
    ? await admin
      .from("notification_push_deliveries")
      .select("id, notification_id, user_id, push_token_id, expo_push_token, status, attempts, expo_ticket_id, error_message, sent_at, created_at, updated_at")
      .in("notification_id", notificationIds)
      .order("created_at", { ascending: false })
      .limit(200)
    : { data: [] };

  const participants = (participantResult.data || []) as ParticipantRow[];
  const deliveries = (deliveryData || []) as DeliveryRow[];
  const userIds = unique([
    ...matchedUserIds,
    ...messages.map((row) => row.sender_id),
    ...participants.map((row) => row.user_id),
    ...notifications.map((row) => row.user_id),
    ...notifications.map((row) => row.created_by || ""),
    ...deliveries.map((row) => row.user_id),
  ]);
  const [profiles, tokenResult, blockResult] = await Promise.all([
    loadProfiles(admin, userIds),
    userIds.length > 0
      ? admin
        .from("user_push_tokens")
        .select("id, user_id, expo_push_token, platform, device_id, app_id, enabled, last_seen_at, updated_at")
        .in("user_id", userIds)
        .order("last_seen_at", { ascending: false })
        .limit(200)
      : Promise.resolve({ data: [] }),
    // 차단 관계 — 발송 RPC 가 차단 시 알림을 만들지 않으므로 플래그 판정에 필요 (소규모 테이블 전량)
    admin.from("messenger_user_blocks").select("blocker_id, blocked_id").limit(1000),
  ]);
  const tokens = (tokenResult.data || []) as TokenRow[];
  const blocks = (blockResult.data || []) as BlockRow[];
  const profileObject = Object.fromEntries(profiles.entries());

  return NextResponse.json({
    ok: true,
    query: q,
    caller,
    counts: {
      messages: messages.length,
      conversations: ((conversationResult.data || []) as ConversationRow[]).length,
      participants: participants.length,
      notifications: notifications.length,
      deliveries: deliveries.length,
      tokens: tokens.length,
    },
    flags: buildFlags(messages, participants, notifications, deliveries, tokens, blocks),
    mode: recent ? "recent" : "search",
    matched_users: matchedProfiles,
    profiles: profileObject,
    conversations: (conversationResult.data || []) as ConversationRow[],
    participants,
    messages,
    notifications,
    deliveries,
    tokens,
  });
}

function uniqueRows<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
