/* ============================================================
   시설물 사용신청 — 건물/층/공간 데이터

   건물 이름·배치·층 구성은 실제 캠퍼스를 반영했다.

   모든 건물·모든 공간은 기본이 "대여 가능"이다. 무엇을 막을지는 코드가 아니라
   관리자가 시설 화면(공간 편집)에서 정한다. 건물 이름·설명도 관리자가 고칠 수 있고,
   그 값은 facility_building_overrides 에 쌓인다.
   층별 세부 공간은 **비전센터만** 건축도면 기준으로 채워져 있고,
   바울관·명성교회 본당은 아직 확인 전이라 층마다 자리표시 공간 하나만 있다.

   ── 비전센터 층 번호 주의 ────────────────────────────────
   건축도면(대영건축사사무소 A-301~402)의 층 이름과 교회에서 부르는 층 이름이
   한 층씩 다르다. 도면상 지하1층이 전면도로 높이(GL-200)에 있고 지상1층이
   3m 위(GL+3,000)에 있어서, 교회에서는 도면 지하1층을 "1층"으로 부른다.
   여기 floor 번호는 **교회에서 부르는 층**을 쓰고, 각 층 note 에 도면 층을
   같이 적어 뒀다.

       교회 1층 = 도면 지하1층 (주차장 18대)
       교회 2층 = 도면 지상1층 (필로티 주차장 20대)
       교회 3층 = 도면 지상2층 (유아부실·세미나실·Kids 도서관)
       교회 4층 = 도면 지상3층 (교육실·교사실·휴게음식점)
       교회 5층 = 도면 지상4층 (당회실·교육실·중고등부 교사실·게스트룸)
       교회 6층 = 도면 지상5층 (체육관·게스트룸·샤워실)
       교회 7층 = 도면 지상6층 (체육관 상부·세미나실·샤워실)

   이 대응이 실제와 다르면 아래 VISION_FLOOR_SHEET 주석과 각 층 note 만
   고치면 되고, id·신청 로직은 건드리지 않아도 된다.
   ────────────────────────────────────────────────────────

   교체 지점
     1) 층별 세부 공간이 확인되면 해당 floor.rooms 배열을 채운다
        (pendingFloor 로 만든 자리표시 공간을 실제 목록으로 교체).
     2) 건물/층 구성 자체를 바꾸려면 FACILITY_BUILDINGS 를 고친다.
     3) 지도 외곽선은 building.footprint — 좌표계 설명은 campus-map.ts.
     4) 나중에 시설 목록을 DB(facilities 테이블 등)로 옮길 경우,
        이 파일이 노출하는 조회 함수(findBuilding/findFloor/findRoom)의
        구현만 DB 조회로 바꾸면 화면 코드는 손대지 않아도 된다.

   화면 코드에는 시설명·facility_id 를 하드코딩하지 않는다. 전부 여기서 온다.
   ============================================================ */

import type { FacilityFootprint } from "./campus-map";

/** 공간 종류 — 예약 대상이 아닌 곳(복도/창고 등)도 위치 이해를 위해 그린다 */
export type FacilityRoomKind =
  | "room"
  | "hall"
  | "office"
  | "corridor"
  | "storage"
  | "service"
  | "outdoor";

/** 지도 이름표에 쓰는 아이콘 — 실제 lucide 아이콘은 그리는 쪽에서 고른다 */
export type FacilityIconKey = "church" | "vision" | "hall" | "library" | "parking";

/**
 * 안내도에서의 표시 종류.
 *   building — 건물. 세부 공간이 아직 확인 전이어도 눌러서 층 구성을 볼 수 있다.
 *   lot      — 포장된 지상 주차면. 건물이 아니므로 누를 수 없다.
 */
export type FacilityMapKind = "building" | "lot";

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
  iconKey: FacilityIconKey;
  mapKind: FacilityMapKind;
  /** 캠퍼스 안내도에서의 외곽선·이름표 위치 */
  footprint: FacilityFootprint;
  floors: FacilityFloor[];
};

// -------------------------------------------------------------
// 공통 안내 문구
// -------------------------------------------------------------

