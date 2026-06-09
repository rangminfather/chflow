"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";

// ─────────────────────────────────────────────────────────────────
// 폼 정의
// ─────────────────────────────────────────────────────────────────
// 2페이지 기본값 — 거의 매주 동일하므로 자동 입력 (수정 가능)
const DEFAULT_START_TIME = "10시 50분";
const DEFAULT_LEADER = "최성헌 부장";
const DEFAULT_PREACHER = "김희숙 전도사";
const DEFAULT_PRAISE1 = "신예슬";
const DEFAULT_PRAISE2 = "최성현";

const EMPTY_FORM = {
  date: "",
  issueNumber: "",      // 호수 (자동값 default + 수정 가능)
  pageOneVerse: "",     // 1페이지 표어 구절 (사진 밑) — 별도 등록 시스템에서 자동 채움
  startTime: DEFAULT_START_TIME, // 시작시간

  // 1부 예배
  guide: "",
  praise1: DEFAULT_PRAISE1,
  praise2: DEFAULT_PRAISE2,
  leader: DEFAULT_LEADER,
  theme: "",            // 주제제창 (연도 표어에서 자동 채움, 수정 가능)
  prayerClass: "",
  scripture: "",
  sermonTitle: "",
  preacher: DEFAULT_PREACHER,
  nextPrayer: "",

  tithe: "",
  thanksgiving: "",

  lessonNum: "",
  versePassage: "",      // 요절암송 (3페이지) — NEW
  q1: "",
  q1c1: "",
  q1c2: "",
  q1c3: "",
  q1c4: "",
  q2: "",
  q2c1: "",
  q2c2: "",
  q2c3: "",
  q2c4: "",
  q3: "",
  q3c1: "",
  q3c2: "",
  q3c3: "",
  q3c4: "",
  q4: "",                 // 26년 양식 신규 (보기 없음)

  // 광고 / 2부행사 (26년 양식 매핑 가능)
  announcement: "",          // 광고/공지 본문 (자유 텍스트, hwpx에는 자리 없음 — 향후)
  announcementAuthor: "",    // 광고 담당 (예: "총무선생님") - hwpx 매핑 있음
  twoPartActivity: "",       // 2부행사 안내 (예: "14과 공과공부, 찬양연습")

  newFriend: "",
};

type FormState = typeof EMPTY_FORM;

const SUPPORTED_DEPT = "초등1부";

interface YearlyTheme {
  theme: string;
  scripture_ref: string | null;
  page_one_verse: string | null;  // 1페이지 표어 (긴 본문) — 1년에 1번 등록 → 매주 자동 채움
  updated_at: string;
}

interface DraftMeta {
  last_edited_by: string | null;
  last_edited_at: string;
}

type MonthlyPlanImportField = Extract<
  keyof FormState,
  | "guide"
  | "praise1"
  | "praise2"
  | "leader"
  | "prayerClass"
  | "scripture"
  | "sermonTitle"
  | "preacher"
  | "nextPrayer"
  | "lessonNum"
  | "versePassage"
  | "twoPartActivity"
>;

interface MonthlyPlanImport {
  date: string;
  sourceFile: string;
  sheetName: string;
  fields: Partial<Record<MonthlyPlanImportField, string>>;
  raw: {
    sunday: string;
    sermon: string;
    leader: string;
    preacher: string;
    prayer: string;
    guide: string;
    praiseDance: string;
    activity: string;
    note: string;
  };
  nextPrayerSource: {
    date: string;
    sheetName: string;
    prayer: string;
  } | null;
}

const MONTHLY_PLAN_FIELD_LABELS: Array<{ key: MonthlyPlanImportField; label: string }> = [
  { key: "sermonTitle", label: "강론 제목" },
  { key: "scripture", label: "성경봉독" },
  { key: "leader", label: "예배인도" },
  { key: "preacher", label: "말씀" },
  { key: "prayerClass", label: "기도" },
  { key: "nextPrayer", label: "다음 주 기도" },
  { key: "guide", label: "안내" },
  { key: "praise1", label: "찬양율동 1" },
  { key: "praise2", label: "찬양율동 2" },
  { key: "twoPartActivity", label: "2부 행사" },
  { key: "lessonNum", label: "공과 회차" },
  { key: "versePassage", label: "요절암송" },
];

interface ReviewQuiz {
  type: QuizType;
  question: string;
  choices: string[];
}

// 경량 목록 항목 (quizzes 미포함)
interface ReviewIndex {
  path: string;
  jsonPath: string;
  title: string;
  lessonNum: string;
  specialTitle: string;
  quizCount: number;
  created_at: string | null;
  size: number | null;
}

// 전체 데이터 (적용 시 개별 fetch)
interface ReviewProblem {
  id: string;
  path: string;
  jsonPath?: string;
  name: string;
  title: string;
  lessonNum: string;
  specialTitle: string;
  quizzes: ReviewQuiz[];
}

interface ReviewPlanStatus {
  status: "missing-plan" | "no-date-row" | "no-lesson" | "ready" | "no-review-match";
  message: string;
  plan?: {
    lessonNum: string;
    specialTitle: string;
    activity: string;
    sermon: string;
    sheetName: string;
  };
}

// ─────────────────────────────────────────────────────────────────
// 호수 계산
// ─────────────────────────────────────────────────────────────────
function calcIssueNumber(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  if (d.getDay() !== 0) return "";
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const firstSun = new Date(jan1);
  while (firstSun.getDay() !== 0) firstSun.setDate(firstSun.getDate() + 1);
  const diffDays = Math.round((d.getTime() - firstSun.getTime()) / 86400000);
  const nn = Math.floor(diffDays / 7) + 1;
  const yy = year % 100;
  return `제${yy}-${nn}호`;
}

function nextSundayDate(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatKoreanDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return "방금 전";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  return `${Math.floor(diffSec / 86400)}일 전`;
}

// ─────────────────────────────────────────────────────────────────
// hwpx 치환 — 26년 4월 26일자 양식 기준
// 대부분 hp:t 단순 치환. 일부는 <hp:fwSpace/> 끼어있어 raw XML chunk 단위로 치환.
// ─────────────────────────────────────────────────────────────────
function buildReplacements(form: FormState): Record<string, string> {
  return {
    // 단순 텍스트
    "2026년 4월 26일": formatKoreanDate(form.date),
    "✿안내 : 박희연 선생님 ": `✿안내 : ${form.guide || "(미입력)"} 선생님 `,
    "신예슬 최성현 선생님": `${form.praise1 || ""} ${form.praise2 || ""} 선생님`,
    // 예배인도: 사용자가 직책 포함 자유 입력 (예: "최성헌 부장", "박양흠 부감")
    "최성헌부장선생님": `${form.leader || "(미입력)"}선생님`,
    "하나님의 안경으로 세상을 바라보는 어린이": form.theme || "(주제 미입력)",
    // 기도: 사용자 입력 그대로 (반/이름/장로 등 형태 다양 — "(반)" 자동 부착 X)
    "2-3반": form.prayerClass || "?",
    "창세기 11장 1~9절": form.scripture || "(성경본문 미입력)",
    "우리는 배울 때 무엇을 조심해야 할까요?": form.sermonTitle || "(설교제목 미입력)",
    // 강론자: 사용자가 직책 포함 자유 입력 (예: "김희숙 전도사", "박지성 목사")
    "김희숙전도사님": `${form.preacher || "?"}님`,
    "✿다음 주 기도 : 김정권장로님": `✿다음 주 기도 : ${form.nextPrayer || "(미입력)"}`,
    "십일조 : ": `십일조 : ${form.tithe || ""}`,
    "감사헌금 : ": `감사헌금 : ${form.thanksgiving || ""}`,
    "차난(1학년)-자진": form.newFriend || "(미입력)",
    "14과 공과 퀴즈": `${form.lessonNum || "?"}과 공과 퀴즈`,

    // 퀴즈 1번 (보기 ① 단독, ②③④ 가로묶음)
    "1. 사람들은 왜 바벨탑을 쌓으려고 했나요?": `1. ${form.q1 || "(문제 미입력)"}`,
    "  ① 하나님께 닿으려고, 자기 이름을 높이려고 ": `  ① ${form.q1c1 || ""} `,
    "  ② 새로운 집을 만들려고  ③ 돈을 벌려고  ④ 친구를 위해":
      `  ② ${form.q1c2 || ""}  ③ ${form.q1c3 || ""}  ④ ${form.q1c4 || ""}`,

    // 퀴즈 2번 (문제 2줄, 보기 ①② / ③④ 두 줄)
    " 2. 하나님은 사람들이 스스로 높이 올라가려는 것을 보시고 ": ` 2. ${form.q2 || "(문제 미입력)"} `,
    "   어떻게 하셨나요?": "   ",  // 둘째 줄은 비움 (사용자 폼은 한 줄로 받음)
    "  ① 칭찬하셨다.                        ② 그냥 두셨다. ":
      `  ① ${form.q2c1 || ""}                        ② ${form.q2c2 || ""} `,
    "  ③ 사람들의 언어를 혼잡하게 하셨다.       ④ 집을 부수셨다.":
      `  ③ ${form.q2c3 || ""}       ④ ${form.q2c4 || ""}`,

    // 퀴즈 3번 (보기 ①② / ③④ 두 줄)
    " 3. 하나님이 언어를 혼잡하게 하신 결과, 사람들은 어떻게 되었나요?":
      ` 3. ${form.q3 || "(문제 미입력)"}`,
    "  ① 다른 언어를 배웠다.         ② 말이 통하지 않아 흩어졌다.":
      `  ① ${form.q3c1 || ""}         ② ${form.q3c2 || ""}`,
    "  ③ 더 빨리 탑을 쌓았다.        ④ 아무 일도 일어나지 않았다.":
      `  ③ ${form.q3c3 || ""}        ④ ${form.q3c4 || ""}`,

    // 퀴즈 4번 (26년 신규, 보기 자리 없음)
    " 4. 우리는 배울 때 무엇을 경계해야 하나요?": ` 4. ${form.q4 || "(문제 미입력)"}`,

    // 광고 담당
    "총무<hp:fwSpace/>선생님": `${form.announcementAuthor || "총무"}<hp:fwSpace/>선생님`,
  };
}

// 추가: <hp:t> 태그 안에 <hp:fwSpace/> 같은 자식 노드가 있는 경우
// 단순 hp:t 텍스트 치환으로 안 잡히므로 raw XML chunk 단위로 치환
// 호수, 2부행사 같은 항목.
function buildRawReplacements(form: FormState): Record<string, string> {
  return {
    // 호수 (제26-17호)
    "<hp:t>제26<hp:fwSpace/>- 17호</hp:t>":
      `<hp:t>${form.issueNumber || "제??-??호"}</hp:t>`,
    // 2부행사
    "<hp:t>✿2부<hp:fwSpace/>행사 : 14과 공과공부 , 찬양연습</hp:t>":
      `<hp:t>✿2부<hp:fwSpace/>행사 : ${form.twoPartActivity || "(미입력)"}</hp:t>`,
  };
}

// ─────────────────────────────────────────────────────────────────
// 사진 처리 — 브라우저 Canvas 로 jpg 변환 + 리사이즈
// ─────────────────────────────────────────────────────────────────
async function fileToJpgBytes(file: File, maxLongSide = 1500, quality = 0.85): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    i.src = url;
  });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > maxLongSide ? maxLongSide / longSide : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => b ? res(b) : rej(new Error("jpg 변환 실패")), "image/jpeg", quality)
  );
  return new Uint8Array(await blob.arrayBuffer());
}

// 빈 슬롯용 흰색 plain jpg (사진 부족할 때 채워넣음)
let cachedWhiteJpg: Uint8Array | null = null;
async function getWhitePlaceholder(): Promise<Uint8Array> {
  if (cachedWhiteJpg) return cachedWhiteJpg;
  const canvas = document.createElement("canvas");
  canvas.width = 1500; canvas.height = 1000;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1500, 1000);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => b ? res(b) : rej(new Error("placeholder 생성 실패")), "image/jpeg", 0.6)
  );
  cachedWhiteJpg = new Uint8Array(await blob.arrayBuffer());
  return cachedWhiteJpg;
}

