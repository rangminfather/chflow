import { describe, expect, it } from "vitest";
import {
  isPastureExplorePlaceholder,
  sortPastureExploreRows,
} from "./pasture-explore-utils";
import type { PastureExploreRow } from "./pasture";

function row(overrides: Partial<PastureExploreRow>): PastureExploreRow {
  return {
    pasture_id: crypto.randomUUID(),
    pasture_name: "사랑",
    mission_area: null,
    grassland_name: "은혜",
    plain_name: "1평원",
    pasture_order: 0,
    grassland_order: 0,
    plain_order: 0,
    leaders: [],
    ...overrides,
  };
}

describe("목장탐방 목록", () => {
  it("숫자 평원을 앞에서부터 정렬하고 젊은이평원을 마지막에 둔다", () => {
    const sorted = sortPastureExploreRows([
      row({ pasture_name: "청년", plain_name: "젊은이평원", plain_order: 4 }),
      row({ pasture_name: "셋", plain_name: "3평원", plain_order: 3 }),
      row({ pasture_name: "하나", plain_name: "1평원", plain_order: 1 }),
      row({ pasture_name: "둘", plain_name: "2평원", plain_order: 2 }),
    ]);

    expect(sorted.map((item) => item.plain_name)).toEqual(["1평원", "2평원", "3평원", "젊은이평원"]);
  });

  it("같은 평원 안에서는 초원과 목장 순서를 따른다", () => {
    const sorted = sortPastureExploreRows([
      row({ pasture_name: "나중", grassland_order: 2, pasture_order: 1 }),
      row({ pasture_name: "둘째", grassland_order: 1, pasture_order: 2 }),
      row({ pasture_name: "첫째", grassland_order: 1, pasture_order: 1 }),
    ]);

    expect(sorted.map((item) => item.pasture_name)).toEqual(["첫째", "둘째", "나중"]);
  });

  it("미정 placeholder를 어느 계층에서도 탐방 대상으로 보지 않는다", () => {
    expect(isPastureExplorePlaceholder(row({ pasture_name: "미정" }))).toBe(true);
    expect(isPastureExplorePlaceholder(row({ pasture_name: "(미정)" }))).toBe(true);
    expect(isPastureExplorePlaceholder(row({ grassland_name: "미정" }))).toBe(true);
    expect(isPastureExplorePlaceholder(row({ plain_name: "미정평원" }))).toBe(true);
    expect(isPastureExplorePlaceholder(row({ pasture_name: "사랑" }))).toBe(false);
  });
});
