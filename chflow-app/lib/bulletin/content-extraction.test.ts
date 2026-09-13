import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import { extractNativeBulletinText } from "./content-extraction";

describe("XLSX 주보 추출", () => {
  it("시트와 셀 텍스트를 공통 파이프라인으로 읽는다", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("예배순서");
    sheet.addRow(["성경봉독", "요한복음 3:16"]);
    sheet.addRow(["설교", "하나님의 사랑"]);
    const output = await workbook.xlsx.writeBuffer();

    const extraction = await extractNativeBulletinText(new Uint8Array(output), "dept/elementary1/2026-09-13_1571.xlsx");

    expect(extraction.needsOcr).toBe(false);
    expect(extraction.text).toContain("예배순서");
    expect(extraction.text).toContain("요한복음 3:16");
  });
});
