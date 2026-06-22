// GET /api/edu/monthly-plans/render?path={deptId}/{name}
// .xlsx 파일을 exceljs로 파싱해 HTML 표로 반환 (인라인 표출용)
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Workbook } from "exceljs";
import { r2 } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "object") {
    // exceljs rich text / hyperlink / formula 결과 등
    const o = v as Record<string, unknown>;
    s = String(o.text ?? o.result ?? o.hyperlink ?? "");
  } else {
    s = String(v);
  }
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// "B2:C3" → {top,left,bottom,right} (1-based)
function parseRange(ref: string) {
  const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  const col = (s: string) => s.split("").reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
  return { left: col(m[1]), top: Number(m[2]), right: col(m[3]), bottom: Number(m[4]) };
}

// 인증 + 부서 접근 권한 확인 (grade ≤ 4 면 통과)
async function checkAccess(req: NextRequest, deptId: string) {
  const token = tokenFrom(req);
  if (!token) return { ok: false as const, status: 401, error: "Unauthenticated" };
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) return { ok: false as const, status: 401, error: "Invalid token" };
  const gradeResp = await userClient.rpc("get_user_grade", { p_dept_id: deptId });
  const grade = typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data);
  if (!Number.isFinite(grade) || grade > 4) {
    return { ok: false as const, status: 403, error: "부서 접근 권한이 없습니다" };
  }
  return { ok: true as const, grade };
}

// xlsx 바이트 → 시트별 HTML 표 (병합 반영)
async function renderXlsxHtml(bytes: unknown): Promise<string | null> {
  const wb = new Workbook();
  try {
    // exceljs 번들 타입의 Buffer 제네릭 충돌 회피 (런타임은 Node Buffer로 정상)
    const load = wb.xlsx.load.bind(wb.xlsx) as (d: unknown) => Promise<unknown>;
    await load(bytes);
  } catch {
    return null;
  }

  const sheetsHtml: string[] = [];
  wb.eachSheet((ws) => {
    const merges = (ws.model?.merges || []) as string[];
    const ranges = merges.map(parseRange).filter(Boolean) as NonNullable<ReturnType<typeof parseRange>>[];
    // covered(=병합에 흡수돼 렌더 생략) 셀 좌표 집합, master 셀의 span
    const covered = new Set<string>();
    const spanAt = new Map<string, { rs: number; cs: number }>();
    for (const r of ranges) {
      spanAt.set(`${r.top}:${r.left}`, { rs: r.bottom - r.top + 1, cs: r.right - r.left + 1 });
      for (let row = r.top; row <= r.bottom; row++) {
        for (let c = r.left; c <= r.right; c++) {
          if (row === r.top && c === r.left) continue;
          covered.add(`${row}:${c}`);
        }
      }
    }

    const colCount = ws.actualColumnCount || ws.columnCount || 0;
    const rows: string[] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNum) => {
      const cells: string[] = [];
      for (let c = 1; c <= colCount; c++) {
        const key = `${rowNum}:${c}`;
        if (covered.has(key)) continue;
        const span = spanAt.get(key);
        const cell = row.getCell(c);
        const attrs = span ? ` rowspan="${span.rs}" colspan="${span.cs}"` : "";
        cells.push(`<td${attrs}>${esc(cell.value)}</td>`);
      }
      rows.push(`<tr>${cells.join("")}</tr>`);
    });

    sheetsHtml.push(
      `<div class="mp-sheet"><div class="mp-sheet-name">${esc(ws.name)}</div>` +
      `<table class="mp-table">${rows.join("")}</table></div>`
    );
  });

  return sheetsHtml.join("");
}

// GET: R2에 저장된 파일 렌더 (조회 화면용)
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") || "";
  if (!path.endsWith(".xlsx")) {
    return NextResponse.json({ error: "지원하지 않는 형식" }, { status: 400 });
  }
  const deptId = path.split("/")[0];

  const access = await checkAccess(req, deptId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { data, error } = await r2.from("monthly-plans").getObject(path);
  if (error || !data) return NextResponse.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });

  const html = await renderXlsxHtml(data.body);
  if (html === null) return NextResponse.json({ error: "엑셀 파싱 실패" }, { status: 422 });
  return NextResponse.json({ ok: true, html });
}

// POST: 업로드 전 미리보기용 — 저장 없이 올린 파일 바이트를 바로 렌더
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const deptId = String(form.get("dept_id") || "");
  const file = form.get("file");
  if (!deptId || !(file instanceof File)) {
    return NextResponse.json({ error: "필수값이 누락되었습니다" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "지원하지 않는 형식" }, { status: 400 });
  }

  const access = await checkAccess(req, deptId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const bytes = await file.arrayBuffer();
  const html = await renderXlsxHtml(bytes);
  if (html === null) return NextResponse.json({ error: "엑셀 파싱 실패" }, { status: 422 });
  return NextResponse.json({ ok: true, html });
}
