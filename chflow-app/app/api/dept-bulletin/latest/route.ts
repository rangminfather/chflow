import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";
import { r2 } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

// 부서 주보 파일 유형 표준 체계 — 어떤 부서가 어떤 형식으로 올려도 유형별 뷰어가 대응한다.
//  pdf → PDF 캔버스 뷰어 / pptx → 슬라이드 렌더링 / hwp·hwpx → 본문 구조 리메이크 /
//  image → 이미지 뷰어 / unknown → PDF 시도 후 원문 링크
// 여러 첨부가 있으면 pdf > pptx > image > hwp 우선순위로 선택 (충실도 높은 쪽 우선).
type DeptFileKind = "pdf" | "pptx" | "hwp" | "image" | "unknown";

const FILE_KIND_PRIORITY: Record<DeptFileKind, number> = {
  pdf: 4,
  pptx: 3,
  image: 2,
  hwp: 1,
  unknown: 0,
};

type DeptBulletinItem = {
  no: number;
  title: string;
  issue_date: string | null;
  posted_at: string | null;
  author: string | null;
  url: string;
  pdf_url: string;
  // 선택된 첨부파일 (초등2부는 hwp 또는 hwpx로 등록됨)
  file_name: string | null;
  file_kind: DeptFileKind;
  file_fn: number; // UMS 첨부 번호 (filenum)
  file_url: string;
  stored: boolean;
};

type StoredBulletin = {
  id: string;
  title: string;
  content: string | null;
  sunday_date: string;
  pdf_url: string | null;
  created_at: string | null;
};

type ListedItem = Omit<DeptBulletinItem, "pdf_url" | "file_url">;

type CacheValue = {
  items: ListedItem[];
  expiresAt: number;
};

type FetchAttempt = {
  name: string;
  url: string;
  headers?: HeadersInit;
  viaWorker?: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SIGNING_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON_KEY;
const BUCKET = "bulletins";
const PROXY_LIST_URL = `${SUPABASE_URL}/functions/v1/ums-fetch?action=list&board=samusil`;
const PROXY_POST_URL = (no: number) => `${SUPABASE_URL}/functions/v1/ums-fetch?action=post&board=samusil&no=${no}`;
const DIRECT_LIST_URL = "http://www.ums.or.kr/bbs/zboard.php?id=samusil&page=1";
const DIRECT_POST_URL = (no: number) => `http://www.ums.or.kr/bbs/zboard.php?id=samusil&no=${no}`;
const VIEW_BASE = "http://www.ums.or.kr/bbs/zboard.php";
const CACHE_TTL_MS = 5 * 60 * 1000;
const PDF_URL_TTL_SECONDS = 10 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEPT_MARKER_PREFIX = "Dept bulletin:";
const UMS_SAMUSIL_MARKER = "UMS samusil no:";

// 부서별 UMS samusil 게시글 제목 매칭 규칙 (2026-07 게시판 실측)
// 작성자는 부서마다 다르고 담당자 교체로 바뀔 수 있어 제목 키워드로 매칭한다.
//  - 초등1부: "7월5일 초등1초원주보입니다."
//  - 초등2부: "7월 5일 초등2초원 주보입니다."
//  - 유치부:  "유치부_주보_26. 7. 5_(6부_출력부탁합니다)"
//  - 유아부:  "유아부) 07월 05일 유아부 주보입니다. (3부)"
//  - 청소년부: "7월 5일 청소년부 주보입니다." / "20260531청소년부주보"
const KNOWN_DEPT_PATTERNS: { deptAliases: string[]; titleKeywords: string[] }[] = [
  { deptAliases: ["초등1"], titleKeywords: ["초등1"] },
  { deptAliases: ["초등2"], titleKeywords: ["초등2"] },
  { deptAliases: ["유치"], titleKeywords: ["유치부"] },
  { deptAliases: ["유아"], titleKeywords: ["유아부"] },
  { deptAliases: ["청소년", "중고등"], titleKeywords: ["청소년"] },
];

// 부서명 → 제목 키워드. 알려진 패턴이 없으면 부서명(및 "부" 뗀 어간)으로 매칭 시도.
function titleKeywordsFor(deptKey: string): string[] {
  const known = KNOWN_DEPT_PATTERNS.find((p) => p.deptAliases.some((a) => deptKey.includes(a)));
  if (known) return known.titleKeywords;
  const stem = deptKey.replace(/부$/, "").trim();
  return stem && stem !== deptKey ? [deptKey, stem] : [deptKey];
}

function matchesDept(title: string, keywords: string[]) {
  return title.includes("주보") && keywords.some((k) => title.includes(k));
}

const listCaches = new Map<string, CacheValue>();

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Referer": "http://www.ums.or.kr/",
} as const;

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function requireUser(req: NextRequest) {
  const token = tokenFrom(req);
  if (!token) return false;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  return !error && !!data.user;
}