/** 도면에는 있으나 수용인원·비품을 아직 확인하지 못한 공간 */
const DETAIL_PENDING = "수용인원·비품은 임의 기본값 — 확인되면 관리자 화면에서 수정";

/** 비전센터 각 층이 도면상 몇 층인지 — note 앞에 붙인다 */
const VISION_FLOOR_SHEET: Record<number, string> = {
  1: "도면 지하1층",
  2: "도면 지상1층",
  3: "도면 지상2층",
  4: "도면 지상3층",
  5: "도면 지상4층",
  6: "도면 지상5층",
  7: "도면 지상6층",
  8: "도면 옥상층",
};

// -------------------------------------------------------------
// 층 슬러그 — B1 은 "b1", 지상층은 "1f"/"2f" 형태로 id에 쓴다
// -------------------------------------------------------------
function floorSlug(floor: number): string {
  return floor < 0 ? `b${-floor}` : `${floor}f`;
}

/** 세부 공간이 아직 확인되지 않은 층 — 자리표시 공간 하나만 넣는다 */
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
        reservable: true,
        facilities: [],
        note: "세부 공간은 확인 후 나눌 예정 — 지금은 층 전체로 신청합니다",
        plan: { x: 0, y: 0, w: 4, h: 3 },
      },
    ],
  };
}

