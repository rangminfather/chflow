// =============================================================
// 홈(메인메뉴) 커스터마이즈 설정 적용 로직
//   DB(get_home_menu_config)에는 "덮어쓴 값"만 저장되고,
//   메뉴 정의(아이콘·링크·기본 이름)는 app/home/page.tsx 가 소유한다.
//   여기서는 저장된 이름/숨김/순서를 기본 목록에 얹는 순수 함수만 다룬다.
// =============================================================

export type HomeMenuSetting = { label: string | null; hidden: boolean };
export type HomeMenuSettings = Record<string, HomeMenuSetting>;
export type HomeMenuOrder = Record<string, string[]>;
export type HomeMenuConfig = { settings: HomeMenuSettings; order: HomeMenuOrder };

export const HOME_MENU_GROUP_IDS = ["ministry", "pasture", "common", "implemented", "unimplemented", "system"] as const;
export type HomeMenuGroupId = (typeof HOME_MENU_GROUP_IDS)[number];

export const EMPTY_HOME_MENU_CONFIG: HomeMenuConfig = { settings: {}, order: {} };

// 설정 키: 공통 메뉴는 common/<id>, 관리자 메뉴는 그룹과 무관하게 admin/<id>
// (관리자 메뉴는 구현/미구현 그룹이 코드에서 href 유무로 갈리므로 그룹명을 키에 넣지 않는다)
export function homeMenuKeyOf(groupId: string, menuId: string): string {
  const prefix = groupId === "common" || groupId === "ministry" || groupId === "pasture"
    ? groupId
    : "admin";
  return `${prefix}/${menuId}`;
}

// 섹션 제목 설정 키 — 메뉴와 같은 테이블을 쓰되 접두사로 구분한다
export const HOME_SECTION_IDS = ["ministry", "pasture", "common"] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

export function homeSectionKeyOf(sectionId: string): string {
  return `section/${sectionId}`;
}

// 저장된 섹션 제목(없거나 공백이면 코드 기본값)
export function resolveHomeSectionLabel(
  config: HomeMenuConfig,
  sectionId: string,
  defaultLabel: string,
): string {
  const saved = config.settings[homeSectionKeyOf(sectionId)]?.label;
  return saved && saved.trim() ? saved : defaultLabel;
}

// RPC 응답(jsonb)을 방어적으로 파싱 — 형태가 어긋나면 그 부분만 버린다
export function parseHomeMenuConfig(raw: unknown): HomeMenuConfig {
  if (!raw || typeof raw !== "object") return EMPTY_HOME_MENU_CONFIG;
  const source = raw as { settings?: unknown; order?: unknown };

  const settings: HomeMenuSettings = {};
  if (source.settings && typeof source.settings === "object") {
    for (const [key, value] of Object.entries(source.settings as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const row = value as { label?: unknown; hidden?: unknown };
      settings[key] = {
        label: typeof row.label === "string" ? row.label : null,
        hidden: row.hidden === true,
      };
    }
  }

  const order: HomeMenuOrder = {};
  if (source.order && typeof source.order === "object") {
    for (const [key, value] of Object.entries(source.order as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      order[key] = value.filter((x): x is string => typeof x === "string");
    }
  }

  return { settings, order };
}

// 기본 메뉴 목록에 저장된 이름/숨김/순서를 적용한다.
//  - includeHidden=false(기본): 숨긴 메뉴는 제외
//  - includeHidden=true(편집모드): 숨긴 메뉴도 hidden=true 로 함께 반환
//  - 저장된 순서에 없는 항목은 기본 순서를 유지하며 뒤에 붙는다
export function applyHomeMenuConfig<T extends { id: string; label: string }>(
  groupId: string,
  menus: T[],
  config: HomeMenuConfig,
  options?: { includeHidden?: boolean },
): (T & { hidden: boolean })[] {
  const resolved = menus.map((menu) => {
    const setting = config.settings[homeMenuKeyOf(groupId, menu.id)];
    const label = setting?.label && setting.label.trim() ? setting.label : menu.label;
    return { ...menu, label, hidden: setting?.hidden === true };
  });

  const visible = options?.includeHidden ? resolved : resolved.filter((menu) => !menu.hidden);
  const orderArr = config.order[groupId] || [];
  return visible
    .map((menu, index) => {
      const at = orderArr.indexOf(menu.id);
      return { menu, position: at === -1 ? orderArr.length + index : at };
    })
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.menu);
}
