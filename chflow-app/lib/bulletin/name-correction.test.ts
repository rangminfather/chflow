import { describe, it, expect } from "vitest";
import { correctNames, correctNamesIn } from "./name-correction";

const ROSTER = ["최성헌", "김찬규", "박양흠", "김희숙", "김정권", "황선영", "신예슬", "최성현"];

describe("주보 이름 오타 교정", () => {
  it("실제 사례 — 촤성헌 → 최성헌", () => {
    expect(correctNames("촤성헌부장선생님", ROSTER)).toBe("최성헌부장선생님");
    expect(correctNames("촤성헌 부장 선생님", ROSTER)).toBe("최성헌 부장 선생님");
  });

  it("맞는 이름은 건드리지 않는다", () => {
    expect(correctNames("최성헌부장선생님", ROSTER)).toBe("최성헌부장선생님");
    expect(correctNames("김희숙전도사님", ROSTER)).toBe("김희숙전도사님");
    expect(correctNames("김정권장로님", ROSTER)).toBe("김정권장로님");
  });

  it("두 글자 이상 다르면 손대지 않는다 (다른 사람일 수 있다)", () => {
    expect(correctNames("홍길동선생님", ROSTER)).toBe("홍길동선생님");
  });

  it("후보가 둘이면 판단을 보류한다", () => {
    // 최성헌·최성현이 둘 다 한 글자 차이 → 어느 쪽인지 알 수 없다
    expect(correctNames("최성혁선생님", ROSTER)).toBe("최성혁선생님");
  });

  it("길이가 다르면 손대지 않는다", () => {
    expect(correctNames("최성헌우선생님", ROSTER)).toBe("최성헌우선생님");
    expect(correctNames("성헌선생님", ROSTER)).toBe("성헌선생님");
  });

  it("이름이 아닌 값은 그대로 둔다", () => {
    expect(correctNames("사무엘상 31장 3~5절", ROSTER)).toBe("사무엘상 31장 3~5절");
    expect(correctNames("1-2반", ROSTER)).toBe("1-2반");
    expect(correctNames("", ROSTER)).toBe("");
  });

  it("명단이 비면 아무것도 하지 않는다", () => {
    expect(correctNames("촤성헌부장선생님", [])).toBe("촤성헌부장선생님");
  });

  it("여러 항목을 한 번에 고친다", () => {
    const fields = {
      leader: "촤성헌부장선생님",
      preacher: "김희숙전도사님",
      scripture: "사무엘상31장3~5절",
      empty: "",
    };
    const fixed = correctNamesIn(fields, ["leader", "preacher", "scripture", "empty"], ROSTER);
    expect(fixed.leader).toBe("최성헌부장선생님");
    expect(fixed.preacher).toBe("김희숙전도사님");
    expect(fixed.scripture).toBe("사무엘상31장3~5절");
    expect(fixed.empty).toBe("");
  });
});
