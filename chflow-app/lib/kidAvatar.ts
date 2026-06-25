// 초등부 출결/명단의 학생 기본 얼굴(아바타) 선택 로직.
// 사진 미등록 학생은 성별별 일러스트 묶음에서 학생 ID 기반으로 "고정 랜덤" 한 장을 보여준다.
// (렌더마다 바뀌지 않도록 ID 해시로 결정 — 같은 학생은 항상 같은 얼굴.)

export const KID_BOY_COUNT = 9;
export const KID_GIRL_COUNT = 6;

export type NormalizedGender = "male" | "female" | "neutral";

export function normalizeGender(gender: string | null | undefined): NormalizedGender {
  const value = String(gender || "").trim().toLowerCase();
  if (["m", "male", "남", "남자"].includes(value)) return "male";
  if (["f", "female", "여", "여자"].includes(value)) return "female";
  return "neutral";
}

// 문자열(학생 ID 등) → 안정적인 양의 정수 해시
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 성별 + 학생 ID로 기본 얼굴 PNG 경로를 결정. 성별 미상은 남아 묶음 사용(기존 동작 유지).
export function kidDefaultFace(gender: string | null | undefined, seed: string): string {
  const g = normalizeGender(gender);
  const h = hashSeed(seed || "");
  if (g === "female") return `/avatars/kids/girl-${(h % KID_GIRL_COUNT) + 1}.png`;
  return `/avatars/kids/boy-${(h % KID_BOY_COUNT) + 1}.png`;
}

// 저장된 photo_url 이 "기본 얼굴 일러스트" 경로인지 여부.
// (null/빈값=자동 기본얼굴, /avatars/kids/..=직접 고른 기본얼굴 → 둘 다 '기본 얼굴'로 취급)
export function isKidDefaultFace(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("/avatars/kids/");
}

const BOY_FACES = Array.from({ length: KID_BOY_COUNT }, (_, i) => `/avatars/kids/boy-${i + 1}.png`);
const GIRL_FACES = Array.from({ length: KID_GIRL_COUNT }, (_, i) => `/avatars/kids/girl-${i + 1}.png`);

// 성별별 선택 가능한 기본 얼굴 목록. 성별 미상이면 남아+여아 모두 제공.
export function kidFaceChoices(gender: string | null | undefined): string[] {
  const g = normalizeGender(gender);
  if (g === "female") return GIRL_FACES;
  if (g === "male") return BOY_FACES;
  return [...BOY_FACES, ...GIRL_FACES];
}

// 일러스트마다 얼굴이 원형 안에서 정중앙에 오도록 보정하는 CSS transform.
// 이미지·컨테이너가 모두 정사각형이라 objectPosition 은 효과가 없어 transform(확대/이동)으로 맞춘다.
// translate(X%,Y%) → X+면 오른쪽·Y+면 아래로 이동(원본 일러스트마다 얼굴이 좌/우/상하로 치우쳐 있어 눈높이를 가운데로 보정).
// scale 로 장식 테두리를 살짝 잘라 얼굴을 키운다. translate 백분율은 컨테이너(=이미지) 크기 기준.
const FACE_ADJUST: Record<string, string> = {
  "boy-1": "scale(1.1)",
  "boy-2": "translateX(10%) scale(1.1)",
  "boy-3": "translateX(3%) scale(1.1)",
  "boy-4": "translateX(4%) scale(1.1)",
  "boy-5": "translateX(12%) scale(1.1)",
  "boy-6": "translate(2%, 4%) scale(1.12)",
  "boy-7": "translateX(6%) scale(1.1)",
  "boy-8": "translateX(2%) scale(1.1)",
  "boy-9": "translate(4%, -2%) scale(1.1)",
  "girl-1": "translate(4%, 3%) scale(1.12)",
  "girl-2": "translateX(-2%) scale(1.1)",
  "girl-3": "scale(1.08)",
  "girl-4": "translate(2%, 2%) scale(1.1)",
  "girl-5": "translateX(-1%) scale(1.1)",
  "girl-6": "translateX(2%) scale(1.08)",
};

// 기본 얼굴 경로에 맞는 transform 반환(실제 사진은 빈 문자열 → 변형 없음).
export function kidFaceTransform(url: string | null | undefined): string {
  if (!isKidDefaultFace(url)) return "";
  const m = (url as string).match(/\/avatars\/kids\/([a-z]+-\d+)\.png/);
  return (m && FACE_ADJUST[m[1]]) || "scale(1.1)";
}
