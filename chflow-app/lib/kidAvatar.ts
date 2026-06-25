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
