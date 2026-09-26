import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncJuboBulletin } from "@/lib/bulletin/jubo-sync";
import { processPendingScriptureExtractions } from "@/lib/bulletin/scripture-auto";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

function hasCronAccess(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("Authorization") || "";
  return auth === `Bearer ${secret}`;
}

async function handler(req: NextRequest) {
  if (!hasCronAccess(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof syncJuboBulletin>> | null = null;
  try {
    result = await syncJuboBulletin();
  } catch {
    result = null;
  }

  // 주보 수집 성공 여부와 별개로, 최근 주보의 성경봉독 자동 추출을 이어서 돌린다
  // (이전 회차에 과부하로 실패한 건의 재시도 포함).
  let scripture: unknown = null;
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const done = await processPendingScriptureExtractions(admin, { deadline: startedAt + (maxDuration - 5) * 1000 });
    scripture = done.map((item) => ({ bulletin_id: item.bulletinId, status: item.status, errors: item.errors }));
  } catch (e) {
    scripture = { error: e instanceof Error ? e.message : "성경봉독 추출 실패" };
  }

  if (!result) {
    return NextResponse.json({ ok: false, error: "주보 수집 실패", scripture }, { status: 500 });
  }
  return NextResponse.json({ ...result, scripture });
}

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}
