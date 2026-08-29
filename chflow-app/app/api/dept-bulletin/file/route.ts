import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import * as CFB from "cfb";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";
import { parseHwpBlocks } from "@/lib/bulletin/hwp-parse";
import { extractHwpxPreview, parseHwpxBlocks } from "@/lib/bulletin/hwpx-parse";
import { r2 } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

// UMS samusil 첨부파일 프록시 — 부서 주보 파일 유형 표준 체계의 서버측.
// 부서마다 PDF/PPTX/HWP/이미지로 올려도 클라이언트 뷰어가 이 라우트 하나로 대응한다.
//  - as=raw         : 원본 파일 그대로 (다운로드 / pptx·이미지 렌더링용)
//  - as=hwp-preview : HWP 내장 첫 페이지 미리보기 이미지(PrvImage) 추출
//  - as=hwp-json    : HWP 본문 구조(문단/표) JSON — 리메이크 렌더링용
//  - fn=N           : 첨부파일 번호 (기본 0, 여러 첨부 중 선택)
// 서명 방식은 /api/dept-bulletin/pdf 와 동일 (samusil:no:exp HMAC).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SIGNING_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON_KEY;
const PROXY_BASE = `${SUPABASE_URL}/functions/v1/ums-fetch`;
// 저장본 모드에서 읽을 수 있는 범위 — bulletins 버킷의 부서 주보 폴더로 한정
const STORAGE_BUCKET = "bulletins";
const STORAGE_PATH_RE = /^dept\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/;
const UMS_BBS_BASE = "http://ums.or.kr/bbs";
const DOWNLOAD_PATH = (no: number, fn: number) =>
  `/bbs/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=samusil&no=${no}&filenum=${fn}&snum=0&hit=0`;

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

// 저장본(R2) 경로 서명 — /api/dept-bulletin/latest 의 signStoragePath 와 같은 규칙
function signStorage(path: string, expiresAt: number) {
  return createHmac("sha256", SIGNING_SECRET).update(`storage:${path}:${expiresAt}`).digest("hex");
}

function matchesSignature(expected: string, sig: string) {
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(sig, "hex");
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

function validSignature(no: number, expiresAt: number, sig: string) {
  return matchesSignature(sign(no, expiresAt), sig);
}

// 받은 바이트가 파일인지 (에러 HTML 페이지가 아닌지) 판별
function looksLikeFile(buf: Uint8Array) {
  if (buf.byteLength < 1000) return false;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 256)).trimStart().toLowerCase();
  return !head.startsWith("<!doctype") && !head.startsWith("<html") && !head.startsWith("<script");
}

function detectContentType(buf: Uint8Array, fileName: string | null) {
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45) return "image/webp";
  const ext = fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    if (ext === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    if (ext === "hwpx") return "application/vnd.hancom.hwpx";
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

async function downloadAttachment(no: number, fn: number): Promise<Uint8Array> {
  const worker = await umsViaCf(DOWNLOAD_PATH(no, fn), {
    referer: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`,
  });
  if (worker.status >= 200 && worker.status < 300 && looksLikeFile(worker.body)) return worker.body;

  if (fn === 0) {
    const proxied = await fetchBuffer(`${PROXY_BASE}?action=pdf&board=samusil&no=${no}`);
    if (proxied.ok && looksLikeFile(proxied.buf)) return proxied.buf;
  }

  const direct = await fetchBuffer(`http://www.ums.or.kr${DOWNLOAD_PATH(no, fn)}`, {
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

function isZipFile(buf: Uint8Array) {
  return buf[0] === 0x50 && buf[1] === 0x4b;
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
    const storagePath = url.searchParams.get("path");
    const fn = Number(url.searchParams.get("fn") || "0");

    if (!Number.isInteger(expiresAt) || expiresAt <= 0 || !/^[0-9a-f]{64}$/i.test(sig)) {
      return NextResponse.json({ ok: false, error: "Invalid file URL" }, { status: 400 });
    }
    if (expiresAt < Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ ok: false, error: "File URL expired" }, { status: 401 });
    }

    // 저장본(R2) 모드 — UMS 원본이 아니라 이미 수집해 둔 부서 주보 파일을 읽는다.
    // hwp/hwpx 저장본도 as=hwp-json / as=hwp-preview 가공을 받게 하려는 용도.
    let file: Uint8Array;
    let fileName = url.searchParams.get("name");
    if (storagePath) {
      if (!STORAGE_PATH_RE.test(storagePath)) {
        return NextResponse.json({ ok: false, error: "Invalid file URL" }, { status: 400 });
      }
      if (!matchesSignature(signStorage(storagePath, expiresAt), sig)) {
        return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
      }
      const { data, error } = await r2.from(STORAGE_BUCKET).getObject(storagePath);
      if (error || !data) {
        return NextResponse.json({ ok: false, error: "저장된 주보 파일을 찾지 못했습니다" }, { status: 404 });
      }
      file = new Uint8Array(data.body);
      fileName = fileName || storagePath.split("/").pop() || null;
    } else {
      if (!Number.isInteger(fn) || fn < 0 || fn > 20) {
        return NextResponse.json({ ok: false, error: "Invalid file URL" }, { status: 400 });
      }
      if (!Number.isInteger(no) || no <= 0) {
        return NextResponse.json({ ok: false, error: "Invalid file URL" }, { status: 400 });
      }
      if (!validSignature(no, expiresAt, sig)) {
        return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
      }
      file = await downloadAttachment(no, fn);
    }

    if (as === "hwp-preview") {
      const preview = isZipFile(file) ? await extractHwpxPreview(file) : extractHwpPreview(file);
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

    if (as === "hwp-json") {
      try {
        const blocks = isZipFile(file)
          ? await parseHwpxBlocks(file)
          : parseHwpBlocks(Buffer.from(file));
        if (blocks.length === 0) throw new Error("empty");
        return NextResponse.json(
          { ok: true, blocks },
          { headers: { "Cache-Control": "private, max-age=600" } },
        );
      } catch {
        return NextResponse.json({ ok: false, error: "HWP 본문을 해석하지 못했습니다" }, { status: 422 });
      }
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
