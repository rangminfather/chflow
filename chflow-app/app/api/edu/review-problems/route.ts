import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REVIEW_BUCKET = "review-problems";
const PLAN_BUCKET = "monthly-plans";

type QuizType = "subjective" | "mc3" | "mc4" | "mc5";

interface ParsedQuiz {
  type: QuizType;
  question: string;
  choices: string[];
}

interface ParsedReviewProblem {
  id: string;
  path: string;
  name: string;
  title: string;
  lessonNum: string;
  specialTitle: string;
  quizzes: ParsedQuiz[];
  created_at: string | null;
  size: number | null;
}

interface PlanLesson {
  date: string;
  lessonNum: string;
  specialTitle: string;
  activity: string;
  sermon: string;
  sourceFile: string;
  sheetName: string;
  fileOrder: number;
  sheetScore: number;
}

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
  return { ok: true as const, grade };
}

async function ensureBucket(admin: ReturnType<typeof adminClient>, bucket: string) {
  const { data } = await admin.storage.getBucket(bucket);
  if (data) return;
  await admin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 30 * 1024 * 1024,
  });
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "");
}

function extractTextsFromShape(shapeXml: string) {
  const texts = Array.from(shapeXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeXmlText(stripTags(match[1])))
    .map(cleanText)
    .filter(Boolean);
  return cleanText(texts.join(" "));
}

function numericSlideName(name: string) {
  const match = name.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function lessonFromTitle(title: string) {
  const match = title.match(/(\d+)\s*과/);
  return match?.[1] || "";
}

function specialFromText(text: string) {
  const normalized = cleanText(text);
  const keywords = ["종려주일", "부활주일", "어린이주일", "나라사랑주일"];
  return keywords.find((keyword) => normalized.includes(keyword)) || "";
}

function quizTypeFromChoices(count: number): QuizType {
  if (count <= 0) return "subjective";
  if (count === 3) return "mc3";
  if (count >= 5) return "mc5";
  return "mc4";
}

function parseQuizSlide(texts: string[]): ParsedQuiz | null {
  const tokens = texts.map(cleanText).filter(Boolean);
  const content = tokens.filter((token) => !/^\d+$/.test(token));
  if (content.length === 0) return null;

  const question = content[0];
  const choices = content.slice(1, 6);
  const type = quizTypeFromChoices(choices.length >= 3 ? choices.length : 0);
  return {
    type,
    question,
    choices: type === "subjective" ? [] : choices.slice(0, type === "mc3" ? 3 : type === "mc4" ? 4 : 5),
  };
}

async function parseReviewPptx(buffer: Buffer, id: string, path: string, name: string, createdAt: string | null, size: number | null): Promise<ParsedReviewProblem> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((fileName) => /^ppt\/slides\/slide\d+\.xml$/.test(fileName))
    .sort((a, b) => numericSlideName(a) - numericSlideName(b));

  const slides: string[][] = [];
  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)?.async("string");
    if (!xml) continue;
    const shapes = Array.from(xml.matchAll(/<p:sp[\s\S]*?<\/p:sp>/g))
      .map((match) => extractTextsFromShape(match[0]))
      .filter(Boolean);
    slides.push(shapes);
  }

  const title = cleanText((slides[0] || []).join(" ")) || name;
  const quizzes = slides.slice(1).map(parseQuizSlide).filter((quiz): quiz is ParsedQuiz => Boolean(quiz));
  const lessonNum = lessonFromTitle(`${title} ${name}`);
  const specialTitle = specialFromText(`${title} ${name}`);

  return {
    id,
    path,
    name,
    title,
    lessonNum,
    specialTitle,
    quizzes,
    created_at: createdAt,
    size,
  };
}

function safeExtension(name: string) {
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const clean = (ext || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return clean ? `.${clean.toLowerCase()}` : "";
}

function safeSlug(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "review";
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

function scoreSheetForMonth(sheetName: string, month: number) {
  const months = Array.from(sheetName.matchAll(/(\d{1,2})/g)).map((match) => Number(match[1]));
  if (months[0] === month) return 30;
  if (months.includes(month)) return 10;
  return 0;
}

function readLessonsFromWorkbook(buffer: Buffer, sourceFile: string, fileOrder: number, year: number) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const lessons: PlanLesson[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });

    for (const rawRow of rows) {
      const row = Array.from({ length: 12 }, (_, index) => cleanText(rawRow[index]));
      const parsedDate = parseMonthDay(row[0]);
      if (!parsedDate) continue;
      const activity = row[10] || "";
      const sermon = row[1] || "";
      lessons.push({
        date: isoFromMonthDay(year, parsedDate.month, parsedDate.day),
        lessonNum: lessonFromTitle(activity),
        specialTitle: specialFromText(`${sermon} ${activity}`),
        activity,
        sermon,
        sourceFile,
        sheetName,
        fileOrder,
        sheetScore: scoreSheetForMonth(sheetName, parsedDate.month),
      });
    }
  }

  return lessons;
}

