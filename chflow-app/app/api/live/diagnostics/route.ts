// 예배 생방송 진단 보조 정보 (관리자 전용).
//
// 화면에서 알 수 없는 두 가지만 돌려준다.
//   ① OAuth/API 키 환경변수가 설정되어 있는지 (configured | missing)
//   ② 현재 배포 식별 정보 (Vercel 이 런타임에 주입하는 시스템 환경변수)
//
// 보안: 값 자체는 절대 반환하지 않는다. 길이·앞자리·해시도 반환하지 않는다.
//   권한이 없으면 환경 정보도 배포 정보도 주지 않는다 (화면 접근제어를 신뢰하지 않고
//   route 에서 다시 role 을 확인한다).
// 새 Vercel API 토큰은 도입하지 않는다 — 배포 정보는 런타임 환경변수만 사용한다.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
// 상대경로 — 이 리포지터리의 vitest 는 alias 설정 없이 돌아간다(기존 테스트도 모두 상대경로)
import { canViewLiveDiagnostics, type LiveEnvSnapshot } from "../../../../lib/liveDiagnostics";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function configured(name: string): "configured" | "missing" {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? "configured" : "missing";
}

async function callerRole(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const userClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  return typeof profile?.role === "string" ? profile.role : null;
}

export async function GET(req: NextRequest) {
  const role = await callerRole(req);
  if (!role) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!canViewLiveDiagnostics(role)) {
    return NextResponse.json({ ok: false, error: "권한이 없습니다." }, { status: 403 });
  }

  const env: LiveEnvSnapshot = {
    youtube_oauth_client_id: configured("YOUTUBE_OAUTH_CLIENT_ID"),
    youtube_oauth_client_secret: configured("YOUTUBE_OAUTH_CLIENT_SECRET"),
    youtube_oauth_refresh_token: configured("YOUTUBE_OAUTH_REFRESH_TOKEN"),
    youtube_api_key: configured("YOUTUBE_API_KEY"),
    // Vercel 은 env 변경 시각을 런타임에 주지 않는다. 억지로 추정하지 않는다.
    credential_changed_at: "확인 불가",
    deploy_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    deploy_ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  };

  const res = NextResponse.json({ ok: true, env });
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
