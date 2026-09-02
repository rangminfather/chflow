import { createClient } from "@supabase/supabase-js";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";
import { normalizeBulletinAttachmentAsPdf } from "@/lib/bulletin/attachment-to-pdf";
import {
  type SamusilListItem,
  extractAttachments,
  extractDateFromTitle,
  hasPdfPreviewImage,
  matchesDept,
  metaContent,
  parseBoardList,
  pickBestAttachment,
  titleKeywordsFor,
  yearFromPostedAt,
} from "@/lib/bulletin/samusil-board";
import { r2 } from "@/lib/r2";

// 교육사역국 부서 주보(UMS samusil 게시판) 수집 로직.
// /api/dept-bulletin/sync (cron) 과 /api/worship-guide/bulletin-refresh (사용자 트리거) 가 공유한다.
//
// 원본 확장자 그대로 보관한다 (pdf/pptx/hwpx/jpg…). 부서마다 올리는 형식이 달라
// PDF 로 강제 변환하면 pptx·hwpx 는 변환 자체가 불가능하기 때문이다.
// 조회 경로(/api/dept-bulletin/latest)가 저장 경로의 확장자로 뷰어를 고르므로
// 원본을 그대로 둬야 유형별 뷰어가 동작한다.

export type DeptSyncOutcome = {
  dept: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  latest?: SamusilListItem;
  pdf_path?: string;
  bytes?: number;
};

export type DeptSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  departments: DeptSyncOutcome[];
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "bulletins";
const UMS_MARKER = "UMS samusil no:";
const BOARD_URL = "http://www.ums.or.kr/bbs/zboard.php?id=samusil";

// 수집 대상 부서와 저장 폴더.
// 영아부는 사무실 게시판에 주보를 올리지 않아 매번 "게시글 없음"으로 건너뛴다
// (올리기 시작하면 자동으로 수집된다).
const SYNC_DEPTS: { key: string; slug: string }[] = [
  { key: "초등1부", slug: "elementary1" },
  { key: "초등2부", slug: "elementary2" },
  { key: "유치부", slug: "kindergarten" },
  { key: "유아부", slug: "toddler" },
  { key: "청소년부", slug: "youth" },
  { key: "영아부", slug: "infant" },
];

