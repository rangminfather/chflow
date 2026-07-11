// GET /api/edu/monthly-plans/render?path={deptId}/{name}
// .xlsx 파일을 exceljs로 파싱.
//  - format=cards: 초등1초원 양식(주일 = 행, 12열)을 월별 카드 데이터(JSON)로 반환.
//                  양식이 안 맞으면 template:false + 표 HTML로 폴백.
//  - 기본: 표 HTML(인라인 표출용) 반환 (legacy)
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2 } from "@/lib/r2";
import { loadWorkbook } from "@/lib/xlsx-load";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function esc(v: unknown): string {
  return cellText(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// exceljs 셀 값 → 평문(줄바꿈 보존). rich text / hyperlink / formula 결과 처리.
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    return String(o.text ?? o.result ?? o.hyperlink ?? "");
  }
  return String(v);
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

// xlsx 바이트 → 시트별 HTML 표 (병합 반영) — 양식 안 맞는 파일 폴백용
async function renderXlsxHtml(bytes: unknown): Promise<string | null> {
  const wb = await loadWorkbook(bytes as Buffer);
  if (!wb) return null;

  const sheetsHtml: string[] = [];
  wb.eachSheet((ws) => {
    const merges = (ws.model?.merges || []) as string[];
    const ranges = merges.map(parseRange).filter(Boolean) as NonNullable<ReturnType<typeof parseRange>>[];
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

// ───────────────────── 카드 파서 (초등1초원 양식) ─────────────────────
// 열 매핑(1-based): 1 날짜 · 2 설교제목(+본문) · 3 사회 · 4 설교자 · 5 기도
//   · 6 주제찬양 · 7 안내 · 8 찬양율동 · 9 여백 · 10 행사준비팀 · 11 행사내용 · 12 비고(요절)
const ROLE_COLS: Array<{ col: number; label: string }> = [
  { col: 3, label: "사회" },
  { col: 4, label: "설교" },
  { col: 5, label: "기도" },
  { col: 6, label: "주제찬양" },
  { col: 7, label: "안내" },
  { col: 8, label: "율동" },
];

export interface PlanWeek {
  date: string;            // "6/7"
  month: number;           // 6
  day: number;             // 7
  title: string;           // 설교제목
  scripture: string;       // 본문 "마5:13~16,엡5:8~14"
  verse: string;           // 요절 "마5:16"
  roles: Array<{ label: string; name: string }>; // 비어있지 않은 역할만
  prep: string;            // 행사준비팀
  event: string;           // 행사내용
}
export interface MonthBucket {
  month: number;
  weeks: PlanWeek[];
  notes: string[];
}
export interface CardsResult {
  template: true;
  year: number;
  common: string[];        // 모든 달 공통 안내
  months: MonthBucket[];   // 월 오름차순
}

const DATE_RE = /^\s*(\d{1,2})\/(\d{1,2})\s*$/;
const INLINE_DATE_RE = /(\d{1,2})\/(\d{1,2})/;

function monthsFromSheetName(name: string): number[] {
  const nums = (name.match(/\d{1,2}/g) || []).map(Number).filter((n) => n >= 1 && n <= 12);
  return Array.from(new Set(nums)).slice(0, 2);
}

function parseTitleScripture(raw: string): { title: string; scripture: string } {
  const text = raw.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const m = text.match(/\(([^()]*)\)\s*$/);
  if (m && m.index !== undefined) {
    return { title: text.slice(0, m.index).trim(), scripture: m[1].trim() };
  }
  return { title: text, scripture: "" };
}

async function parseXlsxCards(bytes: unknown, fallbackYear: number | null): Promise<CardsResult | null> {
  const wb = await loadWorkbook(bytes as Buffer);
  if (!wb) return null;

  let year: number | null = fallbackYear;
  const weekMap = new Map<string, PlanWeek>(); // key "M/D" — 셀 단위 병합(채워진 값 우선)
  const sheetNotes: Array<{ months: number[]; lines: string[] }> = [];

  wb.eachSheet((ws) => {
    const sheetMonths = monthsFromSheetName(ws.name);
    ws.eachRow({ includeEmpty: false }, (row) => {
      const c1 = cellText(row.getCell(1).value).trim();

      // 연도 추출 (제목 행 등 "2026년")
      if (year === null) {
        for (let c = 1; c <= 3; c++) {
          const ym = cellText(row.getCell(c).value).match(/(20\d{2})\s*년/);
          if (ym) { year = Number(ym[1]); break; }
        }
      }

      // 기타사항 행
      if (c1 === "기타사항") {
        const lines = cellText(row.getCell(2).value)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length) sheetNotes.push({ months: sheetMonths, lines });
        return;
      }

      // 데이터(주일) 행
      const dm = c1.match(DATE_RE);
      if (!dm) return;
      const month = Number(dm[1]);
      const day = Number(dm[2]);
      if (month < 1 || month > 12) return;
      const dateKey = `${month}/${day}`;

      const { title, scripture } = parseTitleScripture(cellText(row.getCell(2).value));
      const roles = ROLE_COLS
        .map(({ col, label }) => ({
          label,
          name: cellText(row.getCell(col).value).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim(),
        }))
        .filter((r) => r.name);
      const prep = cellText(row.getCell(10).value).trim();
      const event = cellText(row.getCell(11).value).replace(/\r?\n/g, " ").trim();
      const verse = cellText(row.getCell(12).value).replace(/^요절\s*[:：]?\s*/, "").trim();

      const next: PlanWeek = { date: dateKey, month, day, title, scripture, verse, roles, prep, event };
      const prev = weekMap.get(dateKey);
      weekMap.set(dateKey, prev ? mergeWeek(prev, next) : next);
    });
  });

  if (weekMap.size === 0) return null; // 양식 불일치 → 폴백

  // 안내문: 모든 시트 공통 라인 = 공통, 나머지는 날짜→해당 월, 날짜 없으면 시트 월에
  const lineCount = new Map<string, number>();
  for (const s of sheetNotes) for (const l of new Set(s.lines)) lineCount.set(l, (lineCount.get(l) || 0) + 1);
  const totalSheets = sheetNotes.length;
  const commonSet = new Set<string>();
  const common: string[] = [];
  if (totalSheets > 0) {
    const seen = new Set<string>();
    for (const s of sheetNotes) {
      for (const l of s.lines) {
        if (lineCount.get(l) === totalSheets && !seen.has(l)) { seen.add(l); commonSet.add(l); common.push(l); }
      }
    }
  }

  const monthNotes = new Map<number, string[]>();
  const pushNote = (mo: number, line: string) => {
    const arr = monthNotes.get(mo) || [];
    if (!arr.includes(line)) arr.push(line);
    monthNotes.set(mo, arr);
  };
  for (const s of sheetNotes) {
    for (const l of s.lines) {
      if (commonSet.has(l)) continue;
      const md = l.match(INLINE_DATE_RE);
      if (md) pushNote(Number(md[1]), l);
      else for (const mo of s.months) pushNote(mo, l);
    }
  }

  // 월 버킷 구성
  const monthSet = new Set<number>();
  for (const w of weekMap.values()) monthSet.add(w.month);
  for (const mo of monthNotes.keys()) monthSet.add(mo);

  const months: MonthBucket[] = Array.from(monthSet).sort((a, b) => a - b).map((mo) => ({
    month: mo,
    weeks: Array.from(weekMap.values())
      .filter((w) => w.month === mo)
      .sort((a, b) => a.day - b.day),
    notes: monthNotes.get(mo) || [],
  }));

  return { template: true, year: year ?? new Date().getFullYear(), common, months };
}

// 같은 날짜가 여러 시트에 → 셀 단위 병합. 빈 값은 채워진 값으로 덮고, 둘 다 차있으면 나중(b) 우선.
function mergeWeek(a: PlanWeek, b: PlanWeek): PlanWeek {
  const pick = (x: string, y: string) => (y ? y : x);
  const roleMap = new Map<string, string>();
  for (const r of a.roles) roleMap.set(r.label, r.name);
  for (const r of b.roles) roleMap.set(r.label, r.name); // 나중 시트 우선
  const roles = ROLE_COLS.map(({ label }) => ({ label, name: roleMap.get(label) || "" })).filter((r) => r.name);
  return {
    date: a.date,
    month: a.month,
    day: a.day,
    title: pick(a.title, b.title),
    scripture: pick(a.scripture, b.scripture),
    verse: pick(a.verse, b.verse),
    roles,
    prep: pick(a.prep, b.prep),
    event: pick(a.event, b.event),
  };
}

function yearFromPath(path: string): number | null {
  const m = path.match(/(20\d{2})-\d{2}_/);
  return m ? Number(m[1]) : null;
}

// GET: R2에 저장된 파일 렌더 (조회 화면용)
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") || "";
  const format = req.nextUrl.searchParams.get("format");
  if (!path.endsWith(".xlsx")) {
    return NextResponse.json({ error: "지원하지 않는 형식" }, { status: 400 });
  }
  const deptId = path.split("/")[0];

  const access = await checkAccess(req, deptId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { data, error } = await r2.from("monthly-plans").getObject(path);
  if (error || !data) return NextResponse.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });

  if (format === "cards") {
    const cards = await parseXlsxCards(data.body, yearFromPath(path));
    if (cards) return NextResponse.json({ ok: true, ...cards });
    const html = await renderXlsxHtml(data.body);
    return NextResponse.json({ ok: true, template: false, html: html ?? "" });
  }

  const html = await renderXlsxHtml(data.body);
  if (html === null) return NextResponse.json({ error: "엑셀 파싱 실패" }, { status: 422 });
  return NextResponse.json({ ok: true, html });
}

// POST: 업로드 전 미리보기용 — 저장 없이 올린 파일 바이트를 바로 렌더
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const deptId = String(form.get("dept_id") || "");
  const format = String(form.get("format") || "");
  const fallbackYear = Number(form.get("year")) || null;
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

  if (format === "cards") {
    const cards = await parseXlsxCards(bytes, fallbackYear);
    if (cards) return NextResponse.json({ ok: true, ...cards });
    const html = await renderXlsxHtml(bytes);
    return NextResponse.json({ ok: true, template: false, html: html ?? "" });
  }

  const html = await renderXlsxHtml(bytes);
  if (html === null) return NextResponse.json({ error: "엑셀 파싱 실패" }, { status: 422 });
  return NextResponse.json({ ok: true, html });
}
