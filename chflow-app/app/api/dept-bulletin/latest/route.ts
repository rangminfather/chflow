import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";
import {
  type DeptFileKind,
  extractAttachments,
  extractDateFromTitle,
  fileKindOf,
  hasPdfPreviewImage,
  matchesDept,
  metaContent,
  parseBoardList,
  pickBestAttachment,
  titleKeywordsFor,
  yearFromPostedAt,
} from "@/lib/bulletin/samusil-board";

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
    if (fileKind === "unknown" && hasPdfPreviewImage(html)) {
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
  const baseItems: ListedItem[] = parseBoardList(html)
    .filter((item) => matchesDept(item.title, keywords))
    .slice(0, 12)
    .map((item) => ({ ...item, file_name: null, file_kind: "unknown", file_fn: 0, stored: false }));

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
