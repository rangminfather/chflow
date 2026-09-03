import { describe, it, expect } from "vitest";
import {
  applyHomeMenuConfig,
  parseHomeMenuConfig,
  homeMenuKeyOf,
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
