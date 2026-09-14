import { describe, expect, it } from "vitest";
import { findBulletinScriptureCandidates, normalizeBulletinReference } from "./scripture-parser";

describe("bulletin scripture parser", () => {
  it("finds one continuous reading per worship service", () => {
    const text = `주일 오전예배\n성경봉독 출애굽기 23:10-13\n주일 오후예배 성경봉독 창세기 39:1-6\n수요 오전예배 성경봉독 사도행전 1:9-11\n수요 오후예배 성경봉독 여호수아 7:1-15`;
    expect(findBulletinScriptureCandidates(text)).toMatchObject([
      { serviceType: "sunday_morning", rawReference: "출애굽기 23:10-13" },
      { serviceType: "sunday_afternoon", rawReference: "창세기 39:1-6" },
      { serviceType: "wednesday_morning", rawReference: "사도행전 1:9-11" },
      { serviceType: "wednesday_evening", rawReference: "여호수아 7:1-15" },
    ]);
  });
  it("normalizes Korean chapter/verse notation", () => {
    expect(normalizeBulletinReference("출 23장 10~13절")).toBe("출 23:10-13");
  });
  it("keeps supported short book aliases parseable by the existing Bible alias RPC", () => {
    const text = "주일 오전예배 성경봉독 출 23:10-13 수요 오후예배 성경봉독 수 7:1-15";
    expect(findBulletinScriptureCandidates(text)).toMatchObject([
      { rawReference: "출 23:10-13" },
      { rawReference: "수 7:1-15" },
    ]);
  });
  it("does not auto-confirm conflicting service candidates", () => {
    expect(findBulletinScriptureCandidates("주일 오전예배 성경봉독 출 23:10-13 성경봉독 창 1:1-2")).toEqual([]);
  });
});
