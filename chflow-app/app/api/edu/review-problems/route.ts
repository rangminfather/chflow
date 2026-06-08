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

// PPTX XML 텍스트 노드 분리로 생기는 공백 오염 후처리
// 규칙1: 문장부호 앞 공백 제거 ("했나요 ?" → "했나요?")
// 규칙2: 숫자+한국어 단위 사이 공백 제거 ("7 장 10 절" → "7장 10절")
function postprocessText(text: string): string {
  return text
    .replace(/ ([?!.,])/g, "$1")
    .replace(/(\d+)\s+(장|절|과|편|권|호|번)/g, "$1$2")
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

  const title = postprocessText(cleanText((slides[0] || []).join(" ")) || name);
  const quizzes = slides.slice(1).map(parseQuizSlide).filter((quiz): quiz is ParsedQuiz => Boolean(quiz)).map((quiz) => ({
    ...quiz,
    question: postprocessText(quiz.question),
    choices: quiz.choices.map(postprocessText),
  }));
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

// ─── Index (경량 목록 파일) ──────────────────────────────────────────────────

const INDEX_FILE = "review-index.json";

interface IndexEntry {
  path: string;        // PPTX storage path
  jsonPath: string;    // JSON sidecar path
  lessonNum: string;
  specialTitle: string;
  title: string;
  quizCount: number;
  created_at: string | null;
  size: number | null;
}

function jsonPathFor(pptxPath: string) {
  return pptxPath.replace(/\.pptx$/i, ".json");
}

// 파일명 prefix(lesson-N_)에서 lessonNum 추출 (PPTX 다운로드 없이)
function lessonFromStorageName(name: string): string {
  const prefix = name.match(/^lesson-(\d+)_/);
  if (prefix) return prefix[1];
  return lessonFromTitle(name);
}

async function readIndex(admin: ReturnType<typeof adminClient>, deptId: string): Promise<IndexEntry[]> {
  const { data } = await admin.storage.from(REVIEW_BUCKET).download(`${deptId}/${INDEX_FILE}`);
  if (!data) return [];
  try { return JSON.parse(await data.text()) as IndexEntry[]; } catch { return []; }
}

async function saveIndex(admin: ReturnType<typeof adminClient>, deptId: string, entries: IndexEntry[]) {
  const sorted = [...entries].sort((a, b) => {
    const al = Number(a.lessonNum || 9999), bl = Number(b.lessonNum || 9999);
    return al !== bl ? al - bl : (a.title || "").localeCompare(b.title || "", "ko");
  });
  await admin.storage.from(REVIEW_BUCKET).upload(
    `${deptId}/${INDEX_FILE}`,
    Buffer.from(JSON.stringify(sorted)),
    { contentType: "application/json", upsert: true }
  );
}

// 스토리지 목록에서 index 재구성 (JSON 사이드카 있으면 정확한 메타데이터 사용)
async function rebuildIndex(admin: ReturnType<typeof adminClient>, deptId: string): Promise<IndexEntry[]> {
  const { data, error } = await admin.storage.from(REVIEW_BUCKET).list(deptId, { limit: 200 });
  if (error) throw error;
  const allNames = new Set((data || []).map((f) => f.name));
  const pptxItems = (data || []).filter((f) => /\.pptx$/i.test(f.name));

  const entries: IndexEntry[] = [];
  for (const item of pptxItems) {
    const pptxPath = `${deptId}/${item.name}`;
    const jsonPath = jsonPathFor(pptxPath);
    const jsonName = item.name.replace(/\.pptx$/i, ".json");
    const lessonNum = lessonFromStorageName(item.name);

    let entry: IndexEntry = {
      path: pptxPath,
      jsonPath,
      lessonNum,
      specialTitle: "",
      title: lessonNum ? `${lessonNum}과 복습문제` : item.name,
      quizCount: 0,
      created_at: item.created_at,
      size: item.metadata?.size || null,
    };

    // JSON 사이드카 있으면 정확한 데이터로 덮어쓰기
    if (allNames.has(jsonName)) {
      const { data: blob } = await admin.storage.from(REVIEW_BUCKET).download(jsonPath);
      if (blob) {
        try {
          const parsed = JSON.parse(await blob.text()) as ParsedReviewProblem;
          entry = { ...entry, lessonNum: parsed.lessonNum, specialTitle: parsed.specialTitle, title: parsed.title, quizCount: parsed.quizzes.length };
        } catch { /* JSON 파손 무시 */ }
      }
    }
    entries.push(entry);
  }

  await saveIndex(admin, deptId, entries);
  return entries;
}

async function addToIndex(admin: ReturnType<typeof adminClient>, deptId: string, parsed: ParsedReviewProblem, pptxPath: string) {
  const existing = await readIndex(admin, deptId);
  const entry: IndexEntry = {
    path: pptxPath,
    jsonPath: jsonPathFor(pptxPath),
    lessonNum: parsed.lessonNum,
    specialTitle: parsed.specialTitle,
    title: parsed.title,
    quizCount: parsed.quizzes.length,
    created_at: new Date().toISOString(),
    size: parsed.size,
  };
  const next = existing.filter((e) => e.path !== pptxPath).concat(entry);
  await saveIndex(admin, deptId, next);
}

async function removeFromIndex(admin: ReturnType<typeof adminClient>, deptId: string, pptxPath: string) {
  const existing = await readIndex(admin, deptId);
  await saveIndex(admin, deptId, existing.filter((e) => e.path !== pptxPath));
}

// JSON 사이드카 저장 (quizzes 포함 전체 데이터)
async function saveJsonSidecar(admin: ReturnType<typeof adminClient>, pptxPath: string, problem: ParsedReviewProblem) {
  await admin.storage.from(REVIEW_BUCKET).upload(
    jsonPathFor(pptxPath),
    Buffer.from(JSON.stringify(problem)),
    { contentType: "application/json", upsert: true }
  );
}

// 특정 파일의 quizzes 포함 전체 데이터 가져오기
// JSON 사이드카 없으면 PPTX 파싱 후 사이드카 저장 (기존 파일 폴백)
async function fetchFullProblem(admin: ReturnType<typeof adminClient>, jsonPath: string): Promise<ParsedReviewProblem | null> {
  const { data: jsonData } = await admin.storage.from(REVIEW_BUCKET).download(jsonPath);
  if (jsonData) {
    try { return JSON.parse(await jsonData.text()) as ParsedReviewProblem; } catch { /* fall through */ }
  }

  // 폴백: PPTX 파싱 후 사이드카 자동 생성
  const pptxPath = jsonPath.replace(/\.json$/i, ".pptx");
  const { data: pptxData } = await admin.storage.from(REVIEW_BUCKET).download(pptxPath);
  if (!pptxData) return null;
  try {
    const buffer = Buffer.from(await pptxData.arrayBuffer());
    const fileName = pptxPath.split("/").pop() || pptxPath;
    const parsed = await parseReviewPptx(buffer, fileName, pptxPath, fileName, null, null);
    await saveJsonSidecar(admin, pptxPath, parsed);
    return parsed;
  } catch { return null; }
}

// ─── findMatchedProblem (index 기반) ────────────────────────────────────────

function findMatchedEntry(entries: IndexEntry[], plan?: PlanLesson): IndexEntry | null {
  if (!plan) return null;
  if (plan.lessonNum) return entries.find((e) => e.lessonNum === plan.lessonNum) || null;
  if (plan.specialTitle) return entries.find((e) => e.specialTitle === plan.specialTitle || e.title.includes(plan.specialTitle)) || null;
  return null;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("dept_id");
  const date = req.nextUrl.searchParams.get("date");
  const filePath = req.nextUrl.searchParams.get("file"); // 단일 파일 quizzes fetch
  if (!deptId) return NextResponse.json({ ok: false, error: "dept_id가 필요합니다" }, { status: 400 });

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });

  const admin = adminClient();

  // ① 단일 파일 quizzes 요청 (적용 버튼 클릭 시)
  if (filePath) {
    if (!filePath.startsWith(`${deptId}/`)) return NextResponse.json({ ok: false, error: "접근 불가" }, { status: 403 });
    const problem = await fetchFullProblem(admin, filePath);
    if (!problem) return NextResponse.json({ ok: false, error: "파일을 찾을 수 없습니다" }, { status: 404 });
    return NextResponse.json({ ok: true, problem });
  }

  // ② 목록 요청 — index만 읽음 (경량)
  try {
    await ensureBucket(admin, REVIEW_BUCKET);
    let index = await readIndex(admin, deptId);
    // index가 비어 있으면 스토리지에서 재구성 (최초 1회)
    if (index.length === 0) index = await rebuildIndex(admin, deptId);

    let planStatus = null;
    let match: ParsedReviewProblem | null = null;
    if (date) {
      planStatus = await loadPlanLesson(admin, deptId, date);
      if (planStatus.status === "ready") {
        const entry = findMatchedEntry(index, planStatus.plan);
        if (entry) {
          // 매칭된 1개 파일만 quizzes 포함해서 가져옴
          match = await fetchFullProblem(admin, entry.jsonPath);
          if (!match) planStatus = { ...planStatus, status: "no-review-match" as const, message: "복습문제 파일을 읽을 수 없습니다" };
        } else {
          planStatus = { ...planStatus, status: "no-review-match" as const, message: "월별 계획과 매칭되는 복습문제가 없습니다" };
        }
      }
    }

    return NextResponse.json({ ok: true, problems: index, planStatus, match });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const deptId = String(form.get("dept_id") || "");
  const files = form.getAll("files").filter((file): file is File => file instanceof File);
  if (!deptId || files.length === 0) return NextResponse.json({ ok: false, error: "dept_id와 파일이 필요합니다" }, { status: 400 });

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });

  const admin = adminClient();
  await ensureBucket(admin, REVIEW_BUCKET);

  const uploaded = [];
  for (const file of files) {
    if (!/\.pptx$/i.test(file.name)) return NextResponse.json({ ok: false, error: "PPTX 파일만 업로드할 수 있습니다" }, { status: 400 });
    const bytes = await file.arrayBuffer();
    const parsed = await parseReviewPptx(Buffer.from(bytes), file.name, "", file.name, null, file.size);
    const lessonPart = parsed.lessonNum ? `lesson-${parsed.lessonNum}` : safeSlug(parsed.specialTitle || parsed.title);
    const objectName = `${lessonPart}_${Date.now()}_${safeSlug(file.name)}${safeExtension(file.name)}`;
    const pptxPath = `${deptId}/${objectName}`;

    const { error } = await admin.storage.from(REVIEW_BUCKET).upload(pptxPath, bytes, {
      contentType: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: false,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const fullParsed = { ...parsed, path: pptxPath };
    await Promise.all([
      saveJsonSidecar(admin, pptxPath, fullParsed),
      addToIndex(admin, deptId, fullParsed, pptxPath),
    ]);
    uploaded.push({ path: pptxPath, title: parsed.title, lessonNum: parsed.lessonNum, specialTitle: parsed.specialTitle });
  }

  return NextResponse.json({ ok: true, uploaded });
}

export async function DELETE(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("dept_id");
  const path = req.nextUrl.searchParams.get("path");
  if (!deptId || !path) return NextResponse.json({ ok: false, error: "dept_id와 path가 필요합니다" }, { status: 400 });
  if (!path.startsWith(`${deptId}/`)) return NextResponse.json({ ok: false, error: "다른 부서의 파일을 삭제할 수 없습니다" }, { status: 403 });

  const verified = await verifyGrade(req, deptId);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });

  const admin = adminClient();
  await admin.storage.from(REVIEW_BUCKET).remove([path, jsonPathFor(path)]);
  await removeFromIndex(admin, deptId, path);

  return NextResponse.json({ ok: true });
}
