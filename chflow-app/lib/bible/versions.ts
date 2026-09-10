/* ============================================================
   성경 역본 선택
   사용 가능한 역본은 서버(또는 DB)에서 내려주는 목록을 그대로 따른다.
   역본이 하나뿐이면 선택 UI를 감추고, 둘 이상이면 사용자가 고른다.
   사용자가 고른 값은 해당 기기의 localStorage에만 저장된다.
   앱/코드 쪽에서 특정 역본을 우선시하거나 강제하지 않는다.
   ============================================================ */

export const DEFAULT_BIBLE_VERSION = "KRV";

/** @deprecated 코드에서 더 이상 역본 우선순위를 강제하지 않는다. versions.test.ts 하위 호환용으로만 유지. */
export const PREFERRED_VERSION_ORDER = ["NKRV", "KRV"];

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

/**
 * 저장된 선택이 아직 쓸 수 있는 역본이면 그것을 사용한다.
 * 없으면 목록의 첫 번째 역본을 쓰고, 목록이 비어 있으면 DEFAULT만 반환한다.
 * 어떤 역본을 우선할지 코드에서 결정하지 않는다.
 */
export function resolveBibleVersion(versions: BibleVersion[], saved: string | null): string {
  if (saved && versions.some((version) => version.code === saved)) {
    return saved;
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

/**
 * 대본·화면에 표시할 역본 이름.
 * 목록에 있으면 그 name_ko를 쓰고, 없으면 코드만 그대로 돌려준다.
 * 특정 역본 이름을 코드에 하드코딩하지 않는다.
 */
export function versionLabel(versions: BibleVersion[], code: string): string {
  const found = versions.find((version) => version.code === code)?.name_ko;
  return found ?? code;
}