/** 지상 평면 주차장(바울관주차장·맑은숲도서관주차장) 한 동 전체 */
function surfaceParkingBuilding(
  code: string,
  name: string,
  footprint: FacilityFootprint,
): FacilityBuilding {
  return {
    code,
    name,
    description: "지상 주차장",
    iconKey: "parking",
    mapKind: "lot",
    footprint,
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
            reservable: true,
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
// 비전센터 — 건축도면(A-301 ~ A-307) 기준 층별 공간
//
// 격자는 8칸 × 5칸이다. 도면의 실제 면적비가 아니라
//   · 위 3줄 = 주동 북측의 큰 방들
//   · 4번째 줄 = 복도·화장실
//   · 5번째 줄 = 남서측 별동·창고·계단/엘리베이터
// 라는 배치 관계만 지킨다.
// -------------------------------------------------------------

type VisionRoomSpec = Omit<FacilityRoom, "building" | "floor" | "note"> & { note?: string };

function visionFloor(floor: number, label: string, rooms: VisionRoomSpec[]): FacilityFloor {
  const sheet = VISION_FLOOR_SHEET[floor];
  return {
    floor,
    label,
    planCols: 8,
    planRows: 5,
    rooms: rooms.map((room) => ({
      ...room,
      building: "vision",
      floor,
      note: [sheet, room.note].filter(Boolean).join(" · "),
    })),
  };
}

const VISION_FLOORS: FacilityFloor[] = [
  visionFloor(1, "1층", [
    { id: "vision-1f-parking", name: "주차장", kind: "outdoor", capacity: 18, capacityUnit: "대", reservable: true, facilities: [], note: "주차 공간 — 신청 대상이 아닙니다", plan: { x: 0, y: 0, w: 6, h: 4 } },
    { id: "vision-1f-hall", name: "홀", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 0, w: 2, h: 2 } },
    { id: "vision-1f-storage", name: "창고", kind: "storage", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 2, w: 2, h: 1 } },
    { id: "vision-1f-stair", name: "계단·엘리베이터", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 3, w: 2, h: 2 } },
    { id: "vision-1f-electric", name: "전기실", kind: "office", capacity: null, reservable: true, facilities: [], plan: { x: 0, y: 4, w: 2, h: 1 } },
    { id: "vision-1f-safety", name: "방재실", kind: "office", capacity: null, reservable: true, facilities: [], plan: { x: 2, y: 4, w: 2, h: 1 } },
  ]),
  visionFloor(2, "2층", [
    { id: "vision-2f-parking", name: "주차장", kind: "outdoor", capacity: 20, capacityUnit: "대", reservable: true, facilities: [], note: "필로티 주차 공간 — 신청 대상이 아닙니다", plan: { x: 0, y: 0, w: 6, h: 4 } },
    { id: "vision-2f-queue", name: "대기차로", kind: "outdoor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 0, w: 2, h: 2 } },
    { id: "vision-2f-hall", name: "홀", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 2, w: 2, h: 1 } },
    { id: "vision-2f-stair", name: "계단·엘리베이터", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 3, w: 2, h: 2 } },
    { id: "vision-2f-gate", name: "차량 출입구", kind: "outdoor", capacity: null, reservable: true, facilities: [], plan: { x: 0, y: 4, w: 4, h: 1 } },
  ]),
  visionFloor(3, "3층", [
    { id: "vision-3f-infant", name: "유아부실", kind: "room", capacity: 20, reservable: true, facilities: ["냉난방기", "놀이매트"], note: `유아부 전용 공간 · ${DETAIL_PENDING}`, plan: { x: 0, y: 0, w: 3, h: 3 } },
    { id: "vision-3f-seminar", name: "세미나실", kind: "hall", capacity: 60, reservable: true, facilities: ["빔프로젝터", "스크린", "화이트보드", "냉난방기"], note: `층에서 가장 큰 공간 · ${DETAIL_PENDING}`, plan: { x: 3, y: 0, w: 3, h: 3 } },
    { id: "vision-3f-hall", name: "홀", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 0, w: 2, h: 2 } },
    { id: "vision-3f-kids-library", name: "Kids 도서관", kind: "room", capacity: 20, reservable: true, facilities: ["책상", "냉난방기"], note: DETAIL_PENDING, plan: { x: 6, y: 2, w: 2, h: 1 } },
    { id: "vision-3f-corridor", name: "복도", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 0, y: 3, w: 4, h: 1 } },
    { id: "vision-3f-restroom", name: "화장실", kind: "service", capacity: null, reservable: true, facilities: [], plan: { x: 4, y: 3, w: 2, h: 1 } },
    { id: "vision-3f-stair", name: "계단·엘리베이터", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 3, w: 2, h: 2 } },
    { id: "vision-3f-seminar-annex", name: "세미나실(별동)", kind: "hall", capacity: 30, reservable: true, facilities: ["빔프로젝터", "화이트보드", "냉난방기"], note: `남서측 45° 별동 · ${DETAIL_PENDING}`, plan: { x: 0, y: 4, w: 3, h: 1 } },
    { id: "vision-3f-support", name: "부속실", kind: "office", capacity: null, reservable: true, facilities: [], plan: { x: 3, y: 4, w: 1, h: 1 } },
    { id: "vision-3f-storage", name: "창고", kind: "storage", capacity: null, reservable: true, facilities: [], plan: { x: 4, y: 4, w: 2, h: 1 } },
  ]),
  visionFloor(4, "4층", [
    { id: "vision-4f-class1", name: "교육실1", kind: "room", capacity: 30, reservable: true, facilities: ["빔프로젝터", "화이트보드", "냉난방기"], note: DETAIL_PENDING, plan: { x: 0, y: 0, w: 2, h: 3 } },
    { id: "vision-4f-teacher1", name: "교사실1", kind: "office", capacity: null, reservable: true, facilities: [], note: "부서 교사 전용 — 사용 가능 여부 확인 필요", plan: { x: 2, y: 0, w: 2, h: 1 } },
    { id: "vision-4f-teacher2", name: "교사실2", kind: "office", capacity: null, reservable: true, facilities: [], note: "부서 교사 전용 — 사용 가능 여부 확인 필요", plan: { x: 2, y: 1, w: 2, h: 1 } },
    { id: "vision-4f-teacher3", name: "교사실3", kind: "office", capacity: null, reservable: true, facilities: [], note: "부서 교사 전용 — 사용 가능 여부 확인 필요", plan: { x: 2, y: 2, w: 2, h: 1 } },
    { id: "vision-4f-class2", name: "교육실2", kind: "room", capacity: 30, reservable: true, facilities: ["빔프로젝터", "화이트보드", "냉난방기"], note: DETAIL_PENDING, plan: { x: 4, y: 0, w: 2, h: 3 } },
    { id: "vision-4f-hall", name: "홀", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 0, w: 2, h: 2 } },
    { id: "vision-4f-class3", name: "교육실3", kind: "room", capacity: 24, reservable: true, facilities: ["화이트보드", "냉난방기"], note: DETAIL_PENDING, plan: { x: 6, y: 2, w: 2, h: 1 } },
    { id: "vision-4f-corridor", name: "복도", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 0, y: 3, w: 4, h: 1 } },
    { id: "vision-4f-restroom", name: "화장실", kind: "service", capacity: null, reservable: true, facilities: [], plan: { x: 4, y: 3, w: 2, h: 1 } },
    { id: "vision-4f-stair", name: "계단·엘리베이터", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 3, w: 2, h: 2 } },
    { id: "vision-4f-cafe", name: "카페테리아", kind: "room", capacity: 40, reservable: true, facilities: ["싱크대", "냉장고", "정수기", "냉난방기"], note: `도면상 휴게음식점 · ${DETAIL_PENDING}`, plan: { x: 0, y: 4, w: 3, h: 1 } },
    { id: "vision-4f-storage", name: "창고", kind: "storage", capacity: null, reservable: true, facilities: [], plan: { x: 3, y: 4, w: 3, h: 1 } },
  ]),
  visionFloor(5, "5층", [
    { id: "vision-5f-council", name: "당회실", kind: "room", capacity: 20, reservable: true, facilities: ["회의탁자", "빔프로젝터", "냉난방기"], note: DETAIL_PENDING, plan: { x: 0, y: 0, w: 2, h: 3 } },
    { id: "vision-5f-class", name: "교육실", kind: "room", capacity: 40, reservable: true, facilities: ["빔프로젝터", "화이트보드", "냉난방기"], note: DETAIL_PENDING, plan: { x: 2, y: 0, w: 4, h: 3 } },
    { id: "vision-5f-mid1", name: "중등부교사실1", kind: "office", capacity: null, reservable: true, facilities: [], note: "부서 교사 전용 — 사용 가능 여부 확인 필요", plan: { x: 6, y: 0, w: 2, h: 1 } },
    { id: "vision-5f-high1", name: "고등부교사실1", kind: "office", capacity: null, reservable: true, facilities: [], note: "부서 교사 전용 — 사용 가능 여부 확인 필요", plan: { x: 6, y: 1, w: 2, h: 1 } },
    { id: "vision-5f-mid2", name: "중등부교사실2", kind: "office", capacity: null, reservable: true, facilities: [], note: "부서 교사 전용 — 사용 가능 여부 확인 필요", plan: { x: 6, y: 2, w: 2, h: 1 } },
    { id: "vision-5f-corridor", name: "복도", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 0, y: 3, w: 4, h: 1 } },
    { id: "vision-5f-restroom", name: "화장실", kind: "service", capacity: null, reservable: true, facilities: [], plan: { x: 4, y: 3, w: 2, h: 1 } },
    { id: "vision-5f-high2", name: "고등부교사실2", kind: "office", capacity: null, reservable: true, facilities: [], note: "부서 교사 전용 — 사용 가능 여부 확인 필요", plan: { x: 6, y: 3, w: 2, h: 1 } },
    { id: "vision-5f-guest", name: "게스트룸", kind: "room", capacity: 4, reservable: true, facilities: ["침구", "샤워실", "냉난방기"], note: `남서측 45° 별동 · ${DETAIL_PENDING}`, plan: { x: 0, y: 4, w: 3, h: 1 } },
    { id: "vision-5f-storage", name: "창고", kind: "storage", capacity: null, reservable: true, facilities: [], plan: { x: 3, y: 4, w: 2, h: 1 } },
    { id: "vision-5f-stair", name: "계단·엘리베이터", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 5, y: 4, w: 3, h: 1 } },
  ]),
  visionFloor(6, "6층", [
    { id: "vision-6f-gym", name: "체육관", kind: "hall", capacity: 100, reservable: true, facilities: ["음향설비", "냉난방기"], note: `2개 층 높이 · 실내화 지참 · ${DETAIL_PENDING}`, plan: { x: 0, y: 0, w: 8, h: 3 } },
    { id: "vision-6f-storage", name: "창고", kind: "storage", capacity: null, reservable: true, facilities: [], plan: { x: 0, y: 3, w: 1, h: 1 } },
    { id: "vision-6f-laundry", name: "세탁실", kind: "service", capacity: null, reservable: true, facilities: [], plan: { x: 1, y: 3, w: 1, h: 1 } },
    { id: "vision-6f-locker-w", name: "탈의실(여)", kind: "service", capacity: null, reservable: true, facilities: [], plan: { x: 2, y: 3, w: 2, h: 1 } },
    { id: "vision-6f-shower-w", name: "샤워실(여)", kind: "service", capacity: null, reservable: true, facilities: [], plan: { x: 4, y: 3, w: 2, h: 1 } },
    { id: "vision-6f-hall", name: "홀", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 3, w: 2, h: 1 } },
    { id: "vision-6f-guest", name: "게스트룸", kind: "room", capacity: 4, reservable: true, facilities: ["침구", "샤워실", "냉난방기"], note: `남서측 45° 별동 · ${DETAIL_PENDING}`, plan: { x: 0, y: 4, w: 3, h: 1 } },
    { id: "vision-6f-roofdeck", name: "옥상", kind: "outdoor", capacity: null, reservable: true, facilities: [], note: "동측 저층부 옥상", plan: { x: 3, y: 4, w: 2, h: 1 } },
    { id: "vision-6f-stair", name: "계단·엘리베이터", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 5, y: 4, w: 3, h: 1 } },
  ]),
  visionFloor(7, "7층", [
    { id: "vision-7f-gym-void", name: "체육관 상부", kind: "hall", capacity: null, reservable: true, facilities: [], note: "6층 체육관의 위쪽이 열린 공간 — 따로 신청할 수 없습니다", plan: { x: 0, y: 0, w: 8, h: 3 } },
    { id: "vision-7f-storage", name: "창고", kind: "storage", capacity: null, reservable: true, facilities: [], plan: { x: 0, y: 3, w: 1, h: 1 } },
    { id: "vision-7f-locker-m", name: "탈의실(남)", kind: "service", capacity: null, reservable: true, facilities: [], plan: { x: 1, y: 3, w: 2, h: 1 } },
    { id: "vision-7f-shower-m", name: "샤워실(남)", kind: "service", capacity: null, reservable: true, facilities: [], plan: { x: 3, y: 3, w: 2, h: 1 } },
    { id: "vision-7f-hall", name: "홀", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 5, y: 3, w: 1, h: 1 } },
    { id: "vision-7f-storage-east", name: "창고(동측)", kind: "storage", capacity: null, reservable: true, facilities: [], plan: { x: 6, y: 3, w: 2, h: 1 } },
    { id: "vision-7f-seminar", name: "세미나실", kind: "hall", capacity: 30, reservable: true, facilities: ["빔프로젝터", "화이트보드", "냉난방기"], note: `남서측 45° 별동 · ${DETAIL_PENDING}`, plan: { x: 0, y: 4, w: 3, h: 1 } },
    { id: "vision-7f-stair", name: "계단·엘리베이터", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 5, y: 4, w: 3, h: 1 } },
  ]),
  visionFloor(8, "옥상", [
    { id: "vision-roof-deck", name: "옥상", kind: "outdoor", capacity: null, reservable: true, facilities: [], note: "설비·피난 공간 — 사용 가능 여부 확인 필요", plan: { x: 0, y: 0, w: 8, h: 4 } },
    { id: "vision-roof-stair", name: "계단·엘리베이터", kind: "corridor", capacity: null, reservable: true, facilities: [], plan: { x: 0, y: 4, w: 8, h: 1 } },
  ]),
];

