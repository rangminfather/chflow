import { describe, it, expect } from "vitest";
import {
  parseBibleVersions,
  resolveBibleVersion,
  versionLabel,
  PREFERRED_VERSION_ORDER,
} from "./versions";

const KRV = { code: "KRV", name_ko: "개역한글", name_en: null, language_code: "ko", copyright_note: null, is_public_domain: true };
const NKRV = { code: "NKRV", name_ko: "개역개정", name_en: null, language_code: "ko", copyright_note: "허락 필요", is_public_domain: false };

describe("역본 선택", () => {
  it("개역개정이 1순위 — 쓸 수 있게 되면 자동으로 기본이 된다", () => {
    expect(PREFERRED_VERSION_ORDER[0]).toBe("NKRV");
    expect(resolveBibleVersion([KRV, NKRV], null)).toBe("NKRV");
  });

  it("개역개정이 아직 없으면 개역한글로 내려간다", () => {
    expect(resolveBibleVersion([KRV], null)).toBe("KRV");
  });

  it("사용자가 고른 역본이 아직 유효하면 그것을 쓴다", () => {
    expect(resolveBibleVersion([KRV, NKRV], "KRV")).toBe("KRV");
  });

  it("고른 역본이 사라졌으면 우선순위로 되돌아간다", () => {
    expect(resolveBibleVersion([KRV], "NKRV")).toBe("KRV");
  });

  it("역본이 하나뿐이면 대본에 역본명을 적지 않는다", () => {
    expect(versionLabel([KRV], "KRV")).toBe("");
    expect(versionLabel([KRV, NKRV], "NKRV")).toBe("개역개정");
  });

  it("RPC 응답이 이상해도 죽지 않는다", () => {
    expect(parseBibleVersions(null)).toEqual([]);
    expect(parseBibleVersions([{ code: "", name_ko: "" }])).toEqual([]);
    expect(parseBibleVersions([{ code: "KRV", name_ko: "개역한글" }])).toHaveLength(1);
  });
});
