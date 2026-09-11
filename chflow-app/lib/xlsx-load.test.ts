import { describe, it, expect } from "vitest";
import * as XLSX from "@e965/xlsx";
import { convertLegacyXlsToXlsx, detectWorkbookFormat, loadWorkbookWithReason } from "./xlsx-load";

/** 파일 앞머리 서명만 흉내 낸 가짜 버퍼 */
function withSignature(bytes: number[]): Buffer {
  return Buffer.concat([Buffer.from(bytes), Buffer.alloc(64)]);
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

describe("엑셀 형식 판별", () => {
  it("xlsx·한셀은 ZIP 서명이다", () => {
    expect(detectWorkbookFormat(withSignature(ZIP))).toBe("xlsx");
  });

  it("구형 .xls 는 OLE2 복합문서 서명이다", () => {
    expect(detectWorkbookFormat(withSignature(OLE2))).toBe("legacy-xls");
  });

  it("둘 다 아니면 unknown", () => {
    expect(detectWorkbookFormat(withSignature([0x00, 0x01, 0x02, 0x03]))).toBe("unknown");
    expect(detectWorkbookFormat(Buffer.alloc(0))).toBe("unknown");
  });

  it("Uint8Array 로 줘도 같은 판정", () => {
    expect(detectWorkbookFormat(new Uint8Array([...OLE2, 0, 0]))).toBe("legacy-xls");
  });
});

describe("통합 문서 읽기", () => {
  it("구형 .xls 를 읽고 표준 .xlsx 로 변환한다", async () => {
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([
      ["주일", "설교제목"],
      ["9/13", "잃은 양을 찾으시는 예수님 (눅15:1~7)"],
    ]), "9.10월");
    const bytes = XLSX.write(source, { type: "buffer", bookType: "xls" }) as Buffer;

    const result = await loadWorkbookWithReason(bytes);
    expect(result.workbook).not.toBeNull();
    expect(result.format).toBe("legacy-xls");
    expect(result.reason).toBeNull();
    expect(result.workbook?.getWorksheet("9.10월")?.getCell("B2").text).toContain("눅15:1~7");

    const converted = await convertLegacyXlsToXlsx(bytes);
    expect(converted).not.toBeNull();
    expect(detectWorkbookFormat(converted!)).toBe("xlsx");
  });

  it("서명만 있고 내용이 없는 가짜 .xls 는 손상 안내를 돌려준다", async () => {
    const result = await loadWorkbookWithReason(withSignature(OLE2));
    expect(result.workbook).toBeNull();
    expect(result.reason).toContain("변환하지 못했습니다");
  });

  it("깨진 파일은 손상 안내를 돌려준다", async () => {
    const result = await loadWorkbookWithReason(withSignature(ZIP));
    expect(result.workbook).toBeNull();
    expect(result.reason).toContain("손상");
  });
});
