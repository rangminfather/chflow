// 1클릭 자동등록 v2 — Cloudflare Worker proxy 통해 UMS 4단계
//
// Tampermonkey 의존 제거. 사용자 0 설치.
//
// Flow:
//   1. 사용자 인증 + 부서 권한 체크
//   2. 쿨다운 체크 (DB)
//   3. CF Worker 통해 4단계 UMS 등록 (login → write.php → upload → write_ok)
//   4. 결과 DB 로그
//   5. 응답

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { umsAutoPost } from "@/lib/bulletin/ums-via-cf";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const UMS_USER_ID = process.env.UMS_USER_ID || "";
const UMS_PASSWORD = process.env.UMS_PASSWORD || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface PostBody {
  dept_id?: string;
  dept_name: string;
  date: string;
  subject: string;
  memo: string;
  pdf_base64: string;
  pdf_filename?: string;
  chflow_user_id?: string;
}

export async function POST(req: NextRequest) {
  if (!UMS_USER_ID || !UMS_PASSWORD) {
    return NextResponse.json({ ok: false, error: "UMS 자격증명 미설정" }, { status: 500 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.subject || !body.memo || !body.pdf_base64) {
    return NextResponse.json(
      { ok: false, error: "subject/memo/pdf_base64 필수" },
      { status: 400 },
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 쿨다운 체크
  const { data: cdRows } = await admin.rpc("ums_check_cooldown", {
    p_ums_user_id: UMS_USER_ID,
  });
  const cd = (cdRows && cdRows[0]) || { remaining_seconds: 0 };
  if ((cd.remaining_seconds || 0) > 0) {
    return NextResponse.json(
      { ok: false, error: "30분 쿨다운 중", remaining_seconds: cd.remaining_seconds },
      { status: 429 },
    );
  }

  // PDF base64 → Buffer
  let pdfBytes: Buffer;
  try {
    pdfBytes = Buffer.from(body.pdf_base64, "base64");
    if (pdfBytes.byteLength < 100) throw new Error("PDF 너무 작음");
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: `PDF 디코딩 실패: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const filename = body.pdf_filename || `${body.dept_name}_${body.date}.pdf`;

  // 4단계 실행 (Cloudflare Worker proxy 거침)
  const result = await umsAutoPost({
    ums_user_id: UMS_USER_ID,
    ums_password: UMS_PASSWORD,
    subject: body.subject,
    memo: body.memo,
    pdf_bytes: pdfBytes,
    pdf_filename: filename,
  });

  // 로그 기록
  if (!result.ok) {
    await admin.rpc("ums_log_post", {
      p_ums_user_id: UMS_USER_ID,
      p_status: (result.error || "").includes("30분") ? "rate_limited" : "failed",
      p_subject: body.subject,
      p_error_message: result.error,
      p_chflow_user_id: body.chflow_user_id || null,
      p_dept_id: body.dept_id || null,
      p_pl_date: result.pl_date || null,
      p_category: 2,
    });
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  await admin.rpc("ums_log_post", {
    p_ums_user_id: UMS_USER_ID,
    p_status: "success",
    p_post_no: result.post_no,
    p_subject: body.subject,
    p_chflow_user_id: body.chflow_user_id || null,
    p_dept_id: body.dept_id || null,
    p_pl_date: result.pl_date || null,
    p_category: 2,
  });

  return NextResponse.json({
    ok: true,
    post_no: result.post_no,
    post_url: `http://www.ums.or.kr/bbs/zboard.php?id=samusil&no=${result.post_no}`,
    subject: body.subject,
  });
}
