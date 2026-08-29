// UMS 사무실(samusil) 게시판 공용 파서 — 부서 주보 조회(/api/dept-bulletin/latest)와
// 수집 크론(dept-bulletin-sync)이 같은 규칙을 쓰도록 한곳에 모았다.
//
// 두 경로가 어긋나면 크론이 저장한 글과 화면이 고르는 글이 달라지므로
// 부서 매칭·발행일 해석·첨부 선택은 반드시 여기 것만 쓴다.

export const SAMUSIL_VIEW_BASE = "http://www.ums.or.kr/bbs/zboard.php";

// 부서 주보 파일 유형 표준 체계 — 어떤 부서가 어떤 형식으로 올려도 유형별 뷰어가 대응한다.
//  pdf → PDF 캔버스 뷰어 / pptx → 슬라이드 렌더링 / hwp·hwpx → 본문 구조 리메이크 /
//  image → 이미지 뷰어 / unknown → PDF 시도 후 원문 링크
export type DeptFileKind = "pdf" | "pptx" | "hwp" | "image" | "unknown";

// 여러 첨부가 있으면 충실도 높은 쪽 우선
const FILE_KIND_PRIORITY: Record<DeptFileKind, number> = {
  pdf: 4,
  pptx: 3,
  image: 2,
  hwp: 1,
  unknown: 0,
};

export type SamusilListItem = {
  no: number;
  title: string;
  issue_date: string | null;
  posted_at: string | null;
  author: string | null;
  url: string;
};

export type SamusilAttachment = { fn: number; name: string; kind: DeptFileKind };

// 부서별 UMS samusil 게시글 제목 매칭 규칙 (2026-07 게시판 실측)
// 작성자는 부서마다 다르고 담당자 교체로 바뀔 수 있어 제목 키워드로 매칭한다.
//  - 초등1부: "8월30일 초등1초원 주보입니다."
//  - 초등2부: "8월 23일 초등2초원 주보입니다."
//  - 유치부:  "유치부_주보_26. 8. 30_(6부_출력부탁합니다)"
//  - 유아부:  "유아부) 08월 30일 유아부 주보입니다. (3부)"
//  - 청소년부: "8월 30일 청소년부 주보입니다." / "20260531청소년부주보"
export const KNOWN_DEPT_PATTERNS: { deptAliases: string[]; titleKeywords: string[] }[] = [
  { deptAliases: ["초등1"], titleKeywords: ["초등1"] },
  { deptAliases: ["초등2"], titleKeywords: ["초등2"] },
  { deptAliases: ["유치"], titleKeywords: ["유치부"] },
  { deptAliases: ["유아"], titleKeywords: ["유아부"] },
  { deptAliases: ["청소년", "중고등"], titleKeywords: ["청소년"] },
];

// 부서명 → 제목 키워드. 알려진 패턴이 없으면 부서명(및 "부" 뗀 어간)으로 매칭 시도.
export function titleKeywordsFor(deptKey: string): string[] {
  const known = KNOWN_DEPT_PATTERNS.find((p) => p.deptAliases.some((a) => deptKey.includes(a)));
  if (known) return known.titleKeywords;
  const stem = deptKey.replace(/부$/, "").trim();
  return stem && stem !== deptKey ? [deptKey, stem] : [deptKey];
}

export function matchesDept(title: string, keywords: string[]) {
  return title.includes("주보") && keywords.some((k) => title.includes(k));
}

export function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(parseInt(num, 10)));
}

export function textFromHtml(value: string) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function absoluteSamusilUrl(href: string) {
  const normalized = href.startsWith("?") ? `${SAMUSIL_VIEW_BASE}${href}` : href;
  return new URL(normalized, "http://www.ums.or.kr/bbs/").toString();
}

export function yearFromPostedAt(postedAt: string | null) {
  const match = postedAt?.match(/^(\d{4})-/);
  return match ? Number(match[1]) : new Date(new Date().getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

function toIsoIfValid(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// 부서마다 제목 날짜 표기가 다르다: "7월 5일" / "26. 7. 5" / "20260531"
export function extractDateFromTitle(title: string, fallbackYear: number) {
  const md = title.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) return toIsoIfValid(fallbackYear, Number(md[1]), Number(md[2]));

  const compact = title.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) {
    const iso = toIsoIfValid(Number(compact[1]), Number(compact[2]), Number(compact[3]));
    if (iso) return iso;
  }

  const dotted = title.match(/(\d{2})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})/);
  if (dotted) return toIsoIfValid(2000 + Number(dotted[1]), Number(dotted[2]), Number(dotted[3]));

  return null;
}

