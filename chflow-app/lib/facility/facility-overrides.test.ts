import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FACILITY_BUILDINGS,
  findBuildingIn,
  findFloorIn,
  findRoomIn,
  formatRoomPathIn,
  isBuildingSelectable,
  listBuildings,
} from "./facility-map-config";
import type { FacilityRoom } from "./facility-map-config";
import {
  ROOM_NAME_MAX,
  applyOverrides,
  buildSavePayload,
  countOverridden,
  draftFromRoom,
  isSameDraft,
  toOverrideMap,
  validateDrafts,
} from "./facility-overrides";
import type { RoomDraft } from "./facility-overrides";

const here = dirname(fileURLToPath(import.meta.url));

function allRooms(buildings = FACILITY_BUILDINGS): FacilityRoom[] {
  return buildings.flatMap((b) => b.floors.flatMap((f) => f.rooms));
}

describe("applyOverrides", () => {
  it("덮어쓸 것이 없으면 원래 배열을 그대로 돌려준다", () => {
    const base = listBuildings();
    expect(applyOverrides(base, toOverrideMap([]))).toBe(base);
  });

  it("이름과 대여 여부를 덮어쓴다", () => {
    const next = applyOverrides(
      listBuildings(),
      toOverrideMap([{ facility_id: "vision-3f-seminar", name: "3층 대세미나실", reservable: false }]),
    );
    const room = findRoomIn(next, "vision-3f-seminar")!;
    expect(room.name).toBe("3층 대세미나실");
    expect(room.reservable).toBe(false);

    // 원본은 건드리지 않는다
    expect(findRoomIn(FACILITY_BUILDINGS, "vision-3f-seminar")!.name).toBe("세미나실");
    expect(findRoomIn(FACILITY_BUILDINGS, "vision-3f-seminar")!.reservable).toBe(true);
  });

  it("null 은 '기본값 유지' 로 읽는다", () => {
    const next = applyOverrides(
      listBuildings(),
      toOverrideMap([{ facility_id: "vision-3f-seminar", name: null, reservable: null }]),
    );
    const room = findRoomIn(next, "vision-3f-seminar")!;
    expect(room.name).toBe("세미나실");
    expect(room.reservable).toBe(true);
  });

  it("빈 이름은 기본값으로 되돌아간다", () => {
    const next = applyOverrides(
      listBuildings(),
      toOverrideMap([{ facility_id: "vision-3f-seminar", name: "   ", reservable: null }]),
    );
    expect(findRoomIn(next, "vision-3f-seminar")!.name).toBe("세미나실");
  });

  it("설정 파일에 없는 공간의 덮어쓰기는 무시한다", () => {
    const next = applyOverrides(
      listBuildings(),
      toOverrideMap([{ facility_id: "사라진-공간", name: "없음", reservable: true }]),
    );
    expect(findRoomIn(next, "사라진-공간")).toBeNull();
    expect(allRooms(next)).toHaveLength(allRooms().length);
  });

  it("평면도 배치·건물 외곽선은 덮어쓰기로 바뀌지 않는다", () => {
    const next = applyOverrides(
      listBuildings(),
      toOverrideMap([{ facility_id: "vision-3f-seminar", name: "딴이름", reservable: false }]),
    );
    const before = findRoomIn(FACILITY_BUILDINGS, "vision-3f-seminar")!;
    const after = findRoomIn(next, "vision-3f-seminar")!;
    expect(after.plan).toEqual(before.plan);
    expect(findBuildingIn(next, "vision")!.footprint).toBe(findBuildingIn(FACILITY_BUILDINGS, "vision")!.footprint);
  });

  it("손대지 않은 건물·층은 같은 객체로 남는다 (불필요한 리렌더 방지)", () => {
    const next = applyOverrides(
      listBuildings(),
      toOverrideMap([{ facility_id: "vision-3f-seminar", name: "딴이름", reservable: true }]),
    );
    expect(findBuildingIn(next, "myungsung")).toBe(findBuildingIn(FACILITY_BUILDINGS, "myungsung"));
    expect(findFloorIn(next, "vision", 6)).toBe(findFloorIn(FACILITY_BUILDINGS, "vision", 6));
    expect(findFloorIn(next, "vision", 3)).not.toBe(findFloorIn(FACILITY_BUILDINGS, "vision", 3));
  });

  it("대여 가능으로 바꾸면 확인 대기 건물도 신청 가능해진다", () => {
    expect(isBuildingSelectable(findBuildingIn(FACILITY_BUILDINGS, "baul")!)).toBe(false);

    const next = applyOverrides(
      listBuildings(),
      toOverrideMap([{ facility_id: "baul-3f-pending", name: "소예배실", reservable: true }]),
    );
    const baul = findBuildingIn(next, "baul")!;
    expect(isBuildingSelectable(baul)).toBe(true);
    expect(formatRoomPathIn(next, findRoomIn(next, "baul-3f-pending")!)).toBe("바울관 · 3층 · 소예배실");
  });

  it("덮어쓰기가 걸린 공간 수를 센다", () => {
    const overrides = toOverrideMap([
      { facility_id: "vision-3f-seminar", name: "가", reservable: true },
      { facility_id: "vision-6f-gym", name: "나", reservable: true },
      { facility_id: "baul-1f-pending", name: "다", reservable: true },
    ]);
    expect(countOverridden(findBuildingIn(FACILITY_BUILDINGS, "vision")!, overrides)).toBe(2);
    expect(countOverridden(findBuildingIn(FACILITY_BUILDINGS, "baul")!, overrides)).toBe(1);
    expect(countOverridden(findBuildingIn(FACILITY_BUILDINGS, "library")!, overrides)).toBe(0);
  });
});