// ─────────────────────────────────────────────────────────────────
// hwpx 생성 — 텍스트 치환 + 사진 4슬롯 교체
// ─────────────────────────────────────────────────────────────────
async function generateHwpx(form: FormState, photos: Array<File | null>): Promise<Blob> {
  const JSZipMod = (await import("jszip")).default;
  const res = await fetch("/templates/elem1-bulletin-template.hwpx");
  if (!res.ok) throw new Error(`템플릿 로드 실패: ${res.status}`);
  const templateBuf = await res.arrayBuffer();

  const inZip = await JSZipMod.loadAsync(templateBuf);
  const sectionFile = inZip.file("Contents/section0.xml");
  if (!sectionFile) throw new Error("템플릿에 section0.xml 없음");

  let xml = await sectionFile.async("string");
  // 1. raw XML chunk 치환 (fwSpace 끼어있는 hp:t 등 — buildRawReplacements 가 hp:t 통째)
  for (const [oldStr, newStr] of Object.entries(buildRawReplacements(form))) {
    xml = xml.split(oldStr).join(newStr);
  }
  // 2. hp:t 안의 텍스트 치환 (단순)
  for (const [oldStr, newStr] of Object.entries(buildReplacements(form))) {
    xml = xml.split(`<hp:t>${oldStr}</hp:t>`).join(`<hp:t>${newStr}</hp:t>`);
  }

  // 사진 슬롯 4개 처리: image3.jpg ~ image6.jpg
  // photos[0] → image3, ..., photos[3] → image6
  // null 인 슬롯은 흰색 placeholder
  const photoBytes: Uint8Array[] = [];
  for (let i = 0; i < 4; i++) {
    const f = photos[i];
    if (f) {
      photoBytes.push(await fileToJpgBytes(f));
    } else {
      photoBytes.push(await getWhitePlaceholder());
    }
  }

  const outZip = new JSZipMod();
  const mimeFile = inZip.file("mimetype");
  if (mimeFile) {
    const mime = await mimeFile.async("uint8array");
    outZip.file("mimetype", mime, { compression: "STORE" });
  }
  for (const name of Object.keys(inZip.files)) {
    if (name === "mimetype") continue;
    const f = inZip.files[name];
    if (f.dir) continue;
    if (name === "Contents/section0.xml") {
      outZip.file(name, xml);
    } else if (name === "BinData/image3.jpg") {
      outZip.file(name, photoBytes[0]);
    } else if (name === "BinData/image4.jpg") {
      outZip.file(name, photoBytes[1]);
    } else if (name === "BinData/image5.jpg") {
      outZip.file(name, photoBytes[2]);
    } else if (name === "BinData/image6.jpg") {
      outZip.file(name, photoBytes[3]);
    } else {
      outZip.file(name, await f.async("uint8array"));
    }
  }
  return outZip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

// ─────────────────────────────────────────────────────────────────
// UMS 등록용 텍스트 빌더
// ─────────────────────────────────────────────────────────────────
function buildPostSubject(form: FormState): string {
  if (!form.date) return "초등1초원주보입니다";
  const [, m, d] = form.date.split("-");
  return `${parseInt(m, 10)}월${parseInt(d, 10)}일 초등1초원주보입니다`;
}

function buildPostMemo(form: FormState): string {
  const lines: string[] = [];
  lines.push(`초등1부 주보 (${form.date})`);
  if (form.issueNumber) lines.push(form.issueNumber);
  lines.push("");
  if (form.theme) lines.push(`주제 : ${form.theme}`);
  if (form.scripture) lines.push(`본문 : ${form.scripture}`);
  lines.push("");
  lines.push("─ 주일예배 순서 ─");
  if (form.guide) lines.push(`안내 : ${form.guide}`);
  if (form.praise1 || form.praise2) lines.push(`찬양 : ${[form.praise1, form.praise2].filter(Boolean).join(" ")}`);
  if (form.leader) lines.push(`예배인도 : ${form.leader}`);
  if (form.prayerClass) lines.push(`기도 : ${form.prayerClass}`);
  if (form.scripture) lines.push(`성경봉독 : ${form.scripture}`);
  if (form.sermonTitle) lines.push(`설교제목 : ${form.sermonTitle}`);
  if (form.preacher) lines.push(`강론자 : ${form.preacher}`);
  if (form.nextPrayer) lines.push(`다음 주 기도 : ${form.nextPrayer}`);
  lines.push("");
  if (form.tithe || form.thanksgiving) {
    lines.push("─ 헌금 ─");
    if (form.tithe) lines.push(`십일조 : ${form.tithe}`);
    if (form.thanksgiving) lines.push(`감사헌금 : ${form.thanksgiving}`);
    lines.push("");
  }
  if (form.twoPartActivity) {
    lines.push(`✿2부행사 : ${form.twoPartActivity}`);
  }
  if (form.announcement || form.announcementAuthor) {
    lines.push("");
    lines.push("─ 광고 ─");
    if (form.announcementAuthor) lines.push(`(담당: ${form.announcementAuthor}선생님)`);
    if (form.announcement) lines.push(form.announcement);
  }
  if (form.newFriend) {
    lines.push("");
    lines.push(`새 친구 : ${form.newFriend}`);
  }
  lines.push("");
  lines.push("(chflow 자동작성)");
  return lines.join("\n");
}

// UMS 사무실 게시판 (등록 후 결과 확인용 링크에 사용)
const UMS_BOARD_URL = "http://www.ums.or.kr/bbs/zboard.php?id=samusil&page=1";

// ─────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// 3페이지 — 공과 퀴즈 (동적 N문제)
// ─────────────────────────────────────────────────────────────────
type QuizType = "subjective" | "mc3" | "mc4" | "mc5";

interface QuizItem {
  id: string;
  type: QuizType;
  question: string;
  choices: string[];
}

function quizTypeChoiceCount(t: QuizType): number {
  return t === "subjective" ? 0 : t === "mc3" ? 3 : t === "mc4" ? 4 : 5;
}

function newQuizItem(type: QuizType = "mc4"): QuizItem {
  return {
    id: Math.random().toString(36).slice(2),
    type,
    question: "",
    choices: Array(quizTypeChoiceCount(type)).fill(""),
  };
}

// 유형 변경 시 choices 배열 길이 조정 (입력 보존)
function changeQuizType(quiz: QuizItem, newType: QuizType): QuizItem {
  const newCount = quizTypeChoiceCount(newType);
  const choices = Array(newCount).fill("").map((_, i) => quiz.choices[i] || "");
  return { ...quiz, type: newType, choices };
}

// ─────────────────────────────────────────────────────────────────
// 4페이지 — 목장 현황 (9개 반 × 13컬럼 + 새친구 + 합계)
// ─────────────────────────────────────────────────────────────────
const FARM_CLASSES = ["1-1", "1-2", "1-3", "2-1", "2-2", "2-3", "3-1", "3-2", "3-3"] as const;

interface FarmRow {
  teacher: string;          // 담임 이름 (예: "이분선")
  enrolled: string;         // 재적
  attended: string;         // 출석인원
  bibleCarry: string;       // 성경지참 점수
  verse: string;            // 요절 점수
  quiz: string;             // 주보퀴즈 점수
  homework: string;         // 과제 점수
  evangel: string;          // 전도 점수
  promotion: string;        // 등반 점수
  teacherAttend: string;    // 교사 출석 (0 or 1)
  teacherVisit: string;     // 교사 심방 (0 or 1)
  cumulative: string;       // 누계 (수동 입력, 이전 주까지 누적)
}

const EMPTY_FARM_ROW: FarmRow = {
  teacher: "", enrolled: "", attended: "",
  bibleCarry: "", verse: "", quiz: "", homework: "",
  evangel: "", promotion: "",
  teacherAttend: "", teacherVisit: "",
  cumulative: "",
};

interface FarmData {
  rows: Record<string, FarmRow>;  // key: "1-1", "1-2" ...
  newFriendName: string;
  promotion: string;  // 등반 정보 (자유 텍스트)
}

const EMPTY_FARM: FarmData = {
  rows: Object.fromEntries(FARM_CLASSES.map((c) => [c, { ...EMPTY_FARM_ROW }])),
  newFriendName: "",
  promotion: "",
};

// 한 반의 소계 자동 계산 (점수 합)
function calcRowSubtotal(row: FarmRow): number {
  const att = (parseInt(row.attended) || 0) * 2;  // 출석인원 × 2점
  const fields = [row.bibleCarry, row.verse, row.quiz, row.homework, row.evangel, row.promotion, row.teacherAttend, row.teacherVisit];
  const total = fields.reduce((sum, v) => sum + (parseInt(v) || 0), 0);
  return att + total;
}

// UMS 입장권(PHPSESSID) 시도 정보 — 서버 write_form_attempts 와 동일
interface AttemptInfo {
  i: number;
  elapsed_ms: number;
  worker_ip?: string;
  worker_colo?: string;
  phpsessid: string;
  size: number;
  passed: boolean;
}

// 시도별 입장권 결과 표시 — UMS 가 60% 인정, 40% 거부 → 새 입장권 자동 재시도
function AttemptList({ attempts }: { attempts?: AttemptInfo[] }) {
  if (!attempts || attempts.length === 0) return null;
  const passedCount = attempts.filter((a) => a.passed).length;
  return (
    <div style={{ marginTop: 14, padding: 10, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
        <span>🎲 UMS 입장권 시도 내역</span>
        <span style={{ color: "#94a3b8", fontWeight: 600 }}>
          {passedCount}/{attempts.length} 통과
        </span>
      </div>
      {attempts.map((a) => (
        <div
          key={a.i}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 8px", fontSize: 11, fontFamily: "ui-monospace, monospace",
            background: a.passed ? "#f0fdf4" : "#fef2f2",
            borderLeft: `3px solid ${a.passed ? "#22c55e" : "#ef4444"}`,
            marginBottom: 3, borderRadius: 4,
          }}
        >
          <span style={{ width: 18, textAlign: "center" }}>{a.passed ? "✅" : "❌"}</span>
          <span style={{ width: 26, color: "#94a3b8" }}>#{a.i}</span>
          <span style={{ flex: 1, color: "#475569" }}>{a.phpsessid}…</span>
          <span style={{ color: "#94a3b8" }}>{(a.size / 1024).toFixed(0)}KB</span>
        </div>
      ))}
      {passedCount === 0 && (
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
          ⚠️ UMS 가 모든 입장권을 거부. 잠시 후 다시 시도해주세요.
        </div>
      )}
    </div>
  );
}

// 자동등록 진행 단계 표시 컴포넌트
type PostStepId = "pdf" | "login" | "upload" | "submit" | "done" | "error";
function PostStepper({ currentStep }: { currentStep: PostStepId | null }) {
  const STEPS: { id: PostStepId; label: string; hint: string }[] = [
    { id: "pdf",    label: "PDF 자동 생성",     hint: "주보 데이터 + 사진을 PDF로" },
    { id: "login",  label: "UMS 로그인",         hint: "사이트 접속 + 세션 확보" },
    { id: "upload", label: "PDF 업로드",          hint: "파일을 청크 단위로 전송" },
    { id: "submit", label: "글 등록",             hint: "제목/본문/첨부 최종 제출" },
    { id: "done",   label: "완료",                 hint: "글번호 발급 + 게시판 반영" },
  ];
  const order: Record<PostStepId, number> = { pdf: 0, login: 1, upload: 2, submit: 3, done: 4, error: -1 };
  const curIdx = currentStep ? order[currentStep] : -1;
  const isError = currentStep === "error";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 4px" }}>
      {STEPS.map((s, i) => {
        const status = isError && i === curIdx ? "error"
                     : i < curIdx ? "done"
                     : i === curIdx ? "active"
                     : "pending";
        const icon = status === "done" ? "✅"
                   : status === "active" ? "⏳"
                   : status === "error" ? "❌"
                   : "⚪";
        const labelColor = status === "done" ? "#15803d"
                         : status === "active" ? "#1e293b"
                         : status === "error" ? "#b91c1c"
                         : "#94a3b8";
        return (
          <div key={s.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 12px",
            background: status === "active" ? "#eff6ff" : "transparent",
            borderRadius: 8,
            border: status === "active" ? "1px solid #bfdbfe" : "1px solid transparent",
          }}>
            <div style={{ fontSize: 18, width: 22, textAlign: "center" }}>{icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: status === "active" ? 800 : 600, color: labelColor }}>
                {s.label}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{s.hint}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function WeeklyBulletinPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [form, setForm] = useState<FormState>(() => ({ ...EMPTY_FORM, date: nextSundayDate() }));
  const [toast, setToast] = useState("");
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewUploading, setReviewUploading] = useState(false);
  const [reviewProblems, setReviewProblems] = useState<ReviewIndex[]>([]);
  const [reviewMatch, setReviewMatch] = useState<ReviewProblem | null>(null);
  const [reviewPlanStatus, setReviewPlanStatus] = useState<ReviewPlanStatus | null>(null);
  const [selectedReviewPath, setSelectedReviewPath] = useState("");
  const [reviewError, setReviewError] = useState("");

  const [yearlyTheme, setYearlyTheme] = useState<YearlyTheme | null>(null);
  const [themeEditMode, setThemeEditMode] = useState(false);
  const [themeForm, setThemeForm] = useState({ theme: "", scripture_ref: "", page_one_verse: "" });
  const [themeSaving, setThemeSaving] = useState(false);

  const [draftMeta, setDraftMeta] = useState<DraftMeta | null>(null);
  const [draftList, setDraftList] = useState<Array<{
    issue_date: string;
    issue_number: string | null;
    last_edited_at: string;
  }>>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [photos, setPhotos] = useState<Array<File | null>>([null, null, null, null]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [autoPosting, setAutoPosting] = useState(false);
  type PostStep = "pdf" | "login" | "upload" | "submit" | "done" | "error";
  const [postStep, setPostStep] = useState<PostStep | null>(null);
  // 폼 페이지 — hwpx 의 1/2/3/4 페이지 구조 그대로
  const [currentPage, setCurrentPage] = useState<1 | 2 | 3 | 4>(1);
  // 4페이지 — 목장 현황 데이터 (별도 state, EMPTY_FORM 안 건드림)
  const [farmData, setFarmData] = useState<FarmData>(EMPTY_FARM);
  const setFarmRow = (cls: string, field: keyof FarmRow, value: string) => {
    setFarmData((d) => ({ ...d, rows: { ...d.rows, [cls]: { ...d.rows[cls], [field]: value } } }));
  };

  // 3페이지 — 공과 퀴즈 (동적 N문제, 기본 1문제 4지선다)
  const [quizzes, setQuizzes] = useState<QuizItem[]>([newQuizItem("mc4")]);
  const [showReviewList, setShowReviewList] = useState(false);
  const updateQuiz = (idx: number, next: QuizItem) => {
    setQuizzes((arr) => arr.map((q, i) => i === idx ? next : q));
  };
  const addQuiz = (type: QuizType = "mc4") => {
    setQuizzes((arr) => [...arr, newQuizItem(type)]);
  };
  const removeQuiz = (idx: number) => {
    setQuizzes((arr) => arr.length <= 1 ? arr : arr.filter((_, i) => i !== idx));
  };

  // quizzes → form.q1~q4, q1c1~q3c4 sync (hwpx 출력 호환)
  // hwpx 는 1~4번 고정 자리. 5번 이상 quizzes 는 출력 안 됨.
  useEffect(() => {
    setForm((f) => ({
      ...f,
      q1: quizzes[0]?.question || "",
      q1c1: quizzes[0]?.choices[0] || "",
      q1c2: quizzes[0]?.choices[1] || "",
      q1c3: quizzes[0]?.choices[2] || "",
      q1c4: quizzes[0]?.choices[3] || "",
      q2: quizzes[1]?.question || "",
      q2c1: quizzes[1]?.choices[0] || "",
      q2c2: quizzes[1]?.choices[1] || "",
      q2c3: quizzes[1]?.choices[2] || "",
      q2c4: quizzes[1]?.choices[3] || "",
      q3: quizzes[2]?.question || "",
      q3c1: quizzes[2]?.choices[0] || "",
      q3c2: quizzes[2]?.choices[1] || "",
      q3c3: quizzes[2]?.choices[2] || "",
      q3c4: quizzes[2]?.choices[3] || "",
      q4: quizzes[3]?.question || "",
    }));
  }, [quizzes]);
  const [autoPostResult, setAutoPostResult] = useState<
    | { ok: true; postNo: number; redirectUrl: string; attempts?: AttemptInfo[] }
    | { ok: false; error: string; attempts?: AttemptInfo[] }
    | null
  >(null);
  const [cooldown, setCooldown] = useState<{
    remaining_seconds: number;
    can_post: boolean;
    last_post_no: number | null;
    last_posted_at: string | null;
  } | null>(null);

  // UMS 자격증명 (사용자별)
  const [credsMeta, setCredsMeta] = useState<{
    has_credentials: boolean;
    ums_user_id: string | null;
    updated_at: string | null;
  } | null>(null);
  const [credsModalOpen, setCredsModalOpen] = useState(false);
  const [credsForm, setCredsForm] = useState({ ums_user_id: "", ums_password: "" });
  const [credsSaving, setCredsSaving] = useState(false);

  const skipNextLoadRef = useRef(false);

  async function loadCredsMeta() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const r = await fetch("/api/ums-credentials/mine", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json();
      if (j.ok) {
        setCredsMeta({
          has_credentials: j.has_credentials,
          ums_user_id: j.ums_user_id,
          updated_at: j.updated_at,
        });
      }
    } catch {/* ignore */}
  }

  async function handleSaveCreds() {
    if (!credsForm.ums_user_id.trim() || !credsForm.ums_password) {
      showToast("아이디와 비밀번호를 모두 입력하세요");
      return;
    }
    setCredsSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/ums-credentials/mine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(credsForm),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      showToast("UMS 계정 저장됨 ✅");
      setCredsForm({ ums_user_id: "", ums_password: "" });
      setCredsModalOpen(false);
      await loadCredsMeta();
    } catch (e: unknown) {
      showToast("저장 실패: " + (e as Error).message);
    } finally {
      setCredsSaving(false);
    }
  }

  async function handleDeleteCreds() {
    if (!confirm("등록된 UMS 계정을 삭제하시겠습니까?\n(다시 등록해야 자동등록 가능)")) return;
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch("/api/ums-credentials/mine", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const j = await r.json();
    if (j.ok) {
      showToast("UMS 계정 삭제됨");
      await loadCredsMeta();
    }
  }

  // 페이지 로드 시 쿨다운 상태 fetch (사용자 본인 UMS 계정 기준)
  async function fetchCooldown() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const r = await fetch("/api/ums-bulletin-post/status", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json();
      if (j.ok && j.has_credentials) {
        setCooldown({
          remaining_seconds: j.remaining_seconds || 0,
          can_post: j.can_post,
          last_post_no: j.last_post_no,
          last_posted_at: j.last_posted_at,
        });
      }
    } catch {/* ignore */}
  }

  // 쿨다운 1초마다 감산
  useEffect(() => {
    if (!cooldown || cooldown.remaining_seconds <= 0) return;
    const t = setInterval(() => {
      setCooldown((c) => {
        if (!c) return c;
        const next = Math.max(0, c.remaining_seconds - 1);
        return { ...c, remaining_seconds: next, can_post: next === 0 };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown?.remaining_seconds === 0 ? 0 : 1]);

  // 데스크톱 여부 감지 (>= 1024px)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 인증 + 부서 + 표어 + 첫 draft
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const { data: deptInfo } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
      if (deptInfo && deptInfo[0]) setDeptName(deptInfo[0].name || "");

      await loadYearlyTheme();
      await loadDraftsList();
      await loadDraft(form.date);
      await fetchCooldown();
      await loadCredsMeta();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDraftsList() {
    const { data, error } = await supabase.rpc("bulletin_list_drafts", { p_dept_id: deptId });
    if (error) {
      console.warn("[bulletin] loadDraftsList error:", error);
      return;
    }
    setDraftList(data || []);
  }

  // 발행일자 변경 시 draft 로드 → 월간계획 자동 적용 (빈칸만)
  useEffect(() => {
    if (!authChecked) return;
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    (async () => {
      await loadDraft(form.date);
      if (form.date) await autoLoadAndApplyPlan(form.date);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, authChecked]);

  // 3페이지 진입 or 날짜 변경 시 복습문제 자동 로드
  useEffect(() => {
    if (!authChecked || !form.date || currentPage !== 3) return;
    loadReviewProblems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, form.date, authChecked]);

  async function loadYearlyTheme() {
    const year = new Date().getFullYear();
    const { data, error } = await supabase.rpc("bulletin_get_yearly_theme", {
      p_dept_id: deptId, p_year: year,
    });
    if (error) return;
    if (data && data[0]) {
      const t = data[0] as YearlyTheme;
      setYearlyTheme(t);
      setThemeForm({ theme: t.theme || "", scripture_ref: t.scripture_ref || "", page_one_verse: t.page_one_verse || "" });
      // 폼이 비어있으면 yearly 값 자동 채움 (사용자가 입력했으면 보존)
      setForm((f) => ({
        ...f,
        theme: f.theme || t.theme || "",
        pageOneVerse: f.pageOneVerse || t.page_one_verse || "",
      }));
    } else {
      setYearlyTheme(null);
    }
  }

  async function loadDraft(date: string) {
    if (!date) return;
    console.log("[bulletin] loadDraft called for", date);
    const { data, error } = await supabase.rpc("bulletin_get_draft", {
      p_dept_id: deptId, p_issue_date: date,
    });
    if (error) {
      console.error("[bulletin] loadDraft error:", error);
      showToast("Draft 조회 실패: " + error.message);
      return;
    }
    console.log("[bulletin] loadDraft response:", data);
    const row = data && data[0];
    if (row && row.exists_) {
      const draft = row.form_data as Partial<FormState>;
      console.log("[bulletin] draft loaded with fields:", Object.keys(draft).length);
      setForm({
        ...EMPTY_FORM,
        date,
        issueNumber: row.issue_number || calcIssueNumber(date),
        ...draft,
      });
      setDraftMeta({ last_edited_by: row.last_edited_by, last_edited_at: row.last_edited_at });
      showToast(`💾 임시저장본 불러옴 (${formatRelativeTime(row.last_edited_at)})`);
      if (yearlyTheme && !draft.theme) {
        setForm((f) => ({ ...f, theme: yearlyTheme.theme }));
      }
    } else {
      console.log("[bulletin] no draft for", date);
      setForm((f) => ({
        ...EMPTY_FORM,
        date,
        issueNumber: calcIssueNumber(date),
        theme: yearlyTheme?.theme || "",
      }));
      setDraftMeta(null);
    }
  }

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const handleDateChange = (newDate: string) => {
    setForm((f) => ({ ...f, date: newDate, issueNumber: calcIssueNumber(newDate) }));
    setReviewMatch(null);
    setReviewPlanStatus(null);
    setReviewError("");
    // useEffect 가 loadDraft 트리거함
  };

  // 날짜 변경 시 자동 호출 — 월간계획 불러와서 빈칸만 채움 (토스트·에러 없음)
  const autoLoadAndApplyPlan = async (date: string) => {
    if (!date) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const response = await fetch(
        `/api/edu/monthly-plans/bulletin-import?dept_id=${deptId}&date=${date}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) return;
      const plan = result.plan as MonthlyPlanImport;
      setForm((current) => {
        let next: FormState = { ...current };
        for (const { key } of MONTHLY_PLAN_FIELD_LABELS) {
          const value = plan.fields[key];
          if (!value?.trim()) continue;
          if (String(next[key] || "").trim()) continue;
          next = { ...next, [key]: value };
        }
        return next;
      });
    } catch { /* 월간계획 없으면 조용히 무시 */ }
  };

  const loadReviewProblems = async () => {
    if (!form.date) {
      showToast("날짜를 먼저 선택하세요");
      return;
    }
    setReviewLoading(true);
    setReviewError("");
    setReviewMatch(null);
    setReviewPlanStatus(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const response = await fetch(`/api/edu/review-problems?dept_id=${deptId}&date=${form.date}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "복습문제를 불러오지 못했습니다");
      const problems = (result.problems || []) as ReviewIndex[];
      setReviewProblems(problems);
      setReviewMatch((result.match || null) as ReviewProblem | null);
      setReviewPlanStatus((result.planStatus || null) as ReviewPlanStatus | null);
      setSelectedReviewPath(result.match?.path || problems[0]?.path || "");
      if (result.match) showToast("월별 계획과 맞는 복습문제를 찾았습니다");
      else showToast("복습문제 목록을 불러왔습니다");
    } catch (e: unknown) {
      const message = (e as Error).message;
      setReviewError(message);
      showToast(message);
    } finally {
      setReviewLoading(false);
    }
  };

  const handleReviewUpload = async (files: FileList | null) => {
    const selected = Array.from(files || []).filter((f) => /\.pptx$/i.test(f.name));
    if (selected.length === 0) return;
    setReviewUploading(true);
    setReviewError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      let done = 0;
      for (const file of selected) {
        const payload = new FormData();
        payload.append("dept_id", deptId);
        payload.append("files", file);
        const response = await fetch("/api/edu/review-problems", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: payload,
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(`${file.name}: ${result.error || "업로드 실패"}`);
        done++;
      }
      showToast(`${done}개 복습문제 업로드 완료`);
      await loadReviewProblems();
    } catch (e: unknown) {
      const message = (e as Error).message;
      setReviewError(message);
      showToast(message);
    } finally {
      setReviewUploading(false);
    }
  };

  const applyReviewProblem = async (entry: ReviewProblem | ReviewIndex | null) => {
    if (!entry) { showToast("선택된 복습문제가 없습니다"); return; }

    let problem: ReviewProblem | null = null;
    if ("quizzes" in entry) {
      problem = entry as ReviewProblem;
    } else {
      setReviewLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { router.replace("/login"); return; }
        const res = await fetch(
          `/api/edu/review-problems?dept_id=${deptId}&file=${encodeURIComponent(entry.jsonPath)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        const json = await res.json();
        if (!res.ok || !json.ok) { showToast("복습문제 데이터를 불러오지 못했습니다"); return; }
        problem = json.problem as ReviewProblem;
      } catch { showToast("복습문제 로드 실패"); return; }
      finally { setReviewLoading(false); }
    }

    if (!problem) return;
    const p = problem;
    if (p.lessonNum) setForm((f) => ({ ...f, lessonNum: p.lessonNum }));
    const nextQuizzes = (p.quizzes || []).length > 0
      ? p.quizzes.map((quiz) => ({ ...quiz, id: Math.random().toString(36).slice(2), choices: quiz.choices || [] }))
      : [newQuizItem("mc4")];
    setQuizzes(nextQuizzes);
    showToast(`${p.title} 적용 완료`);
  };

  const handleSaveDraft = async () => {
    if (!form.date) {
      showToast("날짜를 먼저 선택하세요");
      return;
    }
    setSavingDraft(true);
    try {
      const { data, error } = await supabase.rpc("bulletin_save_draft", {
        p_dept_id: deptId,
        p_issue_date: form.date,
        p_form_data: form,
        p_issue_number: form.issueNumber || null,
      });
      if (error) throw error;
      const meta = data && data[0];
      if (meta) {
        setDraftMeta({ last_edited_at: meta.last_edited_at, last_edited_by: meta.last_edited_by });
      }
      skipNextLoadRef.current = true;
      showToast("임시저장 완료 ✅");
      await loadDraftsList();
    } catch (e: unknown) {
      showToast("저장 실패: " + (e as Error).message);
    } finally {
      setSavingDraft(false);
    }
  };

  // 페이지별 리셋 — 사용자 입력만 초기화, 자동 입력 (yearly 표어/default 시작시간 등) 은 보존
  const handleResetPage = (page: 1 | 2 | 3 | 4) => {
    const pageNames = { 1: "표지", 2: "예배 순서", 3: "공과", 4: "목장 현황" };
    if (!confirm(`${page}페이지 (${pageNames[page]}) 입력값을 초기화할까요?\n자동 입력된 기본값은 유지됩니다.`)) return;

    if (page === 1) {
      setForm((f) => ({
        ...f,
        issueNumber: calcIssueNumber(f.date) || "",
        theme: yearlyTheme?.theme || "",
        pageOneVerse: yearlyTheme?.page_one_verse || "",
      }));
      setPhotos([null, null, null, null]);
    } else if (page === 2) {
      setForm((f) => ({
        ...f,
        guide: "", prayerClass: "", scripture: "", sermonTitle: "", nextPrayer: "",
        tithe: "", thanksgiving: "",
        twoPartActivity: "", announcementAuthor: "", announcement: "",
        // default 유지
        startTime: DEFAULT_START_TIME,
        leader: DEFAULT_LEADER,
        preacher: DEFAULT_PREACHER,
        praise1: DEFAULT_PRAISE1,
        praise2: DEFAULT_PRAISE2,
      }));
    } else if (page === 3) {
      setForm((f) => ({ ...f, lessonNum: "", versePassage: "" }));
      setQuizzes([newQuizItem("mc4")]);
    } else if (page === 4) {
      setForm((f) => ({ ...f, newFriend: "" }));
      setFarmData(EMPTY_FARM);
    }
    showToast(`${page}페이지 입력 초기화 완료`);
  };

  const handleSaveYearlyTheme = async () => {
    if (!themeForm.theme.trim()) {
      showToast("표어를 입력하세요");
      return;
    }
    setThemeSaving(true);
    try {
      const year = new Date().getFullYear();
      const { error } = await supabase.rpc("bulletin_set_yearly_theme", {
        p_dept_id: deptId,
        p_year: year,
        p_theme: themeForm.theme.trim(),
        p_scripture_ref: themeForm.scripture_ref.trim() || null,
        p_page_one_verse: themeForm.page_one_verse.trim() || null,
      });
      if (error) throw error;
      showToast(`${year}년 표어 저장 완료 ✅`);
      await loadYearlyTheme();
      setThemeEditMode(false);
      // 폼 주제제창도 새 표어로 갱신 (단 사용자가 다른 값 입력했을 수 있어 덮어쓰진 않음)
      if (!form.theme) setForm((f) => ({ ...f, theme: themeForm.theme.trim() }));
    } catch (e: unknown) {
      showToast("표어 저장 실패: " + (e as Error).message);
    } finally {
      setThemeSaving(false);
    }
  };

  const handleDeleteDraft = async (issueDate: string) => {
    const confirmed = confirm(
      `${issueDate} 임시저장본을 삭제하시겠습니까?\n\n⚠️ 삭제하면 복구할 수 없습니다.\n작성한 모든 내용이 사라집니다.`
    );
    if (!confirmed) return;
    try {
      const { error } = await supabase.rpc("bulletin_delete_draft", {
        p_dept_id: deptId, p_issue_date: issueDate,
      });
      if (error) throw error;
      showToast(`${issueDate} 임시저장본 삭제됨`);
      await loadDraftsList();
      // 현재 보고있던 draft 가 삭제됐으면 폼 초기화
      if (form.date === issueDate) {
        setForm({ ...EMPTY_FORM, date: form.date, issueNumber: calcIssueNumber(form.date), theme: yearlyTheme?.theme || "" });
        setDraftMeta(null);
      }
    } catch (e: unknown) {
      showToast("삭제 실패: " + (e as Error).message);
    }
  };

  const setPhoto = (idx: number, file: File | null) => {
    setPhotos((prev) => {
      const next = [...prev];
      next[idx] = file;
      return next;
    });
  };

  const compactPhotos = () => {
    // 빈 슬롯 제거하고 앞으로 채움 (사용자가 1, 3번에 올렸으면 1, 2번으로)
    const filled = photos.filter((p) => p !== null) as File[];
    while (filled.length < 4) filled.push(null as unknown as File);
    setPhotos(filled);
  };

  // 🚀 1클릭 자동등록 — chflow API + Cloudflare Worker proxy 거쳐 UMS 4단계
  // (Tampermonkey 의존 제거: 사용자 0 설치)
  const handleAutoPost = async () => {
    if (cooldown && !cooldown.can_post) {
      showToast(`아직 ${formatRemaining(cooldown.remaining_seconds)} 후 등록 가능`);
      return;
    }
    if (!form.theme && !form.scripture) {
      showToast("주제와 본문을 채우세요");
      return;
    }

    setAutoPosting(true);
    setAutoPostResult(null);
    setPostStep("pdf");

    let pdfBase64: string;
    let pdfFilename: string;

    if (pdfFile) {
      // 사용자가 첨부한 PDF (한글 저장본 등) — 그대로 사용
      pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("PDF 읽기 실패"));
        reader.readAsDataURL(pdfFile);
      });
      pdfFilename = pdfFile.name;
    } else {
      // 자동 생성 (브라우저 PDF)
      try {
        const { generateBulletinPdfBrowser, formToBulletinData } = await import("@/lib/bulletin/pdf-browser");
        const data = formToBulletinData(form as unknown as Record<string, string>, deptName);
        const pdfBytes = await generateBulletinPdfBrowser(data, photos);
        let binary = "";
        for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
        pdfBase64 = btoa(binary);
        pdfFilename = `초등1초원주보_${form.date}.pdf`;
      } catch (e: unknown) {
        setAutoPosting(false);
        setPostStep("error");
        setAutoPostResult({ ok: false, error: `PDF 자동 생성 실패: ${(e as Error).message}` });
        return;
      }
    }

    const subject = buildPostSubject(form);
    const memo = buildPostMemo(form);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      // 서버 호출 — 서버는 4단계 (login → write_form → upload → write_ok) 진행.
      // 클라이언트는 시간 기반으로 단계 추정 (정확도 낮지만 사용자 답답함 해소).
      setPostStep("login");
      const stepTimers: ReturnType<typeof setTimeout>[] = [];
      // 세션 재시도 (5회) + visit_main + visit_board → 약 40초. 그 후 upload/submit.
      stepTimers.push(setTimeout(() => setPostStep((s) => (s === "login" ? "upload" : s)), 40000));
      stepTimers.push(setTimeout(() => setPostStep((s) => (s === "upload" ? "submit" : s)), 48000));
      const r = await fetch("/api/ums-bulletin/post-v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          dept_id: deptId,
          dept_name: deptName,
          date: form.date,
          subject,
          memo,
          pdf_base64: pdfBase64,
          pdf_filename: pdfFilename,
        }),
      });
      stepTimers.forEach(clearTimeout);
      const j = await r.json();

      // 🔬 라이브 응답 풀 디버그 — 콘솔에서 chflowDiag 와 동일 포맷으로 단계별 확인
      // (라이브 실패 시 어디서 거부됐는지 추적용)
      console.log("🚀 라이브 자동등록 응답:", j);
      if (j.debug) {
        console.log("=== 단계별 ===");
        console.table(j.debug.map((d: { step: string; status: number; body_len: number; extra?: Record<string, unknown> }) => ({
          step: d.step,
          status: d.status,
          len: d.body_len,
          extra: d.extra ? JSON.stringify(d.extra).slice(0, 200) : "",
        })));
        const loginStep = j.debug.find((d: { step: string }) => d.step === "login");
        if (loginStep) {
          console.log("=== 🔑 login response (71B 정체) ===");
          console.log(loginStep.body_sample || "(no sample)");
          console.log("login set-cookies:", loginStep.set_cookies);
        }
        const wfStep = j.debug.find((d: { step: string }) => d.step === "write_form");
        if (wfStep) {
          console.log("=== ❌ write_form 거부 페이지 샘플 ===");
          console.log(wfStep.body_sample || "(no sample)");
        }
        // upload / write_ok 단계가 있으면 표시 (라이브에만 있는 단계)
        const upSteps = j.debug.filter((d: { step: string }) => d.step.startsWith("upload"));
        if (upSteps.length > 0) {
          console.log("=== 📤 PDF 업로드 단계 ===");
          console.table(upSteps);
        }
        const woStep = j.debug.find((d: { step: string }) => d.step.startsWith("write_ok"));
        if (woStep) {
          console.log("=== 📝 write_ok 응답 샘플 ===");
          console.log(woStep.body_sample || "(no sample)");
          console.log("extra:", woStep.extra);
        }
      }
      if (j.write_form_attempts) {
        console.log("=== write.php 시도별 ===");
        console.table(j.write_form_attempts);
      }

      setAutoPosting(false);
      setPostStep(j.ok ? "done" : "error");

      // 자격증명 미등록 → 모달 자동 띄우기
      if (!j.ok && j.code === "ums_credentials_required") {
        setAutoPostResult(null);
        setCredsModalOpen(true);
        showToast("먼저 본인의 UMS 계정을 등록해주세요");
        return;
      }

      if (j.ok) {
        setAutoPostResult({ ok: true, postNo: j.post_no, redirectUrl: j.post_url, attempts: j.write_form_attempts });
        setCooldown({
          remaining_seconds: 1800,
          can_post: false,
          last_post_no: j.post_no,
          last_posted_at: new Date().toISOString(),
        });
      } else {
        setAutoPostResult({ ok: false, error: j.error || "알 수 없는 오류", attempts: j.write_form_attempts });
        if (j.remaining_seconds) {
          setCooldown((c) => ({
            remaining_seconds: j.remaining_seconds,
            can_post: false,
            last_post_no: c?.last_post_no || null,
            last_posted_at: c?.last_posted_at || null,
          }));
        }
      }
    } catch (e: unknown) {
      setAutoPosting(false);
      setPostStep("error");
      setAutoPostResult({ ok: false, error: (e as Error).message || "네트워크 오류" });
    }
  };

  const handleDownloadHwpx = async () => {
    if (!form.date) {
      showToast("날짜를 선택해주세요");
      return;
    }
    setGenerating(true);
    try {
      const blob = await generateHwpx(form, photos);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `초등1초원주보_${form.date}.hwpx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("hwpx 다운로드 완료 ✅");
    } catch (e: unknown) {
      showToast("생성 실패: " + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!form.date) {
      showToast("날짜를 선택해주세요");
      return;
    }
    setGenerating(true);
    try {
      const { generateBulletinPdfBrowser, formToBulletinData } = await import("@/lib/bulletin/pdf-browser");
      const data = formToBulletinData(form as unknown as Record<string, string>, deptName);
      const pdfBytes = await generateBulletinPdfBrowser(data, photos);
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `초등1초원주보_${form.date}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("PDF 다운로드 완료 ✅");
    } catch (e: unknown) {
      showToast("PDF 생성 실패: " + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  const isSupported = deptName === SUPPORTED_DEPT;
  const currentYear = new Date().getFullYear();

  return (
    <div style={pageStyle}>

      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>📰 주보 만들기</div>
        <div style={{ display: "flex", gap: 6 }}>
          {!isDesktop && (
            <button onClick={() => setDrawerOpen(true)} style={iconBtnStyle} title="임시저장 목록">
              📂{draftList.length > 0 && <span style={{ fontSize: 11, marginLeft: 3 }}>{draftList.length}</span>}
            </button>
          )}
          <button onClick={handleSaveDraft} disabled={savingDraft} style={draftBtnStyle}>
            {savingDraft ? "저장 중..." : "💾"}
          </button>
        </div>
      </div>

      <div style={{
        display: "flex",
        gap: 20,
        maxWidth: isDesktop ? 1640 : 720,
        margin: "0 auto",
        padding: 16,
        alignItems: "flex-start",
      }}>
        {/* ─── 좌측: 임시저장 목록 (PC 한정) ─── */}
        {isDesktop && (
          <div style={{
            width: 240, position: "sticky", top: 16, alignSelf: "flex-start",
            maxHeight: "calc(100vh - 32px)", overflowY: "auto", flexShrink: 0,
          }}>
            <DraftSidebar
              draftList={draftList}
              currentDate={form.date}
              onSelect={(d) => handleDateChange(d)}
              onDelete={handleDeleteDraft}
            />
          </div>
        )}

        <div style={{ flex: 1, maxWidth: 720, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {!isSupported && (
          <div style={warnCardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>현재 {SUPPORTED_DEPT}만 지원합니다</div>
          </div>
        )}

        {/* 직전 저장 정보 (현재 발행일자 기준) */}
        {draftMeta && (
          <div style={{ ...cardStyle, padding: "10px 16px", background: "#ecfeff", border: "1px solid #67e8f9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <div style={{ fontSize: 12, color: "#0369a1", fontWeight: 700 }}>
                💾 이 발행일자에 임시저장본 있음 — <b>{formatRelativeTime(draftMeta.last_edited_at)}</b> 저장
              </div>
              <div style={{ fontSize: 11, color: "#0e7490" }}>
                {new Date(draftMeta.last_edited_at).toLocaleString("ko-KR")}
              </div>
            </div>
          </div>
        )}

        {/* ─── 작성 헤더 ─── */}
        <div style={{
          background: "linear-gradient(135deg, #faf5ff, #eff6ff)",
          border: "1px solid #ddd6fe",
          borderRadius: 12,
          padding: "12px 16px",
          marginBottom: 12,
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed" }}>
              📝 주보 작성 중
            </div>
            <div style={{ fontSize: 11, color: "#9333ea", marginTop: 2 }}>
              {form.date ? formatKoreanDate(form.date) : "발행일 미선택"} · {currentPage}페이지 입력 중
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {form.issueNumber && (
              <div style={{
                padding: "4px 10px", background: "#fff",
                borderRadius: 6, fontSize: 12, fontWeight: 700, color: "#7c3aed",
                border: "1px solid #ddd6fe",
              }}>
                {form.issueNumber}
              </div>
            )}
            <button
              onClick={() => handleResetPage(currentPage)}
              title={`${currentPage}페이지 입력 초기화 (자동 입력값은 보존)`}
              style={{
                padding: "5px 10px",
                background: "#fff", color: "#dc2626",
                border: "1px solid #fca5a5", borderRadius: 6,
                fontSize: 11, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              🔄 {currentPage}페이지 리셋
            </button>
          </div>
        </div>

        {/* ─── 월간 교육계획서 자동 입력 ─── */}
        <div style={{
          ...cardStyle,
          padding: 14,
          border: "1px solid #fed7aa",
          background: "#fffaf5",
        }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: "#9a3412" }}>월간 교육계획서 자동 입력</div>
          <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, color: "#c2410c", lineHeight: 1.5 }}>
            날짜 선택 시 자동으로 불러와 빈 항목을 채웁니다.
          </div>

        </div>

        {/* ─── 페이지 선택 탭 (hwpx 1/2/3/4 페이지 구조) ─── */}
        <div style={{
          display: "flex", gap: 4, padding: 4,
          background: "#f1f5f9", borderRadius: 10, marginBottom: 12,
          overflowX: "auto",
        }}>
          {[
            { n: 3 as const, label: "알립니다·공과", icon: "📚", spread: 1 },
            { n: 1 as const, label: "표지", icon: "📄", spread: 1 },
            { n: 2 as const, label: "예배 순서", icon: "🎵", spread: 2 },
            { n: 4 as const, label: "목장 현황", icon: "📊", spread: 2 },
          ].map((p) => (
            <button
              key={p.n}
              onClick={() => setCurrentPage(p.n)}
              style={{
                flex: 1, minWidth: 84,
                padding: "10px 8px",
                background: currentPage === p.n ? "#fff" : "transparent",
                color: currentPage === p.n ? "#1e293b" : "#64748b",
                border: "none", borderRadius: 8,
                fontSize: 12, fontWeight: currentPage === p.n ? 800 : 600,
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: currentPage === p.n ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 14, marginBottom: 1 }}>{p.icon}</div>
              <div style={{ fontSize: 9, color: currentPage === p.n ? "#7c3aed" : "#94a3b8" }}>
                {p.spread}페이지 {p.n === 3 || p.n === 2 ? "좌" : "우"}
              </div>
              <div>{p.label}</div>
            </button>
          ))}
        </div>

        {/* ① 기본 정보 (page 1) */}
        {currentPage === 1 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>① 기본 정보</div>
          <FormRow label="발행 일자 (주일)">
            <input
              type="date"
              value={form.date}
              onChange={(e) => handleDateChange(e.target.value)}
              style={inputStyle}
            />
            <div style={hintStyle}>일요일을 선택하세요</div>
          </FormRow>
          <FormRow label="호수">
            <input
              type="text"
              value={form.issueNumber}
              onChange={(e) => set("issueNumber", e.target.value)}
              placeholder={calcIssueNumber(form.date) || "예: 제26-18호"}
              style={inputStyle}
            />
            <div style={hintStyle}>
              자동 계산값: <b>{calcIssueNumber(form.date) || "(일요일 선택 시 자동)"}</b> — 다르게 표기하려면 직접 수정
            </div>
          </FormRow>
        </div>

        )}

        {/* ② 올해 표어 (page 1) */}
        {currentPage === 1 && (
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ ...sectionLabel, marginBottom: 0 }}>② {currentYear}년 표어 (주제제창)</div>
            {!themeEditMode && (
              <button onClick={() => setThemeEditMode(true)} style={smallBtnStyle}>✏️ 수정</button>
            )}
          </div>
          {!themeEditMode ? (
            yearlyTheme ? (
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>
                  {yearlyTheme.theme}
                </div>
                {yearlyTheme.scripture_ref && (
                  <div style={{ fontSize: 12, color: "#64748b" }}>{yearlyTheme.scripture_ref}</div>
                )}
                {yearlyTheme.page_one_verse && (
                  <div style={{
                    marginTop: 6, padding: "6px 10px",
                    background: "#eff6ff", borderLeft: "3px solid #3b82f6",
                    fontSize: 12, lineHeight: 1.6, color: "#1e293b", fontStyle: "italic",
                  }}>
                    {yearlyTheme.page_one_verse}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                  매 주보 작성 시 자동 채움 (주제제창 + 1페이지 표어)
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#64748b" }}>
                {currentYear}년 표어가 등록되지 않았습니다.
                <button onClick={() => setThemeEditMode(true)} style={{ ...smallBtnStyle, marginLeft: 8 }}>+ 등록하기</button>
              </div>
            )
          ) : (
            <div>
              <FormRow label="표어">
                <input
                  type="text"
                  value={themeForm.theme}
                  onChange={(e) => setThemeForm((t) => ({ ...t, theme: e.target.value }))}
                  placeholder="예: 하나님의 안경으로 세상을 바라보는 어린이"
                  style={inputStyle}
                />
              </FormRow>
              <FormRow label="근거 구절 (짧게, 선택)">
                <input
                  type="text"
                  value={themeForm.scripture_ref}
                  onChange={(e) => setThemeForm((t) => ({ ...t, scripture_ref: e.target.value }))}
                  placeholder="예: 히 11:3"
                  style={inputStyle}
                />
              </FormRow>
              <FormRow label="1페이지 표어 (긴 본문, 사진 밑 표시)">
                <textarea
                  value={themeForm.page_one_verse}
                  onChange={(e) => setThemeForm((t) => ({ ...t, page_one_verse: e.target.value }))}
                  placeholder="예: 믿음으로 모든 세계가 하나님의 말씀으로 지어진 줄을 우리가 아나니 보이는 것은 나타난 것으로 말미암아 된 것이 아니니라.(히브리서 11장 3절)"
                  rows={4}
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
                />
                <div style={hintStyle}>1년에 1번 등록 → 매주 자동 채움 (수정 가능)</div>
              </FormRow>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => { setThemeEditMode(false); setThemeForm({ theme: yearlyTheme?.theme || "", scripture_ref: yearlyTheme?.scripture_ref || "", page_one_verse: yearlyTheme?.page_one_verse || "" }); }} style={cancelBtnStyle}>취소</button>
                <button onClick={handleSaveYearlyTheme} disabled={themeSaving} style={primaryBtnStyle}>
                  {themeSaving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          )}
        </div>

        )}

        {/* ③ 1부 예배 (page 2) */}
        {currentPage === 2 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>③ 1부 예배 (인명 / 멘트)</div>

          <FormRow label="시작 시간">
            <input type="text" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} placeholder={DEFAULT_START_TIME} style={inputStyle} />
            <div style={hintStyle}>거의 매주 동일 — 다른 날만 수정</div>
          </FormRow>
          <FormRow label="안내">
            <input type="text" value={form.guide} onChange={(e) => set("guide", e.target.value)} placeholder="예: 박희연" style={inputStyle} />
          </FormRow>
          <FormRow label="찬양율동 (2명)">
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" value={form.praise1} onChange={(e) => set("praise1", e.target.value)} placeholder="이름1" style={inputStyle} />
              <input type="text" value={form.praise2} onChange={(e) => set("praise2", e.target.value)} placeholder="이름2" style={inputStyle} />
            </div>
            <div style={hintStyle}>"선생님" 자동 부착. 기본값: {DEFAULT_PRAISE1}, {DEFAULT_PRAISE2}</div>
          </FormRow>
          <FormRow label="예배인도 (이름 + 직책)">
            <input type="text" value={form.leader} onChange={(e) => set("leader", e.target.value)} placeholder={DEFAULT_LEADER} style={inputStyle} />
            <div style={hintStyle}>"선생님" 자동 부착. 기본값: {DEFAULT_LEADER}. 부장/부감/총무 등 직책 직접 입력</div>
          </FormRow>
          <FormRow label="주제제창 (이번 주 사용 멘트)">
            <input type="text" value={form.theme} onChange={(e) => set("theme", e.target.value)} placeholder="기본은 올해 표어" style={inputStyle} />
            <div style={hintStyle}>비우고 저장 시 올해 표어 그대로 사용</div>
          </FormRow>
          <FormRow label="기도">
            <input type="text" value={form.prayerClass} onChange={(e) => set("prayerClass", e.target.value)} placeholder="예: 2-3반 또는 김정권장로님" style={inputStyle} />
            <div style={hintStyle}>"(반)" 자동 부착 X — 자유 입력 (반 / 이름 / 직책 그대로)</div>
          </FormRow>
          <FormRow label="성경봉독">
            <input type="text" value={form.scripture} onChange={(e) => set("scripture", e.target.value)} placeholder="예: 창세기 11장 1~9절" style={inputStyle} />
          </FormRow>
          <FormRow label="강론 제목">
            <input type="text" value={form.sermonTitle} onChange={(e) => set("sermonTitle", e.target.value)} placeholder="예: 우리는 배울 때 무엇을 조심해야 할까요?" style={inputStyle} />
          </FormRow>
          <FormRow label="말씀 (이름 + 직책)">
            <input type="text" value={form.preacher} onChange={(e) => set("preacher", e.target.value)} placeholder={DEFAULT_PREACHER} style={inputStyle} />
            <div style={hintStyle}>"님" 자동 부착. 기본값: {DEFAULT_PREACHER}. 전도사/목사 등 직책 직접 입력</div>
          </FormRow>
          <FormRow label="다음 주 기도">
            <input type="text" value={form.nextPrayer} onChange={(e) => set("nextPrayer", e.target.value)} placeholder="예: 3-4반 또는 김정권장로님" style={inputStyle} />
          </FormRow>
        </div>

        )}

        {/* ④ 헌금 (page 2) */}
        {currentPage === 2 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>④ 헌금</div>
          <FormRow label="십일조">
            <input type="text" value={form.tithe} onChange={(e) => set("tithe", e.target.value)} placeholder="예: 50,000원" style={inputStyle} />
          </FormRow>
          <FormRow label="감사헌금">
            <input type="text" value={form.thanksgiving} onChange={(e) => set("thanksgiving", e.target.value)} placeholder="예: 30,000원" style={inputStyle} />
          </FormRow>
        </div>

        )}

        {/* 복습문제 (page 3) */}
        {currentPage === 3 && (
          <div style={{ ...cardStyle, border: "1px solid #bfdbfe", background: "#f8fbff" }}>
            {/* 헤더 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#1e40af" }}>📚 복습문제</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={loadReviewProblems}
                  disabled={reviewLoading || !form.date}
                  style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #93c5fd", background: "#fff", color: "#1d4ed8", fontSize: 12, fontWeight: 800, cursor: reviewLoading ? "default" : "pointer", fontFamily: "inherit", opacity: reviewLoading ? 0.6 : 1 }}
                >
                  {reviewLoading ? "확인 중…" : "새로고침"}
                </button>
                <label style={{ padding: "5px 10px", borderRadius: 7, border: "1px dashed #93c5fd", background: "#fff", color: "#1d4ed8", fontSize: 12, fontWeight: 800, cursor: reviewUploading ? "default" : "pointer", opacity: reviewUploading ? 0.6 : 1 }}>
                  {reviewUploading ? "업로드 중…" : "+ PPTX 업로드"}
                  <input type="file" accept=".pptx" multiple disabled={reviewUploading} onChange={(e) => { handleReviewUpload(e.target.files); e.currentTarget.value = ""; }} style={{ display: "none" }} />
                </label>
              </div>
            </div>

            {reviewError && (
              <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 12, fontWeight: 800 }}>
                {reviewError}
              </div>
            )}

            {reviewLoading && !reviewPlanStatus && (
              <div style={{ padding: "14px 0", textAlign: "center", fontSize: 13, color: "#64748b", fontWeight: 700 }}>매칭 중…</div>
            )}

            {/* 자동 매칭 상태 카드 */}
            {reviewPlanStatus && (
              <div style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: reviewMatch ? "1.5px solid #86efac" : "1.5px solid #fde68a",
                background: reviewMatch ? "#f0fdf4" : "#fffbeb",
              }}>
                {/* 매칭 상태 배지 + 플랜 정보 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 900,
                    background: reviewMatch ? "#dcfce7" : "#fef9c3",
                    color: reviewMatch ? "#166534" : "#854d0e",
                  }}>
                    {reviewMatch ? "✅ 자동 매칭" : "⚠️ 미매칭"}
                  </span>
                  {reviewPlanStatus.plan && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                      {reviewPlanStatus.plan.sheetName}
                      {(reviewPlanStatus.plan.activity || reviewPlanStatus.plan.sermon) && ` · ${reviewPlanStatus.plan.activity || reviewPlanStatus.plan.sermon}`}
                    </span>
                  )}
                </div>

                {reviewMatch && (
                  <>
                    <div style={{ marginTop: 8, fontSize: 14, fontWeight: 900, color: "#1e293b" }}>{reviewMatch.title}</div>
                    <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                      {reviewMatch.lessonNum ? `${reviewMatch.lessonNum}과` : reviewMatch.specialTitle || ""} · {reviewMatch.quizzes.length}문제
                    </div>
                    <button
                      type="button"
                      onClick={() => applyReviewProblem(reviewMatch)}
                      style={{ marginTop: 10, width: "100%", minHeight: 38, borderRadius: 8, border: "1px solid #16a34a", background: "#16a34a", color: "#fff", fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      이 문제 적용
                    </button>
                  </>
                )}

                {!reviewMatch && reviewPlanStatus.message && (
                  <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#92400e" }}>{reviewPlanStatus.message}</div>
                )}
              </div>
            )}

            {/* 목록 펼치기 / 수동 선택 */}
            {reviewProblems.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowReviewList((v) => !v)}
                  style={{ width: "100%", padding: "7px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
                >
                  {showReviewList ? "▲ 목록 접기" : `▼ 다른 문제 선택 (${reviewProblems.length}개)`}
                </button>

                {showReviewList && (
                  <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                    {reviewProblems.map((problem) => {
                      const isSelected = selectedReviewPath === problem.path;
                      return (
                        <div
                          key={problem.path}
                          onClick={() => setSelectedReviewPath(problem.path)}
                          style={{
                            padding: "9px 12px",
                            borderRadius: 8,
                            border: isSelected ? "1.5px solid #2563eb" : "1px solid #e2e8f0",
                            background: isSelected ? "#eff6ff" : "#fff",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {problem.lessonNum && (
                                <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 900, background: "#dbeafe", color: "#1e40af" }}>{problem.lessonNum}과</span>
                              )}
                              {problem.specialTitle && !problem.lessonNum && (
                                <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 900, background: "#ede9fe", color: "#5b21b6" }}>절기</span>
                              )}
                              <span style={{ fontSize: 13, fontWeight: 800, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{problem.title}</span>
                            </div>
                            <div style={{ marginTop: 2, fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{problem.quizCount}문제</div>
                          </div>
                          {isSelected && <span style={{ fontSize: 16, color: "#2563eb" }}>✓</span>}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => { applyReviewProblem(reviewProblems.find((p) => p.path === selectedReviewPath) || null); setShowReviewList(false); }}
                      disabled={!selectedReviewPath}
                      style={{ minHeight: 40, borderRadius: 8, border: "1px solid #334155", background: "#334155", color: "#fff", fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", opacity: selectedReviewPath ? 1 : 0.4 }}
                    >
                      선택한 문제 적용
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ⑤ 공과 (page 3) — 동적 N문제 */}
        {currentPage === 3 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>⑤ 공과 / 퀴즈</div>
          <FormRow label="공과 회차">
            <input type="text" value={form.lessonNum} onChange={(e) => set("lessonNum", e.target.value)} placeholder="예: 14" style={inputStyle} />
          </FormRow>
          <FormRow label="요절암송">
            <textarea
              value={form.versePassage}
              onChange={(e) => set("versePassage", e.target.value)}
              placeholder="예: 그러므로 너희가 그리스도 예수를 주로 받았으니 그 안에서 행하되 (골로새서 2장 6절)"
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <div style={hintStyle}>구절 본문 + 출처 한 줄로</div>
          </FormRow>

          {quizzes.map((quiz, idx) => (
            <QuizCard
              key={quiz.id}
              index={idx}
              quiz={quiz}
              canRemove={quizzes.length > 1}
              onChange={(next) => updateQuiz(idx, next)}
              onRemove={() => removeQuiz(idx)}
            />
          ))}

          <button
            onClick={() => addQuiz("mc4")}
            style={{
              width: "100%", padding: "12px", marginTop: 6,
              background: "#eff6ff", color: "#1e40af",
              border: "2px dashed #93c5fd", borderRadius: 10,
              fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            + 문제 추가
          </button>

          {quizzes.length > 4 && (
            <div style={{
              marginTop: 8, padding: 10, background: "#fef3c7",
              border: "1px solid #fbbf24", borderRadius: 8,
              fontSize: 11, color: "#92400e", lineHeight: 1.5,
            }}>
              ⚠️ 5번째 문제부터는 hwpx 출력에 포함되지 않습니다 (양식 자리 4번까지).
              필요 시 PDF 자동 생성에는 모든 문제 포함됨.
            </div>
          )}
        </div>

        )}

        {/* ⑥ 광고 / 2부행사 (page 2 — 예배순서와 함께) */}
        {currentPage === 2 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>⑥ 광고 / 2부행사</div>
          <FormRow label="2부 행사 안내 (✿2부행사)">
            <textarea
              value={form.twoPartActivity}
              onChange={(e) => set("twoPartActivity", e.target.value)}
              placeholder={"예: 14과 공과공부, 찬양연습\n복수개 입력 시 한 줄에 하나씩"}
              rows={2}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
            <div style={hintStyle}>한 줄에 하나씩 입력. 복수 항목 시 hwpx 자동으로 줄 늘어남 (헌금/다음주 기도 자연스럽게 밀림)</div>
          </FormRow>
          <FormRow label="광고 담당자">
            <input type="text" value={form.announcementAuthor} onChange={(e) => set("announcementAuthor", e.target.value)} placeholder="예: 총무" style={inputStyle} />
            <div style={hintStyle}>"선생님" 자동 붙음 → "총무선생님"</div>
          </FormRow>
          <FormRow label="광고 / 공지 본문">
            <textarea
              value={form.announcement}
              onChange={(e) => set("announcement", e.target.value)}
              placeholder={"한 줄에 하나씩 입력하세요.\n예:\n- 다음 주 부활절 분반활동\n- 5/3 야외예배 안내"}
              rows={5}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
            <div style={{ ...hintStyle, color: "#94a3b8" }}>
              hwpx 양식엔 광고 본문 자리가 없어 현재 hwpx 출력엔 반영 X. UMS 글 본문(memo)에는 들어감.
            </div>
          </FormRow>
        </div>

        )}

        {/* ⑦ 새 친구 (page 4 — 목장현황과 함께) */}
        {currentPage === 4 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>⑦ 새 친구</div>
          <FormRow label="이름">
            <input type="text" value={form.newFriend} onChange={(e) => set("newFriend", e.target.value)} placeholder="예: 차난(1학년)-자진" style={inputStyle} />
          </FormRow>
        </div>

        )}

        {/* ⑧ 사진 (page 1) */}
        {currentPage === 1 && (
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ ...sectionLabel, marginBottom: 0 }}>⑧ 사진 (최대 4장)</div>
            {photos.some((p) => p !== null) && (
              <button onClick={compactPhotos} style={smallBtnStyle}>빈칸 정리</button>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
            현재 26년 4월 26일자 양식엔 사진 슬롯이 없어 hwpx 출력엔 반영되지 않음. PDF 자동 생성에만 사용됨.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <PhotoSlot
                key={i}
                index={i}
                file={photos[i]}
                onChange={(f) => setPhoto(i, f)}
              />
            ))}
          </div>
        </div>
        )}

        {/* ⑩ 1페이지 표어 — 이번 주만 다른 본문 (yearly 와 다르게 일회성 수정) */}
        {currentPage === 1 && (
          <div style={cardStyle}>
            <div style={sectionLabel}>⑩ 1페이지 표어 (이번 주)</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8, lineHeight: 1.5 }}>
              ② 표어에 등록한 1페이지 본문이 자동 채워짐. 이번 주만 다르게 사용하려면 직접 수정.
              영구 변경하려면 ② 표어 카드에서 수정.
            </div>
            <FormRow label="이번 주 표어 본문">
              <textarea
                value={form.pageOneVerse}
                onChange={(e) => set("pageOneVerse", e.target.value)}
                placeholder={yearlyTheme?.page_one_verse || "② 표어에 1페이지 표어 등록 시 자동 채움"}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
              />
            </FormRow>
          </div>
        )}

        {/* ⑨ 목장 현황 (page 4) */}
        {currentPage === 4 && (
          <>
            <div style={cardStyle}>
              <div style={sectionLabel}>⑨ 목장 현황 (9개 반)</div>
              <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6, marginBottom: 12 }}>
                hwpx 4페이지 (2페이지 우측) 의 통계 표. 점수 입력 → 소계 자동 계산.
                나중에 출석/달란트 시스템 구현되면 자동 채움 예정.
              </div>

              {FARM_CLASSES.map((cls) => {
                const row = farmData.rows[cls];
                const subtotal = calcRowSubtotal(row);
                return (
                  <div key={cls} style={{
                    padding: 12, marginBottom: 10,
                    background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          padding: "4px 10px", background: "#3b82f6", color: "#fff",
                          borderRadius: 6, fontSize: 13, fontWeight: 800,
                        }}>
                          {cls}
                        </div>
                        <input
                          type="text"
                          value={row.teacher}
                          onChange={(e) => setFarmRow(cls, "teacher", e.target.value)}
                          placeholder="담임 이름"
                          style={{ ...inputStyle, fontSize: 13, padding: "4px 8px", flex: 1 }}
                        />
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                        소계 <span style={{ color: "#3b82f6", fontSize: 14 }}>{subtotal}</span>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginBottom: 6 }}>
                      <SmallInput label="재적" value={row.enrolled} onChange={(v) => setFarmRow(cls, "enrolled", v)} />
                      <SmallInput label="출석인원" value={row.attended} onChange={(v) => setFarmRow(cls, "attended", v)} hint="×2점 자동" />
                    </div>

                    <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, margin: "6px 0 4px" }}>
                      점수 (각 항목 직접 입력)
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 6 }}>
                      <SmallInput label="성경(×1)" value={row.bibleCarry} onChange={(v) => setFarmRow(cls, "bibleCarry", v)} />
                      <SmallInput label="요절(×2)" value={row.verse} onChange={(v) => setFarmRow(cls, "verse", v)} />
                      <SmallInput label="퀴즈(×2)" value={row.quiz} onChange={(v) => setFarmRow(cls, "quiz", v)} />
                      <SmallInput label="과제(×2)" value={row.homework} onChange={(v) => setFarmRow(cls, "homework", v)} />
                      <SmallInput label="전도(×5)" value={row.evangel} onChange={(v) => setFarmRow(cls, "evangel", v)} />
                      <SmallInput label="등반(×5)" value={row.promotion} onChange={(v) => setFarmRow(cls, "promotion", v)} />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                      <SmallInput label="교사출석" value={row.teacherAttend} onChange={(v) => setFarmRow(cls, "teacherAttend", v)} />
                      <SmallInput label="교사심방" value={row.teacherVisit} onChange={(v) => setFarmRow(cls, "teacherVisit", v)} />
                      <SmallInput label="누계" value={row.cumulative} onChange={(v) => setFarmRow(cls, "cumulative", v)} hint="이전주까지" />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={cardStyle}>
              <div style={sectionLabel}>등반 정보</div>
              <FormRow label="등반">
                <input
                  type="text" value={farmData.promotion}
                  onChange={(e) => setFarmData((d) => ({ ...d, promotion: e.target.value }))}
                  placeholder="예: 1-1반 → 1-2반 (이름)"
                  style={inputStyle}
                />
                <div style={hintStyle}>새 친구는 ⑦ 새 친구 카드에서 입력</div>
              </FormRow>
            </div>

            <div style={{ ...cardStyle, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1e40af", marginBottom: 8 }}>전체 합계 (자동)</div>
              {(() => {
                const totalEnrolled = FARM_CLASSES.reduce((s, c) => s + (parseInt(farmData.rows[c].enrolled) || 0), 0);
                const totalAttended = FARM_CLASSES.reduce((s, c) => s + (parseInt(farmData.rows[c].attended) || 0), 0);
                return (
                  <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#1e40af" }}>
                    <div>재적 합계: <b>{totalEnrolled}</b></div>
                    <div>출석 합계: <b>{totalAttended}</b></div>
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {/* 모바일: 폼 끝에 액션 카드 (데스크톱은 사이드바에서 처리) */}
        {!isDesktop && (
          <ActionCard
            cooldown={cooldown}
            autoPosting={autoPosting}
            savingDraft={savingDraft}
            generating={generating}
            credsMeta={credsMeta}
            pdfFile={pdfFile}
            onAutoPost={handleAutoPost}
            onSaveDraft={handleSaveDraft}
            onDownloadHwpx={handleDownloadHwpx}
            onDownloadPdf={handleDownloadPdf}
            onSetPdfFile={setPdfFile}
            onOpenCredsModal={() => {
              setCredsForm({
                ums_user_id: credsMeta?.ums_user_id || "",
                ums_password: "",
              });
              setCredsModalOpen(true);
            }}
            onDeleteCreds={handleDeleteCreds}
          />
        )}
        </div>

        {/* ─── 데스크톱: 우측 sticky 사이드바 ─── */}
        {isDesktop && (
          <div style={{
            width: 520, position: "sticky", top: 16, alignSelf: "flex-start",
            maxHeight: "calc(100vh - 32px)", overflowY: "auto", flexShrink: 0,
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <BulletinPreview
              currentPage={currentPage}
              form={form}
              farmData={farmData}
              quizzes={quizzes}
              photos={photos}
              deptName={deptName}
            />
            <ActionCard
              cooldown={cooldown}
              autoPosting={autoPosting}
              savingDraft={savingDraft}
              generating={generating}
              credsMeta={credsMeta}
              pdfFile={pdfFile}
              onAutoPost={handleAutoPost}
              onSaveDraft={handleSaveDraft}
              onDownloadHwpx={handleDownloadHwpx}
              onDownloadPdf={handleDownloadPdf}
              onSetPdfFile={setPdfFile}
              onOpenCredsModal={() => {
                setCredsForm({
                  ums_user_id: credsMeta?.ums_user_id || "",
                  ums_password: "",
                });
                setCredsModalOpen(true);
              }}
              onDeleteCreds={handleDeleteCreds}
              compact
            />
          </div>
        )}
      </div>

      {/* ─── 모바일 하단 sticky 액션 바 ─── */}
      {!isDesktop && (
        <div style={mobileStickyBarStyle}>
          {cooldown && cooldown.last_post_no && cooldown.remaining_seconds > 0 ? (
            <div style={{ flex: 1, fontSize: 12, color: "#92400e", textAlign: "center" }}>
              ⏱ <b style={{ fontFamily: "monospace", fontSize: 14 }}>{formatRemaining(cooldown.remaining_seconds)}</b> 후 등록 가능
            </div>
          ) : (
            <button
              onClick={handleAutoPost}
              disabled={autoPosting}
              style={{
                flex: 1, padding: "10px 18px",
                background: autoPosting ? "#e2e8f0" : "linear-gradient(135deg, #ec4899, #8b5cf6)",
                color: autoPosting ? "#94a3b8" : "#fff",
                border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800,
                cursor: autoPosting ? "not-allowed" : "pointer", fontFamily: "inherit",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              }}
            >
              <span>{autoPosting ? "등록 중..." : "🚀 1클릭 자동등록"}</span>
              {!autoPosting && (
                <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.85 }}>
                  PDF 자동 생성 후 업로드
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* ─── UMS 계정 등록/수정 모달 ─── */}
      {credsModalOpen && (
        <div style={modalBackdropStyle} onClick={() => setCredsModalOpen(false)}>
          <div style={{ ...postModalCardStyle, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>⚙️ UMS 계정 설정</div>
              <button onClick={() => setCredsModalOpen(false)} style={iconBtnStyle}>✕</button>
            </div>

            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 14, background: "#f8fafc", padding: 10, borderRadius: 8 }}>
              <b>본인의 명성교회 홈페이지(ums.or.kr) 계정</b>을 등록하세요.<br />
              자동등록 시 본인 계정으로 글이 올라갑니다.<br />
              <span style={{ fontSize: 11, color: "#94a3b8" }}>비밀번호는 AES-256-GCM 으로 암호화돼 저장됩니다.</span>
            </div>

            <FormRow label="UMS 아이디">
              <input
                type="text" autoComplete="off"
                value={credsForm.ums_user_id}
                onChange={(e) => setCredsForm((f) => ({ ...f, ums_user_id: e.target.value }))}
                placeholder="ums.or.kr 가입 시 만든 아이디"
                style={inputStyle}
              />
            </FormRow>
            <FormRow label="UMS 비밀번호">
              <input
                type="password" autoComplete="new-password"
                value={credsForm.ums_password}
                onChange={(e) => setCredsForm((f) => ({ ...f, ums_password: e.target.value }))}
                placeholder={credsMeta?.has_credentials ? "변경하려면 새 비밀번호 입력" : "ums.or.kr 비밀번호"}
                style={inputStyle}
              />
            </FormRow>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setCredsModalOpen(false)} style={resetBtnStyle}>취소</button>
              <button onClick={handleSaveCreds} disabled={credsSaving} style={primaryBtnStyle}>
                {credsSaving ? "저장 중..." : "저장"}
              </button>
            </div>

            <div style={{ marginTop: 14, fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
              계정 없으면 <a href="http://www.ums.or.kr/bbs/join.php" target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1" }}>ums.or.kr 회원가입</a> 후 등록.
            </div>
          </div>
        </div>
      )}

      {/* ─── 자동등록 진행/결과 모달 ─── */}
      {(autoPosting || autoPostResult) && (
        <div style={modalBackdropStyle}>
          <div style={{ ...postModalCardStyle, maxWidth: 460 }}>
            {autoPosting && (
              <>
                <div style={{ fontSize: 32, marginBottom: 8, textAlign: "center" }}>🚀</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b", marginBottom: 14, textAlign: "center" }}>
                  자동 등록 진행 중
                </div>
                <PostStepper currentStep={postStep} />
                <div style={{
                  fontSize: 11, color: "#64748b", marginTop: 10, padding: "8px 12px",
                  background: "#fef9c3", borderRadius: 6, lineHeight: 1.5, textAlign: "center",
                }}>
                  💡 UMS 가 입장권을 거부할 때마다 새로 받아 재시도 (최대 5회, 99% 통과)
                </div>
              </>
            )}
            {autoPostResult && autoPostResult.ok && (
              <>
                <div style={{ fontSize: 32, marginBottom: 8, textAlign: "center" }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#15803d", marginBottom: 6, textAlign: "center" }}>
                  등록 완료!
                </div>
                <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 4, textAlign: "center" }}>
                  글번호 #{autoPostResult.postNo}
                </div>
                <AttemptList attempts={autoPostResult.attempts} />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 14 }}>
                  <a
                    href={`http://www.ums.or.kr/bbs/zboard.php?id=samusil&no=${autoPostResult.postNo}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ ...resetBtnStyle, textDecoration: "none" }}
                  >
                    UMS에서 확인
                  </a>
                  <button onClick={() => { setAutoPostResult(null); setPostStep(null); }} style={primaryBtnStyle}>확인</button>
                </div>
              </>
            )}
            {autoPostResult && !autoPostResult.ok && (
              <>
                <div style={{ fontSize: 32, marginBottom: 8, textAlign: "center" }}>⚠️</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#b91c1c", marginBottom: 6, textAlign: "center" }}>
                  자동등록 실패
                </div>
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 4, wordBreak: "break-word" }}>
                  {autoPostResult.error}
                </div>
                <AttemptList attempts={autoPostResult.attempts} />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14, flexWrap: "wrap" }}>
                  <button
                    onClick={() => { setAutoPostResult(null); setPostStep(null); }}
                    style={resetBtnStyle}
                  >
                    닫기
                  </button>
                  <button
                    onClick={() => { setAutoPostResult(null); setPostStep(null); handleAutoPost(); }}
                    style={primaryBtnStyle}
                  >
                    🔄 다시 시도
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── 모바일: 우측 drawer ─── */}
      {!isDesktop && drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", zIndex: 998 }}
          />
          <div style={{
            position: "fixed", top: 0, right: 0, height: "100vh", width: "min(320px, 85vw)",
            background: "#fff", zIndex: 999, padding: 16, overflowY: "auto",
            boxShadow: "-4px 0 20px rgba(0,0,0,0.15)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>📂 임시저장 목록</div>
              <button onClick={() => setDrawerOpen(false)} style={iconBtnStyle}>✕</button>
            </div>
            <DraftSidebar
              draftList={draftList}
              currentDate={form.date}
              onSelect={(d) => { handleDateChange(d); setDrawerOpen(false); }}
              onDelete={handleDeleteDraft}
              embedded
            />
          </div>
        </>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ActionCard — 등록 + 임시저장 + hwpx + 계정 정보
// 데스크톱 사이드바 / 모바일 폼 끝부분 둘 다에서 사용
// ─────────────────────────────────────────────────────────────────
function ActionCard({
  cooldown, autoPosting, savingDraft, generating, credsMeta, pdfFile,
  onAutoPost, onSaveDraft, onDownloadHwpx, onDownloadPdf, onSetPdfFile,
  onOpenCredsModal, onDeleteCreds, compact,
}: {
  cooldown: { remaining_seconds: number; can_post: boolean; last_post_no: number | null; last_posted_at: string | null } | null;
  autoPosting: boolean;
  savingDraft: boolean;
  generating: boolean;
  credsMeta: { has_credentials: boolean; ums_user_id: string | null; updated_at: string | null } | null;
  pdfFile: File | null;
  onAutoPost: () => void;
  onSaveDraft: () => void;
  onDownloadHwpx: () => void;
  onDownloadPdf: () => void;
  onSetPdfFile: (f: File | null) => void;
  onOpenCredsModal: () => void;
  onDeleteCreds: () => void;
  compact?: boolean;
}) {
  const cardCss: React.CSSProperties = {
    background: "#fff", borderRadius: 14, padding: compact ? 14 : 20,
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
  };

  return (
    <div style={cardCss}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.5, marginBottom: 10 }}>
        등록
      </div>

      {/* 계정 상태 */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 10px", borderRadius: 8, marginBottom: 10,
        background: credsMeta?.has_credentials ? "#dcfce7" : "#fef3c7",
        border: `1px solid ${credsMeta?.has_credentials ? "#86efac" : "#fbbf24"}`,
      }}>
        <div style={{ fontSize: 11, lineHeight: 1.4 }}>
          {credsMeta?.has_credentials ? (
            <>
              <span style={{ fontWeight: 700, color: "#15803d" }}>✅ UMS 계정 등록됨</span>
              <br />
              <span style={{ color: "#15803d" }}>{credsMeta.ums_user_id}</span>
            </>
          ) : (
            <>
              <span style={{ fontWeight: 700, color: "#92400e" }}>⚠️ UMS 계정 미등록</span>
              <br />
              <span style={{ color: "#a16207" }}>등록 후 자동등록 가능</span>
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={onOpenCredsModal} style={{
            padding: "5px 8px", background: "#fff", border: "1px solid #cbd5e1",
            borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>
            ⚙️
          </button>
          {credsMeta?.has_credentials && (
            <button onClick={onDeleteCreds} title="삭제" style={{
              padding: "5px 8px", background: "#fef2f2", color: "#b91c1c",
              border: "1px solid #fecaca", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
            }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 쿨다운 / 안내 */}
      {cooldown && cooldown.last_post_no && cooldown.remaining_seconds > 0 ? (
        <div style={{
          background: "#fef3c7", border: "1.5px solid #fbbf24", borderRadius: 8,
          padding: 10, marginBottom: 10, textAlign: "center",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#92400e", marginBottom: 2 }}>
            ⏱ #{cooldown.last_post_no} 후 30분 대기
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#92400e", fontFamily: "monospace" }}>
            {formatRemaining(cooldown.remaining_seconds)}
          </div>
        </div>
      ) : (
        !compact && (
          <div style={{
            background: "#ecfeff", border: "1px solid #67e8f9", borderRadius: 8,
            padding: 8, marginBottom: 10, fontSize: 11, color: "#0369a1", lineHeight: 1.5,
          }}>
            🚀 자동등록 = 폼 → PDF 자동 생성 → UMS 게시판 등록까지 1클릭
          </div>
        )
      )}

      {/* 메인 액션 */}
      <button
        onClick={onAutoPost}
        disabled={autoPosting || (cooldown ? !cooldown.can_post : false)}
        style={{
          width: "100%", padding: compact ? "13px 18px" : "16px 22px",
          background: (autoPosting || (cooldown && !cooldown.can_post))
            ? "#e2e8f0"
            : "linear-gradient(135deg, #ec4899, #8b5cf6)",
          color: (autoPosting || (cooldown && !cooldown.can_post)) ? "#94a3b8" : "#fff",
          border: "none", borderRadius: 10,
          fontSize: compact ? 14 : 16, fontWeight: 800,
          cursor: (autoPosting || (cooldown && !cooldown.can_post)) ? "not-allowed" : "pointer",
          fontFamily: "inherit", marginBottom: 4,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
        }}
      >
        <span>{autoPosting ? "등록 중..." : "🚀 1클릭 자동등록"}</span>
        {!autoPosting && (!cooldown || cooldown.can_post) && (
          <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.85 }}>
            PDF 자동 생성 후 업로드 합니다
          </span>
        )}
      </button>

      {/* 보조 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={onSaveDraft} disabled={savingDraft} style={{
          flex: 1, padding: "8px 10px", background: "#f1f5f9", color: "#475569",
          border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}>
          {savingDraft ? "저장 중..." : "💾 임시저장"}
        </button>
        <button onClick={onDownloadHwpx} disabled={generating} style={{
          flex: 1, padding: "8px 10px", background: "#f1f5f9", color: "#475569",
          border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}>
          {generating ? "생성 중..." : "📥 hwpx"}
        </button>
        <button onClick={onDownloadPdf} disabled={generating} style={{
          flex: 1, padding: "8px 10px", background: "#f1f5f9", color: "#475569",
          border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}>
          {generating ? "생성 중..." : "📥 PDF"}
        </button>
      </div>

      {/* 고급 */}
      <details style={{ marginTop: 10, fontSize: 11, color: "#64748b" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>🔧 한글 PDF 직접 첨부</summary>
        <div style={{ marginTop: 6, padding: 8, background: "#f8fafc", borderRadius: 6 }}>
          <input
            type="file" accept="application/pdf,.pdf"
            onChange={(e) => onSetPdfFile(e.target.files?.[0] || null)}
            style={{ width: "100%", padding: 4, fontSize: 10 }}
          />
          {pdfFile && (
            <div style={{ fontSize: 10, color: "#15803d", marginTop: 4 }}>
              ✅ {pdfFile.name}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function PhotoSlot({ index, file, onChange }: {
  index: number; file: File | null; onChange: (f: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    onChange(f);
    e.target.value = "";  // 같은 파일 다시 선택 가능하게
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) onChange(f);
  };

  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{
        position: "relative",
        aspectRatio: "3/2",
        borderRadius: 10,
        border: file ? "1.5px solid #6366f1" : "1.5px dashed #cbd5e1",
        background: file ? "#000" : "#f8fafc",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <input type="file" accept="image/*" onChange={onPick} style={{ display: "none" }} />
      {preview ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={`슬롯 ${index + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(null); }}
            style={{
              position: "absolute", top: 6, right: 6,
              padding: "3px 8px", background: "rgba(0,0,0,0.55)", color: "#fff",
              border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700,
              cursor: "pointer",
            }}
          >✕</button>
        </>
      ) : (
        <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>📷</div>
          <div>슬롯 {index + 1}</div>
          <div style={{ fontSize: 10, marginTop: 2 }}>탭/드래그</div>
        </div>
      )}
    </label>
  );
}

function DraftSidebar({
  draftList, currentDate, onSelect, onDelete, embedded,
}: {
  draftList: Array<{ issue_date: string; issue_number: string | null; last_edited_at: string }>;
  currentDate: string;
  onSelect: (date: string) => void;
  onDelete: (date: string) => void;
  embedded?: boolean;
}) {
  const wrapperStyle: React.CSSProperties = embedded
    ? {}
    : {
        width: "100%",  // 부모 wrapper 의 width 따라감
        background: "#fff", borderRadius: 14, padding: 16,
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        boxSizing: "border-box",
      };

  return (
    <div style={wrapperStyle}>
      {!embedded && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.5, marginBottom: 12 }}>
          📂 임시저장 목록 ({draftList.length}건)
        </div>
      )}
      {draftList.length === 0 ? (
        <div style={{ fontSize: 12, color: "#94a3b8", padding: 12, textAlign: "center" }}>
          저장된 임시본 없음
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {draftList.map((d) => {
            const isCurrent = d.issue_date === currentDate;
            return (
              <div
                key={d.issue_date}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: isCurrent ? "1.5px solid #6366f1" : "1px solid #e2e8f0",
                  background: isCurrent ? "#eef2ff" : "#fff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div
                  onClick={() => !isCurrent && onSelect(d.issue_date)}
                  style={{ flex: 1, minWidth: 0, cursor: isCurrent ? "default" : "pointer" }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                    {d.issue_date}
                    {d.issue_number && <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>{d.issue_number}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                    {isCurrent && <span style={{ color: "#6366f1", marginRight: 6 }}>● 작성 중</span>}
                    {formatRelativeTime(d.last_edited_at)}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(d.issue_date); }}
                  title="삭제"
                  style={{
                    padding: "6px 8px", background: "#fef2f2", color: "#b91c1c",
                    border: "1px solid #fecaca", borderRadius: 6, fontSize: 11,
                    cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

// 3페이지 공과 — 단일 문제 카드
function QuizCard({ index, quiz, canRemove, onChange, onRemove }: {
  index: number;
  quiz: QuizItem;
  canRemove: boolean;
  onChange: (next: QuizItem) => void;
  onRemove: () => void;
}) {
  const choiceMarkers = ["①", "②", "③", "④", "⑤"];
  const isMc = quiz.type !== "subjective";

  return (
    <div style={{
      padding: 12, marginBottom: 10,
      background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{
          padding: "4px 10px", background: "#3b82f6", color: "#fff",
          borderRadius: 6, fontSize: 13, fontWeight: 800, flexShrink: 0,
        }}>
          {index + 1}번
        </div>
        <select
          value={quiz.type}
          onChange={(e) => onChange(changeQuizType(quiz, e.target.value as QuizType))}
          style={{
            flex: 1, padding: "6px 8px", fontSize: 12,
            border: "1px solid #cbd5e1", borderRadius: 6, fontFamily: "inherit",
            background: "#fff",
          }}
        >
          <option value="subjective">서술형 (단답)</option>
          <option value="mc3">객관식 3지 선다</option>
          <option value="mc4">객관식 4지 선다</option>
          <option value="mc5">객관식 5지 선다</option>
        </select>
        {canRemove && (
          <button
            onClick={onRemove}
            style={{
              padding: "4px 10px", background: "#fee2e2", color: "#b91c1c",
              border: "1px solid #fca5a5", borderRadius: 6,
              fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              flexShrink: 0,
            }}
            title="문제 삭제"
          >
            ✕
          </button>
        )}
      </div>

      <textarea
        value={quiz.question}
        onChange={(e) => onChange({ ...quiz, question: e.target.value })}
        placeholder={isMc ? "문제 (예: 사람들은 왜 바벨탑을 쌓으려고 했나요?)" : "문제 (서술형, 보기 없음)"}
        rows={2}
        style={{
          width: "100%", padding: "8px 10px", marginBottom: 8,
          border: "1px solid #cbd5e1", borderRadius: 6,
          fontSize: 13, fontFamily: "inherit", resize: "vertical",
        }}
      />

      {isMc && (
        <div style={{ display: "grid", gridTemplateColumns: quiz.choices.length >= 4 ? "1fr 1fr" : "1fr", gap: 6 }}>
          {quiz.choices.map((c, ci) => (
            <input
              key={ci}
              type="text"
              value={c}
              onChange={(e) => {
                const newChoices = [...quiz.choices];
                newChoices[ci] = e.target.value;
                onChange({ ...quiz, choices: newChoices });
              }}
              placeholder={`${choiceMarkers[ci]} 보기`}
              style={{
                width: "100%", padding: "6px 10px",
                border: "1px solid #cbd5e1", borderRadius: 6,
                fontSize: 12, fontFamily: "inherit",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 우측 실시간 미리보기 패널 (PC 한정) — hwpx 레이아웃 HTML 재현
// ─────────────────────────────────────────────────────────────────
function BulletinPreview({ currentPage, form, farmData, quizzes, photos, deptName }: {
  currentPage: 1 | 2 | 3 | 4;
  form: FormState;
  farmData: FarmData;
  quizzes: QuizItem[];
  photos: Array<File | null>;
  deptName: string;
}) {
  // 폼 페이지 → hwpx spread 매핑
  // spread 1 (1페이지): 좌측 = 알립니다+공과 / 우측 = 표지
  // spread 2 (2페이지): 좌측 = 예배순서 / 우측 = 목장현황
  const isSpread1 = currentPage === 1 || currentPage === 3;
  const spreadLabel = isSpread1 ? "1페이지 (알립니다+표지)" : "2페이지 (예배순서+통계)";

  const pageCss: React.CSSProperties = {
    flex: 1,
    aspectRatio: "595/842",  // A4 비율 (한 페이지)
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    padding: 8,
    fontSize: 8,
    lineHeight: 1.4,
    color: "#1e293b",
    overflow: "auto",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    fontFamily: "'Noto Sans KR', sans-serif",
  };

  return (
    <div>
      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, marginBottom: 6, textAlign: "center" }}>
        📖 {spreadLabel} 미리보기
      </div>
      <div style={{ display: "flex", gap: 6, background: "#e2e8f0", padding: 6, borderRadius: 6 }}>
        {isSpread1 ? (
          <>
            <div style={pageCss}><PreviewPage3 form={form} quizzes={quizzes} /></div>
            <div style={pageCss}><PreviewPage1 form={form} photos={photos} deptName={deptName} /></div>
          </>
        ) : (
          <>
            <div style={pageCss}><PreviewPage2 form={form} /></div>
            <div style={pageCss}><PreviewPage4 form={form} farmData={farmData} /></div>
          </>
        )}
      </div>
    </div>
  );
}

function PreviewPage1({ form, photos, deptName }: {
  form: FormState; photos: Array<File | null>; deptName: string;
}) {
  const filledPhotos = photos.filter((p) => p !== null) as File[];
  const photoUrls = filledPhotos.slice(0, 4).map((f) => URL.createObjectURL(f));
  const dateStr = form.date ? formatKoreanDate(form.date) : "";
  const issueNum = form.issueNumber || calcIssueNumber(form.date) || "";

  return (
    <div style={{ padding: "4px 6px" }}>
      {/* ── 상단: 호수 (좌) + 날짜 (우) 같은 줄 ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 9 }}>
        <div style={{ color: "#475569", fontWeight: 700 }}>{issueNum || "(호수 미입력)"}</div>
        <div style={{ color: "#475569", fontWeight: 700 }}>{dateStr || "(날짜 미선택)"}</div>
      </div>

      {/* ── 큰 컬러풀 부서명 타이틀 (hwpx 의 무지개 글씨 흉내) ── */}
      <div style={{ textAlign: "center", margin: "8px 0", fontSize: 22, fontWeight: 900, letterSpacing: 4 }}>
        <span style={{ color: "#dc2626" }}>초</span>
        <span style={{ color: "#ea580c" }}>등</span>
        <span style={{ color: "#9333ea" }}> 1 </span>
        <span style={{ color: "#0891b2" }}>초</span>
        <span style={{ color: "#16a34a" }}>원</span>
      </div>

      {/* ── 주제 (환영 자리에 — hwpx 와 동일) ── */}
      <div style={{
        textAlign: "center", fontSize: 9, fontWeight: 700, color: "#1e40af",
        margin: "6px 0 10px", padding: "4px 6px",
        background: "#eff6ff", borderRadius: 4,
      }}>
        주제 : {form.theme || "(미입력)"}
      </div>

      {/* ── 사진 영역 (2x2) ── */}
      {photoUrls.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, marginBottom: 6 }}>
          {photoUrls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt={`사진 ${i + 1}`}
              style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 3, border: "1px solid #cbd5e1" }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, marginBottom: 6 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{
              width: "100%", height: 70,
              background: "#f1f5f9", border: "1px dashed #cbd5e1", borderRadius: 3,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 7, color: "#94a3b8",
            }}>사진 {i + 1}</div>
          ))}
        </div>
      )}

      {/* ── 표어 (사진 밑) ── */}
      {form.pageOneVerse ? (
        <div style={{
          padding: "6px 8px", background: "#fff", borderLeft: "3px solid #f59e0b",
          fontSize: 7.5, lineHeight: 1.6, color: "#1e293b", marginBottom: 6,
          fontStyle: "italic",
        }}>
          {form.pageOneVerse}
        </div>
      ) : (
        <div style={{ padding: 6, fontSize: 7, color: "#cbd5e1", borderLeft: "3px solid #fde68a", fontStyle: "italic" }}>
          (1페이지 표어 미입력)
        </div>
      )}

      {/* ── 푸터 (교회 정보) ── */}
      <div style={{
        marginTop: 8, padding: "6px 8px",
        background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4,
        fontSize: 6.5, color: "#475569", lineHeight: 1.5,
      }}>
        <div style={{ textAlign: "center", fontWeight: 700, color: "#1e293b", marginBottom: 2 }}>
          대한예수교 장로회 명성교회
        </div>
        <div style={{ textAlign: "center", fontSize: 6, color: "#64748b" }}>
          울산광역시 동구 명덕5길-9 (서부동) ☎ 251-7991 (친구구원)
        </div>
        <div style={{ marginTop: 3, paddingTop: 3, borderTop: "1px dashed #cbd5e1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, fontSize: 6 }}>
          <div>✿교장: 김종혁목사</div>
          <div>✿지도: 김희숙전도사</div>
          <div>✿부장: 최성헌</div>
          <div>✿총무: 정기숙</div>
          <div>✿부감: 김찬규,박양흠,정재원</div>
          <div>✿서기: 심주석</div>
        </div>
      </div>
    </div>
  );
}

function PreviewPage2({ form }: { form: FormState }) {
  // hwpx 양식 그대로: 항목(우측정렬) ─── 멘트 ─── 담당(좌측정렬)
  // 멘트가 없으면 ─── 로 가득 채움
  const orderItems: Array<{ label: string; mid: string; right: string }> = [
    { label: "찬양",       mid: "",                                       right: form.praise1 || form.praise2 ? `${form.praise1} ${form.praise2} 선생님` : "" },
    { label: "예배인도",   mid: "",                                       right: form.leader ? `${form.leader}선생님` : "" },
    { label: "십계명",     mid: "",                                       right: "다 같 이" },
    { label: "신앙고백",   mid: "",                                       right: "다 같 이" },
    { label: "주제제창",   mid: form.theme || "",                         right: "다 같 이" },
    { label: "찬양/헌금",  mid: "고백하며 드립니다",                       right: "다 같 이" },
    { label: "기 도",      mid: "",                                       right: form.prayerClass || "" },
    { label: "성경봉독",   mid: form.scripture || "",                     right: "인도자" },
    { label: "강 론",      mid: form.sermonTitle || "",                   right: form.preacher ? `${form.preacher}님` : "" },
    { label: "주기도문",   mid: "",                                       right: "다 같 이" },
    { label: "광 고",      mid: "",                                       right: form.announcementAuthor ? `${form.announcementAuthor} 선생님` : "" },
  ];

  const renderRow = (item: { label: string; mid: string; right: string }, i: number) => (
    <div key={i} style={{
      display: "flex", alignItems: "center", gap: 4,
      padding: "3px 0", fontSize: 7.5,
    }}>
      <div style={{ width: 50, textAlign: "right", color: "#1e293b", fontWeight: 600, flexShrink: 0 }}>
        {item.label}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}>
        <div style={{ flex: 1, height: 1, background: "#475569" }} />
        {item.mid && (
          <div style={{ padding: "0 4px", fontSize: 7, color: "#9333ea", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.mid}
          </div>
        )}
        <div style={{ flex: 1, height: 1, background: "#475569" }} />
      </div>
      <div style={{ width: 90, textAlign: "left", color: "#1e293b", fontSize: 7.5, flexShrink: 0 }}>
        {item.right}
      </div>
    </div>
  );

  return (
    <div style={{ padding: "4px 6px" }}>
      {/* 상단 일러스트 + "주일예배 순서" 큰 글씨 */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12 }}>👧🏻</span>
        <span style={{
          fontSize: 16, fontWeight: 800, color: "#1e293b",
          margin: "0 8px", letterSpacing: 2,
          textShadow: "1px 1px 0 rgba(124,58,237,0.2)",
        }}>
          주일예배 순서
        </span>
        <span style={{ fontSize: 12 }}>👦🏻👦🏻</span>
      </div>

      {/* ✿1부 예배 + ✿안내 (같은 줄, 양쪽 끝) */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 8, fontWeight: 700, color: "#1e40af",
        margin: "0 0 6px",
      }}>
        <span>✿1부 예배 : 오전 {form.startTime}</span>
        <span>✿안내 : {form.guide || ""} 선생님</span>
      </div>

      {/* 예배 순서 표 (11줄) */}
      <div>
        {orderItems.map(renderRow)}
      </div>

      {/* ✿2부 행사 (복수 줄 — 사용자 줄바꿈으로 여러 항목, hwpx 자연스럽게 늘어남) */}
      {form.twoPartActivity && (
        <div style={{ marginTop: 8 }}>
          {form.twoPartActivity.split("\n").map((line, i) => (
            <div key={i} style={{ fontSize: 7.5, color: "#1e40af", fontWeight: 700, marginBottom: 2 }}>
              {i === 0 ? "✿2부 행사 : " : "             "}{line}
            </div>
          ))}
        </div>
      )}

      {/* ✿다음 주 기도 */}
      {form.nextPrayer && (
        <div style={{ marginTop: 4, fontSize: 7.5, color: "#1e40af", fontWeight: 700 }}>
          ✿다음 주 기도 : {form.nextPrayer}
        </div>
      )}

      {/* 헌금 (분홍 둥근 박스 — hwpx 양식과 동일) */}
      <div style={{ marginTop: 12, display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{
          padding: "8px 14px",
          background: "#fce7f3",
          border: "2px solid #f9a8d4",
          borderRadius: "50%",
          fontSize: 10,
          fontWeight: 800,
          color: "#be185d",
          flexShrink: 0,
          minWidth: 36,
          textAlign: "center",
        }}>
          헌금
        </div>
        <div style={{ flex: 1, fontSize: 7.5, paddingTop: 4 }}>
          <div>십일조 : <b style={{ color: "#1e293b" }}>{form.tithe || ""}</b></div>
          <div style={{ marginTop: 4 }}>감사헌금 : <b style={{ color: "#1e293b" }}>{form.thanksgiving || ""}</b></div>
        </div>
      </div>
    </div>
  );
}

function PreviewPage3({ form, quizzes }: { form: FormState; quizzes: QuizItem[] }) {
  const choiceMarkers = ["①", "②", "③", "④", "⑤"];
  return (
    <div style={{ padding: "4px 6px" }}>
      {/* ── 상단: "알 립 니 다 !" 빨간 큰 글씨 ── */}
      <div style={{
        textAlign: "center", marginBottom: 4,
        fontSize: 18, fontWeight: 900, color: "#dc2626",
        letterSpacing: 4, fontStyle: "italic",
        textShadow: "1px 1px 0 rgba(0,0,0,0.1)",
      }}>
        알 립 니 다 !
      </div>

      {/* ── 환영 문구 (hwpx 양식: 알립니다 바로 아래) ── */}
      <div style={{ textAlign: "center", fontSize: 9, color: "#dc2626", fontWeight: 700, margin: "4px 0 8px", letterSpacing: 1 }}>
        ♥ 멋진 초등 1 초원 모든 친구들 환영합니다 ♥
      </div>

      {/* ── 안내 사항 (예배시간 / 교사회의 / 2부 복습) ── */}
      <div style={{ fontSize: 7.5, color: "#1e293b", lineHeight: 1.7, padding: "6px 8px", background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 4, marginBottom: 8 }}>
        <div>♥ 예배시간을 잘 지킵시다.</div>
        <div>♥ 교사회의는 10시 20분에 합니다. 모든 선생님들 참석해주세요.</div>
        <div>♥ 매달 마지막 주일 2부 시간에 공과 요절암송 및 퀴즈로 복습합니다.</div>
      </div>

      {/* hwpx 의 "♣ N과 공과 퀴즈 ♣" 헤더 */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "#dc2626", fontWeight: 900 }}>♣</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#1e293b", margin: "0 8px" }}>
          {form.lessonNum || "?"}과 공과 퀴즈
        </span>
        <span style={{ fontSize: 13, color: "#dc2626", fontWeight: 900 }}>♣</span>
      </div>

      {/* 퀴즈 리스트 */}
      <div style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: 4, padding: "8px 10px" }}>
        {quizzes.map((q, i) => (
          <div key={q.id} style={{ marginBottom: 8, paddingBottom: 6, borderBottom: i < quizzes.length - 1 ? "1px dashed #fde68a" : "none" }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, color: "#1e293b", marginBottom: 3 }}>
              {i + 1}. {q.question || <span style={{ color: "#cbd5e1", fontWeight: 400 }}>(문제 미입력)</span>}
            </div>
            {q.type !== "subjective" && (
              <div style={{ paddingLeft: 6 }}>
                {q.type === "mc4" ? (
                  // 4지 — 2x2 grid (hwpx 와 비슷하게)
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px 8px" }}>
                    {q.choices.map((c, ci) => (
                      <div key={ci} style={{ fontSize: 7.5, color: c ? "#1e293b" : "#cbd5e1" }}>
                        {choiceMarkers[ci]} {c || "—"}
                      </div>
                    ))}
                  </div>
                ) : (
                  // 3지 / 5지 — 세로 한 줄씩
                  q.choices.map((c, ci) => (
                    <div key={ci} style={{ fontSize: 7.5, color: c ? "#1e293b" : "#cbd5e1" }}>
                      {choiceMarkers[ci]} {c || "—"}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 요절암송 — hwpx 양식 */}
      {form.versePassage ? (
        <div style={{
          marginTop: 8, padding: "8px 10px",
          background: "#dbeafe", border: "1px solid #93c5fd",
          borderRadius: 4,
        }}>
          <div style={{ fontSize: 8.5, color: "#1e40af", fontWeight: 800, marginBottom: 3, letterSpacing: 1 }}>
            요절암송
          </div>
          <div style={{ fontSize: 8, lineHeight: 1.6, color: "#1e293b" }}>
            {form.versePassage}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 8, padding: 6, fontSize: 7, color: "#cbd5e1", textAlign: "center" }}>
          (요절암송 미입력)
        </div>
      )}
    </div>
  );
}

function PreviewPage4({ form, farmData }: { form: FormState; farmData: FarmData }) {
  const totalEnrolled = FARM_CLASSES.reduce((s, c) => s + (parseInt(farmData.rows[c].enrolled) || 0), 0);
  const totalAttended = FARM_CLASSES.reduce((s, c) => s + (parseInt(farmData.rows[c].attended) || 0), 0);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", marginBottom: 6 }}>
        초등 1 초원 목장 현황
      </div>
      <div style={{ borderTop: "1px solid #c4b5fd", margin: "4px 0 6px" }} />
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 7 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={{ padding: 2, border: "1px solid #cbd5e1" }}>반</th>
            <th style={{ padding: 2, border: "1px solid #cbd5e1" }}>담임</th>
            <th style={{ padding: 2, border: "1px solid #cbd5e1" }}>재적</th>
            <th style={{ padding: 2, border: "1px solid #cbd5e1" }}>출석</th>
            <th style={{ padding: 2, border: "1px solid #cbd5e1" }}>소계</th>
            <th style={{ padding: 2, border: "1px solid #cbd5e1" }}>누계</th>
          </tr>
        </thead>
        <tbody>
          {FARM_CLASSES.map((cls) => {
            const r = farmData.rows[cls];
            const sub = calcRowSubtotal(r);
            return (
              <tr key={cls}>
                <td style={{ padding: 2, border: "1px solid #cbd5e1", textAlign: "center" }}>{cls}</td>
                <td style={{ padding: 2, border: "1px solid #cbd5e1" }}>{r.teacher || "—"}</td>
                <td style={{ padding: 2, border: "1px solid #cbd5e1", textAlign: "center" }}>{r.enrolled || "-"}</td>
                <td style={{ padding: 2, border: "1px solid #cbd5e1", textAlign: "center" }}>{r.attended || "-"}</td>
                <td style={{ padding: 2, border: "1px solid #cbd5e1", textAlign: "center", color: sub > 0 ? "#3b82f6" : "#cbd5e1" }}>{sub || "-"}</td>
                <td style={{ padding: 2, border: "1px solid #cbd5e1", textAlign: "center" }}>{r.cumulative || "-"}</td>
              </tr>
            );
          })}
          <tr style={{ background: "#eff6ff", fontWeight: 700 }}>
            <td colSpan={2} style={{ padding: 2, border: "1px solid #cbd5e1", textAlign: "center" }}>합계</td>
            <td style={{ padding: 2, border: "1px solid #cbd5e1", textAlign: "center" }}>{totalEnrolled}</td>
            <td style={{ padding: 2, border: "1px solid #cbd5e1", textAlign: "center" }}>{totalAttended}</td>
            <td colSpan={2} style={{ padding: 2, border: "1px solid #cbd5e1" }}></td>
          </tr>
        </tbody>
      </table>
      {form.newFriend && (
        <div style={{ marginTop: 8, padding: 6, background: "#fdf4ff", borderRadius: 4 }}>
          <div style={{ fontSize: 8, color: "#a21caf", fontWeight: 700 }}>새 친구</div>
          <div style={{ fontSize: 8 }}>{form.newFriend}</div>
        </div>
      )}
      {farmData.promotion && (
        <div style={{ marginTop: 6, padding: 6, background: "#ecfeff", borderRadius: 4 }}>
          <div style={{ fontSize: 8, color: "#0891b2", fontWeight: 700 }}>등반</div>
          <div style={{ fontSize: 8 }}>{farmData.promotion}</div>
        </div>
      )}
    </div>
  );
}

// 4페이지 목장 현황의 작은 숫자 입력
function SmallInput({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <input
        type="number" min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", padding: "6px 8px",
          border: "1px solid #cbd5e1", borderRadius: 6,
          fontSize: 13, fontFamily: "inherit",
          background: "#fff",
        }}
      />
      {hint && <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
  paddingBottom: 80, // 모바일 sticky bar 가려지지 않게
};
const containerStyle: React.CSSProperties = {
  maxWidth: 720, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 14,
};
const headerStyle: React.CSSProperties = {
  background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px",
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
};
const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};
const warnCardStyle: React.CSSProperties = {
  background: "#fff7ed", border: "1.5px solid #fed7aa", borderRadius: 14, padding: 14, color: "#9a3412",
};
const sectionLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.5, marginBottom: 12,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8,
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const hintStyle: React.CSSProperties = {
  fontSize: 11, color: "#94a3b8", marginTop: 4,
};
const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8,
  fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 22px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800,
  cursor: "pointer", fontFamily: "inherit",
};
const draftBtnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "#ecfeff", color: "#0369a1",
  border: "1.5px solid #67e8f9", borderRadius: 8, fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const iconBtnStyle: React.CSSProperties = {
  padding: "8px 12px", background: "#f1f5f9", color: "#475569",
  border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center",
};
const modalBackdropStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 16, zIndex: 1000,
};
const postModalCardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 20,
  width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto",
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
};
const resetBtnStyle: React.CSSProperties = {
  padding: "10px 18px", background: "#f1f5f9", color: "#475569",
  border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const cancelBtnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "#f1f5f9", color: "#475569",
  border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const smallBtnStyle: React.CSSProperties = {
  padding: "5px 12px", background: "#eef2ff", color: "#4f46e5",
  border: "1px solid #c7d2fe", borderRadius: 6, fontSize: 11, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const toastStyle: React.CSSProperties = {
  position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)",
  background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px",
  borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999,
  fontFamily: "inherit", whiteSpace: "nowrap", maxWidth: "90vw", textAlign: "center",
};
const mobileStickyBarStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  background: "#fff",
  borderTop: "1px solid #e2e8f0",
  padding: "10px 14px",
  paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
  display: "flex",
  alignItems: "center",
  gap: 10,
  boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
};

const loadingStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif",
};
