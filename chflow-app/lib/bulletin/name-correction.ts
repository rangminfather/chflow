/* ============================================================
   주보에 적힌 이름의 오타 교정

   주보는 사람이 한글 파일로 만들어 올리므로 이름에 오타가 섞인다
   (실제 사례: 예배인도자가 "최성헌" 대신 "촤성헌"으로 적혀 있었다).

   ── 왜 "비슷한 이름 자동 교정"을 쓰지 않는가 ──────────────
   처음엔 부서 명단과 한 글자 차이면 고치도록 만들었다가 실제 데이터를 망쳤다.
   초등1부에는 **최성헌(부장)과 최성현(찬양율동)이 둘 다 있고**, 최성현은
   edu_teachers 에 등록돼 있지 않다. 그래서 멀쩡한 "최성현"이 명단에 없는
   이름으로 보여 "최성헌"으로 바뀌어 버렸다.

   명단이 부서 사람 전부를 담고 있지 않는 한 유사도 교정은 위험하다.
   그래서 **확인된 오타만** 아래 목록에 적어 바꾼다. 새 오타가 보이면 여기 한 줄
   추가하면 된다. 목록에 없는 글자는 절대 건드리지 않는다.
   ============================================================ */

/** 주보에서 실제로 관찰된 오타 → 바른 표기 */
export const KNOWN_NAME_TYPOS: Record<string, string> = {
  촤성헌: "최성헌", // 2026-09-06·08-30 초등1부 주보 예배인도자
};

/** 알려진 오타만 바꾼다. 그 외에는 원문 그대로 둔다. */
export function correctNames(value: string, typos: Record<string, string> = KNOWN_NAME_TYPOS): string {
  const text = value ?? "";
  if (!text.trim()) return text;
  let out = text;
  for (const [wrong, right] of Object.entries(typos)) {
    if (out.includes(wrong)) out = out.split(wrong).join(right);
  }
  return out;
}

/** 여러 항목을 한 번에 (값이 비어 있으면 그대로 둔다) */
export function correctNamesIn<T extends object>(
  fields: T,
  keys: (keyof T)[],
  typos: Record<string, string> = KNOWN_NAME_TYPOS,
): T {
  const next = { ...fields };
  for (const key of keys) {
    const value = next[key];
    if (typeof value === "string" && value.trim()) {
      next[key] = correctNames(value, typos) as T[keyof T];
    }
  }
  return next;
}
