import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2 } from "@/lib/r2";
import { normalizeXlsxForStorage } from "@/lib/xlsx-load";
import { monthlyPlanMonthToken, parseMonthlyPlanName } from "@/lib/monthlyPlanFiles";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BUCKET = "monthly-plans";

function authedClient(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function verifyGrade(req: NextRequest, deptId: string) {
  const token = tokenFrom(req);
  if (!token) return { ok: false as const, status: 401, error: "Unauthenticated" };

  const userClient = authedClient(token);
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const gradeResp = await userClient.rpc("get_user_grade", { p_dept_id: deptId });
  const grade = typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data);
  if (!Number.isFinite(grade) || grade > 4) {
    return { ok: false as const, status: 403, error: "부서 접근 권한이 없습니다" };
  }
  return { ok: true as const, grade };
}

function safeExtension(name: string) {
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const clean = (ext || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return clean ? `.${clean.toLowerCase()}` : "";
}

export async function GET(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("dept_id");
  if (!deptId) return NextResponse.json({ ok: false, error: "dept_id 필수" }, { status: 400 });

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });

  const { data, error } = await r2.from(BUCKET).list(deptId, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) return NextResponse.json({ ok: false, error: "처리 중 오류가 발생했습니다." }, { status: 500 });

  const files = (data || []).filter((item) => item.name).map((item) => {
    const path = `${deptId}/${item.name}`;
    const parsed = parseMonthlyPlanName(item.name);
    return {
      name: item.name,
      path,
      url: `/api/storage/${BUCKET}/${path}`,
      size: item.metadata?.size || null,
      created_at: item.created_at,
      updated_at: item.updated_at,
      ...parsed,
    };
  });

  return NextResponse.json({ ok: true, files });
}

export async function DELETE(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("dept_id") || "";
  const path = req.nextUrl.searchParams.get("path") || "";
  if (!deptId || !path) {
    return NextResponse.json({ ok: false, error: "필수값이 누락되었습니다" }, { status: 400 });
  }
  // 다른 부서 객체 삭제 방지
  if (!path.startsWith(`${deptId}/`) || path.includes("..")) {
    return NextResponse.json({ ok: false, error: "잘못된 경로입니다" }, { status: 400 });
  }

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });
  if (verified.grade > 2) {
    return NextResponse.json({ ok: false, error: "월간교육 삭제 권한이 없습니다" }, { status: 403 });
  }

  const { error } = await r2.from(BUCKET).remove([path]);
  if (error) return NextResponse.json({ ok: false, error: "삭제 중 오류가 발생했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const deptId = String(form.get("dept_id") || "");
  const year = Number(form.get("year"));
  const requestedMonths = String(form.get("months") || form.get("month") || "")
    .split(",")
    .map(Number)
    .filter((month, index, values) => month >= 1 && month <= 12 && values.indexOf(month) === index)
    .sort((a, b) => a - b);
  const file = form.get("file");

  if (!deptId || !year || requestedMonths.length === 0 || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "필수값이 누락되었습니다" }, { status: 400 });
  }

  // 허용 형식: 이미지 · PDF · 엑셀(.xlsx)만. (.xls·.hwp 등은 차단)
  const ext = safeExtension(file.name);
  const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf", ".xlsx"];
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json(
      { ok: false, error: "이미지·PDF·엑셀(.xlsx)만 올릴 수 있습니다. 한글(.hwp)·구형 엑셀(.xls)은 PDF로 저장해 올려주세요." },
      { status: 415 }
    );
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "파일 크기는 20MB 이하만 가능합니다." }, { status: 413 });
  }

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });
  if (verified.grade > 2) {
    return NextResponse.json({ ok: false, error: "월간교육등록 권한이 없습니다" }, { status: 403 });
  }

  const monthToken = monthlyPlanMonthToken(requestedMonths);
  const objectName = `${year}-${monthToken}_${Date.now()}_monthly-plan${safeExtension(file.name)}`;
  const path = `${deptId}/${objectName}`;
  let bytes: ArrayBuffer | Buffer = await file.arrayBuffer();
  let contentType = file.type || "application/octet-stream";

  // 한셀 등에서 만든 xlsx는 XML 네임스페이스가 비표준이라 일부 ExcelJS 경로에서
  // 바로 열리지 않는다. 업로드 전에 읽기·재작성이 가능한지 검증하고 표준화한다.
  if (ext === ".xlsx") {
    const normalized = await normalizeXlsxForStorage(bytes);
    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: "엑셀(.xlsx) 파일을 읽을 수 없습니다. 파일이 손상되었는지 확인해주세요." },
        { status: 422 },
      );
    }
    bytes = normalized;
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  const { error } = await r2.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) return NextResponse.json({ ok: false, error: "업로드 중 오류가 발생했습니다." }, { status: 500 });

  return NextResponse.json({ ok: true, path, months: requestedMonths });
}
