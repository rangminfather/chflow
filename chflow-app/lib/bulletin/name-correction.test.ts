import { describe, it, expect } from "vitest";
import { correctNames, correctNamesIn, KNOWN_NAME_TYPOS } from "./name-correction";

describe("주보 이름 오타 교정", () => {
  it("확인된 오타를 고친다 — 촤성헌 → 최성헌", () => {
    expect(correctNames("촤성헌부장선생님")).toBe("최성헌부장선생님");
    expect(correctNames("촤성헌 부장 선생님")).toBe("최성헌 부장 선생님");
  });

  it("맞는 이름은 건드리지 않는다", () => {
    expect(correctNames("최성헌부장선생님")).toBe("최성헌부장선생님");
    expect(correctNames("김희숙전도사님")).toBe("김희숙전도사님");
  });

  it("최성헌과 최성현은 둘 다 실존하므로 서로 바꾸지 않는다", () => {
    // 초등1부에는 최성헌(부장)·최성현(찬양율동)이 함께 있다.
    // 예전에 쓰던 "한 글자 차이 자동 교정" 은 이 이름을 망가뜨렸다.
    expect(correctNames("신예슬 최성현 선생님")).toBe("신예슬 최성현 선생님");
    expect(correctNames("최성현")).toBe("최성현");
  });

  it("목록에 없는 이름은 손대지 않는다", () => {
    expect(correctNames("홍길동선생님")).toBe("홍길동선생님");
    expect(correctNames("최성혁선생님")).toBe("최성혁선생님");
  });

  it("이름이 아닌 값은 그대로 둔다", () => {
    expect(correctNames("사무엘상 31장 3~5절")).toBe("사무엘상 31장 3~5절");
    expect(correctNames("1-2반")).toBe("1-2반");
    expect(correctNames("")).toBe("");
  });

  it("한 값에 여러 번 나와도 모두 고친다", () => {
    expect(correctNames("촤성헌 부장, 촤성헌 선생님")).toBe("최성헌 부장, 최성헌 선생님");
  });

  it("여러 항목을 한 번에 고치고 나머지는 보존한다", () => {
    const fields = {
      leader: "촤성헌부장선생님",
      praise: "신예슬 최성현 선생님",
      scripture: "사무엘상31장3~5절",
      empty: "",
    };
    const fixed = correctNamesIn(fields, ["leader", "praise", "scripture", "empty"]);
    expect(fixed.leader).toBe("최성헌부장선생님");
    expect(fixed.praise).toBe("신예슬 최성현 선생님");
    expect(fixed.scripture).toBe("사무엘상31장3~5절");
    expect(fixed.empty).toBe("");
  });

  it("오타 목록을 직접 넘겨 쓸 수도 있다", () => {
    expect(correctNames("홍길똥", { 홍길똥: "홍길동" })).toBe("홍길동");
    expect(Object.keys(KNOWN_NAME_TYPOS)).toContain("촤성헌");
  });
});
