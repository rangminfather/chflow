export const BULLETIN_SERVICE_TYPES = [
  "sunday_morning", "sunday_afternoon", "wednesday_morning", "wednesday_evening",
] as const;

export type BulletinServiceType = typeof BULLETIN_SERVICE_TYPES[number];

export const BULLETIN_SERVICE_LABELS: Record<BulletinServiceType, string> = {
  sunday_morning: "주일 오전예배",
  sunday_afternoon: "주일 오후예배",
  wednesday_morning: "수요 오전예배",
  wednesday_evening: "수요 오후예배",
};

export type ScriptureCandidate = {
  serviceType: BulletinServiceType;
  rawReference: string;
  confidence: number;
};

const SERVICE_HEADERS: Array<{ type: BulletinServiceType; pattern: RegExp }> = [
  { type: "sunday_morning", pattern: /주일\s*(?:오전|[123]\s*부)/i },
  { type: "sunday_afternoon", pattern: /(?:주일\s*(?:오후|4\s*부)|4\s*부\s*예배)/i },
  { type: "wednesday_morning", pattern: /수요\s*(?:오전|1\s*부)/i },
  { type: "wednesday_evening", pattern: /수요\s*(?:오후|저녁|2\s*부)/i },
];

const REFERENCE = /([가-힣0-9]+(?:\s*[가-힣0-9]+){0,2}\s*\d{1,3}\s*(?::|장\s*)\s*\d{1,3}\s*(?:절)?\s*(?:[-~∼]\s*\d{1,3}\s*(?:절)?)?)/;

export function normalizeBulletinReference(value: string) {
  return value
    .replace(/[~∼]/g, "-")
    .replace(/\s*장\s*/g, ":")
    .replace(/\s*절/g, "")
    .replace(/\s*[:\-]\s*/g, (match) => match.trim())
    .replace(/\s+/g, " ")
    .trim();
}

function sectionFor(text: string, at: number): BulletinServiceType | null {
  const before = text.slice(Math.max(0, at - 1600), at);
  let best: { type: BulletinServiceType; index: number } | null = null;
  for (const header of SERVICE_HEADERS) {
    const matches = [...before.matchAll(new RegExp(header.pattern.source, "gi"))];
    const index = matches.at(-1)?.index;
    if (index != null && (!best || index > best.index)) best = { type: header.type, index };
  }
  return best?.type ?? null;
}

/** Extracts only simple, single continuous ranges. Ambiguous/multiple refs remain for manual review. */
export function findBulletinScriptureCandidates(text: string): ScriptureCandidate[] {
  const candidates: ScriptureCandidate[] = [];
  for (const anchor of text.matchAll(/성경\s*봉독/gi)) {
    const index = anchor.index ?? 0;
    const nearby = text.slice(index, index + 240).replace(/^성경\s*봉독\s*/i, "");
    const reference = nearby.match(REFERENCE)?.[1];
    const serviceType = sectionFor(text, index);
    if (!reference || !serviceType) continue;
    if (/[,;]/.test(reference)) continue;
    candidates.push({ serviceType, rawReference: normalizeBulletinReference(reference), confidence: 0.72 });
  }
  const grouped = new Map<BulletinServiceType, ScriptureCandidate[]>();
  for (const candidate of candidates) grouped.set(candidate.serviceType, [...(grouped.get(candidate.serviceType) ?? []), candidate]);
  return [...grouped.values()].flatMap((group) => {
    const distinct = [...new Set(group.map((item) => item.rawReference))];
    return distinct.length === 1 ? [group[0]] : [];
  });
}
