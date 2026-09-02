import { NextRequest, NextResponse } from "next/server";
import {
  MAX_BULLETIN_SOURCE_BYTES,
  isBulletinFileLimitError,
  readLimitedResponseBytes,
} from "@/lib/bulletin/attachment-limits";
import {
  isDeptBulletinUrlExpired,
  isDeptBulletinSigningConfigurationError,
  verifyDeptBulletinPostSignature,
} from "@/lib/bulletin/dept-bulletin-signing";
import { normalizeBulletinAttachmentAsPdf } from "@/lib/bulletin/attachment-to-pdf";
import { umsViaCf } from "@/lib/bulletin/ums-via-cf";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
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

async function fetchBuffer(url: string, headers?: HeadersInit) {
  const res = await fetch(url, { cache: "no-store", headers });
  const buf = await readLimitedResponseBytes(res);
  return { ok: res.ok, status: res.status, buf };
}

async function findRawPdfPathFromPost(no: number) {
  const attempts: (
    | { type: "worker"; path: string }
    | { type: "fetch"; url: string; headers?: HeadersInit }
  )[] = [
    { type: "worker", path: `/bbs/zboard.php?id=samusil&no=${no}` },
    { type: "fetch", url: `${PROXY_BASE}?action=post&board=samusil&no=${no}` },
    { type: "fetch", url: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`, headers: BROWSER_HEADERS },
  ];

  for (const attempt of attempts) {
    let html = "";
    if (attempt.type === "worker") {
      const res = await umsViaCf(attempt.path, {
        referer: "http://www.ums.or.kr/",
        maxResponseBytes: MAX_BULLETIN_SOURCE_BYTES,
      });
      if (res.status < 200 || res.status >= 300) continue;
      html = new TextDecoder("euc-kr").decode(res.body);
    } else {
      const res = await fetch(attempt.url, { cache: "no-store", headers: attempt.headers });
      html = new TextDecoder("euc-kr").decode(await res.arrayBuffer());
    }
    const match = html.match(/data\/samusil\/\d+\/[a-f0-9]+__pdf\.jpg/i);
    if (match) return match[0].replace(/__pdf\.jpg$/i, ".pdf");
  }

  return null;
}

async function downloadPdf(no: number) {
  const rawPath = await findRawPdfPathFromPost(no);
  if (rawPath) {
    const workerRaw = await umsViaCf(`/bbs/${rawPath}`, {
      referer: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`,
      maxResponseBytes: MAX_BULLETIN_SOURCE_BYTES,
    });
    if (workerRaw.status >= 200 && workerRaw.status < 300) {
      const normalized = await normalizeBulletinAttachmentAsPdf(workerRaw.body);
      if (normalized) return normalized;
    }

    const raw = await fetchBuffer(`${PROXY_BASE}?action=raw_pdf&board=samusil&path=${encodeURIComponent(rawPath)}`);
    if (raw.ok) {
      const normalized = await normalizeBulletinAttachmentAsPdf(raw.buf);
      if (normalized) return normalized;
    }

    const directRaw = await fetchBuffer(`${UMS_BBS_BASE}/${rawPath}`, {
      ...BROWSER_HEADERS,
      Referer: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`,
    });
    if (directRaw.ok) {
      const normalized = await normalizeBulletinAttachmentAsPdf(directRaw.buf);
      if (normalized) return normalized;
    }
  }

  const downloaded = await fetchBuffer(`${PROXY_BASE}?action=pdf&board=samusil&no=${no}`);
  if (downloaded.ok) {
    const normalized = await normalizeBulletinAttachmentAsPdf(downloaded.buf);
    if (normalized) return normalized;
  }

  const directDownloaded = await fetchBuffer(
    `${UMS_BBS_BASE}/skin/PSM_Revolution_DragDrop_board_domi_t_reply_comment/m_download.php?id=samusil&no=${no}&filenum=0&snum=0&hit=0`,
    {
      ...BROWSER_HEADERS,
      Referer: `${UMS_BBS_BASE}/zboard.php?id=samusil&no=${no}`,
    },
  );
  if (directDownloaded.ok) {
    const normalized = await normalizeBulletinAttachmentAsPdf(directDownloaded.buf);
    if (normalized) return normalized;
  }

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
    if (isDeptBulletinUrlExpired(expiresAt)) {
      return NextResponse.json({ ok: false, error: "PDF URL expired" }, { status: 401 });
    }
    if (!verifyDeptBulletinPostSignature(no, expiresAt, sig)) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    const pdf = await downloadPdf(no);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="dept-bulletin-${no}.pdf"`,
      },
    });
  } catch (e) {
    if (isDeptBulletinSigningConfigurationError(e)) {
      return NextResponse.json(
        { ok: false, error: "Bulletin file service unavailable" },
        { status: 503 },
      );
    }
    if (isBulletinFileLimitError(e)) {
      console.warn(`[dept-bulletin-pdf] rejected attachment (${e.code})`);
      return NextResponse.json(
        { ok: false, error: "Attachment exceeds the allowed processing limits" },
        { status: 413 },
      );
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "PDF 불러오기 실패" },
      { status: 502 },
    );
  }
}
