import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SIGNING_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON_KEY;
const PROXY_BASE = `${SUPABASE_URL}/functions/v1/ums-fetch`;
const UMS_BBS_BASE = "http://ums.or.kr/bbs";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Referer": "http://www.ums.or.kr/",
} as const;

function sign(no: number, expiresAt: number) {
  return createHmac("sha256", SIGNING_SECRET).update(`samusil:${no}:${expiresAt}`).digest("hex");
}

function validSignature(no: number, expiresAt: number, sig: string) {
  const expected = sign(no, expiresAt);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(sig, "hex");
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

function isPdf(buf: Uint8Array) {
  return buf.byteLength > 1000 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

async function fetchBuffer(url: string, headers?: HeadersInit) {
  const res = await fetch(url, { cache: "no-store", headers });
  const buf = new Uint8Array(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, buf };
}

async function findRawPdfPathFromPost(no: number) {
  const attempts = [
    { url: `${PROXY_BASE}?action=post&board=samusil&no=${no}` },
    { url: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`, headers: BROWSER_HEADERS },
  ];

  for (const attempt of attempts) {
    const res = await fetch(attempt.url, { cache: "no-store", headers: attempt.headers });
    const html = new TextDecoder("euc-kr").decode(await res.arrayBuffer());
    const match = html.match(/data\/samusil\/\d+\/[a-f0-9]+__pdf\.jpg/i);
    if (match) return match[0].replace(/__pdf\.jpg$/i, ".pdf");
  }

  return null;
}

async function downloadPdf(no: number) {
  const rawPath = await findRawPdfPathFromPost(no);
  if (rawPath) {
    const raw = await fetchBuffer(`${PROXY_BASE}?action=raw_pdf&board=samusil&path=${encodeURIComponent(rawPath)}`);
    if (raw.ok && isPdf(raw.buf)) return raw.buf;

    const directRaw = await fetchBuffer(`${UMS_BBS_BASE}/${rawPath}`, {
      ...BROWSER_HEADERS,
      Referer: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`,
    });
    if (directRaw.ok && isPdf(directRaw.buf)) return directRaw.buf;
  }

  const downloaded = await fetchBuffer(`${PROXY_BASE}?action=pdf&board=samusil&no=${no}`);
  if (downloaded.ok && isPdf(downloaded.buf)) return downloaded.buf;

  const directDownloaded = await fetchBuffer(
    `${UMS_BBS_BASE}/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=samusil&no=${no}&filenum=0&snum=0&hit=0`,
    {
      ...BROWSER_HEADERS,
      Referer: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`,
    },
  );
  if (directDownloaded.ok && isPdf(directDownloaded.buf)) return directDownloaded.buf;

  throw new Error(`PDF 다운로드 실패: ${downloaded.status}/${directDownloaded.status}`);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const no = Number(url.searchParams.get("no") || "0");
    const expiresAt = Number(url.searchParams.get("exp") || "0");
    const sig = url.searchParams.get("sig") || "";

    if (!Number.isInteger(no) || no <= 0 || !Number.isInteger(expiresAt) || expiresAt <= 0 || !/^[0-9a-f]{64}$/i.test(sig)) {
      return NextResponse.json({ ok: false, error: "Invalid PDF URL" }, { status: 400 });
    }
    if (expiresAt < Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ ok: false, error: "PDF URL expired" }, { status: 401 });
    }
    if (!validSignature(no, expiresAt, sig)) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    const pdf = await downloadPdf(no);
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="dept-bulletin-${no}.pdf"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "PDF 불러오기 실패" },
      { status: 502 },
    );
  }
}
