// Supabase Edge Function: UMS 게시판/PDF 프록시
//
// Vercel(iad1) 함수에서 ums.or.kr 호출 시 일부 IP가 "Access denied"로 차단됨.
// Supabase Edge Function 은 다른 IP 풀에서 실행되므로 우회용으로 사용.
//
// 두 가지 동작:
//   GET ?action=list                -> 게시판 HTML (text)
//   GET ?action=pdf&no=<번호>       -> PDF 바이너리 (application/pdf)

const BOARD_BASE = "http://ums.or.kr/bbs";
const LIST_URL = `${BOARD_BASE}/zboard.php?id=samusil&page=1`;
const FILE_URL = (no: number) =>
  `${BOARD_BASE}/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=samusil&no=${no}&filenum=0&snum=0&hit=0`;

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

async function fetchUms(url: string): Promise<Response> {
  // rate-limit 발생 시 1.5초 대기 후 1회 재시도
  let res = await fetch(url, { headers: BROWSER_HEADERS });
  let buf = new Uint8Array(await res.clone().arrayBuffer());
  if (buf.byteLength < 1000) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await fetch(url, { headers: BROWSER_HEADERS });
    buf = new Uint8Array(await res.clone().arrayBuffer());
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
    if (action === "pdf") {
      const no = url.searchParams.get("no");
      if (!no || !/^\d+$/.test(no)) {
        return new Response(JSON.stringify({ error: "no is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      return await fetchUms(FILE_URL(parseInt(no, 10)));
    }
    return new Response(JSON.stringify({ error: "action=list|pdf" }), {
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
