import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import * as CFB from "cfb";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

// UMS samusil 첨부파일 프록시.
// 부서 주보가 PDF 가 아닌 경우(초등2부 hwp, 유치부·청소년부 pptx)를 위한 라우트.
//  - as=raw         : 원본 파일 그대로 (다운로드/클라이언트 pptx 렌더링용)
//  - as=hwp-preview : HWP 내장 첫 페이지 미리보기 이미지(PrvImage) 추출
// 서명 방식은 /api/dept-bulletin/pdf 와 동일 (samusil:no:exp HMAC).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SIGNING_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON_KEY;
const PROXY_BASE = `${SUPABASE_URL}/functions/v1/ums-fetch`;
const UMS_BBS_BASE = "http://ums.or.kr/bbs";
const DOWNLOAD_PATH = (no: number) =>
  `/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=samusil&no=${no}&filenum=0&snum=0&hit=0`;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "*/*",
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

// 받은 바이트가 파일인지 (에러 HTML 페이지가 아닌지) 판별
function looksLikeFile(buf: Uint8Array) {
  if (buf.byteLength < 1000) return false;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 256)).trimStart().toLowerCase();
  return !head.startsWith("<!doctype") && !head.startsWith("<html") && !head.startsWith("<script");
}

function detectContentType(buf: Uint8Array, fileName: string | null) {
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  const ext = fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    if (ext === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    return "application/zip";
  }
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    if (ext === "hwp") return "application/x-hwp";
    return "application/x-ole-storage";
  }
  return "application/octet-stream";
}

async function fetchBuffer(url: string, headers?: HeadersInit) {
  const res = await fetch(url, { cache: "no-store", headers });
  const buf = new Uint8Array(await res.arrayBuffer());
  return { ok: res.ok, buf };
}

async function downloadAttachment(no: number): Promise<Uint8Array> {
  const worker = await umsViaCf(DOWNLOAD_PATH(no), {
    referer: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`,
  });
  if (worker.status >= 200 && worker.status < 300 && looksLikeFile(worker.body)) return worker.body;

  const proxied = await fetchBuffer(`${PROXY_BASE}?action=pdf&board=samusil&no=${no}`);
  if (proxied.ok && looksLikeFile(proxied.buf)) return proxied.buf;

  const direct = await fetchBuffer(`http://www.ums.or.kr${DOWNLOAD_PATH(no)}`, {
    ...BROWSER_HEADERS,
    Referer: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`,
  });
  if (direct.ok && looksLikeFile(direct.buf)) return direct.buf;

  throw new Error("첨부파일 다운로드 실패");
}

// HWP 5.x(OLE) 내장 첫 페이지 미리보기 이미지 추출
function extractHwpPreview(buf: Uint8Array): { image: Uint8Array; contentType: string } | null {
  try {
    const cfb = CFB.read(Buffer.from(buf), { type: "buffer" });
    const entry = CFB.find(cfb, "PrvImage");
    if (!entry || !entry.content || entry.content.length < 100) return null;
    const image = new Uint8Array(entry.content as Buffer);
    const contentType =
      image[0] === 0x89 && image[1] === 0x50 ? "image/png"
      : image[0] === 0xff && image[1] === 0xd8 ? "image/jpeg"
      : image[0] === 0x42 && image[1] === 0x4d ? "image/bmp"
      : null;
    return contentType ? { image, contentType } : null;
  } catch {
    return null;
  }
}

function contentDisposition(fileName: string | null, no: number) {
  const fallback = `dept-bulletin-${no}`;
  if (!fileName) return `attachment; filename="${fallback}"`;
  const safeAscii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const no = Number(url.searchParams.get("no") || "0");
    const expiresAt = Number(url.searchParams.get("exp") || "0");
    const sig = url.searchParams.get("sig") || "";
    const as = url.searchParams.get("as") || "raw";
    const fileName = url.searchParams.get("name");

    if (!Number.isInteger(no) || no <= 0 || !Number.isInteger(expiresAt) || expiresAt <= 0 || !/^[0-9a-f]{64}$/i.test(sig)) {
      return NextResponse.json({ ok: false, error: "Invalid file URL" }, { status: 400 });
    }
    if (expiresAt < Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ ok: false, error: "File URL expired" }, { status: 401 });
    }
    if (!validSignature(no, expiresAt, sig)) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    const file = await downloadAttachment(no);

    if (as === "hwp-preview") {
      const preview = extractHwpPreview(file);
      if (!preview) {
        return NextResponse.json({ ok: false, error: "미리보기 이미지가 없습니다" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(preview.image), {
        headers: {
          "Content-Type": preview.contentType,
          "Cache-Control": "private, max-age=600",
        },
      });
    }

    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": detectContentType(file, fileName),
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDisposition(fileName, no),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "첨부파일 불러오기 실패" },
      { status: 502 },
    );
  }
}
