import { describe, expect, it } from "vitest";
import { extractSpatialScriptureCandidates, serviceFromOcrHeader, type OcrLine } from "./scripture-ocr-spatial";

const line = (text: string, x: number, y: number, x1 = x + 180, y1 = y + 24): OcrLine => ({ text, confidence: 90, bbox: { x0: x, y0: y, x1, y1 } });

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

  it("maps all four readings from the actual bulletin's spatial layout", () => {
    const lines = [
      line("성경봉독", 88, 789, 159, 801),
      line("출애굽기 2310-13 (구머16)", 347, 788, 555, 806),
      line("창세기 39: 1-6 (860)", 718, 780, 884, 798),
      line("수요오전예배(9/16) 오전10:00", 306, 946, 512, 963),
      line("수요저녁예배(9/16) 오후7:20", 544, 946, 740, 963),
      line("(사도행전1:9-11)", 371, 1101, 487, 1116),
      line("여호수아7:1-15)", 612, 1098, 723, 1113),
    ];

    expect(extractSpatialScriptureCandidates(lines).candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ serviceType: "sunday_morning", rawReference: "출애굽기 23:10-13" }),
      expect.objectContaining({ serviceType: "sunday_afternoon", rawReference: "창세기 39:1-6" }),
      expect.objectContaining({ serviceType: "wednesday_morning", rawReference: "사도행전 1:9-11" }),
      expect.objectContaining({ serviceType: "wednesday_evening", rawReference: "여호수아 7:1-15" }),
    ]));
  });
});
