// Storage proxy route — enforces authentication before serving private bucket files.
// Buckets member-photos and feedback-attachments are private; direct public URLs are disabled.
//
// GET /api/storage/[bucket]/[...path]
//   → verifies session (cookie or Bearer token)
//   → creates a signed URL via service role
//   → 302 redirect to signed URL

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const ALLOWED_BUCKETS = new Set(["member-photos", "feedback-attachments", "messenger-attachments"]);
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  // Bearer token (API calls / fetch with Authorization header)
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    const client = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await client.auth.getUser(token);
    if (!error && data.user) return data.user.id;
  }

  // Cookie-based session (browser <img> tags, navigation)
  const cookieStore = await cookies();
  const ssrClient = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });
  const { data: { user } } = await ssrClient.auth.getUser();
  if (user) return user.id;

  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bucket: string; path: string[] }> }
) {
  const { bucket, path } = await params;

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const uid = await getAuthUserId(req);
  if (!uid) {
    return new NextResponse(null, { status: 401 });
  }

  const storagePath = path.join("/");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (bucket === "messenger-attachments") {
    const { data: attachment } = await admin
      .from("messenger_message_attachments")
      .select("conversation_id")
      .eq("file_path", storagePath)
      .maybeSingle();

    if (!attachment?.conversation_id) {
      return new NextResponse(null, { status: 404 });
    }

    const { data: participant } = await admin
      .from("messenger_participants")
      .select("id")
      .eq("conversation_id", attachment.conversation_id)
      .eq("user_id", uid)
      .maybeSingle();

    if (!participant?.id) {
      return new NextResponse(null, { status: 403 });
    }
  }

  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(storagePath, 300); // 5-minute signed URL

  if (error || !data?.signedUrl) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl, { status: 302 });
}
