import { NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 30;

// ums.or.kr (제로보드) 사무실 게시판에 올라오는 부서별 주보 PDF를
// 자동으로 찾아서 텍스트를 추출하고, 주일예배순서 영역에서
// (인도자/설교자/설교제목/성경본문/기도담당/찬양/주제) 등을 파싱해 돌려준다.
//
// 부서별로 검색 패턴이 다르므로 dept_key 로 분기.
// 일단 초등1부만 지원. 추후 부서별 확장 예정.

type Prefill = {
  source_no?: number;
  source_title?: string;
  source_date?: string;     // YYYY-MM-DD (게시글 제목 기반)
  edu_topic?: string;       // 주제
  scripture?: string;       // 성경봉독 (본문)
  leader?: string;          // 예배인도 (인도자)
  preacher?: string;        // 강론자 (설교자)
  sermon_title?: string;    // 강론 (설교제목)
  prayer_lead?: string;     // 기도 담당
  praise?: string;          // 찬양
};

const BOARD_BASE = "http://ums.or.kr/bbs";
const LIST_URL = `${BOARD_BASE}/zboard.php?id=samusil&page=1`;
const FILE_URL = (no: number) =>
  `${BOARD_BASE}/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=samusil&no=${no}&filenum=0&snum=0&hit=0`;

// ─────────────────────────────────────────
// 부서별 게시글 검색 패턴
// 제목에 모든 키워드가 포함되고 작성자가 일치하는 가장 최근 글
// ─────────────────────────────────────────
const DEPT_PATTERNS: Record<string, { author: string; titleIncludes: string[] }> = {
  "초등1부": { author: "심주석", titleIncludes: ["초등1초원"] },
};

// ums.or.kr 은 User-Agent 비어있거나 봇처럼 보이면 다른 페이지(빈/모바일)를 반환할 수 있음.
// 평범한 데스크탑 크롬으로 위장.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Referer": "http://ums.or.kr/",
} as const;

async function fetchEucKr(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: BROWSER_HEADERS });
  const buf = await res.arrayBuffer();
  return new TextDecoder("euc-kr").decode(buf);
}

// 게시글 목록에서 (no, 제목, 작성자) 추출
function parseBoardList(html: string): { no: number; title: string; author: string }[] {
  const rows: { no: number; title: string; author: string }[] = [];
  const blockRe =
    /no=(\d+)"\s+title='\[\d+\]\s*([^']+)'[\s\S]{0,1500}?<font class=list_name>([^<]+)<\/font>/g;
  let bm;
  while ((bm = blockRe.exec(html))) {
    rows.push({
      no: parseInt(bm[1], 10),
      title: bm[2].trim(),
      author: bm[3].trim(),
    });
  }
  const seen = new Set<number>();
  return rows.filter((r) => {
    if (seen.has(r.no)) return false;
    seen.add(r.no);
    return true;
  });
}

// "4월26일 초등1초원주보입니다" 같은 제목에서 날짜 추출
function extractDateFromTitle(title: string, fallbackYear: number): string | undefined {
  const m = title.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!m) return undefined;
  const mm = String(m[1]).padStart(2, "0");
  const dd = String(m[2]).padStart(2, "0");
  return `${fallbackYear}-${mm}-${dd}`;
}

