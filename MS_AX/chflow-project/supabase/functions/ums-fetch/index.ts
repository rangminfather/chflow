// Supabase Edge Function: UMS board/PDF proxy.
// Vercel server functions can be blocked by ums.or.kr from some regions, so
// app APIs call this proxy for board HTML and PDF downloads.
//
// GET ?action=list&board=samusil|jubo
// GET ?action=post&board=samusil|jubo&no=<number>
// GET ?action=pdf&board=samusil|jubo&no=<number>
// GET ?action=raw_pdf&board=samusil|jubo&path=<pdf-path>

const BOARD_BASE = "http://ums.or.kr/bbs";
const ALLOWED_BOARDS = new Set(["samusil", "jubo"]);

const boardOf = (url: URL) => {
  const board = url.searchParams.get("board") || "samusil";
  return ALLOWED_BOARDS.has(board) ? board : "samusil";
};

const LIST_URL = (board: string) => `${BOARD_BASE}/zboard.php?id=${board}&page=1`;
const POST_URL = (board: string, no: number) => `${BOARD_BASE}/zboard.php?id=${board}&no=${no}`;
const FILE_URL = (board: string, no: number) =>
  `${BOARD_BASE}/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=${board}&no=${no}&filenum=0&snum=0&hit=0`;
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
  const board = boardOf(url);

  try {
    if (action === "list") {
      return await fetchUms(LIST_URL(board));
    }

    if (action === "post") {
      const no = url.searchParams.get("no");
      if (!no || !/^\d+$/.test(no)) {
        return new Response(JSON.stringify({ error: "no is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      return await fetchUms(POST_URL(board, parseInt(no, 10)), `${BOARD_BASE}/zboard.php?id=${board}`);
    }

    if (action === "pdf") {
      const no = url.searchParams.get("no");
      if (!no || !/^\d+$/.test(no)) {
        return new Response(JSON.stringify({ error: "no is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      return await fetchUms(FILE_URL(board, parseInt(no, 10)), POST_URL(board, parseInt(no, 10)));
    }

    if (action === "raw_pdf") {
      const path = url.searchParams.get("path");
      if (!path || !/^[a-zA-Z0-9_./-]+\.pdf$/i.test(path)) {
        return new Response(JSON.stringify({ error: "valid .pdf path required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      return await fetchUms(RAW_PDF_URL(path), `${BOARD_BASE}/zboard.php?id=${board}`);
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