describe("저장 payload", () => {
  const vision = findBuildingIn(FACILITY_BUILDINGS, "vision")!;
  const visionRooms = vision.floors.flatMap((f) => f.rooms);

  function draftsFrom(rooms: FacilityRoom[]): Map<string, RoomDraft> {
    return new Map(rooms.map((r) => [r.id, draftFromRoom(r)]));
  }

  it("아무것도 안 고치면 보낼 것이 없다", () => {
    const payload = buildSavePayload(visionRooms, draftsFrom(visionRooms), toOverrideMap([]));
    expect(payload.rows).toEqual([]);
    expect(payload.resets).toEqual([]);
  });

  it("고친 공간만 rows 에 담는다", () => {
    const drafts = draftsFrom(visionRooms);
    drafts.set("vision-3f-seminar", { name: "대세미나실", reservable: true });
    drafts.set("vision-3f-restroom", { name: "화장실", reservable: true });

    const payload = buildSavePayload(visionRooms, drafts, toOverrideMap([]));
    expect(payload.rows).toEqual([
      { facility_id: "vision-3f-seminar", name: "대세미나실", reservable: true },
      { facility_id: "vision-3f-restroom", name: "화장실", reservable: true },
    ]);
    expect(payload.resets).toEqual([]);
  });

  it("기본값으로 되돌린 공간은 덮어쓰기 행을 지운다", () => {
    const overrides = toOverrideMap([{ facility_id: "vision-3f-seminar", name: "대세미나실", reservable: true }]);
    const shown = applyOverrides(listBuildings(), overrides);
    const drafts = draftsFrom(shown.flatMap((b) => b.floors.flatMap((f) => f.rooms)));

    // 화면에서 원래 이름으로 되돌린 상태
    drafts.set("vision-3f-seminar", { name: "세미나실", reservable: true });

    const payload = buildSavePayload(visionRooms, drafts, overrides);
    expect(payload.rows).toEqual([]);
    expect(payload.resets).toEqual(["vision-3f-seminar"]);
  });

  it("덮어쓰기가 없던 공간을 기본값 그대로 두면 지울 것도 없다", () => {
    const drafts = draftsFrom(visionRooms);
    drafts.set("vision-3f-seminar", { name: "  세미나실  ", reservable: true });
    const payload = buildSavePayload(visionRooms, drafts, toOverrideMap([]));
    expect(payload.rows).toEqual([]);
    expect(payload.resets).toEqual([]);
  });

  it("앞뒤 공백은 떼고 보낸다", () => {
    const drafts = draftsFrom(visionRooms);
    drafts.set("vision-3f-seminar", { name: "  대세미나실 ", reservable: false });
    const payload = buildSavePayload(visionRooms, drafts, toOverrideMap([]));
    expect(payload.rows[0]).toEqual({ facility_id: "vision-3f-seminar", name: "대세미나실", reservable: false });
  });

  it("isSameDraft 는 공백 차이를 같다고 본다", () => {
    expect(isSameDraft({ name: " 홀 ", reservable: true }, { name: "홀", reservable: true })).toBe(true);
    expect(isSameDraft({ name: "홀", reservable: true }, { name: "홀", reservable: false })).toBe(false);
  });
});

