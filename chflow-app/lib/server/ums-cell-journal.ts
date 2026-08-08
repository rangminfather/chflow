// 해외선교 후원목장 "목장일지" (UMS cell2021_XX 게시판) 조회.
//
// 이 게시판은 일반 가정교회 목장 전체가 아니라 "해외선교사 후원목장" 전용이다.
// cell2021_01 ~ cell2021_14 (초원 14개) × category 1~6 (목장, 초원마다 다름) 조합으로
// 총 60여 개 게시판이 있고, 게시글 열람 권한은 UMS 쪽에서 목장 단위로 개별 통제한다
// (본인 목장이 아니면 로그인해도 "이 목장일지를 사용할 권한이 없습니다" 로 막힘).
//
// 그래서 사용자 본인 UMS 계정으로 로그인한 뒤, 후보 게시판을 하나씩 시도해서
// 실제로 열리는 것을 "내 목장"으로 확정 → user_ums_credentials 에 캐싱한다.

import iconv from "iconv-lite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";

const UMS_ORIGIN = "http://www.ums.or.kr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 2026-08 기준 확인된 범위. cell2021_15 이후는 존재하지 않음(빈 페이지).
// 초원 재편성으로 범위가 바뀔 수 있으니, 못 찾는 경우가 늘면 이 범위부터 재확인할 것.
const CELL_BOARD_IDS = Array.from({ length: 14 }, (_, i) => `cell2021_${String(i + 1).padStart(2, "0")}`);

export type CellBoardCandidate = {
  boardId: string;
  category: number;
  label: string;
  count: number;
};

export type CellEntrySummary = {
  no: number;
  writer: string;
  place: string;
  meetingDate: string;
};

