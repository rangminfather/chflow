// UMS 설교 게시판 → 지난 말씀 목록 동기화.
//
// UMS 는 로그인해야 영상 주소를 내려준다. 로그인 상태로 게시판 목록 페이지를 받으면
// 페이지 안에 video.js 용 `var playlist = [...]` 배열이 있고, 여기에 필요한 값이 다 있다:
//   zb_no / title / vod_link / image / description('본문 | 설교자 | 날짜 | 조회수') / bible
//
// 주의
//  - 페이지 인코딩은 EUC-KR 이다.
//  - Referer 헤더가 없으면 본문 대신 리다이렉트 스크립트만 온다.
//  - 영상 파일 자체는 인증이 필요 없다(주소만 알면 받아진다). 로그인은 주소 획득용.

import iconv from "iconv-lite";
import type { SupabaseClient } from "@supabase/supabase-js";

const UMS_ORIGIN = "http://www.ums.or.kr";
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "accept-language": "ko-KR,ko;q=0.9",
};

/** 화면 탭 순서와 이름 */
export const SERMON_BOARDS = [
  { id: "sermon_am", label: "주일오전" },
  { id: "sermon_pm", label: "주일오후" },
  { id: "sermon_pm3", label: "청년오후" },
  { id: "sermon_wed", label: "수요저녁" },
  { id: "sermon_event", label: "집회·세미나" },
] as const;

export type SermonRow = {
  board: string;
  post_no: number;
  title: string;
  preacher: string | null;
  bible: string | null;
  preached_on: string | null;
  video_path: string;
  thumb_path: string | null;
  byte_size: number | null;
};

