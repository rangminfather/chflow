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
    if (!compact) return [];
    return Array.from({ length: compact[1].length - 1 }, (_, index) => {
      const chapter = Number(compact[1].slice(0, index + 1));
      const verseStart = Number(compact[1].slice(index + 1));
      const verseEnd = Number(compact[2]);
      return { chapter, verseStart, verseEnd };
    })
      .filter(({ chapter, verseStart, verseEnd }) => chapter >= 1 && chapter <= 150 && verseStart >= 1 && verseStart <= 176 && verseEnd >= verseStart && verseEnd <= 176)
      .map(({ chapter, verseStart, verseEnd }) => `${match[1]} ${chapter}:${verseStart}-${verseEnd}`);
  });
}

function centerX(line: OcrLine) { return (line.bbox.x0 + line.bbox.x1) / 2; }
function centerY(line: OcrLine) { return (line.bbox.y0 + line.bbox.y1) / 2; }

export function extractSpatialScriptureCandidates(lines: OcrLine[]): OcrDiagnostics {
  const headers = lines.flatMap((line) => {
    const serviceType = serviceFromOcrHeader(line.text);
    return serviceType ? [{ ...line, serviceType }] : [];
  });
  const anchors = lines.filter((line) => /성\s*경\s*(?:봉\s*독|강\s*독)/.test(line.text));
  const best = new Map<BulletinServiceType, OcrCandidate>();
  const references = lines.flatMap((line) => referenceVariants(line.text).map((rawReference) => ({ ...line, rawReference })));
  const pageWidth = Math.max(...lines.map((line) => line.bbox.x1), 1) - Math.min(...lines.map((line) => line.bbox.x0), 0);
  const pageHeight = Math.max(...lines.map((line) => line.bbox.y1), 1) - Math.min(...lines.map((line) => line.bbox.y0), 0);
  const put = (serviceType: BulletinServiceType, reference: typeof references[number], confidenceBoost = 0) => {
    const candidate = {
      serviceType,
      rawReference: reference.rawReference,
      confidence: Math.min(0.95, 0.55 + reference.confidence / 200 + confidenceBoost),
    };
    if (!best.has(serviceType) || candidate.confidence > best.get(serviceType)!.confidence) best.set(serviceType, candidate);
  };
  const trace = [
    `OCR lines: ${lines.length}`,
    `Headers: ${headers.map((line) => `${line.serviceType}=${line.text.trim()}`).join(" | ") || "없음"}`,
    `Anchors: ${anchors.map((line) => line.text.trim()).join(" | ") || "없음"}`,
  ];

  // The Sunday order is one table row: a shared "성경봉독" label followed by
  // the common morning reading and fourth-service reading from left to right.
  for (const anchor of anchors) {
    const rowTolerance = Math.max((anchor.bbox.y1 - anchor.bbox.y0) * 4, pageHeight * 0.045);
    const sameRow = references
      .filter((reference) => reference.bbox.x0 > anchor.bbox.x1 && Math.abs(centerY(reference) - centerY(anchor)) <= rowTolerance)
      .sort((a, b) => centerX(a) - centerX(b));
    if (sameRow.length >= 2) {
      put("sunday_morning", sameRow[0], 0.04);
      put("sunday_afternoon", sameRow.at(-1)!, 0.04);
      trace.push(`주일 행 매핑: 오전=${sameRow[0].rawReference} | 오후=${sameRow.at(-1)!.rawReference}`);
    }
  }

  // Wednesday columns have explicit service headers but the row label is
  // "성경및강론", so requiring a separate "성경봉독" anchor drops both readings.
  for (const header of headers.filter((item) => item.serviceType.startsWith("wednesday_"))) {
    const nearby = references
      .filter((reference) => {
        const dy = reference.bbox.y0 - header.bbox.y1;
        return dy >= 0 && dy <= pageHeight * 0.2 && Math.abs(centerX(reference) - centerX(header)) <= pageWidth * 0.18;
      })
      .sort((a, b) => {
        const score = (reference: typeof a) => reference.bbox.y0 - header.bbox.y1 + Math.abs(centerX(reference) - centerX(header)) * 0.5;
        return score(a) - score(b);
      })[0];
    if (nearby) {
      put(header.serviceType, nearby, 0.04);
      trace.push(`수요 헤더 매핑: ${header.serviceType}=${nearby.rawReference}`);
    } else {
      trace.push(`탈락: ${header.serviceType} 헤더 아래 성경구절 없음`);
    }
  }

  for (const anchor of anchors) {
    const anchorX = (anchor.bbox.x0 + anchor.bbox.x1) / 2;
    const heading = headers
      .filter((item) => item.bbox.y0 <= anchor.bbox.y1 + 55)
      .sort((a, b) => {
        const score = (item: typeof a) => Math.abs((item.bbox.x0 + item.bbox.x1) / 2 - anchorX) + Math.abs(item.bbox.y0 - anchor.bbox.y0) * 0.25;
        return score(a) - score(b);
      })[0];
    if (!heading) {
      if (!best.has("sunday_morning") || !best.has("sunday_afternoon")) trace.push(`탈락: anchor '${anchor.text.trim()}' → 예배 헤더 없음`);
      continue;
    }
    let found = false;
    for (const line of lines) {
      const dy = line.bbox.y0 - anchor.bbox.y0;
      const dx = Math.abs((line.bbox.x0 + line.bbox.x1) / 2 - anchorX);
      if (dy < -45 || dy > 180 || dx > 380) continue;
      for (const rawReference of referenceVariants(line.text)) {
        found = true;
        put(heading.serviceType, { ...line, rawReference });
      }
    }
    if (!found) trace.push(`탈락: ${heading.serviceType} anchor → 주변 성경구절 없음`);
  }
  const candidates = [...best.values()];
  trace.push(`후보: ${candidates.map((item) => `${item.serviceType}=${item.rawReference}`).join(" | ") || "없음"}`);
  trace.push(...lines.map((line) => `[${Math.round(line.bbox.x0)},${Math.round(line.bbox.y0)}] ${line.text.trim()}`));
  return { candidates, lines: trace };
}
