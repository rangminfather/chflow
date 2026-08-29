/* ============================================================
   시설물 사용신청 — 건물/층/공간 지도 설정

   이 파일의 건물·층·공간 목록은 **임시 안내용 데이터**다.
   실제 CAD/BIM/건축도면이 없는 상태에서 "어느 건물의 몇 층, 어느 공간을
   신청하는지"를 사용자가 이해하도록 만든 모형이며, 실제 면적비·배치와
   일치하지 않는다. 실제 공간 목록·수용인원·비품은 확인 후 교체해야 한다.

   교체 지점
     1) 건물/층/공간을 바꾸려면 아래 FACILITY_BUILDINGS 만 고친다.
     2) 실제 도면 SVG가 준비되면 components/facility/*Map.tsx 의 그리기 코드만
        갈아끼우고, 여기 id(=DB facility_id)와 신청 로직은 그대로 둔다.
     3) 나중에 시설 목록을 DB(facilities 테이블 등)로 옮길 경우,
        이 파일이 노출하는 조회 함수(findBuilding/findFloor/findRoom)의
        구현만 DB 조회로 바꾸면 화면 코드는 손대지 않아도 된다.

   화면 코드에는 시설명·facility_id 를 하드코딩하지 않는다. 전부 여기서 온다.
   ============================================================ */

import type { IsoBox } from "./isometric";

/** 공간 종류 — 예약 대상이 아닌 곳(복도/창고 등)도 위치 이해를 위해 그린다 */
export type FacilityRoomKind = "room" | "hall" | "office" | "corridor" | "storage" | "outdoor";

/** 평면도 배치 — 격자 칸 단위. 실제 면적비가 아니라 "누르기 쉬운 크기" 기준 */
export type FacilityPlanRect = { x: number; y: number; w: number; h: number };

export type FacilityRoom = {
  /** DB facility_bookings.facility_id 에 그대로 저장되는 값 */
  id: string;
  building: string;
  floor: number;
  name: string;
  kind: FacilityRoomKind;
  /** 수용 인원(또는 주차 대수). 모르면 null */
  capacity: number | null;
  /** 수용 단위 — 기본 "명" */
  capacityUnit?: string;
  reservable: boolean;
  /** 비품·설비 */
  facilities: string[];
  /** 신청 화면에 함께 보여줄 안내 문구 */
  note?: string;
  plan: FacilityPlanRect;
};

export type FacilityFloor = {
  floor: number;
  label: string;
  /** 평면도 격자 크기 */
  planCols: number;
  planRows: number;
  rooms: FacilityRoom[];
};

export type FacilityBuilding = {
  /** DB facility_bookings.building_code 에 저장되는 값 */
  code: string;
  name: string;
  description: string;
  /** 건물도에서의 위치·크기(격자 단위). 실제 대지 배치가 아니라 안내용 배치 */
  block: IsoBox;
  floors: FacilityFloor[];
};