function setCookiesFrom(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const multi = h.getSetCookie?.();
  if (multi && multi.length) return multi;
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/** UMS 로그인 → 쿠키 헤더 문자열 */
async function login(userId: string, password: string): Promise<string> {
  const params = new URLSearchParams({
    s_url: "/main/main.php",
    user_id: userId.replace(/^umsorkr_/, ""),
    password,
    group_no: "1",
  });

  const res = await fetch(`${UMS_ORIGIN}/bbs/login_check.php`, {
    method: "POST",
    cache: "no-store",
    redirect: "manual",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${UMS_ORIGIN}/bbs/login.php?id=jubo`,
    },
    body: params.toString(),
  });

  const cookie = setCookiesFrom(res)
    .map((c) => c.split(";")[0])
    .join("; ");

  if (!/PHPSESSID=/.test(cookie) || !/login_1st=/.test(cookie)) {
    throw new Error("UMS 로그인 실패 (계정 정보를 확인해 주세요)");
  }
  return cookie;
}

async function fetchBoard(board: string, cookie: string): Promise<string> {
  const res = await fetch(`${UMS_ORIGIN}/bbs/zboard.php?id=${encodeURIComponent(board)}&page=1`, {
    cache: "no-store",
    headers: { ...BROWSER_HEADERS, Cookie: cookie, Referer: `${UMS_ORIGIN}/` },
  });
  if (!res.ok) throw new Error(`UMS 응답 ${res.status}`);
  return iconv.decode(Buffer.from(await res.arrayBuffer()), "euc-kr");
}

/** '(7/19) 제목' · '7월 26일 제목' 처럼 앞에 붙은 날짜를 뗀다 (날짜는 따로 보여준다) */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^\(\s*\d{1,2}\s*[/.]\s*\d{1,2}\s*\)\s*/, "")
    .replace(/^\d{1,2}\s*월\s*\d{1,2}\s*일\s*/, "")
    .trim();
}

/** 파일명의 `2026_0726` 으로 날짜를 만든다. 실패 시 description 의 날짜를 쓴다. */
function dateFrom(videoPath: string, description: string): string | null {
  const f = videoPath.match(/\/(\d{4})_(\d{2})(\d{2})_/);
  if (f) return `${f[1]}-${f[2]}-${f[3]}`;
  const d = description.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return d ? `${d[1]}-${d[2]}-${d[3]}` : null;
}

const pick = (src: string, re: RegExp): string | null => {
  const m = src.match(re);
  return m ? m[1] : null;
};

/** 게시판 HTML 의 playlist 배열을 구조화한다 */
export function parseSermons(board: string, html: string): SermonRow[] {
  const start = html.indexOf("var playlist");
  if (start < 0) return [];
  // playlist 배열 뒤에 다른 스크립트가 이어지므로 넉넉히 자른 뒤 항목 단위로 쪼갠다
  const region = html.slice(start, start + 40000);
  const chunks = region.split(/\{\s*zb_no\s*:/).slice(1);

  const rows: SermonRow[] = [];
  for (const chunk of chunks) {
    const postNo = pick(chunk, /^\s*'(\d+)'/);
    const videoPath = pick(chunk, /vod_link\s*:\s*'([^']+\.mp4)'/);
    const rawTitle = pick(chunk, /title\s*:\s*'((?:[^'\\]|\\.)*)'/);
    if (!postNo || !videoPath || !rawTitle) continue;

    const description = (pick(chunk, /description\s*:\s*'((?:[^'\\]|\\.)*)'/) ?? "")
      .replace(/<[^>]+>/g, "|");
    const parts = description.split("|").map((s) => s.trim()).filter(Boolean);
    // description 예: '출애굽기 22:10~20 | 김종혁목사 | 2026.07.26 | 조회수 125'
    const preacher = parts.find((s) => /목사|전도사|장로|선교사|강도사/.test(s)) ?? null;

    rows.push({
      board,
      post_no: Number(postNo),
      title: cleanTitle(rawTitle.replace(/\\'/g, "'")),
      preacher,
      bible: pick(chunk, /bible\s*:\s*'((?:[^'\\]|\\.)*)'/)?.replace(/<[^>]+>/g, "").trim() || null,
      preached_on: dateFrom(videoPath, description),
      video_path: videoPath,
      // image 값은 `_adress + "/vod/2026/..."` 형태다. video_path 와 형식을 맞추기 위해
      // 앞의 /vod 를 떼고 저장한다 (프록시가 /thumb + 경로 로 조립하기 때문).
      thumb_path:
        pick(chunk, /image\s*:\s*_adress\s*\+\s*"([^"?]+)/)?.replace(/^\/vod(?=\/)/, "") ?? null,
      byte_size: null,
    });
  }
  return rows;
}

/** VOD 파일 크기 조회 (모바일 데이터 안내용). 실패하면 null 로 둔다. */
async function headSize(vodBase: string, videoPath: string): Promise<number | null> {
  try {
    const res = await fetch(`${vodBase}${videoPath}`, {
      method: "HEAD",
      headers: BROWSER_HEADERS,
      cache: "no-store",
    });
    const len = Number(res.headers.get("content-length") || 0);
    return len > 0 ? len : null;
  } catch {
    return null;
  }
}

export const VOD_BASE = "http://pens02.psmvod.kr/encoding/umsorkr/vod";

export type SyncResult = {
  board: string;
  found: number;
  saved: number;
  error?: string;
};

/**
 * 5개 게시판을 훑어 sermon_archive 를 갱신한다.
 * 한 게시판이 실패해도 나머지는 계속 진행한다.
 */
export async function syncSermons(
  admin: SupabaseClient,
  creds: { userId: string; password: string },
  opts: { withSize?: boolean } = {}
): Promise<SyncResult[]> {
  const cookie = await login(creds.userId, creds.password);
  const results: SyncResult[] = [];

  for (const { id } of SERMON_BOARDS) {
    try {
      const rows = parseSermons(id, await fetchBoard(id, cookie));
      if (opts.withSize !== false) {
        // 크기 조회는 게시판당 최신 몇 건만 (매번 전부 HEAD 를 날릴 이유가 없다)
        for (const row of rows.slice(0, 3)) {
          row.byte_size = await headSize(VOD_BASE, row.video_path);
        }
      }
      if (rows.length > 0) {
        const { error } = await admin
          .from("sermon_archive")
          .upsert(rows.map((r) => ({ ...r, synced_at: new Date().toISOString() })), {
            onConflict: "board,post_no",
          });
        if (error) throw new Error(error.message);
      }
      results.push({ board: id, found: rows.length, saved: rows.length });
    } catch (err) {
      results.push({
        board: id,
        found: 0,
        saved: 0,
        error: err instanceof Error ? err.message : "동기화 실패",
      });
    }
  }
  return results;
}
