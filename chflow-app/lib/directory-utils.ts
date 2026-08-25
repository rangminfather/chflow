export type DirectoryAccountState = {
  has_app_account?: boolean | null;
  app_status?: string | null;
  app_username?: string | null;
};

export type QuickEditDraft = {
  name: string;
  phone: string;
  clearPhone: boolean;
  home_phone: string;
  clearHomePhone: boolean;
  family_church: string;
  clearFamilyChurch: boolean;
  sub_role: string;
  clearSubRole: boolean;
  spouse_name: string;
  clearSpouseName: boolean;
  gender: "" | "M" | "F";
  is_child: "" | "true" | "false";
};

export type DirectoryQuickEditMember = {
  name: string;
  phone: string | null;
  home_phone: string | null;
  family_church: string | null;
  sub_role: string | null;
  spouse_name: string | null;
  gender: string | null;
  is_child: boolean | null;
};

export type QuickEditChange = {
  key: keyof DirectoryQuickEditMember;
  label: string;
  before: string;
  after: string;
  nextValue: string | boolean;
};

export const emptyQuickEditDraft: QuickEditDraft = {
  name: "", phone: "", clearPhone: false, home_phone: "", clearHomePhone: false,
  family_church: "", clearFamilyChurch: false, sub_role: "", clearSubRole: false,
  spouse_name: "", clearSpouseName: false, gender: "", is_child: "",
};

export function directoryDisplayText(value: string | null | boolean | undefined, fallback = "없음") {
  if (typeof value === "boolean") return value ? "예" : "아니오";
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function directoryAccountLabel(member: DirectoryAccountState) {
  if (!member.has_app_account) return "앱 미가입";
  if (member.app_status === "active") return "앱 가입";
  if (member.app_status === "pending") return "가입 대기";
  if (member.app_status === "inactive") return "비활성";
  if (member.app_status === "rejected") return "가입 거절";
  return "앱 계정 있음";
}

export function directoryAccountDetail(member: DirectoryAccountState) {
  const label = directoryAccountLabel(member);
  return member.app_username ? `${label} · ${member.app_username}` : label;
}

export function directoryGenderText(value: string | null | undefined) {
  if (value === "M") return "남";
  if (value === "F") return "여";
  return "미정";
}

export function directoryChildText(value: boolean | null | undefined) {
  return value ? "자녀" : "성인";
}

export type DirectoryTreeRow = {
  plain_name: string | null;
  plain_order: number | null;
  grassland_name: string | null;
  pasture_name: string | null;
};

export function hasDirectorySearchCriteria(query: string, plain: string, grassland: string, pasture: string) {
  return !!(query.trim() || plain || grassland || pasture);
}

export function moveDirectoryChild(ids: string[], childId: string, offset: -1 | 1) {
  const next = [...ids];
  const currentIndex = next.indexOf(childId);
  const nextIndex = currentIndex + offset;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= next.length) return null;
  [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
  return next;
}

export function getDirectoryFilterOptions(rows: DirectoryTreeRow[], plain: string, grassland: string) {
  const plains = new Map<string, number>();
  const grasslands = new Set<string>();
  const pastures = new Set<string>();
  for (const row of rows) {
    if (row.plain_name && !plains.has(row.plain_name)) plains.set(row.plain_name, row.plain_order ?? 99);
    if ((!plain || row.plain_name === plain) && row.grassland_name) grasslands.add(row.grassland_name);
    if ((!plain || row.plain_name === plain) && (!grassland || row.grassland_name === grassland) && row.pasture_name) pastures.add(row.pasture_name);
  }
  return {
    plains: Array.from(plains, ([name, order]) => ({ name, order })).sort((left, right) => left.order - right.order),
    grasslands: Array.from(grasslands).sort(),
    pastures: Array.from(pastures).sort(),
  };
}

function addTextChange(
  changes: QuickEditChange[], member: DirectoryQuickEditMember, key: QuickEditChange["key"],
  label: string, input: string, clear: boolean,
) {
  const beforeValue = String(member[key] ?? "");
  const nextValue = clear ? "" : input.trim();
  if ((!clear && !nextValue) || nextValue === beforeValue) return;
  changes.push({ key, label, before: directoryDisplayText(beforeValue), after: directoryDisplayText(nextValue), nextValue });
}

export function buildQuickEditChanges(member: DirectoryQuickEditMember, draft: QuickEditDraft): QuickEditChange[] {
  const changes: QuickEditChange[] = [];
  addTextChange(changes, member, "name", "이름", draft.name, false);
  addTextChange(changes, member, "phone", "휴대폰", draft.phone, draft.clearPhone);
  addTextChange(changes, member, "home_phone", "집전화", draft.home_phone, draft.clearHomePhone);
  addTextChange(changes, member, "family_church", "가정교회", draft.family_church, draft.clearFamilyChurch);
  addTextChange(changes, member, "sub_role", "직분", draft.sub_role, draft.clearSubRole);
  addTextChange(changes, member, "spouse_name", "배우자", draft.spouse_name, draft.clearSpouseName);
  if (draft.gender && draft.gender !== (member.gender || "")) {
    changes.push({ key: "gender", label: "성별", before: directoryGenderText(member.gender), after: directoryGenderText(draft.gender), nextValue: draft.gender });
  }
  if (draft.is_child) {
    const nextValue = draft.is_child === "true";
    if (nextValue !== !!member.is_child) {
      changes.push({ key: "is_child", label: "자녀 여부", before: directoryChildText(member.is_child), after: directoryChildText(nextValue), nextValue });
    }
  }
  return changes;
}
