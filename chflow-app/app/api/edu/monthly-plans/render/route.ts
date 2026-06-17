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

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") || "";
  if (!path.endsWith(".xlsx")) {
    return NextResponse.json({ error: "지원하지 않는 형식" }, { status: 400 });
  }
  const deptId = path.split("/")[0];

  // 인증 + 부서 접근 권한
  const token = tokenFrom(req);
  if (!token) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const gradeResp = await userClient.rpc("get_user_grade", { p_dept_id: deptId });
  const grade = typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data);
  if (!Number.isFinite(grade) || grade > 4) {
    return NextResponse.json({ error: "부서 접근 권한이 없습니다" }, { status: 403 });
  }

  // R2에서 파일 받아 파싱
  const { data, error } = await r2.from("monthly-plans").getObject(path);
  if (error || !data) return NextResponse.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });

  const wb = new Workbook();
  try {
    // exceljs 번들 타입의 Buffer 제네릭 충돌 회피 (런타임은 Node Buffer로 정상)
    const load = wb.xlsx.load.bind(wb.xlsx) as (d: unknown) => Promise<unknown>;
    await load(data.body);
  } catch {
    return NextResponse.json({ error: "엑셀 파싱 실패" }, { status: 422 });
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

  const html = sheetsHtml.join("");
  return NextResponse.json({ ok: true, html });
}
