import * as CFB from "cfb";
import { inflateRawSync } from "zlib";

// HWP 5.x(OLE) 본문 구조 파서 — 부서 주보 리메이크 렌더링용.
// BodyText/SectionN 레코드를 순회해 문단/표(셀 병합·중첩 포함) 트리를 추출한다.
// 문자 서식(굵기·색)은 버리고 내용 구조만 취한다 — 렌더링은 앱 디자인 토큰으로.

export type HwpCell = {
  c: number; // col
  r: number; // row
  cs: number; // colspan
  rs: number; // rowspan
  b: HwpBlock[];
};

export type HwpBlock =
  | { t: "p"; x: string }
  | { t: "tbl"; rows: number; cols: number; cells: HwpCell[] };

const TAG = {
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  TABLE: 77,
} as const;

type Rec = { tag: number; level: number; body: Buffer };

function parseRecords(data: Buffer): Rec[] {
  const recs: Rec[] = [];
  let pos = 0;
  while (pos + 4 <= data.length) {
    const h = data.readUInt32LE(pos);
    const tag = h & 0x3ff;
    const level = (h >> 10) & 0x3ff;
    let size = (h >> 20) & 0xfff;
    let hl = 4;
    if (size === 0xfff) {
      size = data.readUInt32LE(pos + 4);
      hl = 8;
    }
    recs.push({ tag, level, body: data.slice(pos + hl, pos + hl + size) });
    pos += hl + size;
  }
  return recs;
}

// PARA_TEXT의 UTF-16LE 텍스트. 확장 컨트롤 문자(표·그림 등 앵커)는 자신 포함 8워드(16바이트).
const EXTENDED_CONTROL_CODES = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);

function textOf(body: Buffer): string {
  let out = "";
  for (let i = 0; i + 1 < body.length; ) {
    const code = body.readUInt16LE(i);
    if (code >= 32) {
      out += String.fromCharCode(code);
      i += 2;
    } else if (EXTENDED_CONTROL_CODES.has(code)) {
      i += 16;
    } else if (code === 9) {
      out += "\t";
      i += 2;
    } else if (code === 10 || code === 13) {
      out += "\n";
      i += 2;
    } else {
      i += 2;
    }
  }
  // 사설영역(PUA)·비문자 코드 제거 — 한/글 전용 장식문자는 웹폰트에 글리프가 없어 ⊠로 보인다
  let cleaned = "";
  for (const ch of out) {
    const cp = ch.charCodeAt(0);
    if ((cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xfff0) continue;
    cleaned += ch;
  }
  return cleaned;
}

// level 깊이의 문단 스트림을 블록 목록으로 변환.
// 구조: PARA_HEADER(L) → PARA_TEXT(L+1), CTRL_HEADER(L+1, 'tbl ') → TABLE(L+2), LIST_HEADER(L+2)…
// 표 셀 내부 문단은 LIST_HEADER와 "같은" 레벨에 온다.
function walk(recs: Rec[], startIdx: number, level: number, endIdx: number): HwpBlock[] {
  const blocks: HwpBlock[] = [];
  let i = startIdx;
  while (i < endIdx) {
    const r = recs[i];
    if (r.level < level) break;
    if (r.tag === TAG.PARA_HEADER && r.level === level) {
      let text = "";
      const children: HwpBlock[] = [];
      let j = i + 1;
      while (j < endIdx && recs[j].level > level) {
        if (recs[j].tag === TAG.PARA_TEXT && recs[j].level === level + 1) {
          text += textOf(recs[j].body);
        }
        if (recs[j].tag === TAG.CTRL_HEADER && recs[j].level === level + 1 && recs[j].body.length >= 4) {
          const ctrlId = Buffer.from([...recs[j].body.slice(0, 4)].reverse()).toString("latin1");
          if (ctrlId === "tbl ") {
            const table = parseTable(recs, j, endIdx);
            if (table) {
              children.push(table.block);
              j = table.endIdx;
              continue;
            }
          }
        }
        j++;
      }
      if (text.trim()) blocks.push({ t: "p", x: text.trim() });
      blocks.push(...children);
      i = j;
    } else {
      i++;
    }
  }
  return blocks;
}

// CTRL_HEADER('tbl ') 위치에서 표 전체(TABLE 레코드 + 셀 LIST_HEADER들) 파싱
function parseTable(recs: Rec[], ctrlIdx: number, endIdx: number): { block: HwpBlock; endIdx: number } | null {
  const ctrlLevel = recs[ctrlIdx].level;
  let end = ctrlIdx + 1;
  while (end < endIdx && recs[end].level > ctrlLevel) end++;

  let rows = 0;
  let cols = 0;
  for (let k = ctrlIdx + 1; k < end; k++) {
    if (recs[k].tag === TAG.TABLE && recs[k].level === ctrlLevel + 1 && recs[k].body.length >= 8) {
      rows = recs[k].body.readUInt16LE(4);
      cols = recs[k].body.readUInt16LE(6);
      break;
    }
  }
  if (!rows || !cols) return null;

  const cells: HwpCell[] = [];
  let c = ctrlIdx + 1;
  while (c < end) {
    if (recs[c].tag === TAG.LIST_HEADER && recs[c].level === ctrlLevel + 1 && recs[c].body.length >= 16) {
      const b = recs[c].body;
      // 셀 주소/병합: col@8, row@10, colspan@12, rowspan@14 (실측 검증)
      const cell: HwpCell = {
        c: b.readUInt16LE(8),
        r: b.readUInt16LE(10),
        cs: b.readUInt16LE(12),
        rs: b.readUInt16LE(14),
        b: [],
      };
      let e = c + 1;
      while (e < end && !(recs[e].tag === TAG.LIST_HEADER && recs[e].level === recs[c].level)) e++;
      cell.b = walk(recs, c + 1, recs[c].level, e);
      // 비정상 좌표(병합 잔여 등) 방어
      if (cell.c < cols && cell.r < rows) cells.push(cell);
      c = e;
    } else {
      c++;
    }
  }

  return { block: { t: "tbl", rows, cols, cells }, endIdx: end };
}

// HWP 파일 전체 → 블록 목록 (본문 순서대로, 모든 섹션)
export function parseHwpBlocks(file: Buffer): HwpBlock[] {
  const cfb = CFB.read(file, { type: "buffer" });
  const blocks: HwpBlock[] = [];
  for (let s = 0; s < 16; s++) {
    const entry = CFB.find(cfb, `Section${s}`);
    if (!entry || !entry.content) break;
    let data: Buffer;
    try {
      data = inflateRawSync(Buffer.from(entry.content as Buffer));
    } catch {
      data = Buffer.from(entry.content as Buffer);
    }
    const recs = parseRecords(data);
    blocks.push(...walk(recs, 0, 0, recs.length));
  }
  return blocks;
}

// 블록에 실제 내용이 있는지 (빈 셀·빈 문단 걸러내기용)
export function hwpBlocksHaveContent(blocks: HwpBlock[]): boolean {
  return blocks.some((b) =>
    b.t === "p" ? b.x.trim() !== "" : b.cells.some((cell) => hwpBlocksHaveContent(cell.b)),
  );
}
