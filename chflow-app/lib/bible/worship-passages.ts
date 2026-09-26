import { normalizeBibleReference, type BibleVerse } from "../worshipLeaderScript";

/** Expand omitted book/chapter names without discarding any requested passage. */
export function expandWorshipReferences(raw: string): string[] {
  let book = "";
  let chapter = "";
  let hasVerses = false;
  const parts = normalizeBibleReference(raw).split(/[,，;；·]/).map((part) => part.trim());
  if (!parts.length || parts.some((part) => !part)) throw new Error("빈 성경 본문 표기가 있습니다.");
  return parts.map((part) => {
    const explicit = part.match(/^([1-3]?\s*[가-힣A-Za-z]+)\s*(\d.*)$/);
    let numbers = part;
    if (explicit) {
      book = explicit[1];
      numbers = explicit[2];
    } else if (!book) {
      throw new Error(`성경 책 이름을 확인해주세요: ${part}`);
    } else if (!numbers.includes(":") && hasVerses) {
      numbers = `${chapter}:${numbers}`;
    }
    if (!/^\d+(?::\d+(?:-(?:\d+:)?\d+)?)?$/.test(numbers)) {
      throw new Error(`성경 본문 표기를 확인해주세요: ${part}`);
    }
    const [start, end] = numbers.split("-");
    chapter = end?.includes(":") ? end.split(":")[0] : start.split(":")[0];
    hasVerses = numbers.includes(":");
    return `${book} ${numbers}`;
  });
}

type PassageResponse = {
  ok?: boolean;
  normalizedLabel?: string;
  bookId?: number;
  rows?: BibleVerse[];
  error?: string;
};

export async function loadWorshipPassages(
  reference: string,
  lookup: (ref: string) => Promise<PassageResponse>,
) {
  const references = expandWorshipReferences(reference);
  const passages = await Promise.all(references.map(async (ref) => {
    const result = await lookup(ref);
    if (!result.ok || !result.rows?.length || !result.bookId) {
      throw new Error(`${ref}: ${result.error || "본문을 찾지 못했습니다."}`);
    }
    return { ...result, rows: result.rows, bookId: result.bookId, label: result.normalizedLabel || ref };
  }));
  const testaments = new Set(passages.map((p) => p.bookId <= 39 ? "구약" : "신약"));
  return {
    normalizedLabel: passages.map((p) => p.label).join(", "),
    testament: (testaments.size > 1 ? "구약/신약" : [...testaments][0]) as "구약" | "신약" | "구약/신약",
    rows: passages.flatMap((p) => p.rows.map((row, index) => ({
      ...row,
      passageLabel: passages.length > 1 && index === 0 ? p.label : undefined,
    }))),
  };
}
