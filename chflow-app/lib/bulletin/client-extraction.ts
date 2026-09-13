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

async function request(url: string, token: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
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
      const result = await worker.recognize(source);
      text = result.data.text.trim();
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