// -------------------------------------------------------------
// 캠퍼스 건물 데이터
//
// footprint 좌표계·배치 근거는 campus-map.ts 주석 참고.
// -------------------------------------------------------------
export const FACILITY_BUILDINGS: FacilityBuilding[] = [
  {
    code: "vision",
    name: "명성교회 비전센터",
    description: "1~7층 + 옥상 (1·2층 주차장)",
    iconKey: "vision",
    mapKind: "building",
    footprint: {
      // 동서 33.8m 주동 + 동측 남향 돌출부 + 남서측 45° 별동
      points: [
        { x: 250, y: 44 },
        { x: 580, y: 44 },
        { x: 580, y: 215 },
        { x: 536, y: 215 },
        { x: 536, y: 160 },
        { x: 318, y: 160 },
        { x: 244, y: 234 },
        { x: 176, y: 234 },
        { x: 250, y: 160 },
      ],
      pin: { x: 415, y: 96 },
      labelLines: ["명성교회", "비전센터"],
    },
    floors: VISION_FLOORS,
  },
  surfaceParkingBuilding("baul-parking", "바울관주차장", {
    points: [
      { x: 20, y: 330 },
      { x: 156, y: 324 },
      { x: 160, y: 448 },
      { x: 24, y: 456 },
    ],
    pin: { x: 90, y: 388 },
    labelLines: ["바울관", "주차장"],
  }),
  {
    code: "baul",
    name: "바울관",
    description: "1~4층",
    iconKey: "hall",
    mapKind: "building",
    footprint: {
      points: [
        { x: 200, y: 340 },
        { x: 334, y: 350 },
        { x: 324, y: 500 },
        { x: 194, y: 488 },
      ],
      pin: { x: 264, y: 416 },
    },
    floors: [1, 2, 3, 4].map((floor) => pendingFloor("baul", floor, `${floor}층`)),
  },
  {
    code: "library",
    name: "맑은숲작은도서관",
    description: "1~4층 (2·4층 대여 불가)",
    iconKey: "library",
    mapKind: "building",
    footprint: {
      points: [
        { x: 404, y: 362 },
        { x: 552, y: 372 },
        { x: 544, y: 492 },
        { x: 398, y: 480 },
      ],
      pin: { x: 474, y: 420 },
      labelLines: ["맑은숲", "작은도서관"],
    },
    floors: [
      {
        floor: 1,
        label: "1층",
        planCols: 4,
        planRows: 3,
        rooms: [
          { id: "library-1f-reading", building: "library", floor: 1, name: "도서관", kind: "room", capacity: 30, reservable: true, facilities: ["책상", "냉난방기"], note: DETAIL_PENDING, plan: { x: 0, y: 0, w: 4, h: 3 } },
        ],
      },
      {
        floor: 2,
        label: "2층",
        planCols: 4,
        planRows: 3,
        rooms: [
          { id: "library-2f-staff", building: "library", floor: 2, name: "교역자실", kind: "office", capacity: null, reservable: true, facilities: [], note: "교역자 전용 공간 — 대여 대상이 아닙니다", plan: { x: 0, y: 0, w: 4, h: 3 } },
        ],
      },
      {
        floor: 3,
        label: "3층",
        planCols: 4,
        planRows: 3,
        rooms: [
          { id: "library-3f-gathering", building: "library", floor: 3, name: "회집 장소", kind: "hall", capacity: 40, reservable: true, facilities: ["빔프로젝터", "음향설비", "냉난방기"], note: DETAIL_PENDING, plan: { x: 0, y: 0, w: 4, h: 3 } },
        ],
      },
      {
        floor: 4,
        label: "4층",
        planCols: 4,
        planRows: 3,
        rooms: [
          { id: "library-4f-residence", building: "library", floor: 4, name: "관리집사님 생활공간", kind: "office", capacity: null, reservable: true, facilities: [], note: "관리집사님 사택 — 대여 대상이 아닙니다", plan: { x: 0, y: 0, w: 4, h: 3 } },
        ],
      },
    ],
  },
  surfaceParkingBuilding("library-parking", "맑은숲도서관주차장", {
    points: [
      { x: 588, y: 372 },
      { x: 704, y: 380 },
      { x: 698, y: 500 },
      { x: 582, y: 492 },
    ],
    pin: { x: 643, y: 430 },
    labelLines: ["도서관", "주차장"],
  }),
  {
    code: "myungsung",
    name: "명성교회",
    description: "본당 (지하1층~3층)",
    iconKey: "church",
    mapKind: "building",
    footprint: {
      points: [
        { x: 26, y: 512 },
        { x: 286, y: 528 },
        { x: 286, y: 586 },
        { x: 382, y: 596 },
        { x: 374, y: 700 },
        { x: 250, y: 748 },
        { x: 108, y: 740 },
        { x: 24, y: 672 },
      ],
      pin: { x: 150, y: 618 },
    },
    floors: [
      pendingFloor("myungsung", -1, "지하1층"),
      pendingFloor("myungsung", 1, "1층"),
      pendingFloor("myungsung", 2, "2층"),
      pendingFloor("myungsung", 3, "3층"),
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

/* 관리자가 화면에서 고친 이름·대여 여부는 facility-overrides.ts 가 이 목록 위에
   덮어써서 **새 배열**을 만든다. 그래서 조회는 "어떤 배열에서 찾을지"를 받는
   *In 함수가 본체이고, 아래 findBuilding/findFloor/findRoom 은 설정 파일
   원본에서 찾는 지름길이다. 화면 코드는 덮어쓴 배열을 쓰도록 *In 을 쓴다. */

export function findBuildingIn(
  buildings: FacilityBuilding[],
  code: string | null | undefined,
): FacilityBuilding | null {
  if (!code) return null;
  return buildings.find((b) => b.code === code) ?? null;
}

export function findFloorIn(
  buildings: FacilityBuilding[],
  code: string | null | undefined,
  floor: number | null | undefined,
): FacilityFloor | null {
  const building = findBuildingIn(buildings, code);
  if (!building || floor === null || floor === undefined) return null;
  return building.floors.find((f) => f.floor === floor) ?? null;
}

export function findRoomIn(buildings: FacilityBuilding[], id: string | null | undefined): FacilityRoom | null {
  if (!id) return null;
  for (const building of buildings) {
    for (const floor of building.floors) {
      const room = floor.rooms.find((r) => r.id === id);
      if (room) return room;
    }
  }
  return null;
}

export function findBuilding(code: string | null | undefined): FacilityBuilding | null {
  return findBuildingIn(FACILITY_BUILDINGS, code);
}

export function findFloor(code: string | null | undefined, floor: number | null | undefined): FacilityFloor | null {
  return findFloorIn(FACILITY_BUILDINGS, code, floor);
}

export function findRoom(id: string | null | undefined): FacilityRoom | null {
  return findRoomIn(FACILITY_BUILDINGS, id);
}

/** 예약 가능한 공간만 */
export function listReservableRooms(): FacilityRoom[] {
  return FACILITY_BUILDINGS.flatMap((b) => b.floors.flatMap((f) => f.rooms.filter((r) => r.reservable)));
}

/** 한 층에서 신청 가능한 공간 수 */
export function countReservableRooms(floor: FacilityFloor): number {
  return floor.rooms.filter((r) => r.reservable).length;
}

/** 건물 전체에 신청 가능한 공간이 하나라도 있는지 — 지도에서 누를 수 있는지의 기준 */
export function isBuildingSelectable(building: FacilityBuilding): boolean {
  return building.floors.some((floor) => floor.rooms.some((room) => room.reservable));
}

/** 그 층에서 이름을 보여줄 대표 공간들 — 층 목록 한 줄 요약용 */
export function summarizeFloor(floor: FacilityFloor, limit = 3): string {
  const names = floor.rooms.filter((r) => r.reservable).map((r) => r.name);
  const pool = names.length > 0 ? names : floor.rooms.map((r) => r.name);
  const shown = pool.slice(0, limit).join(" · ");
  return pool.length > limit ? `${shown} 외 ${pool.length - limit}곳` : shown;
}

/** "비전센터 · 3층 · 세미나실" — 목록·신청내역에서 공통으로 쓰는 표기 */
export function formatRoomPathIn(buildings: FacilityBuilding[], room: FacilityRoom): string {
  const building = findBuildingIn(buildings, room.building);
  const floor = findFloorIn(buildings, room.building, room.floor);
  return [building?.name ?? room.building, floor?.label ?? `${room.floor}층`, room.name].join(" · ");
}

export function formatRoomPath(room: FacilityRoom): string {
  return formatRoomPathIn(FACILITY_BUILDINGS, room);
}

/** 수용인원 표기 — 단위가 다른 공간(주차 "대")도 여기서 처리 */
export function formatCapacity(room: FacilityRoom): string | null {
  if (room.capacity === null) return null;
  return `수용인원 ${room.capacity}${room.capacityUnit ?? "명"}`;
}