function deptMarker(deptKey: string) {
  return `Dept bulletin: ${deptKey}`;
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function logSync(
  admin: ReturnType<typeof adminClient>,
  deptKey: string,
  status: "success" | "skipped" | "error",
  opts: { detail?: string | null; item_no?: number | null; issue_date?: string | null } = {},
) {
  try {
    await admin.rpc("log_bulletin_sync", {
      p_source: `dept:${deptKey}`,
      p_status: status,
      p_detail: opts.detail ?? null,
      p_item_no: opts.item_no ?? null,
      p_issue_date: opts.issue_date ?? null,
    });
  } catch (e) {
    console.error("[dept-bulletin-sync] log_bulletin_sync failed", e);
  }
}

function isoTodayKst() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function workerEucKr(path: string) {
  const res = await umsViaCf(path, {
    referer: "http://www.ums.or.kr/",
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`UMS worker response ${res.status}`);
  return new TextDecoder("euc-kr").decode(res.body);
}

type EnrichedItem = SamusilListItem & {
  file_name: string | null;
  file_fn: number;
  is_pdf_preview: boolean;
};

// 게시글 본문에서 og:title(정확한 제목)과 첨부파일 정보를 읽는다.
async function enrichFromPost(item: SamusilListItem): Promise<EnrichedItem> {
  const base: EnrichedItem = { ...item, file_name: null, file_fn: 0, is_pdf_preview: false };
  try {
    const html = await workerEucKr(`/bbs/zboard.php?id=samusil&no=${item.no}`);
    const best = pickBestAttachment(extractAttachments(html));
    const ogTitle = metaContent(html, "og:title");
    return {
      ...base,
      title: ogTitle || item.title,
      issue_date: ogTitle
        ? extractDateFromTitle(ogTitle, yearFromPostedAt(item.posted_at)) || item.issue_date
        : item.issue_date,
      file_name: best?.name ?? null,
      file_fn: best?.fn ?? 0,
      is_pdf_preview: !best && hasPdfPreviewImage(html),
    };
  } catch {
    return base;
  }
}

// 부서별 최신 주보 게시글. 조회 경로와 같은 제목 키워드 규칙을 쓴다.
async function findLatestDeptBulletin(listHtml: string, deptKey: string): Promise<EnrichedItem | null> {
  const keywords = titleKeywordsFor(deptKey);
  const baseItems = parseBoardList(listHtml)
    .filter((item) => matchesDept(item.title, keywords))
    .slice(0, 3);

  if (baseItems.length === 0) return null;

  const items = await Promise.all(baseItems.map(enrichFromPost));
  return items[0];
}

async function downloadAttachment(no: number, fn: number) {
  const res = await umsViaCf(
    `/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=samusil&no=${no}&filenum=${fn}&snum=0&hit=0`,
    { referer: `${BOARD_URL}&no=${no}` },
  );
  if (res.status < 200 || res.status >= 300) throw new Error(`첨부파일 다운로드 실패 (HTTP ${res.status})`);
  if (res.body.byteLength < 1000) throw new Error(`첨부파일이 비어 있음 (${res.body.byteLength} bytes)`);
  return res.body;
}

// 첨부파일 링크가 없고 PDF 미리보기 이미지만 있는 예전 형식 게시글 폴백.
async function downloadRenderedPdf(no: number) {
  const html = await workerEucKr(`/bbs/zboard.php?id=samusil&no=${no}`);
  const match = html.match(/data\/samusil\/\d+\/[a-f0-9]+__pdf\.jpg/i);
  if (!match) return null;
  const raw = await umsViaCf(`/bbs/${match[0].replace(/__pdf\.jpg$/i, ".pdf")}`, {
    referer: `${BOARD_URL}&no=${no}`,
  });
  return normalizeBulletinAttachmentAsPdf(raw.body);
}

function extensionOf(fileName: string | null, fallback: string) {
  const ext = fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return ext || fallback;
}

// 이미지 주보는 <img> 로 렌더되므로 content-type 이 맞아야 한다.
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  hwp: "application/x-hwp",
  hwpx: "application/vnd.hancom.hwpx",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

async function syncOneDept(
  admin: ReturnType<typeof adminClient>,
  listHtml: string,
  dept: { key: string; slug: string },
): Promise<DeptSyncOutcome> {
  const marker = deptMarker(dept.key);
  try {
    const latest = await findLatestDeptBulletin(listHtml, dept.key);
    if (!latest) {
      await logSync(admin, dept.key, "skipped", { detail: "no_post" });
      return { dept: dept.key, ok: true, skipped: true, reason: "no_post" };
    }

    const issueDate = latest.issue_date || latest.posted_at || isoTodayKst();

    const { data: existing, error: existingError } = await admin
      .from("bulletins")
      .select("id,pdf_url")
      .eq("sunday_date", issueDate)
      .ilike("content", `%${marker}%`)
      .ilike("content", `%${UMS_MARKER} ${latest.no}%`)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (existing?.pdf_url) {
      await logSync(admin, dept.key, "skipped", { detail: "already_fetched", item_no: latest.no, issue_date: issueDate });
      return { dept: dept.key, ok: true, skipped: true, reason: "already_fetched", latest };
    }

    // 원본 확장자 그대로 저장 — 조회 경로가 확장자로 뷰어를 고른다.
    let bytes: Uint8Array;
    let extension: string;
    if (latest.file_name || !latest.is_pdf_preview) {
      bytes = await downloadAttachment(latest.no, latest.file_fn);
      extension = extensionOf(latest.file_name, "pdf");
    } else {
      const rendered = await downloadRenderedPdf(latest.no);
      if (!rendered) throw new Error("첨부파일도 PDF 미리보기도 찾지 못했습니다");
      bytes = rendered;
      extension = "pdf";
    }

    const objectPath = `dept/${dept.slug}/${issueDate}_${latest.no}.${extension}`;
    const { error: uploadError } = await r2.from(BUCKET).upload(objectPath, bytes, {
      contentType: CONTENT_TYPES[extension] || "application/octet-stream",
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { error: insertError } = await admin
      .from("bulletins")
      .insert({
        title: latest.title,
        content: `교육사역국 ${dept.key} 주보입니다.\n${marker}\n${UMS_MARKER} ${latest.no}`,
        sunday_date: issueDate,
        pdf_url: objectPath,
        created_at: new Date().toISOString(),
      });

    if (insertError) throw new Error(insertError.message);
    await logSync(admin, dept.key, "success", { detail: objectPath, item_no: latest.no, issue_date: issueDate });
    return { dept: dept.key, ok: true, skipped: false, latest, pdf_path: objectPath, bytes: bytes.byteLength };
  } catch (e) {
    const detail = e instanceof Error ? e.message : `${dept.key} 주보 수집 실패`;
    await logSync(admin, dept.key, "error", { detail });
    // 한 부서가 실패해도 나머지 부서 수집은 계속한다.
    return { dept: dept.key, ok: false, error: detail };
  }
}

// 동시 호출 방지 (in-flight 잠금) — cron 과 사용자 트리거가 겹쳐도 1회만 수집
let inFlight: Promise<DeptSyncResult> | null = null;
const singleDeptInFlight = new Map<string, Promise<DeptSyncOutcome>>();

export function syncDeptBulletin(): Promise<DeptSyncResult> {
  if (inFlight) return inFlight;
  inFlight = doSyncDeptBulletin().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// Demand-triggered collection only checks the department the user is viewing.
// This avoids running all six department parsers for every self-heal attempt.
export function syncDeptBulletinFor(deptKey: string): Promise<DeptSyncOutcome> {
  const dept = SYNC_DEPTS.find((candidate) => candidate.key === deptKey);
  if (!dept) {
    return Promise.resolve({
      dept: deptKey,
      ok: false,
      error: "지원하지 않는 부서입니다.",
    });
  }

  if (inFlight) {
    return inFlight.then((result) => result.departments.find((item) => item.dept === deptKey) || {
      dept: deptKey,
      ok: false,
      error: "부서 주보 수집 결과를 찾지 못했습니다.",
    });
  }

  const running = singleDeptInFlight.get(deptKey);
  if (running) return running;

  const promise = (async () => {
    const admin = adminClient();
    const listHtml = await workerEucKr("/bbs/zboard.php?id=samusil&page=1");
    return syncOneDept(admin, listHtml, dept);
  })().finally(() => {
    singleDeptInFlight.delete(deptKey);
  });

  singleDeptInFlight.set(deptKey, promise);
  return promise;
}

async function doSyncDeptBulletin(): Promise<DeptSyncResult> {
  const admin = adminClient();
  // 게시판 목록은 한 번만 받아 모든 부서가 나눠 쓴다.
  const listHtml = await workerEucKr("/bbs/zboard.php?id=samusil&page=1");

  const departments: DeptSyncOutcome[] = [];
  for (const dept of SYNC_DEPTS) {
    departments.push(await syncOneDept(admin, listHtml, dept));
  }

  const collected = departments.filter((d) => d.ok && !d.skipped);
  return {
    ok: departments.some((d) => d.ok),
    skipped: collected.length === 0,
    reason: collected.length === 0 ? "nothing_new" : undefined,
    departments,
  };
}
