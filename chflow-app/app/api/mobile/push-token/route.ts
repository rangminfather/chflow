import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type PushTokenRequest = {
  expoPushToken?: string;
  platform?: string;
  deviceId?: string | null;
  appId?: string;
};

async function getAuthUser(req: NextRequest): Promise<{ uid: string } | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { uid: data.user.id };
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  let body: PushTokenRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const expoPushToken = (body.expoPushToken || "").trim();
  const platform = (body.platform || "android").trim().toLowerCase();
  const deviceId = body.deviceId ? String(body.deviceId).trim() : null;
  const appId = (body.appId || "smart-myungsung").trim();

  if (!expoPushToken || !expoPushToken.startsWith("ExponentPushToken[")) {
    return NextResponse.json({ ok: false, error: "Invalid Expo push token" }, { status: 400 });
  }

  if (!["android", "ios", "web"].includes(platform)) {
    return NextResponse.json({ ok: false, error: "Invalid platform" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  if (deviceId) {
    await admin
      .from("user_push_tokens")
      .update({ enabled: false, updated_at: now })
      .eq("user_id", user.uid)
      .eq("platform", platform)
      .eq("app_id", appId)
      .eq("device_id", deviceId)
      .neq("expo_push_token", expoPushToken);
  }

  const { data, error } = await admin
    .from("user_push_tokens")
    .upsert(
      {
        user_id: user.uid,
        expo_push_token: expoPushToken,
        platform,
        device_id: deviceId,
        app_id: appId,
        enabled: true,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,expo_push_token" }
    )
    .select("id, last_seen_at")
    .single();

  if (error) return NextResponse.json({ ok: false, error: "처리 중 오류가 발생했습니다." }, { status: 500 });

  return NextResponse.json({ ok: true, token_id: data.id, last_seen_at: data.last_seen_at });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  let body: PushTokenRequest = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const expoPushToken = (body.expoPushToken || "").trim();
  const platform = (body.platform || "").trim().toLowerCase();
  const deviceId = body.deviceId ? String(body.deviceId).trim() : null;
  const appId = (body.appId || "smart-myungsung").trim();
  const now = new Date().toISOString();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let query = admin
    .from("user_push_tokens")
    .update({ enabled: false, updated_at: now })
    .eq("user_id", user.uid)
    .eq("app_id", appId);

  if (expoPushToken) {
    query = query.eq("expo_push_token", expoPushToken);
  } else if (deviceId && platform) {
    query = query.eq("device_id", deviceId).eq("platform", platform);
  } else {
    return NextResponse.json({ ok: false, error: "Missing token or device" }, { status: 400 });
  }

  const { error } = await query;
  if (error) return NextResponse.json({ ok: false, error: "처리 중 오류가 발생했습니다." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
