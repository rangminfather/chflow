import { createClient } from "@supabase/supabase-js";
import iconv from "iconv-lite";
import { CookieJar, umsViaCf } from "@/lib/bulletin/ums-via-cf";

// 메인 교회(명성교회) 주보 PDF 수집 로직.
// cron(`/api/bulletin/sync`)과 조회 시 lazy 폴백(`/api/bulletin/latest`)이 공유한다.

export type JuboListItem = {
  no: number;
  title: string;
  issue_date: string;
  posted_at: string | null;
  url: string;
};

export type JuboSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  latest?: JuboListItem;
  pdf_path?: string;
  bytes?: number;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "bulletins";
const SOURCE = "jubo";
const BOARD_URL = "http://www.ums.or.kr/bbs/zboard.php?id=jubo";
const LIST_URL = `${BOARD_URL}&page=1`;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Referer": "http://www.ums.or.kr/",
} as const;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchEucKr(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`UMS response ${res.status}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("euc-kr").decode(buf);
}

// 목록 페이지(`/bbs/zboard.php`)는 UMS WAF가 데이터센터 IP(=Vercel egress)에서 403 차단한다.
// PDF 단계와 동일하게 Cloudflare Worker(umsViaCf)로 우회한다. 로컬/비차단 IP는 직접 fetch가
// 통과하므로 우선 시도하고, 실패(403 포함) 시 워커로 폴백.
async function fetchListHtml(): Promise<string> {
  try {
    return await fetchEucKr(LIST_URL);
  } catch (directError) {
    console.warn("[jubo-sync] direct list fetch failed, trying worker", directError);
  }

  const res = await umsViaCf("/bbs/zboard.php?id=jubo&page=1", {
    referer: "http://www.ums.or.kr/",
  });
  if (res.status !== 200) throw new Error(`UMS response ${res.status}`);
  return iconv.decode(res.body, "cp949");
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

function parseLatestJubo(html: string): JuboListItem | null {
  const rowRe =
    /<tr\s+class=list\d[\s\S]*?<input[^>]+name=cart[^>]+value=["']?(\d+)["']?[\s\S]*?<a\s+[^>]*href=["']([^"']*no=\1[^"']*)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<span\s+title=['"][^'"]*['"]>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>/gi;

  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html))) {
    const rawTitle = textFromHtml(match[3]);
    const title = rawTitle.replace(/\[[^\]]+\]\s*/, "").trim();
    const issueDate = title.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (!title.includes("명성교회 주보") || !issueDate) continue;

    return {
      no: parseInt(match[1], 10),
      title,
      issue_date: `${issueDate[1]}-${issueDate[2].padStart(2, "0")}-${issueDate[3].padStart(2, "0")}`,
      posted_at: match[4],
      url: new URL(decodeHtml(match[2]), "http://www.ums.or.kr/bbs/zboard.php").toString(),
    };
  }

  return null;
}

async function ensureBucket(admin: ReturnType<typeof adminClient>) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) return;
  await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf"],
  });
}

function pdfFromBuffer(buf: Buffer) {
  return buf.byteLength > 1000 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

function ingestSetCookie(cookieHeader: string, setCookies: string[]) {
  const map = new Map<string, string>();
  for (const part of cookieHeader.split(";").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  for (const cookie of setCookies) {
    const pair = cookie.split(";")[0]?.trim();
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return Array.from(map.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
}

function setCookiesFrom(res: Response) {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const multi = headers.getSetCookie?.();
  if (multi && multi.length > 0) return multi;
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function findRawPdfPaths(html: string) {
  const paths = new Set<string>();
  const staticRe = /data\/jubo\/\d+\/[a-zA-Z0-9_./-]+?(?:__pdf\.jpg|\.pdf)/gi;
  let match: RegExpExecArray | null;
  while ((match = staticRe.exec(html))) {
    paths.add(match[0].replace(/__pdf\.jpg$/i, ".pdf"));
  }

  const hrefRe = /(?:href|src)=["']([^"']+(?:download|\.pdf)[^"']*)["']/gi;
  while ((match = hrefRe.exec(html))) {
    paths.add(decodeHtml(match[1]));
  }

  return Array.from(paths);
}

async function loginUms(umsUserId: string, umsPassword: string) {
  const jar = new CookieJar();
  const cleanUserId = umsUserId.replace(/^umsorkr_/, "");
  const params = new URLSearchParams();
  params.append("s_url", "/main/main.php");
  params.append("user_id", cleanUserId);
  params.append("password", umsPassword);
  params.append("group_no", "1");

  const res = await umsViaCf("/bbs/login_check.php", {
    method: "POST",
    body: Buffer.from(params.toString(), "utf8"),
    contentType: "application/x-www-form-urlencoded",
    referer: "http://www.ums.or.kr/bbs/login.php?id=jubo",
  });
  jar.ingest(res.setCookies);

  if (!jar.get("PHPSESSID") || !jar.get("login_1st")) {
    const html = iconv.decode(res.body, "cp949");
    const msg = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`UMS 로그인 실패: ${msg}`);
  }

  return jar;
}

async function directLoginUms(umsUserId: string, umsPassword: string) {
  const cleanUserId = umsUserId.replace(/^umsorkr_/, "");
  const params = new URLSearchParams();
  params.append("s_url", "/main/main.php");
  params.append("user_id", cleanUserId);
  params.append("password", umsPassword);
  params.append("group_no", "1");

  const res = await fetch("http://www.ums.or.kr/bbs/login_check.php", {
    method: "POST",
    cache: "no-store",
    redirect: "manual",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "http://www.ums.or.kr/bbs/login.php?id=jubo",
    },
    body: params.toString(),
  });

  const cookieHeader = ingestSetCookie("", setCookiesFrom(res));
  if (!/PHPSESSID=/.test(cookieHeader) || !/login_1st=/.test(cookieHeader)) {
    const html = iconv.decode(Buffer.from(await res.arrayBuffer()), "cp949");
    const msg = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`UMS 직접 로그인 실패: ${msg}`);
  }

  return cookieHeader;
}

async function directFetch(pathOrUrl: string, cookieHeader: string, referer: string) {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `http://www.ums.or.kr${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      ...BROWSER_HEADERS,
      "Cookie": cookieHeader,
      "Referer": referer,
    },
  });
  const body = Buffer.from(await res.arrayBuffer());
  return {
    body,
    cookieHeader: ingestSetCookie(cookieHeader, setCookiesFrom(res)),
  };
}

