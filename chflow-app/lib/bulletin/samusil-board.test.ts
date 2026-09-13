import { describe, expect, it } from "vitest";
import { isElementaryJointBulletin, matchesDept } from "./samusil-board";

describe("초등 연합예배 주보 제목", () => {
  const title = "9월13일 초등 1 2초원 연합예배 주보입니다.";

  it("초등1·2부가 공유하는 주보로 인식한다", () => {
    expect(isElementaryJointBulletin(title)).toBe(true);
    expect(matchesDept(title, ["초등1"])).toBe(true);
    expect(matchesDept(title, ["초등2"])).toBe(true);
  });

  it("연합 키워드가 없으면 공유 주보로 인식하지 않는다", () => {
    expect(isElementaryJointBulletin("초등 1 2초원 주보입니다.")).toBe(false);
  });
});
