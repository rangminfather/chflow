/* ============================================================
   시설물 사용신청 — 건물/층/공간 지도 설정

   건물 이름·위치·층 구성(지하 유무, 대여 불가 층 등)은 실제 캠퍼스 배치를
   반영했다. 다만 각 층의 세부 공간(방 이름·수용인원·비품)은 아직 확인 전이라
   층마다 "확인 필요" 자리표시 공간 하나만 넣어뒀다 — 확인되는 대로 해당 층의
   rooms 배열만 채우면 된다. block(x,y,w,d,h)의 배치 좌표는 실측이 아니라
   "명덕6길을 사이에 두고 비전센터가 맞은편에, 바울관·도서관이 명성교회 본당보다
   도로 쪽으로 나와 있는" 상대적 관계를 보여주기 위한 값이다.

   교체 지점
     1) 층별 세부 공간이 확인되면 해당 floor.rooms 배열을 채운다
        (지금 들어있는 "확인 필요" placeholder room을 실제 공간 목록으로 교체).
     2) 건물/층 구성 자체를 바꾸려면 아래 FACILITY_BUILDINGS 를 고친다.
     3) 실제 도면 SVG가 준비되면 components/facility/*Map.tsx 의 그리기 코드만
        갈아끼우고, 여기 id(=DB facility_id)와 신청 로직은 그대로 둔다.
     4) 나중에 시설 목록을 DB(facilities 테이블 등)로 옮길 경우,
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
// 층 슬러그 — B1 은 "b1", 지상층은 "1f"/"2f" 형태로 id에 쓴다
// -------------------------------------------------------------
function floorSlug(floor: number): string {
  return floor < 0 ? `b${-floor}` : `${floor}f`;
}

/** 세부 공간이 아직 확인되지 않은 층 — placeholder room 하나만 넣는다 */
function pendingFloor(building: string, floor: number, label: string): FacilityFloor {
  return {
    floor,
    label,
    planCols: 4,
    planRows: 3,
    rooms: [
      {
        id: `${building}-${floorSlug(floor)}-pending`,
        building,
        floor,
        name: label,
        kind: "room",
        capacity: null,
        reservable: false,
        facilities: [],
        note: "세부 공간 정보 확인 후 반영 예정",
        plan: { x: 0, y: 0, w: 4, h: 3 },
      },
    ],
  };
}

/** 건물 내부의 주차 전용 층(비전센터 1·2층 등) — 예약 대상 방이 아니라 주차 공간임을 표시 */
function parkingFloor(building: string, floor: number, label: string): FacilityFloor {
  return {
    floor,
    label,
    planCols: 4,
    planRows: 3,
    rooms: [
      {
        id: `${building}-${floorSlug(floor)}-parking`,
        building,
        floor,
        name: "주차장",
        kind: "outdoor",
        capacity: null,
        capacityUnit: "대",
        reservable: false,
        facilities: [],
        note: "주차 공간 — 신청 대상이 아닙니다",
        plan: { x: 0, y: 0, w: 4, h: 3 },
      },
    ],
  };
}

/** 지상 평면 주차장(바울관주차장·맑은숲도서관주차장) 한 동 전체 */
function surfaceParkingBuilding(code: string, name: string, block: IsoBox): FacilityBuilding {
  return {
    code,
    name,
    description: "지상 주차장",
    block,
    floors: [
      {
        floor: 1,
        label: "지상",
        planCols: 4,
        planRows: 3,
        rooms: [
          {
            id: `${code}-1f-lot`,
            building: code,
            floor: 1,
            name: "주차장",
            kind: "outdoor",
            capacity: null,
            capacityUnit: "대",
            reservable: false,
            facilities: [],
            note: "행사 시 사용 가능 여부 확인 필요",
            plan: { x: 0, y: 0, w: 4, h: 3 },
          },
        ],
      },
    ],
  };
}

