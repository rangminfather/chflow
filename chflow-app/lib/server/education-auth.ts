import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { EDUCATION_CAPABILITY } from "@/lib/education/permissions";

export const EDUCATION_CAPABILITIES = EDUCATION_CAPABILITY;

function bearerToken(request: NextRequest): string | null {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

export async function requireEducationCapability(
  request: NextRequest,
  capability: string,
): Promise<{ client: SupabaseClient; userId: string }> {
  const token = bearerToken(request);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !key) throw new Error("UNAUTHORIZED");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) throw new Error("UNAUTHORIZED");
  const { data: capabilities, error } = await client.rpc("get_my_app_capabilities");
  if (error || !Array.isArray(capabilities) || !capabilities.includes(capability)) {
    throw new Error("FORBIDDEN");
  }
  return { client, userId: userData.user.id };
}

export function educationErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return Response.json(
    { error: status === 401 ? "로그인이 필요합니다." : status === 403 ? "권한이 없습니다." : message },
    { status },
  );
}