export function parseBoardList(html: string): SamusilListItem[] {
  const rows: SamusilListItem[] = [];
  const rowRe = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html))) {
    const row = rowMatch[0];
    const noMatch =
      row.match(/name=["']?(?:cart|notice_cart)["']?[^>]+value=["']?(\d+)["']?/i) ||
      row.match(/no=(\d+)/i);
    if (!noMatch) continue;

    const no = parseInt(noMatch[1], 10);
    const hrefMatch =
      row.match(new RegExp(`<a\\s+[^>]*href=["']([^"']*no=${no}[^"']*)["']`, "i")) ||
      row.match(/<a\s+[^>]*href=["']([^"']*no=\d+[^"']*)["']/i);
    // 제목은 글 링크(no= 포함) 앵커에서만 추출 — 행 앞쪽 분류 라벨(☞ 부서주보)의 title 속성에 걸리면 안 됨
    const anchorMatch = row.match(/<a\s+[^>]*href=["'][^"']*no=\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const anchorTitleAttr = anchorMatch?.[0].match(/title=['"](?:\[\d+\]\s*)?([^'"]+)['"]/i);
    const authorMatch = row.match(/<font\s+class=["']?list_name["']?[^>]*>([\s\S]*?)<\/font>/i);
    const postedAtMatch = row.match(/<span\s+title=['"][^'"]*['"]>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>/i);

    const rawTitle = textFromHtml(anchorTitleAttr?.[1] || anchorMatch?.[1] || "");
    if (!rawTitle) continue;

    const postedAt = postedAtMatch?.[1] || null;
    rows.push({
      no,
      title: rawTitle,
      issue_date: extractDateFromTitle(rawTitle, yearFromPostedAt(postedAt)),
      posted_at: postedAt,
      author: authorMatch ? textFromHtml(authorMatch[1]) : null,
      url: hrefMatch ? absoluteSamusilUrl(decodeHtml(hrefMatch[1])) : `${SAMUSIL_VIEW_BASE}?id=samusil&no=${no}`,
    });
  }

  const seen = new Set<number>();
  return rows.filter((item) => {
    if (seen.has(item.no)) return false;
    seen.add(item.no);
    return true;
  });
}

export function metaContent(html: string, property: string) {
  const re = new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const match = html.match(re);
  return match ? decodeHtml(match[1]).trim() : null;
}

export function fileKindOf(fileName: string | null): DeptFileKind {
  const ext = fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "pptx") return "pptx";
  if (ext === "hwp" || ext === "hwpx") return "hwp";
  if (ext && ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "image";
  return "unknown";
}

// 게시글 본문에서 첨부파일 목록 추출 — m_download 링크(filenum=N) 뒤에 <b>파일명.확장자</b> 형태
export function extractAttachments(html: string): SamusilAttachment[] {
  const out: SamusilAttachment[] = [];
  const re = /m_download\.php\?[^"'<>]*filenum=(\d+)[^"'<>]*["'][^>]*>\s*(?:<b[^>]*>)?\s*([^<]+?\.[a-z0-9]{2,5})\s*</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = decodeHtml(m[2]).trim();
    out.push({ fn: parseInt(m[1], 10), name, kind: fileKindOf(name) });
  }
  // filenum 중복 제거 (같은 링크가 목록/본문에 반복 노출되는 경우)
  const seen = new Set<number>();
  return out.filter((a) => (seen.has(a.fn) ? false : (seen.add(a.fn), true)));
}

// 여러 첨부 중 뷰어 충실도가 높은 유형 우선 선택
export function pickBestAttachment(attachments: SamusilAttachment[]): SamusilAttachment | null {
  if (attachments.length === 0) return null;
  return [...attachments].sort(
    (a, b) => FILE_KIND_PRIORITY[b.kind] - FILE_KIND_PRIORITY[a.kind] || a.fn - b.fn,
  )[0];
}

// 확장자를 못 읽었어도 PDF 미리보기 이미지(__pdf.jpg)가 있으면 PDF 첨부로 본다
export function hasPdfPreviewImage(html: string) {
  return /data\/samusil\/\d+\/[a-f0-9]+__pdf\.jpg/i.test(html);
}
