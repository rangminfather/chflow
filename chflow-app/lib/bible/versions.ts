/* ============================================================
   성경 역본 선택
   사용 가능한 역본은 서버(또는 DB)에서 내려주는 목록을 그대로 따른다.
   역본이 하나뿐이면 선택 UI를 감추고, 둘 이상이면 사용자가 고른다.
   사용자가 고른 값은 해당 기기의 localStorage에만 저장된다.
   사용자가 아직 고르지 않았을 때의 기본 역본만 코드가 정한다 (PREFERRED_VERSION_ORDER).
   ============================================================ */

/** 스마트명성 성경 기능의 단일 기본 역본. 본문은 R2에서 제공한다. */
export const DEFAULT_BIBLE_VERSION = "NKRV";

/**
 * 사용자가 아직 역본을 고르지 않았을 때 쓸 기본 역본 우선순위.
 * 교회에서 실제로 봉독하는 것은 개역개정(NKRV)이므로 그것을 1순위로 둔다.
 * 허락받아 본문을 넣고 is_active 를 켜는 순간 코드 수정 없이 개역개정이 기본이 된다.
 *
 * 목록 자체의 정렬 순서에 이 정책을 맡기지 않는다 — list_bible_versions() 는
 * `order by v.code` 라서 알파벳순으로 KRV 가 NKRV 보다 앞에 온다.
 */
export const PREFERRED_VERSION_ORDER = ["NKRV", "KRV"];

export type BibleVersion = {
  code: string;
  name_ko: string;
  name_en: string | null;
  language_code: string;
  copyright_note: string | null;
  is_public_domain: boolean;
  /** copyright_items.slug 와 연결 — 있으면 화면에 저작권 안내 링크를 붙인다(공용 컴포넌트가 사용). */
  copyright_slug: string | null;
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
      copyright_slug: typeof row.copyright_slug === "string" ? row.copyright_slug : null,
    }))
    .filter((version) => version.code && version.name_ko);
}

/**
 * 저장된 선택이 아직 쓸 수 있는 역본이면 그것을 사용한다.
 * 없으면 PREFERRED_VERSION_ORDER 순서로 찾고(NKRV → KRV),
 * 둘 다 없으면 목록의 첫 번째 역본, 목록이 비어 있으면 DEFAULT만 반환한다.
 */
export function resolveBibleVersion(versions: BibleVersion[], saved: string | null): string {
  void versions;
  void saved;
  return DEFAULT_BIBLE_VERSION;
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
 * 목록에 있으면 그 name_ko를 쓰고, 아직 목록이 없으면 코드만 그대로 돌려준다.
 */
export function versionLabel(versions: BibleVersion[], code: string): string {
  const found = versions.find((version) => version.code === code)?.name_ko;
  return found ?? code;
}
