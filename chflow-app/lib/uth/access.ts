// UTH control authorization. SERVER-ONLY.
// Mirrors the app's Bearer-token → getUser → profiles.role pattern
// (see app/api/admin/reset-password/route.ts). Controllers: admin/office/pastor.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const CONTROLLER_ROLES = ["admin", "office", "pastor"];

export interface Caller {
  userId: string;
  name: string;
  role: string;
}

export type AuthResult =
  | { ok: true; caller: Caller }
  | { ok: false; status: number; error: string };

export function tokenFrom(req: Request): string {
  const v = req.headers.get("authorization") || "";
  return v.startsWith("Bearer ") ? v.slice(7).trim() : "";
}

export async function authorize(token: string): Promise<AuthResult> {
  if (!token) return { ok: false, status: 401, error: "로그인이 필요합니다" };
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return { ok: false, status: 500, error: "Supabase 환경변수가 설정되지 않았습니다" };
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) return { ok: false, status: 401, error: "유효하지 않은 토큰" };

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("username, role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (pErr || !profile) return { ok: false, status: 500, error: "프로필 조회 실패" };
  if (!CONTROLLER_ROLES.includes(profile.role as string)) {
    return { ok: false, status: 403, error: "난방 제어 권한이 없습니다" };
  }
  return {
    ok: true,
    caller: { userId: authData.user.id, name: (profile.username as string) ?? "?", role: profile.role as string },
  };
}
