import { describe, it, expect } from "vitest";
import { FACILITY_BUILDINGS, findBuildingIn, type FacilityRoom } from "./facility-map-config";
import { HIDDEN_PARENT, annexesOf, groupFloorRooms, listPrimaryRooms } from "./facility-groups";

function room(patch: Partial<FacilityRoom> & { id: string; kind: FacilityRoom["kind"] }): FacilityRoom {
  return {
    building: "vision",
    floor: 6,
    name: patch.id,
    capacity: null,
    reservable: true,
    facilities: [],
    plan: { x: 0, y: 0, w: 1, h: 1 },
    ...patch,
  };
}

describe("대표 · 부속 나누기", () => {
  it("room/hall 은 대표, 화장실·창고·복도는 부속으로 딸린다", () => {
    const groups = groupFloorRooms([
      room({ id: "gym", kind: "hall" }),
      room({ id: "restroom", kind: "service" }),
      room({ id: "storage", kind: "storage" }),
      room({ id: "corridor", kind: "corridor" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.id).toBe("gym");
    expect(groups[0].annexes.map((r) => r.id)).toEqual(["restroom", "storage", "corridor"]);
  });

  it("대표가 여럿이면 각각 줄이 되고, 부속은 첫 대표에 붙는다", () => {
    const groups = groupFloorRooms([
      room({ id: "class1", kind: "room" }),
      room({ id: "class2", kind: "room" }),
      room({ id: "restroom", kind: "service" }),
    ]);
    expect(groups.map((g) => g.primary.id)).toEqual(["class1", "class2"]);
    expect(groups[0].annexes.map((r) => r.id)).toEqual(["restroom"]);
    expect(groups[1].annexes).toEqual([]);
  });

  it("관리자가 지정하면 그 대표에 붙는다", () => {
    const parents = new Map([["restroom", "class2"]]);
    const groups = groupFloorRooms([
      room({ id: "class1", kind: "room" }),
      room({ id: "class2", kind: "room" }),
      room({ id: "restroom", kind: "service" }),
    ], parents);
    expect(groups[0].annexes).toEqual([]);
    expect(groups[1].annexes.map((r) => r.id)).toEqual(["restroom"]);
  });

  it("관리자가 부속을 대표로 올릴 수 있다 (parent_id 를 빈 값으로)", () => {
    const parents = new Map([["restroom", ""]]);
    const groups = groupFloorRooms([
      room({ id: "gym", kind: "hall" }),
      room({ id: "restroom", kind: "service" }),
    ], parents);
    expect(groups.map((g) => g.primary.id)).toEqual(["gym", "restroom"]);
  });

  it("지정한 대표가 그 층에 없으면 첫 대표에 붙인다 (사라지지 않게)", () => {
    const parents = new Map([["restroom", "다른층공간"]]);
    const groups = groupFloorRooms([
      room({ id: "gym", kind: "hall" }),
      room({ id: "restroom", kind: "service" }),
    ], parents);
    expect(groups).toHaveLength(1);
    expect(groups[0].annexes.map((r) => r.id)).toEqual(["restroom"]);
  });

  it("주차장 같은 야외 공간은 대표다 — 실제로 빌리는 대상이므로", () => {
    const groups = groupFloorRooms([
      room({ id: "parking", kind: "outdoor" }),
      room({ id: "stair", kind: "corridor" }),
    ]);
    expect(groups.map((g) => g.primary.id)).toEqual(["parking"]);
    expect(groups[0].annexes.map((r) => r.id)).toEqual(["stair"]);
  });

  it("대표가 하나도 없는 층은 전부 대표로 둔다 (목록에서 통째로 사라지지 않게)", () => {
    const groups = groupFloorRooms([
      room({ id: "corridor", kind: "corridor" }),
      room({ id: "stair", kind: "corridor" }),
    ]);
    expect(groups.map((g) => g.primary.id)).toEqual(["corridor", "stair"]);
    expect(groups.every((g) => g.annexes.length === 0)).toBe(true);
  });

  it("listAs 로 못박은 공간은 kind 보다 우선한다", () => {
    const groups = groupFloorRooms([
      room({ id: "gym", kind: "hall" }),
      room({ id: "gym-void", kind: "hall", listAs: "annex" }),
      room({ id: "restroom", kind: "service", listAs: "primary" }),
    ]);
    expect(groups.map((g) => g.primary.id)).toEqual(["gym", "restroom"]);
    expect(groups[0].annexes.map((r) => r.id)).toEqual(["gym-void"]);
  });
});

describe("실제 시설 데이터", () => {
  it("비전센터 6층은 체육관·게스트룸이 대표, 샤워실·탈의실은 부속이다", () => {
    const vision = findBuildingIn(FACILITY_BUILDINGS, "vision")!;
    const sixth = vision.floors.find((f) => f.floor === 6)!;
    const groups = groupFloorRooms(sixth.rooms);
    const primaries = groups.map((g) => g.primary.id);
    expect(primaries).toContain("vision-6f-gym");
    expect(primaries).toContain("vision-6f-guest");
    expect(primaries).not.toContain("vision-6f-shower-w");
    expect(primaries).not.toContain("vision-6f-locker-w");

    const gym = groups.find((g) => g.primary.id === "vision-6f-gym")!;
    expect(gym.annexes.map((r) => r.id)).toContain("vision-6f-shower-w");
    expect(gym.annexes.map((r) => r.id)).toContain("vision-6f-locker-w");
  });

  it("예약 현황 표는 대표만 줄로 올린다 — 전체 공간 수보다 적다", () => {
    const rows = listPrimaryRooms(FACILITY_BUILDINGS);
    const allRooms = FACILITY_BUILDINGS.flatMap((b) => b.floors.flatMap((f) => f.rooms));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(allRooms.length);
  });

  it("대표 공간의 부속 목록을 찾을 수 있다 (신청 화면 선택지)", () => {
    const annexes = annexesOf(FACILITY_BUILDINGS, "vision-6f-gym");
    expect(annexes.map((r) => r.id)).toContain("vision-6f-shower-w");
    expect(annexesOf(FACILITY_BUILDINGS, "없는공간")).toEqual([]);
  });
});

describe("빌릴 일이 없는 공간은 아예 뺀다", () => {
  it("listAs: hidden 은 목록에도 부속에도 나오지 않는다", () => {
    const groups = groupFloorRooms([
      room({ id: "gym", kind: "hall" }),
      room({ id: "restroom", kind: "service", listAs: "hidden" }),
      room({ id: "shower", kind: "service" }),
    ]);
    expect(groups.map((g) => g.primary.id)).toEqual(["gym"]);
    expect(groups[0].annexes.map((r) => r.id)).toEqual(["shower"]);
  });

  it("관리자가 숨김으로 지정하면(parent_id = '-') 빠진다", () => {
    const parents = new Map([["shower", HIDDEN_PARENT]]);
    const groups = groupFloorRooms([
      room({ id: "gym", kind: "hall" }),
      room({ id: "shower", kind: "service" }),
    ], parents);
    expect(groups[0].annexes).toEqual([]);
  });

  it("전부 숨김인 층은 빈 목록이 된다", () => {
    const groups = groupFloorRooms([
      room({ id: "restroom", kind: "service", listAs: "hidden" }),
      room({ id: "stair", kind: "corridor", listAs: "hidden" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("실제 데이터 — 층 공용 화장실·계단·교사실은 목록에도 부속에도 없다", () => {
    const shown = new Set(
      listPrimaryRooms(FACILITY_BUILDINGS).flatMap(({ group }) => [
        group.primary.id,
        ...group.annexes.map((a) => a.id),
      ]),
    );
    for (const id of [
      "vision-3f-restroom", "vision-4f-restroom", "vision-5f-restroom",
      "vision-3f-stair", "vision-4f-teacher1", "vision-5f-mid1",
      "vision-2f-gate", "vision-7f-gym-void",
      "library-2f-staff", "library-4f-residence",
    ]) {
      expect(shown.has(id), id).toBe(false);
    }
  });

  it("실제 데이터 — 복도·홀은 따로 빌릴 수 있으므로 목록에 남는다", () => {
    const primaries = new Set(listPrimaryRooms(FACILITY_BUILDINGS).map(({ group }) => group.primary.id));
    expect(primaries.has("vision-3f-corridor")).toBe(true);
    expect(primaries.has("vision-3f-hall")).toBe(true);
  });
});
