import { describe, expect, it } from "vitest";
import { isBulletinServiceType, splitScriptureReferences } from "./scripture-parser";

describe("bulletin scripture references", () => {
  it("splits multiple readings in one cell", () => {
    expect(splitScriptureReferences("출애굽기 22:1-9, 시편 24:1")).toEqual(["출애굽기 22:1-9", "시편 24:1"]);
  });
  it("normalizes spacing, tildes and 장/절 notation", () => {
    expect(splitScriptureReferences("마태복음 5장 6~7절")).toEqual(["마태복음 5:6-7"]);
    expect(splitScriptureReferences("요한계시록 3: 1-6")).toEqual(["요한계시록 3:1-6"]);
  });
  it("treats empty values as no reading", () => {
    expect(splitScriptureReferences(null)).toEqual([]);
    expect(splitScriptureReferences("  ")).toEqual([]);
  });
  it("accepts only the six bulletin service slots", () => {
    expect(isBulletinServiceType("sunday_2")).toBe(true);
    expect(isBulletinServiceType("sunday_morning")).toBe(false);
  });
});
