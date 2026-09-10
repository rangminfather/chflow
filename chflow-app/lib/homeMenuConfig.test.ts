import { describe, it, expect } from "vitest";
import {
  applyHomeMenuConfig,
  parseHomeMenuConfig,
  homeMenuKeyOf,
  homeSectionKeyOf,
  resolveHomeSectionLabel,
  EMPTY_HOME_MENU_CONFIG,
} from "./homeMenuConfig";

const MENUS = [
  { id: "live", label: "예배" },
  { id: "bulletin", label: "주보 보기" },
  { id: "directory", label: "성도 요람" },
];

describe("homeMenuKeyOf", () => {
  it("공통 메뉴는 common/ 접두사를 쓴다", () => {
    expect(homeMenuKeyOf("common", "live")).toBe("common/live");
  });

  it("관리자 메뉴는 그룹과 무관하게 admin/ 접두사를 쓴다", () => {
    expect(homeMenuKeyOf("implemented", "vote")).toBe("admin/vote");
    expect(homeMenuKeyOf("unimplemented", "vehicle")).toBe("admin/vehicle");
    expect(homeMenuKeyOf("system", "usage-status")).toBe("admin/usage-status");
  });

  it("사역·목장 하위메뉴는 섹션별 접두사를 쓴다", () => {
    expect(homeMenuKeyOf("ministry", "dept-1")).toBe("ministry/dept-1");
    expect(homeMenuKeyOf("pasture", "meeting")).toBe("pasture/meeting");
  });
});

describe("parseHomeMenuConfig", () => {
  it("정상 응답을 그대로 파싱한다", () => {
    const parsed = parseHomeMenuConfig({
      settings: { "common/live": { label: "온라인 예배", hidden: false } },
      order: { common: ["directory", "live"] },
    });
    expect(parsed.settings["common/live"]).toEqual({ label: "온라인 예배", hidden: false });
    expect(parsed.order.common).toEqual(["directory", "live"]);
  });

  it("형태가 어긋난 값은 버리고 빈 설정으로 만든다", () => {
    expect(parseHomeMenuConfig(null)).toEqual(EMPTY_HOME_MENU_CONFIG);
    expect(parseHomeMenuConfig("nope")).toEqual(EMPTY_HOME_MENU_CONFIG);
    const parsed = parseHomeMenuConfig({ settings: { "common/live": 3 }, order: { common: "x" } });
    expect(parsed.settings).toEqual({});
    expect(parsed.order).toEqual({});
  });

  it("label 이 없거나 hidden 이 boolean 이 아니면 기본값으로 채운다", () => {
    const parsed = parseHomeMenuConfig({ settings: { "common/live": { label: null, hidden: null } } });
    expect(parsed.settings["common/live"]).toEqual({ label: null, hidden: false });
  });
});

describe("applyHomeMenuConfig", () => {
  it("설정이 없으면 기본 목록 그대로다", () => {
    const result = applyHomeMenuConfig("common", MENUS, EMPTY_HOME_MENU_CONFIG);
    expect(result.map((m) => m.id)).toEqual(["live", "bulletin", "directory"]);
    expect(result.map((m) => m.label)).toEqual(["예배", "주보 보기", "성도 요람"]);
  });

  it("저장된 이름으로 바꾼다", () => {
    const result = applyHomeMenuConfig("common", MENUS, {
      settings: { "common/directory": { label: "교인 검색", hidden: false } },
      order: {},
    });
    expect(result.find((m) => m.id === "directory")?.label).toBe("교인 검색");
  });

  it("빈 이름은 무시하고 기본 이름을 쓴다", () => {
    const result = applyHomeMenuConfig("common", MENUS, {
      settings: { "common/directory": { label: "   ", hidden: false } },
      order: {},
    });
    expect(result.find((m) => m.id === "directory")?.label).toBe("성도 요람");
  });

  it("저장된 순서를 적용한다", () => {
    const result = applyHomeMenuConfig("common", MENUS, {
      settings: {},
      order: { common: ["directory", "bulletin", "live"] },
    });
    expect(result.map((m) => m.id)).toEqual(["directory", "bulletin", "live"]);
  });

  it("순서에 없는 새 메뉴는 기본 순서를 유지하며 뒤에 붙는다", () => {
    const result = applyHomeMenuConfig("common", MENUS, {
      settings: {},
      order: { common: ["directory"] },
    });
    expect(result.map((m) => m.id)).toEqual(["directory", "live", "bulletin"]);
  });

  it("숨긴 메뉴는 기본적으로 빠지고, 편집모드에서는 hidden 표시와 함께 남는다", () => {
    const config = {
      settings: { "common/bulletin": { label: null, hidden: true } },
      order: {},
    };
    expect(applyHomeMenuConfig("common", MENUS, config).map((m) => m.id)).toEqual(["live", "directory"]);
    const editing = applyHomeMenuConfig("common", MENUS, config, { includeHidden: true });
    expect(editing.map((m) => m.id)).toEqual(["live", "bulletin", "directory"]);
    expect(editing.find((m) => m.id === "bulletin")?.hidden).toBe(true);
  });

  it("다른 그룹의 설정에는 영향을 주지 않는다", () => {
    const result = applyHomeMenuConfig("common", MENUS, {
      settings: { "admin/live": { label: "관리자 예배", hidden: true } },
      order: { implemented: ["directory"] },
    });
    expect(result.map((m) => m.id)).toEqual(["live", "bulletin", "directory"]);
    expect(result[0].label).toBe("예배");
  });
});

describe("resolveHomeSectionLabel", () => {
  it("섹션 키는 section/ 접두사를 쓴다", () => {
    expect(homeSectionKeyOf("ministry")).toBe("section/ministry");
  });

  it("저장값이 없으면 기본 제목을 쓴다", () => {
    expect(resolveHomeSectionLabel(EMPTY_HOME_MENU_CONFIG, "ministry", "내 사역 · 부서")).toBe("내 사역 · 부서");
  });

  it("저장된 제목으로 바꾼다", () => {
    const config = {
      settings: { "section/pasture": { label: "우리 목장", hidden: false } },
      order: {},
    };
    expect(resolveHomeSectionLabel(config, "pasture", "나의 목장")).toBe("우리 목장");
    // 사이드바처럼 기본값이 다른 자리에도 같은 저장값이 적용된다
    expect(resolveHomeSectionLabel(config, "pasture", "내 목장")).toBe("우리 목장");
  });

  it("빈 제목은 무시하고 기본 제목을 쓴다", () => {
    const config = { settings: { "section/common": { label: "  ", hidden: false } }, order: {} };
    expect(resolveHomeSectionLabel(config, "common", "공통 메뉴")).toBe("공통 메뉴");
  });

  it("메뉴 설정과 섹션 설정은 서로 간섭하지 않는다", () => {
    const config = {
      settings: { "common/live": { label: "온라인 예배", hidden: false } },
      order: {},
    };
    expect(resolveHomeSectionLabel(config, "common", "공통 메뉴")).toBe("공통 메뉴");
  });
});
