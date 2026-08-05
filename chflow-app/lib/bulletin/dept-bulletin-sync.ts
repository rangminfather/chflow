import { createClient } from "@supabase/supabase-js";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";
import {
  detectBulletinAttachmentKind,
  normalizeBulletinAttachmentAsPdf,
} from "@/lib/bulletin/attachment-to-pdf";
import { r2 } from "@/lib/r2";

// 초등1부 주보(UMS samusil 게시판) 수집 로직.
// /api/dept-bulletin/sync (cron) 과 /api/worship-guide/bulletin-refresh (사용자 트리거) 가 공유한다.

type DeptListItem = {
  no: number;
  title: string;
  issue_date: string | null;
  posted_at: string | null;
  author: string | null;
  url: string;
};

export type DeptSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  latest?: DeptListItem;
  pdf_path?: string;
  bytes?: number;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "bulletins";
const DEPT_KEY = "초등1부";
const DEPT_AUTHOR = "심주석";
const STORAGE_PREFIX = "dept/elementary1";
const DEPT_MARKER = `Dept bulletin: ${DEPT_KEY}`;
const UMS_MARKER = "UMS samusil no:";
const BOARD_URL = "http://www.ums.or.kr/bbs/zboard.php?id=samusil";
const VIEW_BASE = "http://www.ums.or.kr/bbs/zboard.php";

