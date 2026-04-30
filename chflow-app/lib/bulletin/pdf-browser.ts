// 브라우저-사이드 PDF 생성
// pdf-lib + NanumGothic 으로 폼 데이터 + 사진 4장을 1~2페이지 PDF로 만듦.
// fontkit 으로 한글 폰트 임베드 (서브셋팅 가능).
//
// 디자인 fidelity: 한컴 hwpx 대비 80~90%. 글자 자간/장평/폰트 미세 차이.
// 추후 LibreOffice 서버 변환으로 100% 가능하지만 일단은 이걸로 자동등록 동작 검증.

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export interface BrowserBulletinData {
  dept_name: string;          // "초등1부"
  date: string;               // YYYY-MM-DD
  issue_number?: string;      // "제26-18호"
  topic: string;              // 주제 (theme)
  scripture: string;          // 본문 (성경)
  guide: string;              // 안내
  leader: string;
  praise1: string;
  praise2: string;
  prayer_class: string;
  scripture_reader: string;
  sermon_title: string;
  preacher: string;
  next_prayer: string;
  tithe: string;
  thanksgiving: string;
  two_part_activity: string;
  announcement: string;
  new_friend: string;
  lesson_num: string;
  q1: string;
  q1c: [string, string, string, string];
  q2: string;
  q2c: [string, string, string, string];
  q3: string;
  q3c: [string, string, string, string];
  q4: string;
  announcement_author: string;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const COLOR_TEXT   = rgb(0.12, 0.16, 0.24);
const COLOR_MUTED  = rgb(0.45, 0.51, 0.62);
const COLOR_ACCENT = rgb(0.39, 0.40, 0.95);
const COLOR_LIGHT  = rgb(0.91, 0.93, 0.96);

// 다중 폰트 로드 — hwpx 디자인 fidelity 향상용
// - 본문: 삼립호빵체 Basic (hwpx 본문 압도적 사용 폰트, 283회)
// - 제목/강조: EF_제주돌담 ("알려드립니다!" 등 강조)
// - 메타: 배스킨라빈스 B (호수 등)
// - fallback: NanumGothic (subset 안 되는 글자 대비)
const FONT_PATHS = {
  body: "/fonts/SDSamliphopangcheTTFBasic.ttf",
  title: "/fonts/EF_jejudoldam.otf",
  meta: "/fonts/BaskinRobbins-B.ttf",
  fallback: "/fonts/NanumGothic-Regular.ttf",
} as const;

const cachedFontBytes: Record<string, Uint8Array> = {};
async function loadFontBytes(path: string): Promise<Uint8Array> {
  if (cachedFontBytes[path]) return cachedFontBytes[path];
  const res = await fetch(path);
  if (!res.ok) throw new Error(`폰트 로드 실패: ${path} ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  cachedFontBytes[path] = bytes;
  return bytes;
}

// 사진 → jpg 바이트 (Canvas 로 리사이즈 + 압축)
async function fileToJpgBytes(file: File, maxLongSide = 1200, quality = 0.82): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지 로드 실패")); };
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

// 한국어 wrap
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (!para) { lines.push(""); continue; }
    let cur = "";
    for (const ch of para) {
      const test = cur + ch;
      if (font.widthOfTextAtSize(test, fontSize) > maxWidth && cur) {
        lines.push(cur); cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function drawText(p: PDFPage, t: string, x: number, y: number, font: PDFFont, size: number, color = COLOR_TEXT) {
  if (!t) return;
  p.drawText(t, { x, y, size, font, color });
}

function formatKoreanDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${y}년 ${m}월 ${d}일 (${dow})`;
}

export async function generateBulletinPdfBrowser(
  data: BrowserBulletinData,
  photos: Array<File | null>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // 다중 폰트 임베드 (subset: true 로 사용된 글자만 — PDF 사이즈 작게)
  const [bodyBytes, titleBytes, metaBytes, fallbackBytes] = await Promise.all([
    loadFontBytes(FONT_PATHS.body),
    loadFontBytes(FONT_PATHS.title),
    loadFontBytes(FONT_PATHS.meta),
    loadFontBytes(FONT_PATHS.fallback),
  ]);
  const fontBody = await doc.embedFont(bodyBytes, { subset: true });
  const fontTitle = await doc.embedFont(titleBytes, { subset: true });
  const fontMeta = await doc.embedFont(metaBytes, { subset: true });
  const fontFallback = await doc.embedFont(fallbackBytes, { subset: true });
  // 기존 코드 호환용 — 본문 폰트를 'font' 로 사용
  const font = fontBody;
  void fontFallback; // fallback 은 일부 글자 누락 시 사용 (현재는 배포만)
  await doc.embedFont(StandardFonts.Helvetica);

  // ───── Page 1: 표지 ─────
  const p1 = doc.addPage([PAGE_W, PAGE_H]);

  // 호수 (우상단) — 메타 폰트
  if (data.issue_number) {
    const w = fontMeta.widthOfTextAtSize(data.issue_number, 11);
    drawText(p1, data.issue_number, PAGE_W - MARGIN - w, PAGE_H - MARGIN - 12, fontMeta, 11, COLOR_MUTED);
  }

  // 부서명 (큰 제목) — 제목 폰트 (EF_제주돌담)
  drawText(p1, `${data.dept_name} 주보`, MARGIN, PAGE_H - MARGIN - 32, fontTitle, 28, COLOR_ACCENT);
  drawText(p1, formatKoreanDate(data.date), MARGIN, PAGE_H - MARGIN - 56, fontMeta, 12, COLOR_MUTED);

  // 헤더 라인
  p1.drawLine({
    start: { x: MARGIN, y: PAGE_H - MARGIN - 70 },
    end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 70 },
    thickness: 1.2, color: COLOR_ACCENT,
  });

  // 주제
  let cy = PAGE_H - MARGIN - 100;
  drawText(p1, "주제", MARGIN, cy, font, 11, COLOR_MUTED);
  cy -= 18;
  for (const line of wrapText(data.topic || "(미입력)", font, 16, PAGE_W - 2 * MARGIN)) {
    drawText(p1, line, MARGIN, cy, font, 16);
    cy -= 22;
  }

  // 본문 (성경)
  cy -= 8;
  drawText(p1, "본문", MARGIN, cy, font, 11, COLOR_MUTED);
  cy -= 18;
  drawText(p1, data.scripture || "(미입력)", MARGIN, cy, font, 13);
  cy -= 24;

  // 사진 그리드 (2x2 또는 1x1, 폼+사진 개수에 따라)
  const filledPhotos = photos.filter((p) => p !== null) as File[];
  if (filledPhotos.length > 0) {
    cy -= 10;
    const photoBytesAll: Uint8Array[] = await Promise.all(
      filledPhotos.slice(0, 4).map((p) => fileToJpgBytes(p))
    );
    const cellW = (PAGE_W - 2 * MARGIN - 10) / 2;
    const cellH = 130;
    for (let i = 0; i < photoBytesAll.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = MARGIN + col * (cellW + 10);
      const y = cy - row * (cellH + 10) - cellH;
      const img = await doc.embedJpg(photoBytesAll[i]);
      const iw = img.width, ih = img.height;
      const scale = Math.min(cellW / iw, cellH / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = x + (cellW - dw) / 2;
      const dy = y + (cellH - dh) / 2;
      p1.drawImage(img, { x: dx, y: dy, width: dw, height: dh });
      // 살짝 보더
      p1.drawRectangle({ x, y, width: cellW, height: cellH, borderColor: COLOR_LIGHT, borderWidth: 0.5 });
    }
    const rows = Math.ceil(photoBytesAll.length / 2);
    cy -= rows * (cellH + 10) + 10;
  }

  // 푸터
  drawText(p1, `${data.dept_name} · chflow 자동등록`, MARGIN, MARGIN - 14, font, 8, COLOR_MUTED);

  // ───── Page 2: 예배 순서 + 광고 ─────
  const p2 = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN - 20;

  drawText(p2, "주일예배 순서", MARGIN, y, font, 14, COLOR_ACCENT);
  y -= 22;

  // 예배 순서 표
  const ROWS: Array<[string, string]> = [
    ["안내", `${data.guide || "?"} 선생님`],
    ["찬양", [data.praise1, data.praise2].filter(Boolean).join(" ") || "?"],
    ["예배인도", `${data.leader || "?"} 부장`],
    ["주제제창", data.topic || ""],
    ["기도", `${data.prayer_class || "?"}반`],
    ["성경봉독", data.scripture || ""],
    ["설교제목", data.sermon_title || ""],
    ["강론자", `${data.preacher || "?"} 전도사`],
    ["다음 주 기도", data.next_prayer || ""],
  ];
  const labelW = 80;
  const rowH = 22;
  for (const [label, val] of ROWS) {
    p2.drawRectangle({ x: MARGIN, y: y - rowH, width: labelW, height: rowH, color: COLOR_LIGHT });
    drawText(p2, label, MARGIN + 8, y - rowH + 7, font, 10, COLOR_MUTED);
    drawText(p2, val, MARGIN + labelW + 10, y - rowH + 7, font, 11);
    y -= rowH;
  }
  p2.drawRectangle({
    x: MARGIN, y, width: PAGE_W - 2 * MARGIN, height: rowH * ROWS.length,
    borderColor: COLOR_LIGHT, borderWidth: 1,
  });
  y -= 16;

  // 헌금
  if (data.tithe || data.thanksgiving) {
    drawText(p2, "헌금", MARGIN, y, font, 13, COLOR_ACCENT);
    y -= 16;
    if (data.tithe) { drawText(p2, `십일조 : ${data.tithe}`, MARGIN, y, font, 11); y -= 14; }
    if (data.thanksgiving) { drawText(p2, `감사헌금 : ${data.thanksgiving}`, MARGIN, y, font, 11); y -= 14; }
    y -= 10;
  }

  // 2부 행사
  if (data.two_part_activity) {
    drawText(p2, `✿ 2부 행사 : ${data.two_part_activity}`, MARGIN, y, font, 11);
    y -= 18;
  }

  // 광고
  if (data.announcement) {
    drawText(p2, "광고 / 공지", MARGIN, y, font, 13, COLOR_ACCENT);
    y -= 16;
    for (const line of wrapText(data.announcement, font, 10, PAGE_W - 2 * MARGIN)) {
      if (y < MARGIN + 60) break;
      drawText(p2, line, MARGIN, y, font, 10);
      y -= 14;
    }
    y -= 10;
  }

  // 새 친구
  if (data.new_friend) {
    drawText(p2, `✿ 새 친구 : ${data.new_friend}`, MARGIN, y, font, 11);
    y -= 18;
  }

  // 공과
  if (data.lesson_num || data.q1 || data.q2 || data.q3) {
    if (y < MARGIN + 100) {
      // 페이지 부족하면 새 페이지
      const p3 = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN - 20;
      drawText(p3, `${data.lesson_num || "?"}과 공과 퀴즈`, MARGIN, y, font, 14, COLOR_ACCENT);
      y -= 20;
      const quizBlock = (page: PDFPage, n: number, q: string, c: [string, string, string, string]) => {
        if (!q) return;
        for (const line of wrapText(`${n}. ${q}`, font, 11, PAGE_W - 2 * MARGIN)) {
          drawText(page, line, MARGIN, y, font, 11);
          y -= 14;
        }
        const labels = ["①", "②", "③", "④"];
        for (let i = 0; i < 4; i++) {
          if (!c[i]) continue;
          drawText(page, `   ${labels[i]} ${c[i]}`, MARGIN, y, font, 10, COLOR_MUTED);
          y -= 13;
        }
        y -= 6;
      };
      quizBlock(p3, 1, data.q1, data.q1c);
      quizBlock(p3, 2, data.q2, data.q2c);
      quizBlock(p3, 3, data.q3, data.q3c);
      if (data.q4) {
        for (const line of wrapText(`4. ${data.q4}`, font, 11, PAGE_W - 2 * MARGIN)) {
          drawText(p3, line, MARGIN, y, font, 11);
          y -= 14;
        }
      }
    } else {
      drawText(p2, `${data.lesson_num || "?"}과 공과 퀴즈`, MARGIN, y, font, 13, COLOR_ACCENT);
      y -= 18;
      const quizBlock = (n: number, q: string, c: [string, string, string, string]) => {
        if (!q) return;
        for (const line of wrapText(`${n}. ${q}`, font, 10, PAGE_W - 2 * MARGIN)) {
          drawText(p2, line, MARGIN, y, font, 10);
          y -= 13;
        }
        const labels = ["①", "②", "③", "④"];
        for (let i = 0; i < 4; i++) {
          if (!c[i]) continue;
          drawText(p2, `   ${labels[i]} ${c[i]}`, MARGIN, y, font, 9, COLOR_MUTED);
          y -= 11;
        }
        y -= 4;
      };
      quizBlock(1, data.q1, data.q1c);
      quizBlock(2, data.q2, data.q2c);
      quizBlock(3, data.q3, data.q3c);
      if (data.q4) {
        for (const line of wrapText(`4. ${data.q4}`, font, 10, PAGE_W - 2 * MARGIN)) {
          drawText(p2, line, MARGIN, y, font, 10);
          y -= 13;
        }
      }
    }
  }

  // 푸터 페이지 2
  drawText(p2, `${data.dept_name} · chflow 자동등록`, MARGIN, MARGIN - 14, font, 8, COLOR_MUTED);

  return await doc.save();
}

// FormState (page.tsx) → BrowserBulletinData 변환 헬퍼
export function formToBulletinData(
  form: Record<string, string>,
  deptName: string,
): BrowserBulletinData {
  return {
    dept_name: deptName,
    date: form.date || "",
    issue_number: form.issueNumber || "",
    topic: form.theme || "",
    scripture: form.scripture || "",
    guide: form.guide || "",
    leader: form.leader || "",
    praise1: form.praise1 || "",
    praise2: form.praise2 || "",
    prayer_class: form.prayerClass || "",
    scripture_reader: form.scripture_reader || "",
    sermon_title: form.sermonTitle || "",
    preacher: form.preacher || "",
    next_prayer: form.nextPrayer || "",
    tithe: form.tithe || "",
    thanksgiving: form.thanksgiving || "",
    two_part_activity: form.twoPartActivity || "",
    announcement: form.announcement || "",
    new_friend: form.newFriend || "",
    lesson_num: form.lessonNum || "",
    q1: form.q1 || "",
    q1c: [form.q1c1 || "", form.q1c2 || "", form.q1c3 || "", form.q1c4 || ""],
    q2: form.q2 || "",
    q2c: [form.q2c1 || "", form.q2c2 || "", form.q2c3 || "", form.q2c4 || ""],
    q3: form.q3 || "",
    q3c: [form.q3c1 || "", form.q3c2 || "", form.q3c3 || "", form.q3c4 || ""],
    q4: form.q4 || "",
    announcement_author: form.announcementAuthor || "",
  };
}