async function directFetchPdfWithLogin(item: JuboListItem, umsUserId: string, umsPassword: string) {
  let cookieHeader = await directLoginUms(umsUserId, umsPassword);
  const postPath = `/bbs/zboard.php?id=jubo&no=${item.no}`;
  const post = await directFetch(postPath, cookieHeader, BOARD_URL);
  cookieHeader = post.cookieHeader;

  const postHtml = iconv.decode(post.body, "cp949");
  if (postHtml.includes("사용권한이 없습니다")) {
    throw new Error("UMS 직접 로그인은 되었지만 주보 보기 권한이 없습니다");
  }

  const candidates = [
    ...findRawPdfPaths(postHtml),
    `/bbs/skin/AP_skin_jubo/m_download.php?id=jubo&no=${item.no}&filenum=0&snum=0&hit=0`,
    `/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=jubo&no=${item.no}&filenum=0&snum=0&hit=0`,
    `/bbs/download.php?id=jubo&no=${item.no}&filenum=0`,
  ];

  const tried: string[] = [];
  for (const candidate of candidates) {
    const path = candidate.startsWith("http")
      ? new URL(candidate).pathname + new URL(candidate).search
      : candidate.startsWith("/bbs/")
        ? candidate
        : `/bbs/${candidate.replace(/^\/+/, "")}`;

    tried.push(path);
    const res = await directFetch(path, cookieHeader, `http://www.ums.or.kr${postPath}`);
    cookieHeader = res.cookieHeader;
    if (pdfFromBuffer(res.body)) return res.body;
  }

  throw new Error(`직접 PDF 경로를 찾지 못했습니다. tried=${tried.slice(0, 5).join(", ")}`);
}

