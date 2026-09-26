import { BULLETIN_SERVICE_TYPES, splitScriptureReferences, type BulletinServiceType } from "./scripture-parser";

// 주보 1쪽 이미지를 Gemini 로 판독해 예배별 성경봉독 본문을 읽는다.
// 명성교회 주보 PDF 는 글자가 벡터 곡선이라 글자층이 0자다 — 텍스트 추출은 불가능하고
// Tesseract 는 음영 셀인 주일 봉독 행을 통째로 놓친다(2026-09-26 11주 실측 49%).
// PDF 를 그대로 보내면 Gemini 내부 해상도가 낮아 칸을 헷갈리므로 300dpi PNG 로 보낸다.

export type ScriptureSlots = Record<BulletinServiceType, string[]>;

export type ModelReading =
  | { model: string; ok: true; slots: ScriptureSlots }
  | { model: string; ok: false; error: string; retryable: boolean };

/** 두 모델이 교차 확인하므로 기본 2개 + 과부하 시 대체 모델. 모델 교체는 코드 수정 없이 env 로. */
export function scriptureModels(): string[] {
  const configured = (process.env.GEMINI_SCRIPTURE_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  // 순서 = 우선순위. 2026-09-27 운영 실측에서 3.5-flash 는 35초 무응답이 잦아 맨 뒤로 뺐다.
  return configured.length ? configured : ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash"];
}

const PROMPT = `이 이미지는 한국 교회 주보 1쪽입니다. 예배 순서표에서 "성경봉독" 본문을 읽어 JSON으로 답하세요.
- 위쪽 주일 표의 열은 1부, 2부, 3부, 오후(온세대연합 오후찬양예배) 입니다. "성경봉독/강론" 행에서 각 열에 해당하는 성경 본문을 넣으세요. 한 칸이 여러 열에 걸쳐 있으면 걸친 모든 열에 같은 본문을 넣습니다. 칸의 가로 경계를 위쪽 1부·2부·3부·오후 머리글과 맞춰 보세요.
- 아래쪽 "수요오전예배", "수요저녁예배" 칸의 "성경및강론" 괄호 안 본문을 넣으세요. 예배가 없거나 본문이 없으면 null.
- 형식: 개역개정 성경 책 이름 전체(약어 금지, 예: 딤후→디모데후서) + 공백 + 장:절 또는 장:절-절. 예: "출애굽기 23:14-19", "역대하 7:14".
- 본문이 여러 개면 쉼표로 구분. (구P117) 같은 쪽수, 설교 제목, 설교자는 빼세요.
- 보이는 글자만 옮기고 추측하지 마세요.`;

const SLOT_FIELDS: Record<BulletinServiceType, string> = {
  sunday_1: "sunday_1",
  sunday_2: "sunday_2",
  sunday_3: "sunday_3",
  sunday_afternoon: "sunday_afternoon",
  wednesday_morning: "wednesday_morning",
  wednesday_evening: "wednesday_evening",
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: Object.fromEntries(Object.values(SLOT_FIELDS).map((field) => [field, { type: "STRING", nullable: true }])),
  required: Object.values(SLOT_FIELDS),
};

export function parseModelSlots(json: unknown): ScriptureSlots {
  const value = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return Object.fromEntries(BULLETIN_SERVICE_TYPES.map((slot) => {
    const raw = value[SLOT_FIELDS[slot]];
    return [slot, typeof raw === "string" ? splitScriptureReferences(raw) : []];
  })) as ScriptureSlots;
}

export async function readScriptureWithGemini(model: string, png: Buffer, timeoutMs: number): Promise<ModelReading> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { model, ok: false, error: "GEMINI_API_KEY 가 설정되지 않았습니다.", retryable: false };
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: "image/png", data: png.toString("base64") } }, { text: PROMPT }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0 },
      }),
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (!response.ok) {
      // 503 과부하·429 한도 초과·5xx 는 다음 cron 에서 다시 시도할 가치가 있다.
      const retryable = response.status === 429 || response.status >= 500;
      return { model, ok: false, error: `${response.status} ${payload.error?.message?.slice(0, 160) || "Gemini 오류"}`, retryable };
    }
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    return { model, ok: true, slots: parseModelSlots(JSON.parse(text)) };
  } catch (error) {
    return { model, ok: false, error: error instanceof Error ? error.message : "Gemini 호출 실패", retryable: true };
  }
}

/** 주보 PDF 1쪽을 300dpi PNG 로. pdfjs-dist 의 Node 빌드가 @napi-rs/canvas(선택 의존성)로 그린다. */
export async function renderBulletinFirstPage(pdf: Uint8Array): Promise<Buffer> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: pdf });
  const document = await task.promise;
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 300 / 72 });
    const factory = (document as unknown as { canvasFactory: { create: (w: number, h: number) => { canvas: unknown; context: unknown } } }).canvasFactory;
    const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas, canvasContext: context, viewport } as unknown as Parameters<typeof page.render>[0]).promise;
    return Buffer.from(await (canvas as { encode: (format: "png") => Promise<Uint8Array> }).encode("png"));
  } finally {
    await task.destroy();
  }
}
