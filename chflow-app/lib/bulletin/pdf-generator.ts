// 초등1부 주보 PDF 생성기.
//
// pdf-lib + NanumGothic(TTF) 한글 폰트를 임베드해서 1페이지 A4 PDF 생성.
// (Pretendard OTF 는 fontkit 의 CFF 처리 버그로 못 씀. NanumGothic TTF 는 검증됨.)
// 폰트 파일은 next.config.ts 의 outputFileTracingIncludes 로 함수 번들에 포함됨.
//
// 디자인은 의도적으로 단순. 주보다운 전형적 양식 (헤더 / 주제 + 본문 / 예배순서 표 / 광고 / 푸터)
// 추후 사용자가 디자인 보완 요청하면 좌표 조정으로 대응.

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "node:fs";
import path from "node:path";

export interface BulletinData {
  dept_name: string;       // 예: "초등1부"
  date: string;            // YYYY-MM-DD
  topic: string;
  scripture: string;
  leader: string;
  praise: string;
  prayer: string;
  scripture_reader: string;
  sermon_title: string;
  preacher: string;
  announcement: string;    // 멀티라인
}

// 모듈 스코프 캐시 (콜드스타트에서만 디스크 read, 이후 재사용)
let cachedFontBytes: Buffer | null = null;

function loadFontBytes(): Buffer {
  if (cachedFontBytes) return cachedFontBytes;
  const fontPath = path.join(process.cwd(), "lib", "bulletin", "NanumGothic-Regular.ttf");
  cachedFontBytes = fs.readFileSync(fontPath);
  return cachedFontBytes;
}

// 좌표는 pt 단위. A4 = 595 x 842pt. 좌상단 (0, 842).
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;

const COLOR_TEXT = rgb(0.12, 0.16, 0.24);     // 진한 슬레이트
const COLOR_MUTED = rgb(0.45, 0.51, 0.62);    // 중간 회색
const COLOR_ACCENT = rgb(0.39, 0.40, 0.95);   // 브랜드 인디고 (#6366f1)
const COLOR_LIGHT = rgb(0.91, 0.93, 0.96);    // 연한 라인

// 텍스트 폭 측정 후 줄바꿈 (단순 버전 — 단어 단위 wrap, 한국어는 글자 단위로 fallback)
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  if (!text) return [];
  const lines: string[] = [];

  const paragraphs = text.split(/\r?\n/);
  for (const para of paragraphs) {
    if (!para) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const ch of para) {
      const test = current + ch;
      const w = font.widthOfTextAtSize(test, fontSize);
      if (w > maxWidth && current) {
        lines.push(current);
        current = ch;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function drawText(page: PDFPage, text: string, x: number, y: number, opts: {
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
}) {
  page.drawText(text || "", {
    x,
    y,
    size: opts.size,
    font: opts.font,
    color: opts.color || COLOR_TEXT,
  });
}

function formatKoreanDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${y}년 ${m}월 ${d}일 (${dow})`;
}

export async function generateBulletinPdf(data: BulletinData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const fontBytes = loadFontBytes();
  const font = await doc.embedFont(fontBytes, { subset: true });

  // ASCII 백업용 (필요 시)
  await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.addPage([PAGE_W, PAGE_H]);

  // ─── 헤더 ───
  // 부서명 + 날짜
  drawText(page, data.dept_name || "주보", MARGIN, PAGE_H - MARGIN - 20, {
    font, size: 22, color: COLOR_ACCENT,
  });
  drawText(page, formatKoreanDate(data.date), MARGIN, PAGE_H - MARGIN - 44, {
    font, size: 12, color: COLOR_MUTED,
  });

  // 헤더 구분선
  page.drawLine({
    start: { x: MARGIN, y: PAGE_H - MARGIN - 56 },
    end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 56 },
    thickness: 1,
    color: COLOR_ACCENT,
  });

  // ─── 주제 + 본문 ───
  let cursorY = PAGE_H - MARGIN - 90;
  const topicLines = wrapText(data.topic, font, 16, PAGE_W - 2 * MARGIN);
  for (const line of topicLines) {
    drawText(page, line, MARGIN, cursorY, { font, size: 16 });
    cursorY -= 22;
  }

  if (data.scripture) {
    cursorY -= 4;
    drawText(page, `본문 · ${data.scripture}`, MARGIN, cursorY, {
      font, size: 12, color: COLOR_MUTED,
    });
    cursorY -= 20;
  }

  // ─── 예배 순서 표 ───
  cursorY -= 14;
  drawText(page, "주일예배 순서", MARGIN, cursorY, {
    font, size: 13, color: COLOR_ACCENT,
  });
  cursorY -= 18;

  const ROWS: Array<[string, string]> = [
    ["예배인도", data.leader],
    ["찬   양", data.praise],
    ["기   도", data.prayer],
    ["성경봉독", data.scripture_reader],
    ["설교제목", data.sermon_title],
    ["강 론 자", data.preacher],
  ];
  const TABLE_X = MARGIN;
  const TABLE_W = PAGE_W - 2 * MARGIN;
  const LABEL_W = 90;
  const ROW_H = 26;

  for (let i = 0; i < ROWS.length; i++) {
    const [label, val] = ROWS[i];
    const rowTop = cursorY;
    const rowBottom = rowTop - ROW_H;

    // 좌측 라벨 셀 배경
    page.drawRectangle({
      x: TABLE_X,
      y: rowBottom,
      width: LABEL_W,
      height: ROW_H,
      color: COLOR_LIGHT,
    });

    // 라벨
    drawText(page, label, TABLE_X + 10, rowBottom + 9, {
      font, size: 11, color: COLOR_MUTED,
    });

    // 값
    drawText(page, val || "", TABLE_X + LABEL_W + 12, rowBottom + 9, {
      font, size: 12,
    });

    // 행 구분선
    if (i < ROWS.length - 1) {
      page.drawLine({
        start: { x: TABLE_X, y: rowBottom },
        end: { x: TABLE_X + TABLE_W, y: rowBottom },
        thickness: 0.5,
        color: COLOR_LIGHT,
      });
    }

    cursorY -= ROW_H;
  }

  // 표 외곽선
  page.drawRectangle({
    x: TABLE_X,
    y: cursorY,
    width: TABLE_W,
    height: ROW_H * ROWS.length,
    borderColor: COLOR_LIGHT,
    borderWidth: 1,
  });

  // ─── 광고 ───
  cursorY -= 32;
  drawText(page, "이번 주 광고", MARGIN, cursorY, {
    font, size: 13, color: COLOR_ACCENT,
  });
  cursorY -= 18;

  const annLines = wrapText(data.announcement || "(광고 없음)", font, 11, PAGE_W - 2 * MARGIN);
  for (const line of annLines) {
    if (cursorY < MARGIN + 60) break; // 페이지 넘침 방지
    drawText(page, line, MARGIN, cursorY, { font, size: 11 });
    cursorY -= 16;
  }

  // ─── 푸터 ───
  drawText(
    page,
    "명성교회 교육사역국 · chflow 자동등록",
    MARGIN,
    MARGIN - 10,
    { font, size: 9, color: COLOR_MUTED },
  );

  return await doc.save();
}
