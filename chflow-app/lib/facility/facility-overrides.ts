/* ============================================================
   시설 공간 — 관리자가 화면에서 고친 값 덮어쓰기

   공간이 무엇무엇 있는지, 평면도 어디에 놓이는지는 계속
   facility-map-config.ts 가 정한다. 여기서는 관리자가 고칠 수 있는
   값(이름 / 대여 여부 / 수용인원·단위 / 비품 / 안내문구)만 그 위에 덮어쓴다.
   공간 추가·삭제는 여기서 하지 않는다.

   DB 쪽은 facility_room_overrides 테이블 +
   get_facility_room_overrides / save_facility_room_overrides RPC.
   (마이그레이션 20260903120000_facility_room_overrides.sql,
    수용인원·비품 확장은 20260903193000_facility_room_details.sql)

   덮어쓰기 행 하나는 그 공간의 **완전한 스냅샷**이다. 바뀐 공간은 모든
   필드를 함께 보내고, 설정 파일 기본값과 같아지면 행을 지운다.
   그래서 행이 있으면 그 값이 진실이고, capacity 가 null 이면 "미지정"이다.

   설정 파일에서 사라진 공간의 덮어쓰기 행은 조용히 무시한다 —
   건물 구성이 바뀌었을 때 화면이 죽지 않게 하기 위해서다.
   ============================================================ */

import type { FacilityBuilding, FacilityFloor, FacilityRoom } from "./facility-map-config";

/** DB get_facility_room_overrides() 한 행 */
export type FacilityRoomOverride = {
  facility_id: string;
  name: string | null;
  reservable: boolean | null;
  /** null = 미지정(모름) */
  capacity?: number | null;
  /** "" = 기본 단위(명) */
  capacity_unit?: string | null;
  facilities?: string[] | null;
  /** "" = 안내문구 없음 */
  note?: string | null;
};

export type OverrideMap = Map<string, FacilityRoomOverride>;

/** DB get_facility_building_overrides() 한 행 — 건물 이름·설명 덮어쓰기 */
export type FacilityBuildingOverride = {
  building_code: string;
  name: string | null;
  description: string | null;
};

export type BuildingOverrideMap = Map<string, FacilityBuildingOverride>;

export const BUILDING_NAME_MAX = 40;
export const BUILDING_DESC_MAX = 60;

export function toBuildingOverrideMap(
  rows: FacilityBuildingOverride[] | null | undefined,
): BuildingOverrideMap {
  return new Map((rows ?? []).map((row) => [row.building_code, row]));
}

/** 관리자 편집 화면의 건물 머리말 값 */
export type BuildingDraft = { name: string; description: string };

export function draftFromBuilding(building: FacilityBuilding): BuildingDraft {
  return { name: building.name, description: building.description };
}

export function isSameBuildingDraft(a: BuildingDraft, b: BuildingDraft): boolean {
  return a.name.trim() === b.name.trim() && a.description.trim() === b.description.trim();
}

export function validateBuildingDraft(draft: BuildingDraft): string | null {
  if (draft.name.trim() === "") return "건물 이름은 비워 둘 수 없습니다";
  if (draft.name.trim().length > BUILDING_NAME_MAX) {
    return `건물 이름은 ${BUILDING_NAME_MAX}자까지 입력할 수 있습니다`;
  }
  if (draft.description.trim().length > BUILDING_DESC_MAX) {
    return `건물 설명은 ${BUILDING_DESC_MAX}자까지 입력할 수 있습니다`;
  }
  return null;
}

/**
 * 저장할 건물 값 — 설정 파일 기본값과 같아지면 빈 문자열로 보내 행을 지운다.
 * (RPC 는 이름·설명이 모두 비면 덮어쓰기 행을 삭제한다)
 */
export function buildBuildingSavePayload(
  defaults: FacilityBuilding,
  draft: BuildingDraft,
): { p_building_code: string; p_name: string; p_description: string } | null {
  if (isSameBuildingDraft(draft, draftFromBuilding(defaults))) {
    return { p_building_code: defaults.code, p_name: "", p_description: "" };
  }
  return {
    p_building_code: defaults.code,
    p_name: draft.name.trim(),
    p_description: draft.description.trim(),
  };
}

/** 관리자 편집 화면이 다루는 값 — 입력창에 그대로 들어가는 문자열로 둔다 */
export type RoomDraft = {
  name: string;
  reservable: boolean;
  /** 빈 문자열 = 미지정 */
  capacity: string;
  /** 빈 문자열 = 기본 단위(명) */
  capacityUnit: string;
  /** 쉼표로 구분한 비품 목록 */
  facilities: string;
  note: string;
};

