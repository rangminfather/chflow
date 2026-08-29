import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2 } from "@/lib/r2";
import { loadWorkbook } from "@/lib/xlsx-load";
import { resolveMonthlyPlanDate } from "@/lib/monthlyPlanDate";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BUCKET = "monthly-plans";

type PlanFields = {
  guide?: string;
  praise1?: string;
  praise2?: string;
  leader?: string;
  prayerClass?: string;
  scripture?: string;
  sermonTitle?: string;
  preacher?: string;
  nextPrayer?: string;
  lessonNum?: string;
  versePassage?: string;
  twoPartActivity?: string;
};

type PlanEntry = {
  date: string;
  sourceFile: string;
  sheetName: string;
  fileOrder: number;
  sheetScore: number;
  fields: PlanFields;
  raw: {
    sunday: string;
    sermon: string;
    leader: string;
    preacher: string;
    prayer: string;
    praiseTheme: string;
    guide: string;
    praiseDance: string;
    activityTeam: string;
    activity: string;
    note: string;
  };
};

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
  if (!token) return { ok: false as const, status: 401, error: "로그인이 필요합니다" };

  const userClient = authedClient(token);
  const { data: authData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !authData.user) return { ok: false as const, status: 401, error: "로그인이 만료되었습니다" };

  const gradeResp = await userClient.rpc("get_user_grade", { p_dept_id: deptId });
  const grade = typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data);
  if (!Number.isFinite(grade) || grade > 4) {
    return { ok: false as const, status: 403, error: "부서 접근 권한이 없습니다" };
  }
  return { ok: true as const };
}

function cleanCell(value: unknown) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function validIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Excel 날짜 셀은 Date/ISO/M-D/일련번호 중 어느 형태로도 들어올 수 있다. */
function parsePlanDate(value: string, fallbackYear: number) {
  const normalized = cleanCell(value);
  const full = normalized.match(/^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\D.*)?$/);
  if (full) return validIsoDate(Number(full[1]), Number(full[2]), Number(full[3]));

  const monthDay = normalized.match(/^(\d{1,2})\s*(?:[./-]|월)\s*(\d{1,2})(?:\s*일)?(?:\D.*)?$/);
  if (monthDay) return validIsoDate(fallbackYear, Number(monthDay[1]), Number(monthDay[2]));

  // Excel 1900 날짜 체계의 일련번호. 일반적인 날짜 범위만 허용한다.
  if (/^\d{5}(?:\.\d+)?$/.test(normalized)) {
    const serial = Number(normalized);
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
    const year = date.getUTCFullYear();
    if (year >= 2000 && year <= 2100) {
      return validIsoDate(year, date.getUTCMonth() + 1, date.getUTCDate());
    }
  }
  return null;
}

function nextSunday(date: string) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function scoreSheetForMonth(sheetName: string, month: number) {
  const months = Array.from(sheetName.matchAll(/(\d{1,2})/g)).map((m) => Number(m[1]));
  if (months[0] === month) return 30;
  if (months.includes(month)) return 10;
  return 0;
}

function splitSermonAndScripture(raw: string) {
  const normalized = cleanCell(raw);
  const scriptureMatch = normalized.match(/\(([^()]+)\)\s*$/);
  const scripture = scriptureMatch ? scriptureMatch[1].trim() : "";
  const sermonTitle = scriptureMatch
    ? normalized.slice(0, scriptureMatch.index).replace(/\s*\/\s*$/, "").trim()
    : normalized;
  return { sermonTitle, scripture };
}

