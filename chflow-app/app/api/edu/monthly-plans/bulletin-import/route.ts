import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
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

function parseMonthDay(value: string) {
  const match = value.match(/(\d{1,2})\s*[./-]\s*(\d{1,2})/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!month || !day) return null;
  return { month, day };
}

function isoFromMonthDay(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  return entries
    .filter((entry) => entry.date === date)
    .map((entry) => ({ ...entry, sheetScore: scoreSheetForMonth(entry.sheetName, month) }))
    .sort((a, b) => b.sheetScore - a.sheetScore || a.fileOrder - b.fileOrder);
}

function readEntriesFromWorkbook(buffer: Buffer, sourceFile: string, fileOrder: number, year: number) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const entries: PlanEntry[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });

    for (const rawRow of rows) {
      const row = Array.from({ length: 12 }, (_, index) => cleanCell(rawRow[index]));
      const parsedDate = parseMonthDay(row[0]);
      if (!parsedDate) continue;

      entries.push({
        date: isoFromMonthDay(year, parsedDate.month, parsedDate.day),
        sourceFile,
        sheetName,
        fileOrder,
        sheetScore: scoreSheetForMonth(sheetName, parsedDate.month),
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

  const admin = adminClient();
  const { data: files, error: listError } = await admin.storage.from(BUCKET).list(deptId, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (listError) return NextResponse.json({ ok: false, error: listError.message }, { status: 500 });

  const planFiles = (files || []).filter((file) => /\.(xls|xlsx|xlsm)$/i.test(file.name));
  const allEntries: PlanEntry[] = [];

  for (let index = 0; index < planFiles.length; index += 1) {
    const file = planFiles[index];
    const path = `${deptId}/${file.name}`;
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !data) continue;
    const buffer = Buffer.from(await data.arrayBuffer());
    allEntries.push(...readEntriesFromWorkbook(buffer, file.name, index, year));
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