export const ROOM_NAME_MAX = 40;
export const CAPACITY_MAX = 9999;
export const CAPACITY_UNIT_MAX = 8;
export const FACILITY_ITEM_MAX = 12;
export const FACILITY_ITEM_NAME_MAX = 20;
export const ROOM_NOTE_MAX = 80;
export const DEFAULT_CAPACITY_UNIT = "명";

/** "빔프로젝터, 화이트보드" → ["빔프로젝터","화이트보드"] (빈 항목·중복 제거) */
export function facilitiesFromText(text: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of text.split(",")) {
    const item = raw.trim();
    if (item === "" || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }
  return items;
}

export function facilitiesToText(items: string[] | null | undefined): string {
  return (items ?? []).join(", ");
}

/** 입력한 수용인원 문자열 해석 — "" = 미지정(null), 숫자가 아니면 undefined */
export function parseCapacity(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,4}$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value > CAPACITY_MAX ? undefined : value;
}

export function toOverrideMap(rows: FacilityRoomOverride[] | null | undefined): OverrideMap {
  return new Map((rows ?? []).map((row) => [row.facility_id, row]));
}

/**
 * 설정 파일의 건물 목록 위에 덮어쓰기를 얹은 새 목록을 만든다.
 * 덮어쓸 값이 하나도 없는 건물·층은 원래 객체를 그대로 돌려줘서
 * 불필요한 리렌더를 만들지 않는다.
 */
export function applyOverrides(
  buildings: FacilityBuilding[],
  overrides: OverrideMap,
  buildingOverrides?: BuildingOverrideMap,
): FacilityBuilding[] {
  if (overrides.size === 0 && (!buildingOverrides || buildingOverrides.size === 0)) return buildings;

  return buildings.map((building) => {
    let buildingChanged = false;

    // 건물 머리말(이름·설명) 덮어쓰기 — 빈 값은 기본값 유지로 읽는다
    const bo = buildingOverrides?.get(building.code);
    const name = normalizeName(bo?.name) ?? building.name;
    const description = normalizeName(bo?.description) ?? building.description;
    const headChanged = name !== building.name || description !== building.description;

    const floors = building.floors.map((floor) => {
      let floorChanged = false;

      const rooms = floor.rooms.map((room) => {
        const next = applyToRoom(room, overrides.get(room.id));
        if (next !== room) floorChanged = true;
        return next;
      });

      if (!floorChanged) return floor;
      buildingChanged = true;
      return { ...floor, rooms } satisfies FacilityFloor;
    });

    if (!buildingChanged && !headChanged) return building;
    return { ...building, name, description, floors };
  });
}

