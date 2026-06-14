// 1클릭 자동등록 v2 — Supabase Edge Function (AWS Seoul) 으로 UMS 호출.
//
// 2026-05-10: Cloudflare Worker (AS13335) → Supabase Edge (AS16509 AWS Seoul) 우회.
// rate-limit 분리 + 인프라 단순화. ums-via-cf.ts 는 fallback 용 보존.
//
// 사용자별 자격증명 사용 (DB 에서 chflow_user_id 로 조회).
// 미등록 시 ums_credentials_required 에러 반환 → 클라이언트가 ⚙️ 모달 띄움.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/bulletin/creds-crypto";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface PostBody {
  dept_id?: string;
  dept_name: string;
  date: string;
  subject: string;
  memo: string;
  pdf_base64: string;
  pdf_filename?: string;
  // 🔬 진단 모드 — 1·2단계(login + write_form)까지 실행, 글 등록 X, cooldown 발동 X.
  dryRun?: boolean;
}

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
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject || !body.memo) {
    return NextResponse.json(
      { ok: false, error: "subject/memo 필수" },
      { status: 400 },
    );
  }
  if (!body.dryRun && !body.pdf_base64) {
    return NextResponse.json(
      { ok: false, error: "pdf_base64 필수 (dryRun 모드 아니면)" },
      { status: 400 },
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 사용자 자격증명 조회
  const { data: credRow, error: credErr } = await admin
    .from("user_ums_credentials")
    .select("ums_user_id, ums_password_encrypted")
    .eq("user_id", user.uid)
    .maybeSingle();

  if (credErr) {
    return NextResponse.json({ ok: false, error: credErr.message }, { status: 500 });
  }
  if (!credRow) {
    return NextResponse.json(
      {
        ok: false,
        error: "UMS 계정 미등록",
        code: "ums_credentials_required",
      },
      { status: 400 },
    );
  }

  let umsPassword: string;
  try {
    umsPassword = decryptString(credRow.ums_password_encrypted);
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: "자격증명 복호화 실패" },
      { status: 500 },
    );
  }
  const umsUserId = credRow.ums_user_id;

  // 쿨다운 체크 (dryRun 시 skip — write_ok 안 보내므로 cooldown 무관)
  if (!body.dryRun) {
    const { data: cdRows } = await admin.rpc("ums_check_cooldown", {
      p_ums_user_id: umsUserId,
    });
    const cd = (cdRows && cdRows[0]) || { remaining_seconds: 0 };
    if ((cd.remaining_seconds || 0) > 0) {
      return NextResponse.json(
        { ok: false, error: "30분 쿨다운 중", remaining_seconds: cd.remaining_seconds },
        { status: 429 },
      );
    }
  }

  // PDF (dryRun 시 비어있어도 OK — upload 단계 skip)
  let pdfBytes: Buffer;
  try {
    if (body.dryRun && !body.pdf_base64) {
      pdfBytes = Buffer.from("dryRun-no-pdf"); // 사용 안 됨
    } else {
      pdfBytes = Buffer.from(body.pdf_base64, "base64");
      if (pdfBytes.byteLength < 100) throw new Error("PDF 너무 작음");
    }
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: "PDF 디코딩 실패" },
      { status: 400 },
    );
  }

  const filename = body.pdf_filename || `${body.dept_name}_${body.date}.pdf`;

  // Supabase Edge Function 호출 (AWS Seoul AS16509 → ums.or.kr 직접)
  interface EdgeResult {
    ok: boolean;
    post_no?: number;
    redirect_url?: string;
    pl_date?: string;
    error?: string;
    outbound_ip?: string;
    outbound_org?: string;
    debug?: unknown[];
  }
  let result: EdgeResult;
  try {
    const edgeRes = await fetch(`${SUPABASE_URL}/functions/v1/ums-post-bulletin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        ums_user_id: umsUserId,
        ums_password: umsPassword,
        subject: body.subject,
        memo: body.memo,
        pdf_base64: body.dryRun && !body.pdf_base64 ? undefined : Buffer.from(pdfBytes).toString("base64"),
        pdf_filename: filename,
        category: 2,
        dryRun: body.dryRun,
      }),
    });
    result = await edgeRes.json();
  } catch (e: unknown) {
    const err = e as Error;
    return NextResponse.json({
      ok: false,
      error: "Edge function 호출 실패",
    }, { status: 500 });
  }

  // 로그 기록 (dryRun 시 skip)
  if (!result.ok) {
    if (!body.dryRun) {
      await admin.rpc("ums_log_post", {
        p_ums_user_id: umsUserId,
        p_status: (result.error || "").includes("30분") ? "rate_limited" : "failed",
        p_subject: body.subject,
        p_error_message: result.error,
        p_chflow_user_id: user.uid,
        p_dept_id: body.dept_id || null,
        p_pl_date: result.pl_date || null,
        p_category: 2,
      });
    }
    return NextResponse.json({
      ok: false,
      error: result.error,
      debug: result.debug,
      outbound_ip: result.outbound_ip,
      outbound_org: result.outbound_org,
      dryRun: !!body.dryRun,
    }, { status: 500 });
  }

  if (!body.dryRun) {
    await admin.rpc("ums_log_post", {
      p_ums_user_id: umsUserId,
      p_status: "success",
      p_post_no: result.post_no,
      p_subject: body.subject,
      p_chflow_user_id: user.uid,
      p_dept_id: body.dept_id || null,
      p_pl_date: result.pl_date || null,
      p_category: 2,
    });
  }

  return NextResponse.json({
    ok: true,
    dryRun: !!body.dryRun,
    post_no: result.post_no,
    post_url: result.post_no ? `http://www.ums.or.kr/bbs/zboard.php?id=samusil&no=${result.post_no}` : null,
    subject: body.subject,
    pl_date: result.pl_date,
    outbound_ip: result.outbound_ip,
    outbound_org: result.outbound_org,
    debug: body.dryRun ? result.debug : undefined,
  });
}
