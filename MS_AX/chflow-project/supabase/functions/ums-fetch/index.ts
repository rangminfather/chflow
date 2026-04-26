// Supabase Edge Function: UMS 게시판/PDF 프록시
//
// Vercel(iad1) 함수에서 ums.or.kr 호출 시 일부 IP가 "Access denied"로 차단됨.
// Supabase Edge Function 은 다른 IP 풀에서 실행되므로 우회용으로 사용.
//
// 동작:
//   GET ?action=list                -> 게시판 HTML (text)
//   GET ?action=post&no=<번호>      -> 게시글 본문 HTML (text)
//   GET ?action=pdf&no=<번호>       -> PDF 바이너리 (m_download.php 경유, 차단 가능)
//   GET ?action=raw_pdf&path=<경로> -> 정적 PDF 직접 (m_download.php 우회용)

const BOARD_BASE = "http://ums.or.kr/bbs";
const LIST_URL = `${BOARD_BASE}/zboard.php?id=samusil&page=1`;
const POST_URL = (no: number) => `${BOARD_BASE}/zboard.php?id=samusil&no=${no}`;
const FILE_URL = (no: number) =>
  `${BOARD_BASE}/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=samusil&no=${no}&filenum=0&snum=0&hit=0`;
const RAW_PDF_URL = (path: string) => `${BOARD_BASE}/${path.replace(/^\/+/, "")}`;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Referer": "http://ums.or.kr/",
} as const;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 검증 결과 ums.or.kr 이 같은 IP에서 첫 요청 일부를 "Access denied"(14자) 로 막고
// 짧은 시간 안에 재시도하면 통과시키는 패턴이 있음. 응답이 1000자 미만이면
// 최대 5회까지 점진적 백오프로 재시도.
async function fetchUms(url: string, refererOverride?: string): Promise<Response> {
  const headers = refererOverride
    ? { ...BROWSER_HEADERS, Referer: refererOverride }
    : BROWSER_HEADERS;

  let res!: Response;
  let buf = new Uint8Array(0);
  for (let i = 0; i < 5; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 600 * i));
    res = await fetch(url, { headers });
    buf = new Uint8Array(await res.clone().arrayBuffer());
    if (buf.byteLength > 1000 && res.status < 400) break;
  }
  return new Response(buf, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") || "application/octet-stream",
      ...CORS,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "list") {
      return await fetchUms(LIST_URL);
    }
    if (action === "post") {
      const no = url.searchParams.get("no");
      if (!no || !/^\d+$/.test(no)) {
        return new Response(JSON.stringify({ error: "no is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      return await fetchUms(POST_URL(parseInt(no, 10)), `${BOARD_BASE}/zboard.php?id=samusil`);
    }
    if (action === "pdf") {
      const no = url.searchParams.get("no");
      if (!no || !/^\d+$/.test(no)) {
        return new Response(JSON.stringify({ error: "no is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      // m_download.php 호출 시 게시글 페이지를 referer 로 — 일부 호스팅의 hotlink 검증 통과용
      return await fetchUms(FILE_URL(parseInt(no, 10)), POST_URL(parseInt(no, 10)));
    }
    if (action === "raw_pdf") {
      const path = url.searchParams.get("path");
      if (!path || !/^[a-zA-Z0-9_./-]+\.pdf$/i.test(path)) {
        return new Response(JSON.stringify({ error: "valid .pdf path required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      return await fetchUms(RAW_PDF_URL(path), `${BOARD_BASE}/zboard.php?id=samusil`);
    }
    return new Response(JSON.stringify({ error: "action=list|post|pdf|raw_pdf" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