function splitPraise(raw: string) {
  const names = cleanCell(raw)
    .split(/[\/,·\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
  return { praise1: names[0] || "", praise2: names[1] || "" };
}

function withKnownPreacherTitle(name: string) {
  const value = cleanCell(name);
  if (!value) return "";
  if (value === "김희숙") return "김희숙 전도사";
  return value;
}

function withKnownPrayerTitle(name: string) {
  const value = cleanCell(name);
  if (!value) return "";
  if (value === "김정권") return "김정권장로님";
  return value;
}

function extractLessonNum(activity: string) {
  const match = cleanCell(activity).match(/(\d+)\s*과/);
  return match?.[1] || "";
}

function extractVersePassage(note: string) {
  const match = cleanCell(note).match(/요절\s*[:：]?\s*(.+)$/);
  return match?.[1]?.trim() || "";
}

function fieldsFromRow(row: string[]): PlanFields {
  const sermon = splitSermonAndScripture(row[1] || "");
  const praise = splitPraise(row[7] || "");
  const activity = cleanCell(row[10] || "");
  const note = cleanCell(row[11] || "");
  const fields: PlanFields = {};

  if (row[6]) fields.guide = cleanCell(row[6]);
  if (praise.praise1) fields.praise1 = praise.praise1;
  if (praise.praise2) fields.praise2 = praise.praise2;
  if (row[2]) fields.leader = cleanCell(row[2]);
  if (row[4]) fields.prayerClass = withKnownPrayerTitle(row[4]);
  if (sermon.scripture) fields.scripture = sermon.scripture;
  if (sermon.sermonTitle) fields.sermonTitle = sermon.sermonTitle;
  if (row[3]) fields.preacher = withKnownPreacherTitle(row[3]);
  if (activity) fields.twoPartActivity = activity;

  const lessonNum = extractLessonNum(activity);
  if (lessonNum) fields.lessonNum = lessonNum;

  const versePassage = extractVersePassage(note);
  if (versePassage) fields.versePassage = versePassage;

  return fields;
}

function sortEntriesForDate(entries: PlanEntry[], date: string) {
  const month = Number(date.slice(5, 7));
  const matchedDate = resolveMonthlyPlanDate(date, entries.map((entry) => entry.date));
  if (!matchedDate) return [];
  const matches = entries
    .filter((entry) => entry.date === matchedDate)
    .map((entry) => ({ ...entry, sheetScore: scoreSheetForMonth(entry.sheetName, month) }));

  // 월간계획 화면과 동일하게 최신 파일 안의 같은 날짜 행을 셀 단위로 합친다.
  // 실제 양식은 한 날짜의 역할/설교 값이 여러 시트 또는 중복 행에 나뉠 수 있다.
  const latestFileOrder = Math.min(...matches.map((entry) => entry.fileOrder));
  const sameFile = matches.filter((entry) => entry.fileOrder === latestFileOrder);
  const merged = sameFile.slice(1).reduce<PlanEntry>((current, entry) => ({
    ...current,
    sheetName: current.sheetName === entry.sheetName
      ? current.sheetName
      : `${current.sheetName}, ${entry.sheetName}`,
    sheetScore: Math.max(current.sheetScore, entry.sheetScore),
    fields: { ...current.fields, ...entry.fields },
    raw: Object.fromEntries(
      Object.keys(current.raw).map((key) => {
        const rawKey = key as keyof PlanEntry["raw"];
        return [rawKey, entry.raw[rawKey] || current.raw[rawKey]];
      }),
    ) as PlanEntry["raw"],
  }), sameFile[0]);

  return [merged];
}

function xlCellToStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "object") {
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map(r => r.text).join("");
    if ("formula" in v) return String((v as { result?: unknown }).result ?? "");
    if ("hyperlink" in v) return String((v as { text?: unknown }).text ?? "");
    if ("error" in v) return "";
  }
  return String(v);
}

async function readEntriesFromWorkbook(buffer: Buffer, sourceFile: string, fileOrder: number, year: number) {
  const entries: PlanEntry[] = [];
  const wb = await loadWorkbook(buffer);
  if (!wb) return entries; // 깨진 파일 하나가 전체 가져오기를 막지 않도록 건너뜀

  for (const ws of wb.worksheets) {
    const sheetName = ws.name;
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1);
      rows.push(Array.from({ length: 12 }, (_, i) => xlCellToStr(vals[i])));
    });

    for (const rawRow of rows) {
      const row = Array.from({ length: 12 }, (_, index) => cleanCell(rawRow[index]));
      const parsedDate = parsePlanDate(row[0], year);
      if (!parsedDate) continue;

      entries.push({
        date: parsedDate,
        sourceFile,
        sheetName,
        fileOrder,
        sheetScore: scoreSheetForMonth(sheetName, Number(parsedDate.slice(5, 7))),
        fields: fieldsFromRow(row),
        raw: {
          sunday: row[0],
          sermon: row[1],
          leader: row[2],
          preacher: row[3],
          prayer: row[4],
          praiseTheme: row[5],
          guide: row[6],
          praiseDance: row[7],
          activityTeam: row[9],
          activity: row[10],
          note: row[11],
        },
      });
    }
  }

  return entries;
}

export async function GET(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("dept_id");
  const date = req.nextUrl.searchParams.get("date");
  if (!deptId || !date) {
    return NextResponse.json({ ok: false, error: "dept_id와 date가 필요합니다" }, { status: 400 });
  }

  const year = Number(date.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(year)) {
    return NextResponse.json({ ok: false, error: "date 형식은 YYYY-MM-DD여야 합니다" }, { status: 400 });
  }

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });

  const { data: files, error: listError } = await r2.from(BUCKET).list(deptId, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (listError) return NextResponse.json({ ok: false, error: "처리 중 오류가 발생했습니다." }, { status: 500 });

  const planFiles = (files || []).filter((file) => /\.(xls|xlsx|xlsm)$/i.test(file.name));
  const allEntries: PlanEntry[] = [];

  for (let index = 0; index < planFiles.length; index += 1) {
    const file = planFiles[index];
    const path = `${deptId}/${file.name}`;
    const { data, error } = await r2.from(BUCKET).download(path);
    if (error || !data) continue;
    const buffer = Buffer.from(await data.arrayBuffer());
    allEntries.push(...await readEntriesFromWorkbook(buffer, file.name, index, year));
  }

  const match = sortEntriesForDate(allEntries, date)[0];
  if (!match) {
    return NextResponse.json({ ok: false, error: "선택한 날짜에 해당하는 월간 교육계획 행을 찾지 못했습니다" }, { status: 404 });
  }

  const nextMatch = sortEntriesForDate(allEntries, nextSunday(date))[0];
  const fields = { ...match.fields };
  if (nextMatch?.fields.prayerClass) fields.nextPrayer = nextMatch.fields.prayerClass;

  return NextResponse.json({
    ok: true,
    plan: {
      date: match.date,
      sourceFile: match.sourceFile,
      sheetName: match.sheetName,
      fields,
      raw: match.raw,
      nextPrayerSource: nextMatch
        ? { date: nextMatch.date, sheetName: nextMatch.sheetName, prayer: nextMatch.fields.prayerClass || "" }
        : null,
    },
  });
}