async function loadPlanLesson(admin: ReturnType<typeof adminClient>, deptId: string, date: string) {
  const { data: files, error } = await admin.storage.from(PLAN_BUCKET).list(deptId, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) return { status: "missing-plan" as const, message: "월별 계획표가 없습니다" };

  const planFiles = (files || []).filter((file) => /\.(xls|xlsx|xlsm)$/i.test(file.name));
  if (planFiles.length === 0) return { status: "missing-plan" as const, message: "월별 계획표가 없습니다" };

  const year = Number(date.slice(0, 4));
  const allLessons: PlanLesson[] = [];
  for (let index = 0; index < planFiles.length; index += 1) {
    const file = planFiles[index];
    const path = `${deptId}/${file.name}`;
    const { data } = await admin.storage.from(PLAN_BUCKET).download(path);
    if (!data) continue;
    const buffer = Buffer.from(await data.arrayBuffer());
    allLessons.push(...readLessonsFromWorkbook(buffer, file.name, index, year));
  }

  const month = Number(date.slice(5, 7));
  const plan = allLessons
    .filter((lesson) => lesson.date === date)
    .map((lesson) => ({ ...lesson, sheetScore: scoreSheetForMonth(lesson.sheetName, month) }))
    .sort((a, b) => b.sheetScore - a.sheetScore || a.fileOrder - b.fileOrder)[0];

  if (!plan) return { status: "no-date-row" as const, message: "월별 계획표에 해당 주차가 없습니다" };
  if (!plan.lessonNum && !plan.specialTitle) {
    return { status: "no-lesson" as const, message: "월별 계획과 매칭되는 공과 정보가 없습니다", plan };
  }
  return { status: "ready" as const, message: "월별 계획표 공과 정보를 찾았습니다", plan };
}

function findMatchedProblem(problems: ParsedReviewProblem[], plan?: PlanLesson) {
  if (!plan) return null;
  if (plan.lessonNum) {
    return problems.find((problem) => problem.lessonNum === plan.lessonNum) || null;
  }
  if (plan.specialTitle) {
    return problems.find((problem) => problem.specialTitle === plan.specialTitle || problem.title.includes(plan.specialTitle)) || null;
  }
  return null;
}

async function loadReviewProblems(admin: ReturnType<typeof adminClient>, deptId: string) {
  await ensureBucket(admin, REVIEW_BUCKET);
  const { data, error } = await admin.storage.from(REVIEW_BUCKET).list(deptId, {
    limit: 200,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw error;

  const files = (data || []).filter((item) => /\.(pptx)$/i.test(item.name));
  const problems: ParsedReviewProblem[] = [];
  for (const item of files) {
    const path = `${deptId}/${item.name}`;
    const { data: blob } = await admin.storage.from(REVIEW_BUCKET).download(path);
    if (!blob) continue;
    const buffer = Buffer.from(await blob.arrayBuffer());
    problems.push(await parseReviewPptx(
      buffer,
      item.name,
      path,
      item.name,
      item.created_at,
      item.metadata?.size || null
    ));
  }

  return problems.sort((a, b) => {
    const aLesson = Number(a.lessonNum || 9999);
    const bLesson = Number(b.lessonNum || 9999);
    if (aLesson !== bLesson) return aLesson - bLesson;
    return a.title.localeCompare(b.title, "ko");
  });
}

export async function GET(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("dept_id");
  const date = req.nextUrl.searchParams.get("date");
  if (!deptId) return NextResponse.json({ ok: false, error: "dept_id가 필요합니다" }, { status: 400 });

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });

  const admin = adminClient();
  try {
    const problems = await loadReviewProblems(admin, deptId);
    let planStatus = null;
    let match = null;
    if (date) {
      planStatus = await loadPlanLesson(admin, deptId, date);
      if (planStatus.status === "ready") {
        match = findMatchedProblem(problems, planStatus.plan);
        if (!match) {
          planStatus = { ...planStatus, status: "no-review-match" as const, message: "월별 계획과 매칭되는 복습문제가 없습니다" };
        }
      }
    }

    return NextResponse.json({ ok: true, problems, planStatus, match });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const deptId = String(form.get("dept_id") || "");
  const files = form.getAll("files").filter((file): file is File => file instanceof File);

  if (!deptId || files.length === 0) {
    return NextResponse.json({ ok: false, error: "dept_id와 파일이 필요합니다" }, { status: 400 });
  }

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });

  const admin = adminClient();
  await ensureBucket(admin, REVIEW_BUCKET);

  const uploaded = [];
  for (const file of files) {
    if (!/\.pptx$/i.test(file.name)) {
      return NextResponse.json({ ok: false, error: "PPTX 파일만 업로드할 수 있습니다" }, { status: 400 });
    }
    const bytes = await file.arrayBuffer();
    const parsed = await parseReviewPptx(Buffer.from(bytes), file.name, "", file.name, null, file.size);
    const lessonPart = parsed.lessonNum ? `lesson-${parsed.lessonNum}` : safeSlug(parsed.specialTitle || parsed.title);
    const objectName = `${lessonPart}_${Date.now()}_${safeSlug(file.name)}${safeExtension(file.name)}`;
    const path = `${deptId}/${objectName}`;
    const { error } = await admin.storage.from(REVIEW_BUCKET).upload(path, bytes, {
      contentType: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: false,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    uploaded.push({ path, title: parsed.title, lessonNum: parsed.lessonNum, specialTitle: parsed.specialTitle });
  }

  return NextResponse.json({ ok: true, uploaded });
}

export async function DELETE(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("dept_id");
  const path = req.nextUrl.searchParams.get("path");

  if (!deptId || !path) {
    return NextResponse.json({ ok: false, error: "dept_id와 path가 필요합니다" }, { status: 400 });
  }

  if (!path.startsWith(`${deptId}/`)) {
    return NextResponse.json({ ok: false, error: "다른 부서의 파일을 삭제할 수 없습니다" }, { status: 403 });
  }

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });

  const admin = adminClient();
  const { error } = await admin.storage.from(REVIEW_BUCKET).remove([path]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
