/* ============================================================
   시설 공간 — 관리자가 화면에서 고친 값 덮어쓰기

   공간이 무엇무엇 있는지, 평면도 어디에 놓이는지는 계속
   facility-map-config.ts 가 정한다. 여기서는 관리자가 고칠 수 있는
   두 가지(이름 / 대여 여부)만 그 위에 덮어쓴다.

   DB 쪽은 facility_room_overrides 테이블 +
   get_facility_room_overrides / save_facility_room_overrides RPC.
   (마이그레이션 20260903120000_facility_room_overrides.sql)

   설정 파일에서 사라진 공간의 덮어쓰기 행은 조용히 무시한다 —
   건물 구성이 바뀌었을 때 화면이 죽지 않게 하기 위해서다.
   ============================================================ */

import type { FacilityBuilding, FacilityFloor, FacilityRoom } from "./facility-map-config";

/** DB get_facility_room_overrides() 한 행 */
export type FacilityRoomOverride = {
  facility_id: string;
  name: string | null;
  reservable: boolean | null;
};

export type OverrideMap = Map<string, FacilityRoomOverride>;

/** 관리자 편집 화면이 다루는 값 — 공간 하나당 이름과 대여 여부뿐 */
export type RoomDraft = { name: string; reservable: boolean };

export const ROOM_NAME_MAX = 40;

export function toOverrideMap(rows: FacilityRoomOverride[] | null | undefined): OverrideMap {
  return new Map((rows ?? []).map((row) => [row.facility_id, row]));
}

/**
 * 설정 파일의 건물 목록 위에 덮어쓰기를 얹은 새 목록을 만든다.
 * 덮어쓸 값이 하나도 없는 건물·층은 원래 객체를 그대로 돌려줘서
 * 불필요한 리렌더를 만들지 않는다.
 */
export function applyOverrides(buildings: FacilityBuilding[], overrides: OverrideMap): FacilityBuilding[] {
  if (overrides.size === 0) return buildings;

  return buildings.map((building) => {
    let buildingChanged = false;

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

    return buildingChanged ? { ...building, floors } : building;
  });
}

function applyToRoom(room: FacilityRoom, override: FacilityRoomOverride | undefined): FacilityRoom {
  if (!override) return room;

  const name = normalizeName(override.name) ?? room.name;
  const reservable = typeof override.reservable === "boolean" ? override.reservable : room.reservable;
  if (name === room.name && reservable === room.reservable) return room;

  return { ...room, name, reservable };
}

function normalizeName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** 편집 화면 초기값 — 지금 화면에 보이는 값 그대로 */
export function draftFromRoom(room: FacilityRoom): RoomDraft {
  return { name: room.name, reservable: room.reservable };
}

/** 한 글자도 안 고쳤는지 */
export function isSameDraft(a: RoomDraft, b: RoomDraft): boolean {
  return a.name.trim() === b.name.trim() && a.reservable === b.reservable;
}

export type SavePayload = {
  rows: { facility_id: string; name: string; reservable: boolean }[];
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

    const matchesDefault = name === room.name && draft.reservable === room.reservable;
    if (matchesDefault) {
      if (overrides.has(room.id)) resets.push(room.id);
      continue;
    }
    rows.push({ facility_id: room.id, name, reservable: draft.reservable });
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
