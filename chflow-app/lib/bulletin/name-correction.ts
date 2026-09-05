/* ============================================================
   주보에 적힌 이름의 오타 교정

   주보는 사람이 한글 파일로 만들어 올리므로 이름에 오타가 섞인다
   (실제 사례: "최성헌" → "촤성헌"). 주보를 그대로 읽어오는 화면들이
   그 오타를 따라가지 않도록, 부서에 실제로 있는 사람 이름과 대조해 고친다.

   원칙 — 애매하면 고치지 않는다.
     · 명단에 있는 이름과 **한 글자만** 다를 때에만 바꾼다
     · 그 한 글자 차이에 해당하는 명단 이름이 **딱 하나**일 때만 바꾼다
       (김찬규/김찬수처럼 둘 다 후보면 손대지 않는다)
     · 길이가 다르면 손대지 않는다 — 다른 사람일 가능성이 크다
   ============================================================ */

/** 같은 길이의 두 이름이 몇 글자 다른지 */
function differingChars(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let count = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) count += 1;
  }
  return count;
}

/**
 * 문장 안에서 명단에 가까운 이름을 찾아 고친다.
 * 예: correctNames("촤성헌부장선생님", ["최성헌"]) → "최성헌부장선생님"
 */
export function correctNames(value: string, roster: string[]): string {
  const text = (value ?? "").trim();
  if (!text) return text;

  const names = [...new Set(roster.map((name) => (name ?? "").trim()).filter((name) => name.length >= 2))];
  if (names.length === 0) return text;
  // 이미 명단 이름이 그대로 들어 있으면 건드리지 않는다
  if (names.some((name) => text.includes(name))) return text;

  const lengths = [...new Set(names.map((name) => name.length))];
  for (const length of lengths) {
    for (let start = 0; start + length <= text.length; start += 1) {
      const slice = text.slice(start, start + length);
      if (!/^[가-힣]+$/.test(slice)) continue;
      const close = names.filter((name) => name.length === length && differingChars(slice, name) === 1);
      if (close.length !== 1) continue; // 후보가 둘 이상이면 판단 보류
      return text.slice(0, start) + close[0] + text.slice(start + length);
    }
  }
  return text;
}

/** 여러 항목을 한 번에 (값이 비어 있으면 그대로 둔다) */
export function correctNamesIn<T extends object>(
  fields: T,
  keys: (keyof T)[],
  roster: string[],
): T {
  const next = { ...fields };
  for (const key of keys) {
    const value = next[key];
    if (typeof value === "string" && value.trim()) {
      next[key] = correctNames(value, roster) as T[keyof T];
    }
  }
  return next;
}
