/* ============================================================
   성경 역본 선택

   지금 쓸 수 있는 역본은 보호기간이 끝난 개역한글(KRV) 하나다.
   교회에서 실제로 봉독하는 개역개정(NKRV)은 대한성서공회 허락을 받아
   본문을 넣고 is_active 를 켜면 자동으로 목록에 나타난다 — 앱 코드는 그대로다.

   그래서 화면은 "역본이 하나뿐이면 선택 UI 를 감추고, 둘 이상이면 고르게"
   동작한다. 고른 값은 그 기기에 남는다.
   ============================================================ */

/**
 * 기본으로 쓸 역본 우선순위.
 * 교회에서 실제 봉독하는 것은 개역개정(NKRV)이므로 그것을 1순위로 둔다.
 * 다만 저작권 허락 전까지 NKRV 는 is_active = false 라 목록에 없고,
 * 자동으로 개역한글(KRV)로 내려간다. 허락받아 본문을 넣고 켜는 순간
 * 코드 수정 없이 개역개정이 기본이 된다.
 */
export const PREFERRED_VERSION_ORDER = ["NKRV", "KRV"];
export const DEFAULT_BIBLE_VERSION = "KRV";

export type BibleVersion = {
  code: string;
  name_ko: string;
  name_en: string | null;
  language_code: string;
  copyright_note: string | null;
  is_public_domain: boolean;
};

const STORAGE_KEY = "bible-version";

/** RPC 응답을 방어적으로 다듬는다 */
export function parseBibleVersions(raw: unknown): BibleVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      code: String(row.code ?? ""),
      name_ko: String(row.name_ko ?? ""),
      name_en: typeof row.name_en === "string" ? row.name_en : null,
      language_code: String(row.language_code ?? "ko"),
      copyright_note: typeof row.copyright_note === "string" ? row.copyright_note : null,
      is_public_domain: row.is_public_domain === true,
    }))
    .filter((version) => version.code && version.name_ko);
}

/** 저장된 선택이 아직 쓸 수 있는 역본이면 그것을, 아니면 기본값을 쓴다 */
export function resolveBibleVersion(versions: BibleVersion[], saved: string | null): string {
  if (saved && versions.some((version) => version.code === saved)) return saved;
  for (const code of PREFERRED_VERSION_ORDER) {
    if (versions.some((version) => version.code === code)) return code;
  }
  return versions[0]?.code || DEFAULT_BIBLE_VERSION;
}

export function readSavedBibleVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveBibleVersion(code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* 저장 실패는 무시 — 이번 세션에만 적용된다 */
  }
}

/** 대본에 적을 역본 이름 (역본이 하나뿐이면 굳이 적지 않는다) */
export function versionLabel(versions: BibleVersion[], code: string): string {
  if (versions.length <= 1) return "";
  return versions.find((version) => version.code === code)?.name_ko || "";
}