async function fetchPdfWithLogin(item: JuboListItem, umsUserId: string, umsPassword: string) {
  try {
    return await directFetchPdfWithLogin(item, umsUserId, umsPassword);
  } catch (directError) {
    console.warn("[jubo-sync] direct fetch failed, trying worker", directError);
  }

  const jar = await loginUms(umsUserId, umsPassword);
  const postPath = `/bbs/zboard.php?id=jubo&no=${item.no}`;
  const postRes = await umsViaCf(postPath, {
    cookie: jar.toHeader(),
    referer: BOARD_URL,
  });
  jar.ingest(postRes.setCookies);

  const postHtml = iconv.decode(postRes.body, "cp949");
  if (postHtml.includes("사용권한이 없습니다")) {
    throw new Error("UMS 로그인은 되었지만 주보 보기 권한이 없습니다");
  }

  const candidates = [
    ...findRawPdfPaths(postHtml),
    `/bbs/skin/AP_skin_jubo/m_download.php?id=jubo&no=${item.no}&filenum=0&snum=0&hit=0`,
    `/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=jubo&no=${item.no}&filenum=0&snum=0&hit=0`,
    `/bbs/download.php?id=jubo&no=${item.no}&filenum=0`,
  ];

  const tried: string[] = [];
  for (const candidate of candidates) {
    const path = candidate.startsWith("http")
      ? new URL(candidate).pathname + new URL(candidate).search
      : candidate.startsWith("/bbs/")
        ? candidate
        : `/bbs/${candidate.replace(/^\/+/, "")}`;

    tried.push(path);
    const res = await umsViaCf(path, {
      cookie: jar.toHeader(),
      referer: `http://www.ums.or.kr${postPath}`,
    });
    jar.ingest(res.setCookies);
    if (pdfFromBuffer(res.body)) return res.body;
  }

  throw new Error(`PDF 경로를 찾지 못했습니다. tried=${tried.slice(0, 5).join(", ")}`);
}

async function logSync(
  admin: ReturnType<typeof adminClient>,
  status: "success" | "skipped" | "error",
  opts: { detail?: string | null; item_no?: number | null; issue_date?: string | null } = {},
) {
  try {
    await admin.rpc("log_bulletin_sync", {
      p_source: SOURCE,
      p_status: status,
      p_detail: opts.detail ?? null,
      p_item_no: opts.item_no ?? null,
      p_issue_date: opts.issue_date ?? null,
    });
  } catch (e) {
    console.error("[jubo-sync] log_bulletin_sync failed", e);
  }
}

async function runSync(): Promise<JuboSyncResult> {
  const admin = adminClient();

  try {
    const umsUserId = process.env.UMS_JUBO_USER_ID || process.env.UMS_BULLETIN_USER_ID || process.env.UMS_USER_ID;
    const umsPassword = process.env.UMS_JUBO_PASSWORD || process.env.UMS_BULLETIN_PASSWORD || process.env.UMS_PASSWORD;
    if (!umsUserId || !umsPassword) {
      throw new Error("UMS_JUBO_USER_ID/UMS_JUBO_PASSWORD 또는 UMS_USER_ID/UMS_PASSWORD 환경변수가 필요합니다");
    }

    const html = await fetchListHtml();
    const latest = parseLatestJubo(html);
    if (!latest) throw new Error("최신 주보 항목을 찾지 못했습니다");

    const { data: existing, error: existingError } = await admin
      .from("bulletins")
      .select("id,pdf_url,content")
      .eq("sunday_date", latest.issue_date)
      .ilike("content", `%UMS jubo no: ${latest.no}%`)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (existing?.pdf_url) {
      await logSync(admin, "skipped", { detail: "already_fetched", item_no: latest.no, issue_date: latest.issue_date });
      return { ok: true, skipped: true, reason: "already_fetched", latest };
    }

    const pdf = await fetchPdfWithLogin(latest, umsUserId, umsPassword);
    await ensureBucket(admin);

    const objectPath = `jubo/${latest.issue_date}_${latest.no}.pdf`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    // 주의: source_board/source_no/pdf_path/fetched_at 컬럼은 운영 DB에 적용돼 있지 않으므로
    // (마이그레이션 20260604010000 미적용) base 컬럼만 사용한다. 추가하면 insert가 깨진다.
    const { error: upsertError } = await admin
      .from("bulletins")
      .insert({
        title: latest.title,
        content: `명성교회 홈페이지에서 자동 수집한 주보 PDF입니다.\nUMS jubo no: ${latest.no}`,
        sunday_date: latest.issue_date,
        pdf_url: objectPath,
        created_at: new Date().toISOString(),
      });

    if (upsertError) throw new Error(upsertError.message);

    await logSync(admin, "success", { detail: objectPath, item_no: latest.no, issue_date: latest.issue_date });
    return { ok: true, skipped: false, latest, pdf_path: objectPath, bytes: pdf.byteLength };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "주보 수집 실패";
    await logSync(admin, "error", { detail });
    throw e;
  }
}

// 동시 호출(여러 사용자가 동시에 조회 → lazy 폴백) 시 같은 인스턴스에서 중복 수집을 막는다.
let inFlight: Promise<JuboSyncResult> | null = null;

export function syncJuboBulletin(): Promise<JuboSyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
