import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import iconv from "iconv-lite";
import { syncJuboBulletin } from "@/lib/bulletin/jubo-sync";
import {
  claimBulletinDemandRetry,
  finishBulletinDemandRetry,
} from "@/lib/bulletin/demand-retry";
import {
  getBulletinSundayTargets as getPreferredSundayTargets,
  getExpectedBulletinIssueDate as getExpectedIssueDate,
  isBulletinDemandRetryWindow,
} from "@/lib/bulletin/schedule";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";
import { r2 } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 60;
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

function pickPreferredBulletin(items: BulletinItem[]) {
  const targets = getPreferredSundayTargets();
  return (
    items.find((item) => item.issue_date === targets.nextSunday) ||
    items.find((item) => item.issue_date === targets.currentSunday) ||
    items[0] ||
    null
  );
}

// 이번 주에 "저장돼 있어야 할" 주보의 발행일(일요일자)을 달력만으로 계산한다.
// 교회는 다가오는 주일 주보를 그 전 금요일에 올리므로, 금(5)·토(6)에는 다음 주일자,
// 그 외 요일에는 직전 주일자를 기대 대상으로 본다. UMS를 다시 파싱하지 않는다.
// Weekend self-heal. The persisted DB claim limits all Vercel instances
// together to one attempt per issue and source every 30 minutes.
function scheduleLazyJuboSync(reason: string, issueDate: string) {
  if (!isBulletinDemandRetryWindow()) return;
  after(async () => {
    let claimed = false;
    try {
      claimed = await claimBulletinDemandRetry("jubo", issueDate);
      if (!claimed) return;

      const result = await syncJuboBulletin();
      await finishBulletinDemandRetry(
        "jubo",
        issueDate,
        result.latest?.issue_date === issueDate ? "success" : "not_available",
      );
    } catch (e) {
      if (claimed) {
        try {
          await finishBulletinDemandRetry("jubo", issueDate, "error");
        } catch (finishError) {
          console.error("[bulletin-latest] lazy retry state update failed", finishError);
        }
      }
      console.error(`[bulletin-latest] lazy sync failed (${reason})`, e);
    }
  });
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

  // UMS WAF가 /bbs/zboard.php GET을 데이터센터 IP(=Vercel)에서 403 차단한다.
  // cf-worker(umsViaCf, Cloudflare edge)가 유일하게 안정적으로 통과하므로 1순위.
  // ums-fetch(Supabase edge)는 현재 anti-bot 페이지를 반환해 파싱 0건이 잦고,
  // direct는 Vercel에서 403이라 폴백으로만 둔다(로컬/비차단 IP에서는 통과).
  const attempts: { name: string; fetch: () => Promise<string> }[] = [
    {
      name: "cf-worker",
      fetch: async () => {
        const res = await umsViaCf("/bbs/zboard.php?id=jubo&page=1", {
          referer: "http://www.ums.or.kr/",
        });
        if (res.status !== 200) throw new Error(`UMS response ${res.status}`);
        return iconv.decode(res.body, "cp949");
      },
    },
    { name: "ums-fetch", fetch: () => fetchEucKr(PROXY_URL) },
    { name: "direct", fetch: () => fetchEucKr(DIRECT_URL) },
  ];

  let lastError = "";
  for (const attempt of attempts) {
    try {
      const html = await attempt.fetch();
      const items = parseJuboList(html);
      if (items.length > 0) {
        publicListCache = { items, source: attempt.name, expiresAt: Date.now() + CACHE_TTL_MS };
        return publicListCache;
      }
      lastError = `${attempt.name}: no jubo rows`;
    } catch (e) {
      lastError = `${attempt.name}: 오류`;
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
    .ilike("content", "%UMS jubo no:%")
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
      // pdf.js 가 fetch 하므로 same-origin 스트리밍(?stream=1)
      signedUrl = `/api/storage/${BUCKET}/${path}?stream=1`;
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
      // 저장본은 있지만 이번 주에 있어야 할 주보(날짜 기반)가 아직 없으면 백그라운드 수집.
      const expected = getExpectedIssueDate();
      if (!stored.some((item) => item.issue_date === expected)) {
        scheduleLazyJuboSync("stored-missing-expected", expected);
      }
      return NextResponse.json({
        ok: true,
        latest: pickPreferredBulletin(stored),
        items: stored,
        source: "storage",
        cached: false,
        preferred_dates: getPreferredSundayTargets(),
      });
    }

    // If storage is empty during the weekend, enqueue the same persisted retry
    // instead of making every viewer request query UMS directly.
    if (isBulletinDemandRetryWindow()) {
      const expected = getExpectedIssueDate();
      scheduleLazyJuboSync("no-stored-weekend", expected);
      return NextResponse.json({
        ok: true,
        latest: null,
        items: [],
        source: "storage",
        cached: false,
        retry_scheduled: true,
        preferred_dates: getPreferredSundayTargets(),
      });
    }

    const publicItems = await loadPublicItems();
    const targets = getPreferredSundayTargets();
    const preferred = pickPreferredBulletin(publicItems.items);

    // 저장 PDF가 하나도 없는데 UMS에는 이번/다음 주일 주보가 올라와 있으면,
    // 응답은 원문 링크로 즉시 주고 백그라운드로 1회 수집을 트리거한다(self-heal).
    if (
      preferred &&
      (preferred.issue_date === targets.nextSunday || preferred.issue_date === targets.currentSunday)
    ) {
      scheduleLazyJuboSync("no-stored-fresh-upstream", getExpectedIssueDate());
    }

    return NextResponse.json({
      ok: true,
      latest: preferred,
      items: publicItems.items,
      source: publicItems.source,
      cached: true,
      preferred_dates: targets,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "주보 목록 불러오기 실패" },
      { status: 502 },
    );
  }
}
