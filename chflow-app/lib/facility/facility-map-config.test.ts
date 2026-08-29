import { describe, expect, it } from "vitest";
import {
  FACILITY_BUILDINGS,
  findBuilding,
  findFloor,
  findRoom,
  formatCapacity,
  formatRoomPath,
  listReservableRooms,
} from "./facility-map-config";
import { boxFaces, growBoundsWithBox, emptyBounds, project, toViewBox } from "./isometric";

/* 건물도는 설정 파일만 갈아끼워 교체할 수 있어야 한다.
   그 전제(id 유일성·격자 범위·좌표 계산)를 깨면 화면이 조용히 망가지므로
   여기서 막는다. */

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
    expect(findFloor("main", 99)).toBeNull();
    expect(findRoom("nope")).toBeNull();
    expect(findRoom(null)).toBeNull();
  });

  it("표기 헬퍼 — 경로와 수용인원", () => {
    const room = findRoom("education-2f-201");
    expect(room).not.toBeNull();
    expect(formatRoomPath(room!)).toBe("교육관 · 2층 · 201호");
    expect(formatCapacity(room!)).toBe("수용인원 35명");

    const parking = findRoom("parking-1f-area-a");
    expect(formatCapacity(parking!)).toBe("수용인원 40대");

    const corridor = findRoom("education-2f-corridor");
    expect(formatCapacity(corridor!)).toBeNull();
  });
});

describe("isometric", () => {
  it("원점은 화면 원점으로 간다", () => {
    expect(project(0, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("z 가 커지면 화면에서 위로 올라간다", () => {
    expect(project(1, 1, 1).y).toBeLessThan(project(1, 1, 0).y);
  });

  it("x 는 오른쪽, y 는 왼쪽으로 간다", () => {
    expect(project(1, 0, 0).x).toBeGreaterThan(0);
    expect(project(0, 1, 0).x).toBeLessThan(0);
  });

  it("상자는 3면 + 라벨 위치 + 터치 폴리곤을 만든다", () => {
    const faces = boxFaces({ x: 0, y: 0, w: 2, d: 2, h: 1 });
    expect(faces.top.split(" ")).toHaveLength(4);
    expect(faces.left.split(" ")).toHaveLength(4);
    expect(faces.right.split(" ")).toHaveLength(4);
    expect(faces.hit.split(" ")).toHaveLength(6);
    expect(Number.isFinite(faces.topCenter.x)).toBe(true);
  });

  it("viewBox 는 상자를 여백과 함께 감싼다", () => {
    const bounds = growBoundsWithBox(emptyBounds(), { x: 0, y: 0, w: 2, d: 2, h: 1 });
    const { viewBox, width, height } = toViewBox(bounds, 10);
    expect(viewBox.split(" ")).toHaveLength(4);
    expect(width).toBeGreaterThan(20);
    expect(height).toBeGreaterThan(20);
  });
});