const SYNC_SOURCE = `dept:${DEPT_KEY}`;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function logSync(
  admin: ReturnType<typeof adminClient>,
  status: "success" | "skipped" | "error",
  opts: { detail?: string | null; item_no?: number | null; issue_date?: string | null } = {},
) {
  try {
    await admin.rpc("log_bulletin_sync", {
      p_source: SYNC_SOURCE,
      p_status: status,
      p_detail: opts.detail ?? null,
      p_item_no: opts.item_no ?? null,
      p_issue_date: opts.issue_date ?? null,
    });
  } catch (e) {
    console.error("[dept-bulletin-sync] log_bulletin_sync failed", e);
  }
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

function isoTodayKst() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function yearFromPostedAt(postedAt: string | null) {
  const match = postedAt?.match(/^(\d{4})-/);
  return match ? Number(match[1]) : Number(isoTodayKst().slice(0, 4));
}

function extractDateFromTitle(title: string, fallbackYear: number) {
  const match = title.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!match) return null;
  return `${fallbackYear}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function absoluteSamusilUrl(href: string) {
  const normalized = href.startsWith("?") ? `${VIEW_BASE}${href}` : href;
  return new URL(normalized, "http://www.ums.or.kr/bbs/").toString();
}

function parseBoardList(html: string): DeptListItem[] {
  const rows: DeptListItem[] = [];
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

    const title = textFromHtml(titleAttrMatch?.[1] || anchorMatch?.[1] || "");
    if (!title) continue;
    const postedAt = postedAtMatch?.[1] || null;
    rows.push({
      no,
      title,
      issue_date: extractDateFromTitle(title, yearFromPostedAt(postedAt)),
      posted_at: postedAt,
      author: authorMatch ? textFromHtml(authorMatch[1]) : null,
      url: hrefMatch ? absoluteSamusilUrl(decodeHtml(hrefMatch[1])) : `${VIEW_BASE}?id=samusil&no=${no}`,
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

async function workerEucKr(path: string) {
  const res = await umsViaCf(path, {
    referer: "http://www.ums.or.kr/",
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`UMS worker response ${res.status}`);
  return new TextDecoder("euc-kr").decode(res.body);
}

async function enrichFromPost(item: DeptListItem): Promise<DeptListItem> {
  try {
    const html = await workerEucKr(`/bbs/zboard.php?id=samusil&no=${item.no}`);
    const ogTitle = metaContent(html, "og:title");
    if (!ogTitle) return item;
    return {
      ...item,
      title: ogTitle,
      issue_date: extractDateFromTitle(ogTitle, yearFromPostedAt(item.posted_at)) || item.issue_date,
    };
  } catch {
    return item;
  }
}

async function findLatestDeptBulletin() {
  const html = await workerEucKr("/bbs/zboard.php?id=samusil&page=1");
  const baseItems = parseBoardList(html)
    .filter((item) => item.author === DEPT_AUTHOR)
    .slice(0, 6);

  if (baseItems.length === 0) {
    throw new Error(`${DEPT_KEY} 주보 게시글을 찾지 못했습니다`);
  }

  const items = await Promise.all(baseItems.map(enrichFromPost));
  return items[0];
}

async function findRawPdfPathFromPost(no: number) {
  const html = await workerEucKr(`/bbs/zboard.php?id=samusil&no=${no}`);
  const match = html.match(/data\/samusil\/\d+\/[a-f0-9]+__pdf\.jpg/i);
  return match ? match[0].replace(/__pdf\.jpg$/i, ".pdf") : null;
}

async function downloadPdf(no: number) {
  const rawPath = await findRawPdfPathFromPost(no);
  if (rawPath) {
    const raw = await umsViaCf(`/bbs/${rawPath}`, {
      referer: `${BOARD_URL}&no=${no}`,
    });
    const normalized = await normalizeBulletinAttachmentAsPdf(raw.body);
    if (normalized) return normalized;
  }

  const downloaded = await umsViaCf(
    `/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=samusil&no=${no}&filenum=0&snum=0&hit=0`,
    { referer: `${BOARD_URL}&no=${no}` },
  );
  const normalized = await normalizeBulletinAttachmentAsPdf(downloaded.body);
  if (normalized) return normalized;

  const kind = detectBulletinAttachmentKind(downloaded.body);
  throw new Error(
    `${DEPT_KEY} 첨부파일 처리 실패: HTTP ${downloaded.status}, ${downloaded.contentType}, ${downloaded.body.byteLength} bytes (${kind})`
  );
}

// 동시 호출 방지 (in-flight 잠금) — cron 과 사용자 트리거가 겹쳐도 1회만 수집
let inFlight: Promise<DeptSyncResult> | null = null;

export function syncDeptBulletin(): Promise<DeptSyncResult> {
  if (inFlight) return inFlight;
  inFlight = doSyncDeptBulletin().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSyncDeptBulletin(): Promise<DeptSyncResult> {
  const admin = adminClient();

  try {
    const latest = await findLatestDeptBulletin();
    const issueDate = latest.issue_date || latest.posted_at || isoTodayKst();

    const { data: existing, error: existingError } = await admin
      .from("bulletins")
      .select("id,pdf_url,content")
      .eq("sunday_date", issueDate)
      .ilike("content", `%${DEPT_MARKER}%`)
      .ilike("content", `%${UMS_MARKER} ${latest.no}%`)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (existing?.pdf_url) {
      await logSync(admin, "skipped", { detail: "already_fetched", item_no: latest.no, issue_date: issueDate });
      return { ok: true, skipped: true, reason: "already_fetched", latest };
    }

    const pdf = await downloadPdf(latest.no);

    const objectPath = `${STORAGE_PREFIX}/${issueDate}_${latest.no}.pdf`;
    const { error: uploadError } = await r2.from(BUCKET).upload(objectPath, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { error: insertError } = await admin
      .from("bulletins")
      .insert({
        title: latest.title,
        content: `교육사역국 ${DEPT_KEY} 주보 PDF입니다.\n${DEPT_MARKER}\n${UMS_MARKER} ${latest.no}`,
        sunday_date: issueDate,
        pdf_url: objectPath,
        created_at: new Date().toISOString(),
      });

    if (insertError) throw new Error(insertError.message);
    await logSync(admin, "success", { detail: objectPath, item_no: latest.no, issue_date: issueDate });
    return { ok: true, skipped: false, latest, pdf_path: objectPath, bytes: pdf.byteLength };
  } catch (e) {
    const detail = e instanceof Error ? e.message : `${DEPT_KEY} 주보 수집 실패`;
    await logSync(admin, "error", { detail });
    throw e;
  }
}
