import { describe, expect, it } from "vitest";
import type { FacilityRoom } from "./facility-map-config";
import {
  FACILITY_BUILDINGS,
  countReservableRooms,
  findBuilding,
  findFloor,
  findRoom,
  formatCapacity,
  formatRoomPath,
  isBuildingSelectable,
  listReservableRooms,
  summarizeFloor,
} from "./facility-map-config";
import type { MapPoint } from "./campus-map";
import { CAMPUS_VIEW, polygonPoints, toPercent } from "./campus-map";

/* 안내도는 설정 파일만 갈아끼워 교체할 수 있어야 한다.
   그 전제(id 유일성·격자 범위·이름표가 건물 안에 있음)를 깨면 화면이
   조용히 망가지므로 여기서 막는다. */

describe("facility-map-config", () => {
  const allRooms = FACILITY_BUILDINGS.flatMap((b) => b.floors.flatMap((f) => f.rooms));

  it("공간 id 는 전체에서 유일하다 (facility_id 로 DB에 저장되는 값)", () => {
    const ids = allRooms.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("공간의 building/floor 는 자기가 속한 건물·층과 일치한다", () => {
    for (const building of FACILITY_BUILDINGS) {
      for (const floor of building.floors) {
        for (const room of floor.rooms) {
          expect(room.building).toBe(building.code);
          expect(room.floor).toBe(floor.floor);
        }
      }
    }
  });

  it("평면도 배치가 층 격자를 벗어나지 않는다", () => {
    for (const building of FACILITY_BUILDINGS) {
      for (const floor of building.floors) {
        for (const room of floor.rooms) {
          expect(room.plan.w).toBeGreaterThan(0);
          expect(room.plan.h).toBeGreaterThan(0);
          expect(room.plan.x + room.plan.w).toBeLessThanOrEqual(floor.planCols);
          expect(room.plan.y + room.plan.h).toBeLessThanOrEqual(floor.planRows);
        }
      }
    }
  });

  it("같은 층 안에서 공간끼리 겹치지 않는다", () => {
    for (const building of FACILITY_BUILDINGS) {
      for (const floor of building.floors) {
        for (let i = 0; i < floor.rooms.length; i++) {
          for (let j = i + 1; j < floor.rooms.length; j++) {
            const a = floor.rooms[i].plan;
            const b = floor.rooms[j].plan;
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(overlap, `${floor.rooms[i].id} ↔ ${floor.rooms[j].id}`).toBe(false);
          }
        }
      }
    }
  });

  it("같은 층 안에서 공간 이름이 겹치지 않는다 (목록에서 구분이 안 되므로)", () => {
    for (const building of FACILITY_BUILDINGS) {
      for (const floor of building.floors) {
        const names = floor.rooms.map((r) => r.name);
        expect(new Set(names).size, `${building.code} ${floor.label}`).toBe(names.length);
      }
    }
  });

  it("건물마다 층이 있고, 층 번호는 오름차순이다", () => {
    for (const building of FACILITY_BUILDINGS) {
      expect(building.floors.length).toBeGreaterThan(0);
      const numbers = building.floors.map((f) => f.floor);
      expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
    }
  });

  it("예약 가능한 공간은 모두 조회 함수로 찾을 수 있다", () => {
    for (const room of listReservableRooms()) {
      expect(findRoom(room.id)).toBe(room);
      expect(findBuilding(room.building)?.code).toBe(room.building);
      expect(findFloor(room.building, room.floor)?.floor).toBe(room.floor);
    }
  });

  it("없는 값에는 null 을 돌려준다", () => {
    expect(findBuilding("nope")).toBeNull();
    expect(findBuilding(null)).toBeNull();
    expect(findFloor("myungsung", 99)).toBeNull();
    expect(findRoom("nope")).toBeNull();
    expect(findRoom(null)).toBeNull();
  });

  it("표기 헬퍼 — 경로", () => {
    const room = findRoom("library-1f-reading");
    expect(room).not.toBeNull();
    expect(formatRoomPath(room!)).toBe("맑은숲작은도서관 · 1층 · 도서관");

    // 세부 공간 확인 전이라 대부분 capacity 가 null —
    // 표기 로직 자체(단위 있음/없음)는 합성 fixture로 따로 검증한다
    expect(formatCapacity(room!)).toBeNull();

    const withCapacity: FacilityRoom = { ...room!, capacity: 35 };
    expect(formatCapacity(withCapacity)).toBe("수용인원 35명");

    const withUnit: FacilityRoom = { ...room!, capacity: 40, capacityUnit: "대" };
    expect(formatCapacity(withUnit)).toBe("수용인원 40대");
  });

  it("주차면은 건물이 아니고, 나머지는 모두 건물이다", () => {
    expect(findBuilding("baul-parking")!.mapKind).toBe("lot");
    expect(findBuilding("library-parking")!.mapKind).toBe("lot");
    for (const code of ["vision", "baul", "library", "myungsung"]) {
      expect(findBuilding(code)!.mapKind, code).toBe("building");
    }
  });

  it("신청 가능한 공간이 있는지 — 주차면은 없고, 세부 확인 전인 건물도 아직 없다", () => {
    expect(isBuildingSelectable(findBuilding("baul-parking")!)).toBe(false);
    expect(isBuildingSelectable(findBuilding("baul")!)).toBe(false);
    expect(isBuildingSelectable(findBuilding("myungsung")!)).toBe(false);
    expect(isBuildingSelectable(findBuilding("vision")!)).toBe(true);
    expect(isBuildingSelectable(findBuilding("library")!)).toBe(true);
  });

  it("층 요약 — 신청 가능한 공간 이름을 먼저 보여준다", () => {
    const gymFloor = findFloor("vision", 6)!;
    expect(countReservableRooms(gymFloor)).toBe(2);
    expect(summarizeFloor(gymFloor)).toBe("체육관 · 게스트룸");

    // 신청 가능한 공간이 없는 층은 있는 공간 이름이라도 보여준다
    const parkingFloor = findFloor("vision", 1)!;
    expect(countReservableRooms(parkingFloor)).toBe(0);
    expect(summarizeFloor(parkingFloor)).toContain("주차장");
  });
});

describe("비전센터 층 구성", () => {
  const vision = findBuilding("vision")!;

  it("1층~7층과 옥상이 있다", () => {
    expect(vision.floors.map((f) => f.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(vision.floors.map((f) => f.label)).toEqual([
      "1층",
      "2층",
      "3층",
      "4층",
      "5층",
      "6층",
      "7층",
      "옥상",
    ]);
  });

  it("모든 공간 안내문에 도면상 층이 함께 적혀 있다 (도면과 층 번호가 한 층 다르므로)", () => {
    for (const floor of vision.floors) {
      for (const room of floor.rooms) {
        expect(room.note, room.id).toMatch(/^도면 (지하1층|지상[1-6]층|옥상층)/);
      }
    }
  });

  it("주차장 층은 신청 대상이 아니다", () => {
    expect(countReservableRooms(findFloor("vision", 1)!)).toBe(0);
    expect(countReservableRooms(findFloor("vision", 2)!)).toBe(0);
    expect(findRoom("vision-1f-parking")!.capacity).toBe(18);
    expect(findRoom("vision-2f-parking")!.capacity).toBe(20);
  });

  it("체육관 상부는 6층 체육관과 같은 공간이므로 따로 신청할 수 없다", () => {
    expect(findRoom("vision-6f-gym")!.reservable).toBe(true);
    expect(findRoom("vision-7f-gym-void")!.reservable).toBe(false);
  });
});

describe("campus-map", () => {
  it("건물 외곽선은 3점 이상이고 안내도 밖으로 나가지 않는다", () => {
    for (const building of FACILITY_BUILDINGS) {
      const { points } = building.footprint;
      expect(points.length, building.code).toBeGreaterThanOrEqual(3);
      for (const p of points) {
        expect(p.x, building.code).toBeGreaterThanOrEqual(0);
        expect(p.x, building.code).toBeLessThanOrEqual(CAMPUS_VIEW.width);
        expect(p.y, building.code).toBeGreaterThanOrEqual(0);
        expect(p.y, building.code).toBeLessThanOrEqual(CAMPUS_VIEW.height);
      }
    }
  });

  it("이름표는 자기 건물 외곽선 안에 놓인다", () => {
    for (const building of FACILITY_BUILDINGS) {
      expect(
        pointInPolygon(building.footprint.pin, building.footprint.points),
        `${building.code} 이름표가 건물 밖에 있다`,
      ).toBe(true);
    }
  });

  it("건물끼리 외곽선이 겹치지 않는다", () => {
    for (let i = 0; i < FACILITY_BUILDINGS.length; i++) {
      for (let j = i + 1; j < FACILITY_BUILDINGS.length; j++) {
        const a = FACILITY_BUILDINGS[i];
        const b = FACILITY_BUILDINGS[j];
        const overlap = a.footprint.points.some((p) => pointInPolygon(p, b.footprint.points))
          || b.footprint.points.some((p) => pointInPolygon(p, a.footprint.points));
        expect(overlap, `${a.code} ↔ ${b.code}`).toBe(false);
      }
    }
  });

  it("여러 줄 이름표는 빈 줄 없이 채워져 있다", () => {
    for (const building of FACILITY_BUILDINGS) {
      const lines = building.footprint.labelLines;
      if (!lines) continue;
      expect(lines.length, building.code).toBeGreaterThan(0);
      for (const line of lines) expect(line.trim(), building.code).not.toBe("");
    }
  });

  it("다각형 → SVG points 문자열", () => {
    expect(polygonPoints([{ x: 0, y: 0 }, { x: 10.005, y: 20 }])).toBe("0,0 10.01,20");
  });

  it("캠퍼스 좌표 → 백분율", () => {
    expect(toPercent({ x: CAMPUS_VIEW.width / 2, y: CAMPUS_VIEW.height / 4 })).toEqual({
      left: "50%",
      top: "25%",
    });
  });
});

/** 광선 투사 — 점이 다각형 안에 있는지 */
function pointInPolygon(point: MapPoint, polygon: MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const crossX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < crossX) inside = !inside;
  }
  return inside;
}
