"use client";

import type { DeptBulletinFields } from "@/lib/bulletin/dept-bulletin-fields";

export type CommonBulletinFieldsResult = {
  status: "ready" | "missing" | "error";
  fields: DeptBulletinFields;
  method?: "native" | "ocr";
  fileUrl?: string;
  error?: string;
};

type ExtractionPayload = {
  ok: boolean;
  status: "ready" | "missing" | "ocr_required";
  fields?: DeptBulletinFields;
  method?: "native" | "ocr";
  bulletin?: { id: string };
  file_url?: string;
  error?: string;
};

export type CommonBulletinAvailability = "stored" | "missing" | "error";

/**
 * 글자층이 없는 PDF 를 OCR 하려면 쪽을 먼저 그림으로 그려야 한다.
 * tesseract 는 PDF 를 못 읽고 이미지만 받는다.
 * 예배순서는 앞쪽에 있으므로 앞 몇 쪽만 본다 (전 쪽을 돌리면 너무 느리다).
 */
async function renderPdfPages(blob: Blob, maxPages = 3): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const canvases: HTMLCanvasElement[] = [];
  for (let pageNo = 1; pageNo <= Math.min(doc.numPages, maxPages); pageNo++) {
    const page = await doc.getPage(pageNo);
    // 원본 크기로 그리면 한글 인식률이 크게 떨어져 2배로 키운다
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

async function request(url: string, token: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

/**
 * Checks only the common stored-bulletin cache.  It deliberately never triggers
 * an UMS request, so the journal can explain which source will be used first.
 */
export async function checkCommonBulletinAvailability(
  token: string,
  deptKey: string,
  issueDate: string,
): Promise<CommonBulletinAvailability> {
  try {
    const query = new URLSearchParams({ dept: deptKey, date: issueDate, sync: "0" });
    const response = await request(`/api/dept-bulletin/extraction?${query}`, token, { cache: "no-store" });
    const payload = await response.json() as ExtractionPayload;
    if (!response.ok || !payload.ok) return "error";
    return payload.status === "missing" ? "missing" : "stored";
  } catch {
    return "error";
  }
}

/**
 * 파일 형식에 관계없이 공통 예배 필드를 읽는 진입점.
 * 이미지만 브라우저의 WebAssembly OCR로 처리하고, 결과는 서버에 한 번만 저장한다.
 */
export async function readCommonBulletinFields(
  token: string,
  deptKey: string,
  issueDate: string,
  onOcrProgress?: (progress: number) => void,
): Promise<CommonBulletinFieldsResult> {
  try {
    const query = new URLSearchParams({ dept: deptKey, date: issueDate });
    let response = await request(`/api/dept-bulletin/extraction?${query}`, token, { cache: "no-store" });
    let payload = await response.json() as ExtractionPayload;
    if (!response.ok || !payload.ok) return { status: "error", fields: {}, error: payload.error || "주보 파싱 실패" };
    if (payload.status === "missing") return { status: "missing", fields: {} };
    if (payload.status === "ready") return { status: "ready", fields: payload.fields || {}, method: payload.method, fileUrl: payload.file_url };
    if (!payload.bulletin?.id || !payload.file_url) return { status: "error", fields: {}, error: "OCR 원본을 찾지 못했습니다." };

    const { createWorker } = await import("tesseract.js");
    const isPdf = /\.pdf(?:\?|$)/i.test(payload.file_url);
    // 주보 파일 저장소는 인증 헤더가 필요하다. URL만 OCR 워커에 넘기면
    // 워커가 인증 없이 요청해 401이 나므로, 먼저 인증된 Blob으로 받아 인식한다.
    const sourceResponse = await request(payload.file_url, token, { cache: "no-store" });
    if (!sourceResponse.ok) return { status: "error", fields: {}, error: "OCR 주보 원본을 불러오지 못했습니다." };
    const source = await sourceResponse.blob();
    const worker = await createWorker(["kor", "eng"], 1, {
      logger: (message) => {
        if (message.status === "recognizing text") onOcrProgress?.(Math.round(message.progress * 100));
      },
    });
    let text = "";
    try {
      if (isPdf) {
        const pages = await renderPdfPages(source);
        const parts: string[] = [];
        for (const page of pages) {
          const result = await worker.recognize(page);
          parts.push(result.data.text.trim());
        }
        text = parts.filter(Boolean).join("\n");
      } else {
        const result = await worker.recognize(source);
        text = result.data.text.trim();
      }
    } finally {
      await worker.terminate();
    }
    if (!text) return { status: "error", fields: {}, error: "주보 이미지에서 글자를 인식하지 못했습니다." };

    response = await request("/api/dept-bulletin/extraction", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bulletin_id: payload.bulletin.id, text }),
    });
    payload = await response.json() as ExtractionPayload;
    if (!response.ok || !payload.ok || payload.status !== "ready") {
      return { status: "error", fields: {}, error: payload.error || "OCR 결과 저장 실패" };
    }
    return { status: "ready", fields: payload.fields || {}, method: "ocr", fileUrl: payload.file_url };
  } catch (error) {
    return { status: "error", fields: {}, error: error instanceof Error ? error.message : "주보 파싱 실패" };
  }
}
