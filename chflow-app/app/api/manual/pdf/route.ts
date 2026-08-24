import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel env variable: 크로미엄 팩 URL — 버전 업 시 이 값만 교체
const CHROMIUM_PACK_ARCH = process.arch === "arm64" ? "arm64" : "x64";
const CHROMIUM_PACK_URL =
  process.env.CHROMIUM_PACK_URL ??
  `https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.${CHROMIUM_PACK_ARCH}.tar`;

export async function GET(request: NextRequest) {
  const host = request.headers.get("host") ?? "chflow-app.vercel.app";
  const proto = host.includes("localhost") ? "http" : "https";
  const pageUrl = `${proto}://${host}/manual`;

  const isDev = process.env.NODE_ENV === "development";
  const localChrome = process.env.CHROMIUM_EXECUTABLE_PATH;

  if (isDev && !localChrome) {
    return NextResponse.json(
      { error: "로컬 환경: CHROMIUM_EXECUTABLE_PATH 환경변수를 설정해 주세요. (예: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe)" },
      { status: 503 }
    );
  }

  const puppeteer = (await import("puppeteer-core")).default;
  const Chromium = (await import("@sparticuz/chromium-min")).default;

  let browser;
  try {
    const executablePath = localChrome ?? (await Chromium.executablePath(CHROMIUM_PACK_URL));
    browser = await puppeteer.launch({
      args: isDev ? ["--no-sandbox"] : Chromium.args,
      defaultViewport: { width: 1280, height: 900 },
      executablePath,
      headless: "shell",
    });

    const page = await browser.newPage();

    // 인쇄 미디어 타입 먼저 적용 → .print-doc 가시화 + 이미지 사전 로드
    await page.emulateMediaType("print");

    // 매뉴얼 페이지 로드 (manifest 포함 모든 네트워크 완료 대기)
    await page.goto(pageUrl, { waitUntil: "networkidle0", timeout: 30000 });

    // React 가 print-doc 챕터를 렌더링할 때까지 대기
    await page.waitForSelector(".print-chapter", { timeout: 15000 }).catch(() => {});

    // Serverless Chromium에는 기본 한글 글꼴이 없다. next/font 로 제공하는 한글 글꼴이
    // 실제로 내려와 적용된 뒤 PDF를 만들어야 네모/빈 글자로 출력되지 않는다.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    // print-doc 내 모든 이미지 로드 완료 대기
    await page
      .waitForFunction(
        () => {
          const imgs = Array.from(document.querySelectorAll(".print-doc img"));
          return imgs.length === 0 || imgs.every((img) => (img as HTMLImageElement).complete);
        },
        { timeout: 15000 }
      )
      .catch(() => {});

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="manual.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/manual/pdf]", err);
    return NextResponse.json({ error: "PDF 생성 중 오류가 발생했습니다." }, { status: 500 });
  } finally {
    await browser?.close();
  }
}