export type CellEntryDetail = {
  no: number;
  boardTitle: string;
  writer: string;
  postedAt: string;
  fields: Record<string, string>;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function cleanLabel(s: string): string {
  return decodeEntities(s).replace(/<[^>]+>/g, "").replace(/\s+/g, "").trim();
}

function cleanValue(s: string): string {
  return decodeEntities(s)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function setCookiesFrom(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const multi = h.getSetCookie?.();
  if (multi && multi.length) return multi;
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/** 목자/목녀만 통과. 메뉴는 UI에서만 숨겨져 있어서 직접 URL 접근을 막는 서버 쪽 방어선. */
export async function isCellShepherd(admin: SupabaseClient, uid: string): Promise<boolean> {
  const { data } = await admin
    .from("members")
    .select("family_church")
    .eq("app_user_id", uid)
    .maybeSingle();
  return data?.family_church === "목자" || data?.family_church === "목녀";
}

/** UMS 로그인 → 쿠키 헤더 문자열. 데이터센터 IP 차단 대비 direct → worker 순으로 시도. */
export async function loginUms(umsUserId: string, umsPassword: string): Promise<string> {
  const cleanUserId = umsUserId.replace(/^umsorkr_/, "");
  const params = new URLSearchParams({ s_url: "/main/main.php", user_id: cleanUserId, password: umsPassword, group_no: "1" });

  try {
    const res = await fetch(`${UMS_ORIGIN}/bbs/login_check.php`, {
      method: "POST",
      cache: "no-store",
      redirect: "manual",
      headers: {
        "user-agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${UMS_ORIGIN}/bbs/login.php?id=cell2021_01`,
      },
      body: params.toString(),
    });
    const cookie = setCookiesFrom(res).map((c) => c.split(";")[0]).join("; ");
    if (/PHPSESSID=/.test(cookie) && /login_1st=/.test(cookie)) return cookie;
  } catch {
    // direct 실패 → worker 폴백
  }

  const res = await umsViaCf("/bbs/login_check.php", {
    method: "POST",
    body: Buffer.from(params.toString(), "utf8"),
    contentType: "application/x-www-form-urlencoded",
    referer: `${UMS_ORIGIN}/bbs/login.php?id=cell2021_01`,
  });
  const cookie = res.setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!/PHPSESSID=/.test(cookie) || !/login_1st=/.test(cookie)) {
    throw new Error("UMS 로그인 실패 (계정 정보를 확인해 주세요)");
  }
  return cookie;
}

async function getPage(path: string, cookie: string | null, referer: string): Promise<string> {
  try {
    const res = await fetch(`${UMS_ORIGIN}${path}`, {
      cache: "no-store",
      headers: { "user-agent": UA, Referer: referer, ...(cookie ? { Cookie: cookie } : {}) },
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return iconv.decode(buf, "cp949");
    }
  } catch {
    // direct 실패 → worker 폴백
  }
  const res = await umsViaCf(path, { cookie: cookie || undefined, referer });
  return iconv.decode(res.body, "cp949");
}

/** 초원 14개 게시판의 목장(category) 목록 + 글 개수를 병렬 조회 */
export async function listAllCandidates(): Promise<CellBoardCandidate[]> {
  const pages = await Promise.all(
    CELL_BOARD_IDS.map(async (boardId) => {
      try {
        const html = await getPage(`/bbs/zboard.php?id=${boardId}&page=1`, null, `${UMS_ORIGIN}/`);
        return { boardId, html };
      } catch {
        return { boardId, html: "" };
      }
    }),
  );

  const candidates: CellBoardCandidate[] = [];
  const rowRe = /id=(cell2021_\d+)&category=(\d+)'>\s*([^<(]+?)\s*\((\d+)\)/g;
  for (const { html } of pages) {
    let m: RegExpExecArray | null;
    rowRe.lastIndex = 0;
    while ((m = rowRe.exec(html))) {
      candidates.push({ boardId: m[1], category: parseInt(m[2], 10), label: decodeEntities(m[3]).trim(), count: parseInt(m[4], 10) });
    }
  }
  return candidates;
}

const DENIED_MARKERS = ["이 목장일지를 사용할 권한이 없습니다", "사용권한이 없습니다"];

function isDenied(html: string): boolean {
  return DENIED_MARKERS.some((m) => html.includes(m));
}

/** 본인 계정 세션으로 후보를 하나씩 시도해서 실제 열람 가능한 목장을 찾는다. */
export async function discoverMyBoard(
  cookie: string,
  candidates: CellBoardCandidate[],
): Promise<CellBoardCandidate | null> {
  // 글이 있는 후보부터 시도 (글이 0개면 열람 테스트 자체가 불가능)
  const sorted = [...candidates].filter((c) => c.count > 0).sort((a, b) => b.count - a.count);

  for (const cand of sorted) {
    const listPath = `/bbs/zboard.php?id=${cand.boardId}&category=${cand.category}&page=1`;
    const listHtml = await getPage(listPath, null, `${UMS_ORIGIN}/`);
    const firstNo = listHtml.match(/no=(\d+)&category=\d+&s_date=/);
    if (!firstNo) continue;

    const viewPath = `/bbs/view.php?id=${cand.boardId}&no=${firstNo[1]}&category=${cand.category}`;
    const viewHtml = await getPage(viewPath, cookie, `${UMS_ORIGIN}${listPath}`);
    if (!isDenied(viewHtml) && viewHtml.includes("목장명")) {
      return cand;
    }
  }
  return null;
}

/** 목장일지 목록 (최근 20건, zboard 기본 페이지당 개수) */
export async function fetchEntryList(boardId: string, category: number, cookie: string): Promise<CellEntrySummary[]> {
  const path = `/bbs/zboard.php?id=${boardId}&category=${category}&page=1`;
  const html = await getPage(path, cookie, `${UMS_ORIGIN}/`);

  const rowRe = /<a href=\.\.\/bbs\/view\.php\?id=\w+&no=(\d+)&category=\d+[^>]*>[\s\S]*?<\/a>\s*<\/td>\s*<td align=center>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*align=center>([^<]*)<\/td>/g;
  const entries: CellEntrySummary[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    entries.push({
      no: parseInt(m[1], 10),
      writer: decodeEntities(m[2]).trim(),
      place: decodeEntities(m[3]).trim(),
      meetingDate: decodeEntities(m[4]).trim(),
    });
  }
  return entries;
}

/** 목장일지 상세 (모임일자/목원명단/상황보고/기도제목 등 라벨:값 통째로) */
export async function fetchEntryDetail(
  boardId: string,
  category: number,
  no: number,
  cookie: string,
): Promise<CellEntryDetail | { denied: true }> {
  const path = `/bbs/view.php?id=${boardId}&no=${no}&category=${category}`;
  const html = await getPage(path, cookie, `${UMS_ORIGIN}/bbs/zboard.php?id=${boardId}&category=${category}`);

  if (isDenied(html)) return { denied: true };

  const headerM = html.match(/목장명\s*:\s*<b>([^<]*)<\/b>/);
  const writerM = html.match(/작성자\s*:\s*<B>([^<]*)<\/B>/i);
  const postedM = html.match(/작성일\s*:\s*([\d.: ]+)/);

  const fieldRe = /<td[^>]*align=center[^>]*>\s*<b>\s*([\s\S]*?)<\/b>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  const fields: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(html))) {
    const label = cleanLabel(m[1]);
    if (label) fields[label] = cleanValue(m[2]);
  }

  return {
    no,
    boardTitle: headerM ? decodeEntities(headerM[1]).trim() : "",
    writer: writerM ? decodeEntities(writerM[1]).trim() : "",
    postedAt: postedM ? postedM[1].trim() : "",
    fields,
  };
}
