import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import { extractNativeBulletinText, extractOcrBulletinText } from "./content-extraction";

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

describe("이미지 주보 OCR 추출", () => {
  it("줄 단위 OCR 결과에서 예배안내, 성경, 강론을 채운다", () => {
    const extraction = extractOcrBulletinText(`안내 : 이분선 조은애 선생님 © 말씀은 힘이다!
찬양 ----------- 김신혜 신예슬 최성현 선생님
성경봉독 전도서 3장 1~11절 인도자
강론 죽지 않을 수 있나요? 김희숙전도사님
9/25 행사 : 피구`);

    expect(extraction.fields.leader).toBe("이분선 조은애 선생님");
    expect(extraction.fields.praise).toBe("김신혜 신예슬 최성현 선생님");
    expect(extraction.fields.scripture).toBe("전도서 3장 1~11절");
    expect(extraction.fields.sermonTitle).toBe("죽지 않을 수 있나요?");
    expect(extraction.fields.preacher).toBe("김희숙전도사님");
    expect(extraction.fields.twoPartActivity).toBe("피구");
  });
});
