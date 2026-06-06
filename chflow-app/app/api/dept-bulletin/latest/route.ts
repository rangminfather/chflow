import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

type DeptBulletinItem = {
  no: number;
  title: string;
  issue_date: string | null;
  posted_at: string | null;
  author: string | null;
  url: string;
  pdf_url: string;
  stored: boolean;
};

type CacheValue = {
  items: Omit<DeptBulletinItem, "pdf_url">[];
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
const SIGNING_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON_KEY;
const PROXY_LIST_URL = `${SUPABASE_URL}/functions/v1/ums-fetch?action=list&board=samusil`;
const PROXY_POST_URL = (no: number) => `${SUPABASE_URL}/functions/v1/ums-fetch?action=post&board=samusil&no=${no}`;
const DIRECT_LIST_URL = "http://www.ums.or.kr/bbs/zboard.php?id=samusil&page=1";
const DIRECT_POST_URL = (no: number) => `http://www.ums.or.kr/bbs/zboard.php?id=samusil&no=${no}`;
const VIEW_BASE = "http://www.ums.or.kr/bbs/zboard.php";
const CACHE_TTL_MS = 5 * 60 * 1000;
const PDF_URL_TTL_SECONDS = 10 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEPT_PATTERNS: Record<string, { author: string; titleIncludes: string[] }> = {
  "초등1부": { author: "심주석", titleIncludes: [] },
};

let listCache: CacheValue | null = null;

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

function extractDateFromTitle(title: string, fallbackYear: number) {
  const match = title.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!match) return null;
  return `${fallbackYear}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function parseBoardList(html: string): Omit<DeptBulletinItem, "pdf_url">[] {
  const rows: Omit<DeptBulletinItem, "pdf_url">[] = [];
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
    const titleAttrMatch = row.match(/title=['"](?:\[\d+\]\s*)?([^'"]+)['"]/i);
    const anchorMatch = row.match(/<a\s+[^>]*href=["'][^"']*no=\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const authorMatch = row.match(/<font\s+class=["']?list_name["']?[^>]*>([\s\S]*?)<\/font>/i);
    const postedAtMatch = row.match(/<span\s+title=['"][^'"]*['"]>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>/i);

    const rawTitle = textFromHtml(titleAttrMatch?.[1] || anchorMatch?.[1] || "");
    if (!rawTitle) continue;

    const postedAt = postedAtMatch?.[1] || null;
    rows.push({
      no,
      title: rawTitle,
      issue_date: extractDateFromTitle(rawTitle, yearFromPostedAt(postedAt)),
      posted_at: postedAt,
      author: authorMatch ? textFromHtml(authorMatch[1]) : null,
      url: hrefMatch ? absoluteSamusilUrl(decodeHtml(hrefMatch[1])) : `${VIEW_BASE}?id=samusil&no=${no}`,
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

async function enrichFromPost(item: Omit<DeptBulletinItem, "pdf_url">): Promise<Omit<DeptBulletinItem, "pdf_url">> {
  try {
    const html = await fetchFirstEucKr([
      { name: "worker-post", url: DIRECT_POST_URL(item.no), viaWorker: `/bbs/zboard.php?id=samusil&no=${item.no}` },
      { name: "ums-fetch-post", url: PROXY_POST_URL(item.no) },
      { name: "direct-post", url: DIRECT_POST_URL(item.no), headers: BROWSER_HEADERS },
    ]);
    const ogTitle = metaContent(html, "og:title");
    if (!ogTitle) return item;
    const issueDate = extractDateFromTitle(ogTitle, yearFromPostedAt(item.posted_at)) || item.issue_date;
    return { ...item, title: ogTitle, issue_date: issueDate };
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

function signPdfUrl(no: number, expiresAt: number) {
  return createHmac("sha256", SIGNING_SECRET).update(`samusil:${no}:${expiresAt}`).digest("hex");
}

function withSignedPdfUrls(items: Omit<DeptBulletinItem, "pdf_url">[], origin: string): DeptBulletinItem[] {
  const expiresAt = Math.floor(Date.now() / 1000) + PDF_URL_TTL_SECONDS;
  return items.map((item) => {
    const sig = signPdfUrl(item.no, expiresAt);
    return {
      ...item,
      pdf_url: `${origin}/api/dept-bulletin/pdf?no=${item.no}&exp=${expiresAt}&sig=${sig}`,
    };
  });
}

async function loadPublicItems(deptKey: string) {
  const pattern = DEPT_PATTERNS[deptKey];
  if (!pattern) throw new Error(`지원하지 않는 부서입니다: ${deptKey}`);

  if (listCache && listCache.expiresAt > Date.now()) {
    return listCache.items;
  }

  const html = await fetchFirstEucKr([
    { name: "worker-list", url: DIRECT_LIST_URL, viaWorker: "/bbs/zboard.php?id=samusil&page=1" },
    { name: "ums-fetch-list", url: PROXY_LIST_URL },
    { name: "direct-list", url: DIRECT_LIST_URL, headers: BROWSER_HEADERS },
  ]);
  const baseItems = parseBoardList(html)
    .filter((item) => {
      const authorMatches = !pattern.author || item.author === pattern.author;
      const titleMatches = pattern.titleIncludes.length === 0 || pattern.titleIncludes.every((keyword) => item.title.includes(keyword));
      return authorMatches && titleMatches;
    })
    .slice(0, 12);

  if (baseItems.length === 0) {
    throw new Error("초등1부 주보 게시글을 찾지 못했습니다");
  }

  const items = await Promise.all(baseItems.map(enrichFromPost));
  listCache = { items, expiresAt: Date.now() + CACHE_TTL_MS };
  return items;
}

export async function GET(req: NextRequest) {
  try {
    const authed = await requireUser(req);
    if (!authed) {
      return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const deptKey = url.searchParams.get("dept") || "초등1부";
    const items = withSignedPdfUrls(await loadPublicItems(deptKey), url.origin);

    return NextResponse.json({
      ok: true,
      latest: pickPreferredBulletin(items),
      items,
      source: "ums-samusil",
      cached: !!listCache && listCache.expiresAt > Date.now(),
      preferred_dates: getPreferredSundayTargets(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "초등1부 주보 목록 불러오기 실패" },
      { status: 502 },
    );
  }
}