function applyToRoom(room: FacilityRoom, override: FacilityRoomOverride | undefined): FacilityRoom {
  if (!override) return room;

  const name = normalizeName(override.name) ?? room.name;
  const reservable = typeof override.reservable === "boolean" ? override.reservable : room.reservable;
  // 행이 있으면 그 값이 진실 — capacity 가 null 이면 "미지정"이다.
  // (컬럼이 없던 시절의 행이 남아 있으면 undefined 이므로 설정값을 유지한다)
  const capacity = override.capacity === undefined ? room.capacity : override.capacity;
  const capacityUnit = override.capacity_unit === undefined || override.capacity_unit === null
    ? room.capacityUnit
    : (override.capacity_unit.trim() || undefined);
  const facilities = override.facilities === undefined || override.facilities === null
    ? room.facilities
    : override.facilities;
  const note = override.note === undefined || override.note === null
    ? room.note
    : (override.note.trim() || undefined);

  const same = name === room.name
    && reservable === room.reservable
    && capacity === room.capacity
    && capacityUnit === room.capacityUnit
    && note === room.note
    && sameList(facilities, room.facilities);
  if (same) return room;

  return { ...room, name, reservable, capacity, capacityUnit, facilities, note };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function normalizeName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** 편집 화면 초기값 — 지금 화면에 보이는 값 그대로 */
export function draftFromRoom(room: FacilityRoom): RoomDraft {
  return {
    name: room.name,
    reservable: room.reservable,
    capacity: room.capacity === null ? "" : String(room.capacity),
    capacityUnit: room.capacityUnit ?? "",
    facilities: facilitiesToText(room.facilities),
    note: room.note ?? "",
  };
}

/** 한 글자도 안 고쳤는지 */
export function isSameDraft(a: RoomDraft, b: RoomDraft): boolean {
  return a.name.trim() === b.name.trim()
    && a.reservable === b.reservable
    && a.capacity.trim() === b.capacity.trim()
    && a.capacityUnit.trim() === b.capacityUnit.trim()
    && a.note.trim() === b.note.trim()
    && sameList(facilitiesFromText(a.facilities), facilitiesFromText(b.facilities));
}

export type SavePayload = {
  rows: {
    facility_id: string;
    name: string;
    reservable: boolean;
    capacity: number | null;
    capacity_unit: string;
    facilities: string[];
    note: string;
  }[];
  resets: string[];
};

/**
 * 저장할 것과 되돌릴 것을 가른다.
 *
 *   설정 파일 기본값과 같아진 공간 → resets (덮어쓰기 행을 지운다)
 *   기본값과 다른 공간           → rows  (덮어쓰기 행을 남긴다)
 *
 * 기본값으로 돌아온 행까지 계속 쌓아두면 나중에 설정 파일을 고쳤을 때
 * 낡은 덮어쓰기가 조용히 이겨버린다. 그래서 같아지면 지운다.
 */
export function buildSavePayload(
  defaults: FacilityRoom[],
  drafts: Map<string, RoomDraft>,
  overrides: OverrideMap,
): SavePayload {
  const rows: SavePayload["rows"] = [];
  const resets: string[] = [];

  for (const room of defaults) {
    const draft = drafts.get(room.id);
    if (!draft) continue;

    const name = draft.name.trim();
    if (name === "") continue; // 빈 이름은 저장 전에 화면에서 막는다

    if (isSameDraft(draft, draftFromRoom(room))) {
      if (overrides.has(room.id)) resets.push(room.id);
      continue;
    }

    const capacity = parseCapacity(draft.capacity);
    if (capacity === undefined) continue; // 잘못된 숫자는 validateDrafts 가 먼저 막는다

    rows.push({
      facility_id: room.id,
      name,
      reservable: draft.reservable,
      capacity,
      capacity_unit: draft.capacityUnit.trim(),
      facilities: facilitiesFromText(draft.facilities),
      note: draft.note.trim(),
    });
  }

  return { rows, resets };
}

/** 저장 전 검사 — 문제가 있으면 사람이 읽을 메시지, 없으면 null */
export function validateDrafts(defaults: FacilityRoom[], drafts: Map<string, RoomDraft>): string | null {
  const seen = new Set<string>();

  for (const room of defaults) {
    const draft = drafts.get(room.id);
    if (!draft) continue;

    const name = draft.name.trim();
    if (name === "") return "공간 이름은 비워 둘 수 없습니다";
    if (name.length > ROOM_NAME_MAX) return `공간 이름은 ${ROOM_NAME_MAX}자까지 입력할 수 있습니다`;

    if (parseCapacity(draft.capacity) === undefined) {
      return `"${name}" 수용인원은 0~${CAPACITY_MAX} 사이 숫자로 입력해 주세요`;
    }
    if (draft.capacityUnit.trim().length > CAPACITY_UNIT_MAX) {
      return `수용 단위는 ${CAPACITY_UNIT_MAX}자까지 입력할 수 있습니다`;
    }

    const items = facilitiesFromText(draft.facilities);
    if (items.length > FACILITY_ITEM_MAX) {
      return `비품은 ${FACILITY_ITEM_MAX}개까지 입력할 수 있습니다 ("${name}")`;
    }
    const tooLong = items.find((item) => item.length > FACILITY_ITEM_NAME_MAX);
    if (tooLong) return `비품 이름은 ${FACILITY_ITEM_NAME_MAX}자까지 입력할 수 있습니다: ${tooLong}`;

    if (draft.note.trim().length > ROOM_NOTE_MAX) {
      return `안내 문구는 ${ROOM_NOTE_MAX}자까지 입력할 수 있습니다 ("${name}")`;
    }

    // 같은 층에 같은 이름이 둘이면 목록·평면도에서 구분이 안 된다
    const key = `${room.floor} ${name}`;
    if (seen.has(key)) return `같은 층에 "${name}" 이름이 두 개 있습니다`;
    seen.add(key);
  }

  return null;
}

/** 설정 파일 기본값과 다르게 운영 중인 공간 수 — 편집 화면 안내용 */
export function countOverridden(building: FacilityBuilding, overrides: OverrideMap): number {
  let count = 0;
  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      if (overrides.has(room.id)) count += 1;
    }
  }
  return count;
}
