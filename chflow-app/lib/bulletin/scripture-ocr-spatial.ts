import type { BulletinServiceType } from "./scripture-parser";

export type OcrLine = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
};

export type OcrCandidate = {
  serviceType: BulletinServiceType;
  rawReference: string;
  confidence: number;
};

export type OcrDiagnostics = {
  candidates: OcrCandidate[];
  lines: string[];
};

export function serviceFromOcrHeader(text: string): BulletinServiceType | null {
  const compact = text.replace(/\s+/g, "");
  if (/수요(?:오전|1부)/.test(compact)) return "wednesday_morning";
  if (/수요(?:오후|저녁|2부)/.test(compact)) return "wednesday_evening";
  // The fourth service is commonly printed as "주일찬양예배", not "주일 오후예배".
  if (/(?:주일.*(?:오후|찬양|4부)|4부.*예배|찬양예배)/.test(compact)) return "sunday_afternoon";
  if (/(?:주일.*(?:오전|낮|[123]부)|[123]부.*예배)/.test(compact)) return "sunday_morning";
  return null;
}

function referenceVariants(text: string) {
  return [...text.matchAll(/([가-힣]{1,10})\s*(\d[\d\s:.-]{1,14})/g)].flatMap((match) => {
    const range = match[2].replace(/\s+/g, "").replace(/[~–—]/g, "-").replace(/[).]+$/g, "");
    if (range.includes(":")) return [`${match[1]} ${range}`];
    const compact = range.match(/^(\d{2,6})-(\d{1,3})$/);
    return compact
      ? Array.from({ length: compact[1].length - 1 }, (_, index) => `${match[1]} ${compact[1].slice(0, index + 1)}:${compact[1].slice(index + 1)}-${compact[2]}`)
      : [];
  });
}

export function extractSpatialScriptureCandidates(lines: OcrLine[]): OcrDiagnostics {
  const headers = lines.flatMap((line) => {
    const serviceType = serviceFromOcrHeader(line.text);
    return serviceType ? [{ ...line, serviceType }] : [];
  });
  const anchors = lines.filter((line) => /성\s*경\s*(?:봉\s*독|강\s*독)/.test(line.text));
  const best = new Map<BulletinServiceType, OcrCandidate>();
  const trace = [
    `OCR lines: ${lines.length}`,
    `Headers: ${headers.map((line) => `${line.serviceType}=${line.text.trim()}`).join(" | ") || "없음"}`,
    `Anchors: ${anchors.map((line) => line.text.trim()).join(" | ") || "없음"}`,
  ];

  for (const anchor of anchors) {
    const anchorX = (anchor.bbox.x0 + anchor.bbox.x1) / 2;
    const heading = headers
      .filter((item) => item.bbox.y0 <= anchor.bbox.y1 + 55)
      .sort((a, b) => {
        const score = (item: typeof a) => Math.abs((item.bbox.x0 + item.bbox.x1) / 2 - anchorX) + Math.abs(item.bbox.y0 - anchor.bbox.y0) * 0.25;
        return score(a) - score(b);
      })[0];
    if (!heading) { trace.push(`탈락: anchor '${anchor.text.trim()}' → 예배 헤더 없음`); continue; }
    let found = false;
    for (const line of lines) {
      const dy = line.bbox.y0 - anchor.bbox.y0;
      const dx = Math.abs((line.bbox.x0 + line.bbox.x1) / 2 - anchorX);
      if (dy < -45 || dy > 180 || dx > 380) continue;
      for (const rawReference of referenceVariants(line.text)) {
        found = true;
        const candidate = { serviceType: heading.serviceType, rawReference, confidence: Math.min(0.9, 0.55 + line.confidence / 200) };
        if (!best.has(candidate.serviceType) || candidate.confidence > best.get(candidate.serviceType)!.confidence) best.set(candidate.serviceType, candidate);
      }
    }
    if (!found) trace.push(`탈락: ${heading.serviceType} anchor → 주변 성경구절 없음`);
  }
  const candidates = [...best.values()];
  trace.push(`후보: ${candidates.map((item) => `${item.serviceType}=${item.rawReference}`).join(" | ") || "없음"}`);
  trace.push(...lines.map((line) => `[${Math.round(line.bbox.x0)},${Math.round(line.bbox.y0)}] ${line.text.trim()}`));
  return { candidates, lines: trace };
}
