import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getClientIp,
  logSignupAttempt,
  maskPhone,
  normalizePhoneDigits,
} from "@/lib/server/signup-security";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MAX_BODY = 2000;

const localRate = new Map<string, { n: number; reset: number }>();

function checkLocalRate(ip: string): boolean {
  const now = Date.now();
  const entry = localRate.get(ip);
  if (!entry || now > entry.reset) {
    localRate.set(ip, { n: 1, reset: now + 10 * 60 * 1000 });
    return true;
  }
  if (entry.n >= 5) return false;
  entry.n += 1;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (!checkLocalRate(ip)) {
    await logSignupAttempt(admin, {
      route: "support",
      result: "rate_limited",
      riskLevel: "medium",
      reason: "signup support local rate limit",
      ip,
      userAgent,
    });
    return NextResponse.json({ error: "문의가 짧은 시간에 너무 많이 접수되었습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.body === "string" ? body.body.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!title || !content) {
    await logSignupAttempt(admin, {
      route: "support",
      result: "invalid_request",
      riskLevel: "low",
      reason: "missing title/body",
      name,
      phone,
      ip,
      userAgent,
    });
    return NextResponse.json({ error: "제목과 내용을 입력해 주세요." }, { status: 400 });
  }

  const cleanTitle = title.slice(0, 80);
  const cleanContent = content.slice(0, MAX_BODY);
  const cleanPhone = normalizePhoneDigits(phone);
  const postBody = [
    "[회원가입 문의]",
    name ? `이름: ${name}` : null,
    cleanPhone ? `연락처: ${maskPhone(cleanPhone)}` : null,
    "",
    cleanContent,
  ].filter((line) => line !== null).join("\n");

  const { data: post, error } = await admin
    .from("feedback_posts")
    .insert({
      author_id: null,
      title: `[회원가입 문의] ${cleanTitle}`,
      body: postBody,
      is_private: true,
      source: "signup_support",
      guest_name: name || null,
      guest_phone: cleanPhone ? maskPhone(cleanPhone) : null,
    })
    .select("id")
    .single();

  if (error || !post) {
    await logSignupAttempt(admin, {
      route: "support",
      result: "signup_failed",
      riskLevel: "low",
      reason: error?.message || "feedback insert failed",
      name,
      phone,
      ip,
      userAgent,
    });
    return NextResponse.json({ error: "문의 접수 중 오류가 발생했습니다." }, { status: 500 });
  }

  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .in("role", ["admin", "office", "pastor"]);

  const notifications = admins?.map((profile) => ({
      user_id: profile.id,
      type: "feedback_new",
      title: "회원가입 문의",
      body: cleanTitle,
      link_url: `/feedback/${post.id}`,
      metadata: { post_id: post.id, source: "signup_support" },
    })) || [];

  if (notifications.length > 0) {
    await admin.from("notifications").insert(notifications);
  }

  await logSignupAttempt(admin, {
    route: "support",
    result: "signup_created",
    riskLevel: "low",
    reason: "support feedback created",
    name,
    phone,
    ip,
    userAgent,
    metadata: { post_id: post.id },
  });

  return NextResponse.json({ ok: true, postId: post.id });
}
