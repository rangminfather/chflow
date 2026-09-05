import { describe, expect, it } from "vitest";
import {
  buildOpeningPrayer,
  normalizeBibleReference,
  prayerLeaderLabel,
  preacherLabel,
} from "./worshipLeaderScript";

describe("worship leader script", () => {
  it("changes the opening prayer every week", () => {
    expect(buildOpeningPrayer("2026-08-30")).not.toBe(buildOpeningPrayer("2026-09-06"));
    expect(buildOpeningPrayer("2026-08-30")).toContain("예수님의 이름으로 기도드립니다. 아멘.");
  });

  it("uses the fixed elder on the first Sunday and class placeholder otherwise", () => {
    expect(prayerLeaderLabel("2026-09-06", "1-3")).toBe("(첫째주) 김정권 장로님");
    expect(prayerLeaderLabel("2026-09-13", "1-3")).toBe("1-3반 000 어린이");
  });

  it("normalizes Korean scripture references for the Bible database", () => {
    expect(normalizeBibleReference("시편 139편 13절 ~16절 말씀")).toBe("시편 139:13-16");
    expect(normalizeBibleReference("시 139:13~16")).toBe("시 139:13-16");
    expect(normalizeBibleReference("창세기 1장 31절~2장 3절")).toBe("창세기 1:31-2:3");
    expect(normalizeBibleReference("(마태복음 5장 3-12절)")).toBe("마태복음 5:3-12");
  });

  it("adds a missing ministry honorific without duplicating it", () => {
    expect(preacherLabel("김희숙 전도사")).toBe("김희숙 전도사님");
    expect(preacherLabel("김희숙 전도사님")).toBe("김희숙 전도사님");
  });
});