// -------------------------------------------------------------
// 임시 건물 데이터
// -------------------------------------------------------------
export const FACILITY_BUILDINGS: FacilityBuilding[] = [
  {
    code: "main",
    name: "본관",
    description: "예배실·회의실",
    block: { x: 0, y: 0, w: 4, d: 3, h: 3 },
    floors: [
      {
        floor: 1,
        label: "1층",
        planCols: 6,
        planRows: 4,
        rooms: [
          { id: "main-1f-sanctuary", building: "main", floor: 1, name: "대예배실", kind: "hall", capacity: 800, reservable: true, facilities: ["음향", "빔프로젝터", "냉난방"], note: "예배 일정과 겹치지 않는 시간만 승인됩니다", plan: { x: 0, y: 0, w: 4, h: 3 } },
          { id: "main-1f-lobby", building: "main", floor: 1, name: "로비", kind: "corridor", capacity: null, reservable: false, facilities: [], plan: { x: 4, y: 0, w: 2, h: 2 } },
          { id: "main-1f-prayer", building: "main", floor: 1, name: "기도실", kind: "room", capacity: 20, reservable: true, facilities: ["냉난방"], plan: { x: 4, y: 2, w: 2, h: 1 } },
          { id: "main-1f-info", building: "main", floor: 1, name: "안내실", kind: "office", capacity: null, reservable: false, facilities: [], plan: { x: 0, y: 3, w: 2, h: 1 } },
          { id: "main-1f-cafe", building: "main", floor: 1, name: "카페", kind: "room", capacity: 40, reservable: true, facilities: ["냉난방", "싱크대"], plan: { x: 2, y: 3, w: 4, h: 1 } },
        ],
      },
      {
        floor: 2,
        label: "2층",
        planCols: 6,
        planRows: 4,
        rooms: [
          { id: "main-2f-chapel", building: "main", floor: 2, name: "소예배실", kind: "hall", capacity: 150, reservable: true, facilities: ["음향", "빔프로젝터", "냉난방"], plan: { x: 0, y: 0, w: 3, h: 2 } },
          { id: "main-2f-conference", building: "main", floor: 2, name: "대회의실", kind: "room", capacity: 40, reservable: true, facilities: ["빔프로젝터", "화상회의", "냉난방"], plan: { x: 3, y: 0, w: 3, h: 2 } },
          { id: "main-2f-office", building: "main", floor: 2, name: "사무실", kind: "office", capacity: null, reservable: false, facilities: [], plan: { x: 0, y: 2, w: 2, h: 2 } },
          { id: "main-2f-201", building: "main", floor: 2, name: "201호", kind: "room", capacity: 30, reservable: true, facilities: ["빔프로젝터", "냉난방"], plan: { x: 2, y: 2, w: 2, h: 2 } },
          { id: "main-2f-202", building: "main", floor: 2, name: "202호", kind: "room", capacity: 30, reservable: true, facilities: ["냉난방"], plan: { x: 4, y: 2, w: 2, h: 2 } },
        ],
      },
      {
        floor: 3,
        label: "3층",
        planCols: 6,
        planRows: 3,
        rooms: [
          { id: "main-3f-hall", building: "main", floor: 3, name: "다목적홀", kind: "hall", capacity: 200, reservable: true, facilities: ["음향", "빔프로젝터", "냉난방"], plan: { x: 0, y: 0, w: 4, h: 3 } },
          { id: "main-3f-301", building: "main", floor: 3, name: "301호", kind: "room", capacity: 25, reservable: true, facilities: ["냉난방"], plan: { x: 4, y: 0, w: 2, h: 1 } },
          { id: "main-3f-302", building: "main", floor: 3, name: "302호", kind: "room", capacity: 25, reservable: true, facilities: ["냉난방"], plan: { x: 4, y: 1, w: 2, h: 1 } },
          { id: "main-3f-storage", building: "main", floor: 3, name: "창고", kind: "storage", capacity: null, reservable: false, facilities: [], plan: { x: 4, y: 2, w: 2, h: 1 } },
        ],
      },
    ],
  },
  {
    code: "education",
    name: "교육관",
    description: "교육실·체육관",
    block: { x: 4.7, y: 0, w: 3.2, d: 3, h: 4 },
    floors: [
      {
        floor: 1,
        label: "1층",
        planCols: 6,
        planRows: 3,
        rooms: [
          { id: "education-1f-hall", building: "education", floor: 1, name: "교육관홀", kind: "hall", capacity: 120, reservable: true, facilities: ["음향", "냉난방"], plan: { x: 0, y: 0, w: 4, h: 3 } },
          { id: "education-1f-101", building: "education", floor: 1, name: "101호", kind: "room", capacity: 25, reservable: true, facilities: ["냉난방"], plan: { x: 4, y: 0, w: 2, h: 1 } },
          { id: "education-1f-102", building: "education", floor: 1, name: "102호", kind: "room", capacity: 25, reservable: true, facilities: ["냉난방"], plan: { x: 4, y: 1, w: 2, h: 1 } },
          { id: "education-1f-kitchen", building: "education", floor: 1, name: "조리실", kind: "office", capacity: null, reservable: false, facilities: [], plan: { x: 4, y: 2, w: 2, h: 1 } },
        ],
      },
      {
        floor: 2,
        label: "2층",
        planCols: 6,
        planRows: 3,
        rooms: [
          { id: "education-2f-201", building: "education", floor: 2, name: "201호", kind: "room", capacity: 35, reservable: true, facilities: ["빔프로젝터", "냉난방"], plan: { x: 0, y: 0, w: 2, h: 2 } },
          { id: "education-2f-202", building: "education", floor: 2, name: "202호", kind: "room", capacity: 35, reservable: true, facilities: ["빔프로젝터", "냉난방"], plan: { x: 2, y: 0, w: 2, h: 2 } },
          { id: "education-2f-meeting", building: "education", floor: 2, name: "회의실", kind: "room", capacity: 12, reservable: true, facilities: ["화상회의", "냉난방"], plan: { x: 4, y: 0, w: 2, h: 2 } },
          { id: "education-2f-corridor", building: "education", floor: 2, name: "복도", kind: "corridor", capacity: null, reservable: false, facilities: [], plan: { x: 0, y: 2, w: 5, h: 1 } },
          { id: "education-2f-storage", building: "education", floor: 2, name: "창고", kind: "storage", capacity: null, reservable: false, facilities: [], plan: { x: 5, y: 2, w: 1, h: 1 } },
        ],
      },
      {
        floor: 3,
        label: "3층",
        planCols: 6,
        planRows: 3,
        rooms: [
          { id: "education-3f-301", building: "education", floor: 3, name: "301호", kind: "room", capacity: 30, reservable: true, facilities: ["빔프로젝터", "냉난방"], plan: { x: 0, y: 0, w: 2, h: 2 } },
          { id: "education-3f-302", building: "education", floor: 3, name: "302호", kind: "room", capacity: 30, reservable: true, facilities: ["냉난방"], plan: { x: 2, y: 0, w: 2, h: 2 } },
          { id: "education-3f-303", building: "education", floor: 3, name: "303호", kind: "room", capacity: 20, reservable: true, facilities: ["냉난방"], plan: { x: 4, y: 0, w: 2, h: 2 } },
          { id: "education-3f-corridor", building: "education", floor: 3, name: "복도", kind: "corridor", capacity: null, reservable: false, facilities: [], plan: { x: 0, y: 2, w: 6, h: 1 } },
        ],
      },
      {
        floor: 4,
        label: "4층",
        planCols: 6,
        planRows: 3,
        rooms: [
          { id: "education-4f-gym", building: "education", floor: 4, name: "체육관", kind: "hall", capacity: 150, reservable: true, facilities: ["음향", "냉난방"], note: "실내화 지참", plan: { x: 0, y: 0, w: 4, h: 3 } },
          { id: "education-4f-401", building: "education", floor: 4, name: "401호", kind: "room", capacity: 20, reservable: true, facilities: ["냉난방"], plan: { x: 4, y: 0, w: 2, h: 1 } },
          { id: "education-4f-storage", building: "education", floor: 4, name: "창고", kind: "storage", capacity: null, reservable: false, facilities: [], plan: { x: 4, y: 1, w: 2, h: 2 } },
        ],
      },
    ],
  },
  {
    code: "parking",
    name: "주차장",
    description: "주차 구역·야외",
    block: { x: 0, y: 3.7, w: 7.9, d: 2, h: 0.35 },
    floors: [
      {
        floor: 1,
        label: "지상",
        planCols: 6,
        planRows: 3,
        rooms: [
          { id: "parking-1f-area-a", building: "parking", floor: 1, name: "A구역", kind: "outdoor", capacity: 40, capacityUnit: "대", reservable: true, facilities: [], note: "행사 시 구역 통제용", plan: { x: 0, y: 0, w: 3, h: 2 } },
          { id: "parking-1f-area-b", building: "parking", floor: 1, name: "B구역", kind: "outdoor", capacity: 30, capacityUnit: "대", reservable: true, facilities: [], plan: { x: 3, y: 0, w: 3, h: 2 } },
          { id: "parking-1f-plaza", building: "parking", floor: 1, name: "야외마당", kind: "outdoor", capacity: 200, reservable: true, facilities: ["전기 콘센트"], plan: { x: 0, y: 2, w: 6, h: 1 } },
        ],
      },
    ],
  },
];

