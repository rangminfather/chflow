/* ============================================================
   대표 공간 · 부속 공간

   체육관을 빌리면 그 층 화장실·샤워실·방송실은 따라온다. 예약 현황 목록에
   그것들까지 다 띄우면 길기만 하므로, 층마다 "대표 공간"을 세우고 나머지는
   거기에 묶어 감춘다. 신청할 때는 부속을 "이것도 쓰겠다"로 고를 수 있다(필수 아님).

   어디가 대표인지는
     1) 관리자가 공간 편집에서 지정한 값(parent_id 덮어쓰기)이 있으면 그것
     2) 없으면 kind 로 기본 분류 — room/hall 은 대표, 나머지는 부속
   순으로 정한다. 코드가 특정 공간을 임의로 고르지 않게 하려는 것이다.

   층에 대표가 하나도 없으면(전부 창고·복도인 층) 그 층은 모두 대표로 둔다.
   그래야 목록에서 통째로 사라지지 않는다.
   ============================================================ */

import type { FacilityBuilding, FacilityFloor, FacilityRoom } from "./facility-map-config";

/**
 * 기본값에서 "부속"으로 보는 공간 종류.
 * 화장실·샤워실(service), 창고(storage), 복도·홀·계단(corridor), 사무실(office)은
 * 그것만 따로 빌리는 사람이 없다. 주차장 같은 outdoor 는 실제로 빌리는 대상이라 대표로 둔다.
 */
const ANNEX_KINDS = new Set(["corridor", "storage", "service", "office"]);

export type RoomGroup = {
  primary: FacilityRoom;
  annexes: FacilityRoom[];
};

/** facility_id → 대표 공간 id ("" 또는 없음 = 대표) */
export type ParentMap = Map<string, string>;

/** 관리자가 "숨김" 으로 지정했을 때 parent_id 에 넣는 값 (공간 id 로 쓸 수 없는 문자) */
export const HIDDEN_PARENT = "-";

type Placement = "primary" | "annex" | "hidden";

/** 설정 파일 기준 처지 — 개별 지정(listAs)이 kind 기본값을 이긴다 */
function placementByConfig(room: FacilityRoom): Placement {
  if (room.listAs) return room.listAs;
  return ANNEX_KINDS.has(room.kind) ? "annex" : "primary";
}

/**
 * 한 층의 공간들을 대표별로 묶는다.
 * 대표 순서는 원래 배열 순서를 지킨다(평면도 배치 순서 = 사람이 이해하는 순서).
 */
export function groupFloorRooms(rooms: FacilityRoom[], parents?: ParentMap): RoomGroup[] {
  // 관리자 지정이 있으면 그것이, 없으면 설정 파일이 처지를 정한다
  const placementOf = (room: FacilityRoom): Placement => {
    const saved = parents?.get(room.id);
    if (saved === undefined) return placementByConfig(room);
    const value = saved.trim();
    if (value === "") return "primary";
    if (value === HIDDEN_PARENT) return "hidden";
    return "annex";
  };
  const explicitParent = (room: FacilityRoom): string => {
    const value = (parents?.get(room.id) ?? "").trim();
    return value === HIDDEN_PARENT ? "" : value;
  };

  // 빌릴 일이 없는 공간(층 공용 화장실·계단 등)은 아예 다루지 않는다
  const live = rooms.filter((room) => placementOf(room) !== "hidden");
  if (live.length === 0) return [];

  const primaryIds = new Set<string>();
  for (const room of live) {
    if (placementOf(room) === "primary") primaryIds.add(room.id);
  }
  // 대표가 하나도 없는 층은 전부 대표로 둔다 (목록에서 사라지지 않게)
  if (primaryIds.size === 0) {
    return live.map((room) => ({ primary: room, annexes: [] }));
  }
  rooms = live;

  const groups = new Map<string, RoomGroup>();
  for (const room of rooms) {
    if (primaryIds.has(room.id)) groups.set(room.id, { primary: room, annexes: [] });
  }

  const firstPrimaryId = rooms.find((room) => primaryIds.has(room.id))!.id;

  for (const room of rooms) {
    if (primaryIds.has(room.id)) continue;
    const wanted = explicitParent(room);
    // 지정된 대표가 이 층에 없으면 첫 대표에 붙인다
    const target = wanted !== "" && groups.has(wanted) ? wanted : firstPrimaryId;
    groups.get(target)!.annexes.push(room);
  }

  return [...groups.values()];
}

/** 건물 전체를 층 순서대로 묶는다 */
export function groupBuildingRooms(building: FacilityBuilding, parents?: ParentMap): {
  floor: FacilityFloor;
  groups: RoomGroup[];
}[] {
  return building.floors.map((floor) => ({ floor, groups: groupFloorRooms(floor.rooms, parents) }));
}

/** 예약 현황 표에 한 줄씩 올릴 대표 공간들 — 대여 가능한 곳만 */
export function listPrimaryRooms(
  buildings: FacilityBuilding[],
  parents?: ParentMap,
): { building: FacilityBuilding; floor: FacilityFloor; group: RoomGroup }[] {
  const rows: { building: FacilityBuilding; floor: FacilityFloor; group: RoomGroup }[] = [];
  for (const building of buildings) {
    for (const floor of building.floors) {
      for (const group of groupFloorRooms(floor.rooms, parents)) {
        if (!group.primary.reservable) continue;
        rows.push({ building, floor, group });
      }
    }
  }
  return rows;
}

/** 그 대표 공간에 딸린 부속 공간들 — 신청 화면의 선택 목록 */
export function annexesOf(
  buildings: FacilityBuilding[],
  facilityId: string,
  parents?: ParentMap,
): FacilityRoom[] {
  for (const building of buildings) {
    for (const floor of building.floors) {
      for (const group of groupFloorRooms(floor.rooms, parents)) {
        if (group.primary.id === facilityId) return group.annexes;
      }
    }
  }
  return [];
}
