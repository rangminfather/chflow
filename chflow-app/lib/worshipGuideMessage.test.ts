import { describe, expect, it } from "vitest";
import { fillMissingWorshipGuideMessage } from "./worshipGuideMessage";

describe("fillMissingWorshipGuideMessage", () => {
  it("주보 값으로 직접 입력 항목을 채운다", () => {
    const message = [
      "2. 찬양율동 : (직접 입력)",
      "3. 예배인도 : (직접 입력)",
      "5. 말씀강론 : (직접 입력)",
      "  가. 제목 : (직접 입력)",
      "  나. 성경 : (직접 입력)",
    ].join("\n");

    expect(fillMissingWorshipGuideMessage(message, {
      praise: "신예슬, 최성현 선생님",
      leader: "최성헌 부장선생님",
      preacher: "김희숙 전도사님",
      sermonTitle: "믿음으로 자라요",
      scripture: "히브리서 11:1",
    })).toBe([
      "2. 찬양율동 : 신예슬, 최성현 선생님",
      "3. 예배인도 : 최성헌 부장선생님",
      "5. 말씀강론 : 김희숙 전도사님",
      "  가. 제목 : 믿음으로 자라요",
      "  나. 성경 : 히브리서 11:1",
    ].join("\n"));
  });

  it("기존 값과 사용자가 수정한 문장은 덮어쓰지 않는다", () => {
    const message = [
      "2. 찬양율동 : 기존 담당자 선생님",
      "3. 예배인도 : 사용자가 고친 값",
      "5. 말씀강론 : (직접 입력)",
    ].join("\n");

    expect(fillMissingWorshipGuideMessage(message, {
      praise: "주보 찬양팀",
      leader: "주보 인도자",
      preacher: "주보 설교자",
    })).toBe([
      "2. 찬양율동 : 기존 담당자 선생님",
      "3. 예배인도 : 사용자가 고친 값",
      "5. 말씀강론 : 주보 설교자",
    ].join("\n"));
  });

  it("주보에서 추출하지 못한 빈 값은 그대로 둔다", () => {
    const message = "2. 찬양율동 : (직접 입력)";
    expect(fillMissingWorshipGuideMessage(message, { praise: "" })).toBe(message);
  });
});