async function fetchEucKr({ url, headers, viaWorker }: FetchAttempt): Promise<string> {
  if (viaWorker) {
    const res = await umsViaCf(viaWorker, {
      referer: "http://www.ums.or.kr/",
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`UMS worker response ${res.status}`);
    return new TextDecoder("euc-kr").decode(res.body);
  }

  let lastText = "";
  for (let i = 0; i < 2; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    const res = await fetch(url, { cache: "no-store", headers });
    if (!res.ok) throw new Error(`UMS response ${res.status}`);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("euc-kr").decode(buf);
    lastText = text.length > lastText.length ? text : lastText;
    if (text.length > 1000 && !/Access denied/i.test(text)) return text;
  }
  return lastText;
}

async function fetchFirstEucKr(attempts: FetchAttempt[]) {
  let lastError = "";
  for (const attempt of attempts) {
    try {
      const text = await fetchEucKr(attempt);
      if (text.length > 1000 && !/Access denied/i.test(text)) return text;
      lastError = `${attempt.name}: short response (${text.length})`;
    } catch (e) {
      lastError = `${attempt.name}: ${e instanceof Error ? e.message : "failed"}`;
    }
  }
  throw new Error(lastError || "UMS 응답을 읽지 못했습니다");
}

function decodeHtml(value: string) {
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

function textFromHtml(value: string) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteSamusilUrl(href: string) {
  const normalized = href.startsWith("?") ? `${VIEW_BASE}${href}` : href;
  return new URL(normalized, "http://www.ums.or.kr/bbs/").toString();
}

function yearFromPostedAt(postedAt: string | null) {
  const match = postedAt?.match(/^(\d{4})-/);
  return match ? Number(match[1]) : new Date(new Date().getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

function toIsoIfValid(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// 부서마다 제목 날짜 표기가 다르다: "7월 5일" / "26. 7. 5" / "20260531"
function extractDateFromTitle(title: string, fallbackYear: number) {
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

function parseBoardList(html: string): ListedItem[] {
  const rows: ListedItem[] = [];
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
      url: hrefMatch ? absoluteSamusilUrl(decodeHtml(hrefMatch[1])) : `${VIEW_BASE}?id=samusil&no=${no}`,
      file_name: null,
      file_kind: "unknown",
      file_fn: 0,
      stored: false,
    });
  }

  const seen = new Set<number>();
  return rows.filter((item) => {
    if (seen.has(item.no)) return false;
    seen.add(item.no);
    return true;
  });
}

function metaContent(html: string, property: string) {
  const re = new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const match = html.match(re);
  return match ? decodeHtml(match[1]).trim() : null;
}

function fileKindOf(fileName: string | null): DeptFileKind {
  const ext = fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "pptx") return "pptx";
  if (ext === "hwp" || ext === "hwpx") return "hwp";
  if (ext && ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "image";
  return "unknown";
}

type Attachment = { fn: number; name: string; kind: DeptFileKind };

// 게시글 본문에서 첨부파일 목록 추출 — m_download 링크(filenum=N) 뒤에 <b>파일명.확장자</b> 형태
function extractAttachments(html: string): Attachment[] {
  const out: Attachment[] = [];
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
function pickBestAttachment(attachments: Attachment[]): Attachment | null {
  if (attachments.length === 0) return null;
  return [...attachments].sort(
    (a, b) => FILE_KIND_PRIORITY[b.kind] - FILE_KIND_PRIORITY[a.kind] || a.fn - b.fn,
  )[0];
}

async function enrichFromPost(item: ListedItem): Promise<ListedItem> {
  try {
    const html = await fetchFirstEucKr([
      { name: "worker-post", url: DIRECT_POST_URL(item.no), viaWorker: `/bbs/zboard.php?id=samusil&no=${item.no}` },
      { name: "ums-fetch-post", url: PROXY_POST_URL(item.no) },
      { name: "direct-post", url: DIRECT_POST_URL(item.no), headers: BROWSER_HEADERS },
    ]);

    const best = pickBestAttachment(extractAttachments(html));
    let fileKind = best?.kind ?? "unknown";
    // 확장자를 못 읽었어도 PDF 미리보기 이미지(__pdf.jpg)가 있으면 PDF 첨부
    if (fileKind === "unknown" && /data\/samusil\/\d+\/[a-f0-9]+__pdf\.jpg/i.test(html)) {
      fileKind = "pdf";
    }

    const ogTitle = metaContent(html, "og:title");
    const issueDate = ogTitle
      ? extractDateFromTitle(ogTitle, yearFromPostedAt(item.posted_at)) || item.issue_date
      : item.issue_date;
    return {
      ...item,
      title: ogTitle || item.title,
      issue_date: issueDate,
      file_name: best?.name ?? null,
      file_kind: fileKind,
      file_fn: best?.fn ?? 0,
    };
  } catch {
    return item;
  }
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getPreferredSundayTargets(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const dayOfWeek = new Date(todayUtc).getUTCDay();
  const currentSunday = new Date(todayUtc - dayOfWeek * DAY_MS);
  const nextSunday = new Date(currentSunday.getTime() + 7 * DAY_MS);

  return {
    nextSunday: isoDate(nextSunday),
    currentSunday: isoDate(currentSunday),
  };
}

function pickPreferredBulletin(items: DeptBulletinItem[]) {
  const targets = getPreferredSundayTargets();
  return (
    items.find((item) => item.issue_date === targets.nextSunday) ||
    items.find((item) => item.issue_date === targets.currentSunday) ||
    items[0] ||
    null
  );
}

// 저장본이 이번 주일(또는 다음 주일) 주보를 이미 갖고 있는가
function coversPreferredSunday(items: DeptBulletinItem[]) {
  const targets = getPreferredSundayTargets();
  return items.some(
    (item) => item.issue_date === targets.nextSunday || item.issue_date === targets.currentSunday,
  );
}

// 저장본 + UMS 실시간 목록 병합. 같은 게시글(no)이면 저장본을 남긴다 (이미 정규화·보관된 파일).
// 발행일 내림차순 → 게시글 번호 내림차순 정렬해서 pickPreferredBulletin 의 items[0] 폴백이 최신을 가리키게 한다.
function mergeBulletinItems(stored: DeptBulletinItem[], live: DeptBulletinItem[]): DeptBulletinItem[] {
  const storedNos = new Set(stored.filter((item) => item.no > 0).map((item) => item.no));
  return [...stored, ...live.filter((item) => !storedNos.has(item.no))]
    .sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || "") || b.no - a.no)
    .slice(0, 12);
}

function signPdfUrl(no: number, expiresAt: number) {
  return createHmac("sha256", SIGNING_SECRET).update(`samusil:${no}:${expiresAt}`).digest("hex");
}

// 저장본(R2) 경로 서명 — hwp/hwpx 저장본은 &as=hwp-json / &as=hwp-preview 가공이 필요해
// 스토리지 프록시가 아니라 /api/dept-bulletin/file 을 거쳐야 한다.
function signStoragePath(path: string, expiresAt: number) {
  return createHmac("sha256", SIGNING_SECRET).update(`storage:${path}:${expiresAt}`).digest("hex");
}

function withSignedPdfUrls(items: ListedItem[], origin: string): DeptBulletinItem[] {
  const expiresAt = Math.floor(Date.now() / 1000) + PDF_URL_TTL_SECONDS;
  return items.map((item) => {
    const sig = signPdfUrl(item.no, expiresAt);
    const namePart = item.file_name ? `&name=${encodeURIComponent(item.file_name)}` : "";
    const fnPart = item.file_fn ? `&fn=${item.file_fn}` : "";
    return {
      ...item,
      pdf_url: `${origin}/api/dept-bulletin/pdf?no=${item.no}&exp=${expiresAt}&sig=${sig}`,
      file_url: `${origin}/api/dept-bulletin/file?no=${item.no}&exp=${expiresAt}&sig=${sig}${fnPart}${namePart}`,
    };
  });
}

async function loadPublicItems(deptKey: string) {
  const cached = listCaches.get(deptKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const keywords = titleKeywordsFor(deptKey);
  const html = await fetchFirstEucKr([
    { name: "worker-list", url: DIRECT_LIST_URL, viaWorker: "/bbs/zboard.php?id=samusil&page=1" },
    { name: "ums-fetch-list", url: PROXY_LIST_URL },
    { name: "direct-list", url: DIRECT_LIST_URL, headers: BROWSER_HEADERS },
  ]);
  const baseItems = parseBoardList(html)
    .filter((item) => matchesDept(item.title, keywords))
    .slice(0, 12);

  if (baseItems.length === 0) {
    throw new Error(`${deptKey} 주보 게시글을 찾지 못했습니다`);
  }

  const items = await Promise.all(baseItems.map(enrichFromPost));
  listCaches.set(deptKey, { items, expiresAt: Date.now() + CACHE_TTL_MS });
  return items;
}

async function loadStoredItems(deptKey: string): Promise<DeptBulletinItem[]> {
  if (!SERVICE_KEY) return [];
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const marker = `${DEPT_MARKER_PREFIX} ${deptKey}`;
  const { data, error } = await admin
    .from("bulletins")
    .select("id,title,content,sunday_date,pdf_url,created_at")
    .not("pdf_url", "is", null)
    .ilike("content", `%${marker}%`)
    .ilike("content", `%${UMS_SAMUSIL_MARKER}%`)
    .order("sunday_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) throw new Error(error.message);

  const rows = (data || []) as StoredBulletin[];
  const expiresAt = Math.floor(Date.now() / 1000) + PDF_URL_TTL_SECONDS;

  const items = rows.map((row) => {
    const path = row.pdf_url || "";
    const sourceNo = Number(row.content?.match(/UMS samusil no:\s*(\d+)/)?.[1] || 0);
    const isRemote = /^https?:\/\//i.test(path);
    // pdf.js·pptx·이미지 모두 fetch/img 로 읽으므로 same-origin 스트리밍(?stream=1)
    const streamUrl = path && !isRemote ? `/api/storage/${BUCKET}/${path}?stream=1` : path;

    // 저장본도 확장자로 유형을 판정한다 — 예전엔 pdf 로 고정돼 있어서
    // jpg/hwpx 로 저장된 부서 주보가 PDF 뷰어로 넘어가 "표시하지 못했습니다" 로 깨졌다.
    const fileName = path ? decodeURIComponent(path.split("/").pop() || "") : null;
    const detected = fileKindOf(fileName);
    const fileKind: DeptFileKind = detected === "unknown" ? "pdf" : detected;

    // hwp/hwpx 는 뷰어가 `&as=hwp-json` / `&as=hwp-preview` 를 덧붙여 호출하므로
    // 스토리지 프록시가 아니라 서명된 dept-bulletin/file 라우트를 거쳐야 한다.
    const fileUrl =
      fileKind === "hwp" && path && !isRemote
        ? `/api/dept-bulletin/file?path=${encodeURIComponent(path)}&exp=${expiresAt}&sig=${signStoragePath(path, expiresAt)}`
        : streamUrl;

    return {
      no: sourceNo,
      title: row.title,
      issue_date: row.sunday_date,
      posted_at: row.created_at,
      author: null,
      url: sourceNo ? `${VIEW_BASE}?id=samusil&no=${sourceNo}` : `${VIEW_BASE}?id=samusil`,
      pdf_url: streamUrl,
      file_name: fileName,
      file_kind: fileKind,
      file_fn: 0,
      file_url: fileUrl,
      stored: true,
    } satisfies DeptBulletinItem;
  });

  return items.filter((item) => !!item.pdf_url);
}

export async function GET(req: NextRequest) {
  try {
    const authed = await requireUser(req);
    if (!authed) {
      return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const deptKey = url.searchParams.get("dept") || "초등1부";
    const stored = await loadStoredItems(deptKey);

    // 저장본이 이번/다음 주일을 이미 덮고 있으면 UMS 를 건드리지 않는다 (초등1부 = cron 수집 부서).
    if (stored.length > 0 && coversPreferredSunday(stored)) {
      return NextResponse.json({
        ok: true,
        latest: pickPreferredBulletin(stored),
        items: stored,
        source: "storage",
        cached: false,
        preferred_dates: getPreferredSundayTargets(),
      });
    }

    // 저장본이 밀려 있는 부서(수집 크론이 없는 초등2부·유치부 등)는 UMS 실시간 목록을 합쳐
    // 최신 주보까지 보이게 한다. UMS 가 죽어도 저장본이 있으면 그걸로 응답한다.
    const hadCache = (listCaches.get(deptKey)?.expiresAt ?? 0) > Date.now();
    let live: DeptBulletinItem[] = [];
    let liveError: string | null = null;
    try {
      live = withSignedPdfUrls(await loadPublicItems(deptKey), url.origin);
    } catch (e) {
      if (stored.length === 0) throw e;
      liveError = e instanceof Error ? e.message : "UMS 조회 실패";
    }

    const items = mergeBulletinItems(stored, live);

    return NextResponse.json({
      ok: true,
      latest: pickPreferredBulletin(items),
      items,
      source: stored.length > 0 ? (live.length > 0 ? "storage+ums-samusil" : "storage") : "ums-samusil",
      cached: hadCache,
      live_error: liveError,
      preferred_dates: getPreferredSundayTargets(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "부서 주보 목록 불러오기 실패" },
      { status: 502 },
    );
  }
}
