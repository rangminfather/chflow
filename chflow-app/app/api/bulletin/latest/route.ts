import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

type BulletinItem = {
  no: number;
  title: string;
  volume: string | null;
  issue_date: string | null;
  posted_at: string | null;
  author: string | null;
  url: string;
  pdf_url?: string | null;
  stored?: boolean;
};

type StoredBulletin = {
  id: string;
  title: string;
  content: string | null;
  sunday_date: string;
  pdf_url: string | null;
  created_at: string | null;
};

type CacheValue = {
  items: BulletinItem[];
  source: string;
  expiresAt: number;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PROXY_URL = `${SUPABASE_URL}/functions/v1/ums-fetch?action=list&board=jubo`;
const DIRECT_URL = "http://www.ums.or.kr/bbs/zboard.php?id=jubo&page=1";
const VIEW_BASE = "http://www.ums.or.kr/bbs/zboard.php";
const CACHE_TTL_MS = 5 * 60 * 1000;
const BUCKET = "bulletins";
let publicListCache: CacheValue | null = null;
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function fetchEucKr(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`UMS response ${res.status}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("euc-kr").decode(buf);
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

function absoluteJuboUrl(href: string) {
  const normalized = href.startsWith("?") ? `${VIEW_BASE}${href}` : href;
  return new URL(normalized, "http://www.ums.or.kr/bbs/").toString();
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

function pickPreferredBulletin(items: BulletinItem[]) {
  const targets = getPreferredSundayTargets();
  return (
    items.find((item) => item.issue_date === targets.nextSunday) ||
    items.find((item) => item.issue_date === targets.currentSunday) ||
    items[0] ||
    null
  );
}

function parseJuboList(html: string): BulletinItem[] {
  const rows: BulletinItem[] = [];
  const rowRe =
    /<tr\s+class=list\d[\s\S]*?<input[^>]+name=cart[^>]+value=["']?(\d+)["']?[\s\S]*?<a\s+[^>]*href=["']([^"']*no=\1[^"']*)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<font\s+class=list_name[^>]*>([\s\S]*?)<\/font>[\s\S]*?<span\s+title=['"][^'"]*['"]>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>/gi;

  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html))) {
    const no = parseInt(match[1], 10);
    const href = decodeHtml(match[2]);
    const rawTitle = textFromHtml(match[3]);
    const volume = rawTitle.match(/\[([^\]]+)\]/)?.[1] ?? null;
    const title = rawTitle.replace(/\[[^\]]+\]\s*/, "").trim();
    const issueDate = title.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/) ?? null;

    rows.push({
      no,
      title: title || rawTitle,
      volume,
      issue_date: issueDate
        ? `${issueDate[1]}-${issueDate[2].padStart(2, "0")}-${issueDate[3].padStart(2, "0")}`
        : null,
      posted_at: match[5],
      author: textFromHtml(match[4]) || null,
      url: absoluteJuboUrl(href),
    });
  }

  const seen = new Set<number>();
  return rows
    .filter((item) => item.title.includes("명성교회 주보"))
    .filter((item) => {
      if (seen.has(item.no)) return false;
      seen.add(item.no);
      return true;
    });
}

async function loadPublicItems() {
  if (publicListCache && publicListCache.expiresAt > Date.now()) {
    return publicListCache;
  }

  const attempts = [
    { name: "ums-fetch", url: PROXY_URL },
    { name: "direct", url: DIRECT_URL },
  ];

  let lastError = "";
  for (const attempt of attempts) {
    try {
      const html = await fetchEucKr(attempt.url);
      const items = parseJuboList(html);
      if (items.length > 0) {
        publicListCache = { items, source: attempt.name, expiresAt: Date.now() + CACHE_TTL_MS };
        return publicListCache;
      }
      lastError = `${attempt.name}: no jubo rows`;
    } catch (e) {
      lastError = `${attempt.name}: ${e instanceof Error ? e.message : "failed"}`;
    }
  }

  throw new Error(lastError || "주보 목록을 찾지 못했습니다");
}

async function loadStoredItems(): Promise<BulletinItem[]> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("bulletins")
    .select("id,title,content,sunday_date,pdf_url,created_at")
    .not("pdf_url", "is", null)
    .order("sunday_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(error.message);

  const rows = (data || []) as StoredBulletin[];
  const items = await Promise.all(rows.map(async (row) => {
    const path = row.pdf_url || "";
    const sourceNo = Number(row.content?.match(/UMS jubo no: (\d+)/)?.[1] || 0);
    let signedUrl = "";
    if (path && !/^https?:\/\//i.test(path)) {
      const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
      signedUrl = signed.data?.signedUrl || "";
    } else {
      signedUrl = path;
    }

    return {
      no: sourceNo,
      title: row.title,
      volume: null,
      issue_date: row.sunday_date,
      posted_at: row.created_at,
      author: "명성교회",
      url: sourceNo
        ? `http://www.ums.or.kr/bbs/zboard.php?id=jubo&no=${sourceNo}`
        : "http://www.ums.or.kr/bbs/zboard.php?id=jubo",
      pdf_url: signedUrl || null,
      stored: true,
    } satisfies BulletinItem;
  }));

  return items.filter((item) => !!item.pdf_url);
}

export async function GET(req: NextRequest) {
  try {
    const authed = await requireUser(req);
    if (!authed) {
      return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });
    }

    const stored = await loadStoredItems();
    if (stored.length > 0) {
      return NextResponse.json({
        ok: true,
        latest: pickPreferredBulletin(stored),
        items: stored,
        source: "storage",
        cached: false,
        preferred_dates: getPreferredSundayTargets(),
      });
    }

    const publicItems = await loadPublicItems();
    return NextResponse.json({
      ok: true,
      latest: pickPreferredBulletin(publicItems.items),
      items: publicItems.items,
      source: publicItems.source,
      cached: true,
      preferred_dates: getPreferredSundayTargets(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "주보 목록 불러오기 실패" },
      { status: 502 },
    );
  }
}