// -------------------------------------------------------------
// 조회 헬퍼 — 화면 코드는 이 함수들만 쓴다.
// (시설 목록이 DB로 옮겨가면 여기 구현만 교체)
// -------------------------------------------------------------

export function listBuildings(): FacilityBuilding[] {
  return FACILITY_BUILDINGS;
}

export function findBuilding(code: string | null | undefined): FacilityBuilding | null {
  if (!code) return null;
  return FACILITY_BUILDINGS.find((b) => b.code === code) ?? null;
}

export function findFloor(code: string | null | undefined, floor: number | null | undefined): FacilityFloor | null {
  const building = findBuilding(code);
  if (!building || floor === null || floor === undefined) return null;
  return building.floors.find((f) => f.floor === floor) ?? null;
}

export function findRoom(id: string | null | undefined): FacilityRoom | null {
  if (!id) return null;
  for (const building of FACILITY_BUILDINGS) {
    for (const floor of building.floors) {
      const room = floor.rooms.find((r) => r.id === id);
      if (room) return room;
    }
  }
  return null;
}

/** 예약 가능한 공간만 */
export function listReservableRooms(): FacilityRoom[] {
  return FACILITY_BUILDINGS.flatMap((b) => b.floors.flatMap((f) => f.rooms.filter((r) => r.reservable)));
}

/** "교육관 · 2층 · 201호" — 목록·신청내역에서 공통으로 쓰는 표기 */
export function formatRoomPath(room: FacilityRoom): string {
  const building = findBuilding(room.building);
  const floor = findFloor(room.building, room.floor);
  return [building?.name ?? room.building, floor?.label ?? `${room.floor}층`, room.name].join(" · ");
}

/** 수용인원 표기 — 단위가 다른 공간(주차 "대")도 여기서 처리 */
export function formatCapacity(room: FacilityRoom): string | null {
  if (room.capacity === null) return null;
  return `수용인원 ${room.capacity}${room.capacityUnit ?? "명"}`;
}
