import { describe, expect, it } from "vitest";
import { nkrvBookPath, selectNkrvPassage, type NkrvVerse } from "./nkrvR2";

const verses: NkrvVerse[] = [
  { chapter: 1, verse: 1, text: "one" },
  { chapter: 1, verse: 2, endVerse: 3, text: "two through three" },
  { chapter: 2, verse: 1, text: "chapter two" },
];

describe("NKRV R2 helpers", () => {
  it("uses a stable two-digit book key", () => {
    expect(nkrvBookPath(1)).toBe("NKRV/01.json");
    expect(nkrvBookPath(66)).toBe("NKRV/66.json");
  });

  it("selects a requested passage including merged source verses", () => {
    expect(selectNkrvPassage(verses, 1, 3, 1, 3)).toEqual([verses[1]]);
    expect(selectNkrvPassage(verses, 1, null, 2, 1)).toEqual(verses);
  });
});