async function downloadPdfBuffer(no: number): Promise<Uint8Array> {
  const res = await fetch(FILE_URL(no), { cache: "no-store", headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`PDF 다운로드 실패: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function pdfToText(buf: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(buf);
  const { text } = await extractText(doc, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

// PDF 텍스트에서 필드 파싱
function parseFields(raw: string): Partial<Prefill> {
  const out: Partial<Prefill> = {};

  // 라인 dash(─ ━ –) 만 공백으로 — ASCII "-"는 "2-3반" 등 표기를 보존하기 위해 유지
  const norm = raw
    .replace(/[─━–]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1) 헤더의 주제 (예: "주제 : 하나님의 안경으로 세상을 바라보는 어린이! (히11:3)")
  const topicM = norm.match(/주제\s*[:：]\s*([^(\n]+?)(?:\s*\(|히\d|\n|$)/);
  if (topicM) out.edu_topic = topicM[1].trim().replace(/[!?.]+$/, "").trim();

  // 2) 주일예배순서 영역만 슬라이스
  const startIdx = norm.indexOf("주일예배순서");
  if (startIdx < 0) return out;
  const endMarkers = ["✿2부행사", "✿2부 행사", "헌금 십일조", "목장 현황", "다음 주 기도"];
  let endIdx = norm.length;
  for (const mk of endMarkers) {
    const i = norm.indexOf(mk, startIdx);
    if (i > 0 && i < endIdx) endIdx = i;
  }
  const order = norm.substring(startIdx, endIdx);

  // 3) 알려진 라벨 위치 → 라벨 사이 영역이 그 라벨의 값
  const labels = [
    "안내",
    "찬양",
    "예배인도",
    "십계명",
    "신앙고백",
    "주제제창",
    "찬양/헌금",
    "기도",
    "성경봉독",
    "강론",
    "주기도문",
    "광고",
  ];
  const positions: { label: string; idx: number }[] = [];
  for (const label of labels) {
    const idx = order.indexOf(label);
    if (idx >= 0) positions.push({ label, idx });
  }
  positions.sort((a, b) => a.idx - b.idx);

  const valOf = (label: string): string | undefined => {
    const i = positions.findIndex((p) => p.label === label);
    if (i < 0) return undefined;
    const start = positions[i].idx + label.length;
    const end = i + 1 < positions.length ? positions[i + 1].idx : order.length;
    let v = order.substring(start, end).trim();
    v = v.replace(/^[:：\s]+/, "").replace(/\s+$/, "");
    if (/^다\s*같\s*이$/.test(v.replace(/\s/g, ""))) return undefined;
    return v || undefined;
  };

  const leader = valOf("예배인도");
  if (leader) out.leader = leader;

  const praise = valOf("찬양");
  if (praise) out.praise = praise;

  const prayer = valOf("기도");
  if (prayer && !/제목|손/.test(prayer)) out.prayer_lead = prayer;

  // 성경봉독: 끝의 "인도자" 등 봉독자 표기 제거
  let scripture = valOf("성경봉독");
  if (scripture) {
    scripture = scripture
      .replace(/\s+(인도자|회중|다\s*같\s*이|성경|선생님)\s*$/, "")
      .trim();
    out.scripture = scripture;
  }

  // 강론: "<설교제목> <설교자님>" — 마지막 단어가 직책+님으로 끝나면 분리
  const sermon = valOf("강론");
  if (sermon) {
    const m = sermon.match(
      /^(.+?)\s+([가-힣]{2,5}(?:전도사|목사|장로|부장|총무|선생|사모|권사|집사)\S*)$/,
    );
    if (m) {
      out.sermon_title = m[1].trim();
      out.preacher = m[2].trim();
    } else {
      out.sermon_title = sermon;
    }
  }

  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { dept_key?: string };
    const deptKey = body.dept_key || "초등1부";
    const pattern = DEPT_PATTERNS[deptKey];
    if (!pattern) {
      return NextResponse.json(
        { ok: false, error: `지원하지 않는 부서: ${deptKey}` },
        { status: 400 },
      );
    }

    const html = await fetchEucKr(LIST_URL);
    const rows = parseBoardList(html);

    const matched = rows.find(
      (r) =>
        r.author === pattern.author &&
        pattern.titleIncludes.every((kw) => r.title.includes(kw)),
    );
    if (!matched) {
      // 디버깅: 매칭 실패 사유 추론
      const sameAuthor = rows.filter((r) => r.author === pattern.author);
      let hint: string;
      if (rows.length === 0) {
        hint = `게시판 응답을 읽지 못했습니다 (응답 길이 ${html.length}자). 사이트 차단 가능성.`;
      } else if (sameAuthor.length === 0) {
        hint = `'${pattern.author}' 작성 글을 찾지 못함. 첫 글: '${rows[0]?.title}' (${rows[0]?.author})`;
      } else {
        hint = `'${pattern.author}' 글은 ${sameAuthor.length}개 있으나 제목에 ${pattern.titleIncludes.join(",")} 포함된 게 없음. 최근: '${sameAuthor[0]?.title}'`;
      }
      return NextResponse.json(
        { ok: false, error: hint },
        { status: 404 },
      );
    }

    const pdfBuf = await downloadPdfBuffer(matched.no);
    const text = await pdfToText(pdfBuf);
    const parsed = parseFields(text);

    const today = new Date();
    const result: Prefill = {
      source_no: matched.no,
      source_title: matched.title,
      source_date: extractDateFromTitle(matched.title, today.getFullYear()),
      ...parsed,
    };
    return NextResponse.json({ ok: true, data: result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "주보 불러오기 실패";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
