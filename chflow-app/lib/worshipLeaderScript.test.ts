import { describe, expect, it } from "vitest";
import {
  buildOpeningPrayer,
  buildWorshipLeaderSections,
  parseGuideMessage,
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

describe("본문이 없을 때 대본 문구", () => {
  const base = {
    sunday: "2026-09-06",
    prayerClass: "1-1",
    sermonTitle: "제목",
    preacher: "홍길동",
  };

  it("본문 표기 자체가 없으면 '아직 정해지지 않았다' 로 안내한다 (성경 DB 탓으로 오인하지 않게)", () => {
    const sections = buildWorshipLeaderSections({ ...base, scripture: "", verses: [] });
    const text = sections.map((s) => s.content).join("\n");
    expect(text).toContain("아직 정해지지 않았습니다");
    expect(text).not.toContain("성경 DB");
  });

  it("표기는 있는데 못 찾으면 그 표기를 짚어 준다", () => {
    const sections = buildWorshipLeaderSections({
      ...base,
      scripture: "시편139:13~16",
      normalizedScripture: "시편139:13-16",
      verses: [],
    });
    const text = sections.map((s) => s.content).join("\n");
    expect(text).toContain("시편139:13-16");
    expect(text).toContain("찾지 못했습니다");
  });

  it("본문을 찾았으면 절 내용이 들어간다", () => {
    const sections = buildWorshipLeaderSections({
      ...base,
      scripture: "요 3:16",
      normalizedScripture: "요한복음 3:16",
      testament: "신약",
      verses: [{ chapter: 3, verse: 16, text: "하나님이 세상을 이처럼 사랑하사" }],
    });
    const text = sections.map((s) => s.content).join("\n");
    expect(text).toContain("하나님이 세상을 이처럼 사랑하사");
    expect(text).not.toContain("찾지 못했습니다");
  });
});

describe("예배안내 문구에서 본문 뽑기", () => {
  const real = `샬롬 2026년 하나님의 안경으로 세상을 바라보는 어린이 주일 예배 안내드립니다!
~ 9월 6일 초등1부 예배 ~
1. 안내 : 1-2반 황선영 선생님
5. 말씀강론 : 김희숙 전도사님
가. 제목 : 우리의생명은누구의것인가요?
나. 성경 : 사무엘상31장3~5절
6. 축도`;

  it("실제 저장본에서 성경과 제목을 뽑는다", () => {
    const parsed = parseGuideMessage(real);
    expect(parsed.scripture).toBe("사무엘상31장3~5절");
    expect(parsed.sermonTitle).toBe("우리의생명은누구의것인가요?");
  });

  it("뽑은 표기는 성경 조회용으로 정규화된다", () => {
    expect(normalizeBibleReference(parseGuideMessage(real).scripture)).toBe("사무엘상31:3-5");
  });

  it("한 줄에 이어 붙어 있어도 항목 기호에서 끊는다", () => {
    const oneLine = "가. 제목 : 예수님만 의지해요 나. 성경 : 눅8:40~56";
    const parsed = parseGuideMessage(oneLine);
    expect(parsed.sermonTitle).toBe("예수님만 의지해요");
    expect(parsed.scripture).toBe("눅8:40~56");
  });

  it("문구가 없거나 항목이 빠져 있으면 빈 값", () => {
    expect(parseGuideMessage(null)).toEqual({ scripture: "", sermonTitle: "" });
    expect(parseGuideMessage("1. 안내 : 1-2반").scripture).toBe("");
  });
});