// -------------------------------------------------------------
// 캠퍼스 건물 데이터
//
// 배치(block)는 명덕6길을 사이에 두고 비전센터가 맞은편에, 바울관·
// 맑은숲작은도서관이 명성교회 본당보다 도로 쪽으로 나와 본당을 좌우에서
// 감싸는 상대적 관계를 보여준다 — 실측 좌표가 아니다.
// -------------------------------------------------------------
export const FACILITY_BUILDINGS: FacilityBuilding[] = [
  surfaceParkingBuilding("baul-parking", "바울관주차장", { x: -1.8, y: 2.65, w: 1.3, d: 1.1, h: 0.3 }),
  {
    code: "baul",
    name: "바울관",
    description: "1~4층",
    block: { x: 2.1, y: 2.9, w: 1.7, d: 1.55, h: 4 },
    floors: [1, 2, 3, 4].map((floor) => pendingFloor("baul", floor, `${floor}층`)),
  },
  {
    code: "myungsung",
    name: "명성교회",
    description: "본당 (지하1층~3층)",
    block: { x: 4.3, y: 3.85, w: 2.6, d: 2.1, h: 4 },
    floors: [
      pendingFloor("myungsung", -1, "지하1층"),
      pendingFloor("myungsung", 1, "1층"),
      pendingFloor("myungsung", 2, "2층"),
      pendingFloor("myungsung", 3, "3층"),
    ],
  },
  {
    code: "library",
    name: "맑은숲작은도서관",
    description: "1~4층 (2·4층 대여 불가)",
    block: { x: 7.4, y: 2.9, w: 1.7, d: 1.55, h: 4 },
    floors: [
      {
        floor: 1,
        label: "1층",
        planCols: 4,
        planRows: 3,
        rooms: [
          { id: "library-1f-reading", building: "library", floor: 1, name: "도서관", kind: "room", capacity: null, reservable: true, facilities: [], note: "정확한 수용인원·비품은 확인 후 반영 예정", plan: { x: 0, y: 0, w: 4, h: 3 } },
        ],
      },
      {
        floor: 2,
        label: "2층",
        planCols: 4,
        planRows: 3,
        rooms: [
          { id: "library-2f-staff", building: "library", floor: 2, name: "교역자실", kind: "office", capacity: null, reservable: false, facilities: [], note: "교역자 전용 공간 — 대여 대상이 아닙니다", plan: { x: 0, y: 0, w: 4, h: 3 } },
        ],
      },
      {
        floor: 3,
        label: "3층",
        planCols: 4,
        planRows: 3,
        rooms: [
          { id: "library-3f-gathering", building: "library", floor: 3, name: "회집 장소", kind: "hall", capacity: null, reservable: true, facilities: [], note: "정확한 수용인원·비품은 확인 후 반영 예정", plan: { x: 0, y: 0, w: 4, h: 3 } },
        ],
      },
      {
        floor: 4,
        label: "4층",
        planCols: 4,
        planRows: 3,
        rooms: [
          { id: "library-4f-residence", building: "library", floor: 4, name: "관리집사님 생활공간", kind: "office", capacity: null, reservable: false, facilities: [], note: "관리집사님 사택 — 대여 대상이 아닙니다", plan: { x: 0, y: 0, w: 4, h: 3 } },
        ],
      },
    ],
  },
  surfaceParkingBuilding("library-parking", "맑은숲도서관주차장", { x: 9.9, y: 2.65, w: 1.3, d: 1.1, h: 0.3 }),
  {
    code: "vision",
    name: "명성교회 비전센터",
    description: "1~7층 + 옥상 (1·2층 주차장)",
    block: { x: 4.4, y: 0, w: 2.4, d: 1.9, h: 7.6 },
    floors: [
      parkingFloor("vision", 1, "1층"),
      parkingFloor("vision", 2, "2층"),
      pendingFloor("vision", 3, "3층"),
      pendingFloor("vision", 4, "4층"),
      pendingFloor("vision", 5, "5층"),
      pendingFloor("vision", 6, "6층"),
      pendingFloor("vision", 7, "7층"),
      pendingFloor("vision", 8, "옥상"),
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
