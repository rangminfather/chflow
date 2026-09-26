export const BULLETIN_SERVICE_TYPES = [
  "sunday_1", "sunday_2", "sunday_3", "sunday_afternoon", "wednesday_morning", "wednesday_evening",
] as const;

export type BulletinServiceType = typeof BULLETIN_SERVICE_TYPES[number];

export const BULLETIN_SERVICE_LABELS: Record<BulletinServiceType, string> = {
  sunday_1: "주일 1부예배",
  sunday_2: "주일 2부예배",
  sunday_3: "주일 3부예배",
  sunday_afternoon: "주일 오후예배",
  wednesday_morning: "수요 오전예배",
  wednesday_evening: "수요 저녁예배",
};

export function isBulletinServiceType(value: unknown): value is BulletinServiceType {
  return typeof value === "string" && (BULLETIN_SERVICE_TYPES as readonly string[]).includes(value);
}

/** "출애굽기 22:1-9, 시편 24:1" → 본문 목록. 표기 차이(공백·물결표·장/절)는 한 형태로 맞춘다. */
export function splitScriptureReferences(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;·]|\s그리고\s/)
    .map((part) => part
      .replace(/[~∼–—]/g, "-")
      .replace(/(\d)\s*장\s*(\d)/g, "$1:$2")
      .replace(/(\d)\s*장\s*$/g, "$1")
      .replace(/\s*절/g, "")
      .replace(/\s*([:\-])\s*/g, "$1")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}
