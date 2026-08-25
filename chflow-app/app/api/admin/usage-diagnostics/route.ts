import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
// 이 라우트는 route.test.ts 가 직접 import 하고 vitest 에는 "@/" alias 설정이 없어
// 상대 경로를 쓴다. (alias 로 바꾸면 단위 테스트에서 모듈 해석이 실패한다)
import { dbQuotaBytes } from "../../../../lib/usageDiagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return new NextResponse(null, { status: 401 });

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return new NextResponse(null, { status: 401 });

  const { data, error } = await client.rpc("admin_usage_diagnostics", { p_days: 30 });
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") {
      return NextResponse.json(
        { error: "usage_diagnostics_migration_required" },
        { status: 503 },
      );
    }
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "usage_diagnostics_forbidden" },
        { status: 403 },
      );
    }

    // SQL, schema, query text나 인증 정보를 client/log에 노출하지 않는다.
    console.error("[usage-diagnostics] RPC failed", { code: error.code || "unknown" });
    return NextResponse.json(
      { error: "usage_diagnostics_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...(data as Record<string, unknown>),
    // quota 파싱은 R2 와 같은 정책을 쓴다 (lib/usageDiagnostics 단일 구현)
    db_quota_bytes: dbQuotaBytes(),
  }, { headers: { "Cache-Control": "no-store" } });
}
