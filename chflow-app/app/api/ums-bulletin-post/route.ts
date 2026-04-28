import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateBulletinPdf, type BulletinData } from "@/lib/bulletin/pdf-generator";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

// Vercel 함수에서 ums.or.kr 직접 호출은 IP 차단 위험.
// Cloudflare ICN 엣지에서 도는 Supabase Edge Function 으로 위임.
const UMS_USER_ID = process.env.UMS_USER_ID || "";
const UMS_PASSWORD = process.env.UMS_PASSWORD || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const EDGE_URL = `${SUPABASE_URL}/functions/v1/ums-post-bulletin`;

interface PostBody {
  dept_name: string;
  dept_id?: string;
  date: string;
  topic: string;
  scripture: string;
  leader: string;
  praise: string;
  prayer: string;
  scripture_reader: string;
  sermon_title: string;
  preacher: string;
  announcement: string;
  chflow_user_id?: string;
}

function buildSubject(deptName: string, date: string): string {
  if (!date) return `${deptName} 주보입니다`;
  const [, m, d] = date.split("-");
  const mm = parseInt(m, 10);
  const dd = parseInt(d, 10);
  if (deptName === "초등1부") {
    return `${mm}월${dd}일 초등1초원주보입니다`;
  }
  return `${mm}월 ${dd}일 ${deptName} 주보입니다`;
}

function buildMemo(data: BulletinData): string {
  const lines = [
    `${data.dept_name} 주보 (${data.date})`,
    "",
    data.topic ? `주제 : ${data.topic}` : "",
    data.scripture ? `본문 : ${data.scripture}` : "",
    "",
    "─ 주일예배 순서 ─",
    data.leader ? `예배인도 : ${data.leader}` : "",
    data.praise ? `찬양 : ${data.praise}` : "",
    data.prayer ? `기도 : ${data.prayer}` : "",
    data.scripture_reader ? `성경봉독 : ${data.scripture_reader}` : "",
    data.sermon_title ? `설교제목 : ${data.sermon_title}` : "",
    data.preacher ? `강론자 : ${data.preacher}` : "",
  ];
  if (data.announcement) {
    lines.push("", "─ 광고 ─", data.announcement);
  }
  lines.push("", "(chflow 자동등록)");
  return lines.filter((l) => l !== undefined).join("\n");
}

function bytesToBase64(bytes: Uint8Array): string {
  // Node 에서 Uint8Array → base64
  return Buffer.from(bytes).toString("base64");
}

export async function POST(req: NextRequest) {
  if (!UMS_USER_ID || !UMS_PASSWORD) {
    return NextResponse.json(
      { ok: false, error: "UMS 자격증명이 서버에 설정되지 않음" },
      { status: 500 },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청 본문" }, { status: 400 });
  }

  if (!body.topic?.trim() || !body.scripture?.trim() || !body.date) {
    return NextResponse.json(
      { ok: false, error: "주제·성경본문·날짜는 필수입니다" },
      { status: 400 },
    );
  }
  if (body.dept_name !== "초등1부") {
    return NextResponse.json(
      { ok: false, error: "현재 초등1부만 지원합니다" },
      { status: 400 },
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 쿨다운 체크 (chflow DB 측)
  const { data: cooldownRows, error: cdErr } = await admin.rpc("ums_check_cooldown", {
    p_ums_user_id: UMS_USER_ID,
  });
  if (cdErr) {
    return NextResponse.json({ ok: false, error: cdErr.message }, { status: 500 });
  }
  const cd = (cooldownRows && cooldownRows[0]) || { remaining_seconds: 0 };
  if ((cd.remaining_seconds || 0) > 0) {
    return NextResponse.json(
      { ok: false, error: "30분 쿨다운 중입니다", remaining_seconds: cd.remaining_seconds },
      { status: 429 },
    );
  }

  const subject = buildSubject(body.dept_name, body.date);
  const memo = buildMemo(body);
  const filename = `${body.dept_name}_${body.date}.pdf`;

  // 1) PDF 생성 (Vercel 측)
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateBulletinPdf({
      dept_name: body.dept_name,
      date: body.date,
      topic: body.topic,
      scripture: body.scripture,
      leader: body.leader,
      praise: body.praise,
      prayer: body.prayer,
      scripture_reader: body.scripture_reader,
      sermon_title: body.sermon_title,
      preacher: body.preacher,
      announcement: body.announcement,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: `PDF 생성 실패: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  // 2) Edge Function 에 위임 (UMS 4단계 통째)
  let edgeResp: {
    ok: boolean;
    post_no?: number;
    redirect_url?: string | null;
    pl_date?: string;
    error?: string;
  };
  try {
    const r = await fetch(EDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({
        ums_user_id: UMS_USER_ID,
        ums_password: UMS_PASSWORD,
        subject,
        memo,
        pdf_base64: bytesToBase64(pdfBytes),
        filename,
        category: 2,
      }),
    });
    edgeResp = await r.json();
  } catch (e: unknown) {
    edgeResp = { ok: false, error: `Edge Function 호출 실패: ${(e as Error).message}` };
  }

  // 3) 로그 기록 + 응답
  if (!edgeResp.ok) {
    const errMsg = edgeResp.error || "알 수 없는 오류";
    await admin.rpc("ums_log_post", {
      p_ums_user_id: UMS_USER_ID,
      p_status: errMsg.includes("30분") ? "rate_limited" : "failed",
      p_subject: subject,
      p_error_message: errMsg,
      p_chflow_user_id: body.chflow_user_id || null,
      p_dept_id: body.dept_id || null,
      p_pl_date: edgeResp.pl_date || null,
      p_category: 2,
    });
    return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
  }

  await admin.rpc("ums_log_post", {
    p_ums_user_id: UMS_USER_ID,
    p_status: "success",
    p_post_no: edgeResp.post_no,
    p_subject: subject,
    p_chflow_user_id: body.chflow_user_id || null,
    p_dept_id: body.dept_id || null,
    p_pl_date: edgeResp.pl_date || null,
    p_category: 2,
  });

  return NextResponse.json({
    ok: true,
    post_no: edgeResp.post_no,
    post_url: `http://ums.or.kr/bbs/zboard.php?id=samusil&no=${edgeResp.post_no}`,
    subject,
  });
}