describe("저장 전 검사", () => {
  const vision = findBuildingIn(FACILITY_BUILDINGS, "vision")!;
  const visionRooms = vision.floors.flatMap((f) => f.rooms);

  function draftsFrom(rooms: FacilityRoom[]): Map<string, RoomDraft> {
    return new Map(rooms.map((r) => [r.id, draftFromRoom(r)]));
  }

  it("기본 데이터는 그대로 통과한다", () => {
    expect(validateDrafts(visionRooms, draftsFrom(visionRooms))).toBeNull();
  });

  it("빈 이름을 막는다", () => {
    const drafts = draftsFrom(visionRooms);
    drafts.set("vision-3f-seminar", { name: "   ", reservable: true });
    expect(validateDrafts(visionRooms, drafts)).toBe("공간 이름은 비워 둘 수 없습니다");
  });

  it("너무 긴 이름을 막는다", () => {
    const drafts = draftsFrom(visionRooms);
    drafts.set("vision-3f-seminar", { name: "가".repeat(ROOM_NAME_MAX + 1), reservable: true });
    expect(validateDrafts(visionRooms, drafts)).toContain(`${ROOM_NAME_MAX}자`);
  });

  it("같은 층에 같은 이름이 둘이면 막는다", () => {
    const drafts = draftsFrom(visionRooms);
    drafts.set("vision-3f-seminar", { name: "유아부실", reservable: true });
    expect(validateDrafts(visionRooms, drafts)).toBe('같은 층에 "유아부실" 이름이 두 개 있습니다');
  });

  it("다른 층에 같은 이름은 허용한다 (층마다 교육실1 이 있을 수 있다)", () => {
    const drafts = draftsFrom(visionRooms);
    drafts.set("vision-3f-seminar", { name: "교육실1", reservable: true });
    expect(validateDrafts(visionRooms, drafts)).toBeNull();
  });
});

describe("마이그레이션 계약", () => {
  const sql = readFileSync(
    resolve(here, "../../../MS_AX/chflow-project/supabase/migrations/20260903120000_facility_room_overrides.sql"),
    "utf8",
  );

  it("앱이 호출하는 RPC 이름·인자와 맞는다", () => {
    expect(sql).toContain("create or replace function public.get_facility_room_overrides()");
    expect(sql).toContain("create or replace function public.save_facility_room_overrides(");
    expect(sql).toContain("p_rows   jsonb");
    expect(sql).toContain("p_resets text[]");
  });

  it("쓰기는 결재 권한자만 — 권한 검사를 빼먹지 않는다", () => {
    const save = sql.slice(sql.indexOf("function public.save_facility_room_overrides"));
    expect(save).toContain("if not public.facility_approver_ok() then");
    expect(save).toContain("raise exception '시설 공간을 수정할 권한이 없습니다'");
  });

  it("테이블 직접 접근을 막고 RPC 만 통과시킨다", () => {
    expect(sql).toContain("alter table public.facility_room_overrides enable row level security");
    expect(sql).toContain("revoke all on table public.facility_room_overrides from anon, authenticated");
    expect(sql).toContain("grant execute on function public.get_facility_room_overrides() to authenticated");
    expect(sql).toContain("grant execute on function public.save_facility_room_overrides(jsonb, text[]) to authenticated");
  });

  it("이름 길이 제한이 앱과 같다", () => {
    expect(sql).toContain(`char_length(v_name) > ${ROOM_NAME_MAX}`);
  });

  it("security definer + search_path 를 고정한다", () => {
    const definers = sql.match(/security definer set search_path = public/g) ?? [];
    expect(definers.length).toBe(2);
  });
});
