import { describe, expect, it } from "vitest";
import { extractSpatialScriptureCandidates, serviceFromOcrHeader, type OcrLine } from "./scripture-ocr-spatial";

const line = (text: string, x: number, y: number): OcrLine => ({ text, confidence: 90, bbox: { x0: x, y0: y, x1: x + 180, y1: y + 24 } });

describe("bulletin spatial OCR", () => {
  it.each(["주일찬양예배", "주 일 찬 양 예 배", "주일 오후예배", "4부 예배"])("maps %s to Sunday afternoon", (value) => {
    expect(serviceFromOcrHeader(value)).toBe("sunday_afternoon");
  });

  it("maps the Sunday-afternoon anchor and reference in the same relative column", () => {
    const lines = [line("주 일 찬 양 예 배", 650, 100), line("성 경 봉 독", 650, 220), line("창세기 39:1-6", 650, 270)];
    expect(extractSpatialScriptureCandidates(lines).candidates).toEqual([
      expect.objectContaining({ serviceType: "sunday_afternoon", rawReference: "창세기 39:1-6" }),
    ]);
  });
});
