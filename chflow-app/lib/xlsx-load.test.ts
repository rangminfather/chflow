import { describe, it, expect } from "vitest";
import { detectWorkbookFormat, loadWorkbookWithReason, LEGACY_XLS_NOTICE } from "./xlsx-load";

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

describe("못 읽은 이유 알리기", () => {
  it("구형 .xls 는 열지 않고 바로 안내 문구를 돌려준다", async () => {
    const result = await loadWorkbookWithReason(withSignature(OLE2));
    expect(result.workbook).toBeNull();
    expect(result.format).toBe("legacy-xls");
    expect(result.reason).toBe(LEGACY_XLS_NOTICE);
    // 사람이 바로 조치할 수 있게 xlsx 로 저장하라는 말이 들어 있어야 한다
    expect(result.reason).toContain(".xlsx");
  });

  it("깨진 파일은 손상 안내를 돌려준다", async () => {
    const result = await loadWorkbookWithReason(withSignature(ZIP));
    expect(result.workbook).toBeNull();
    expect(result.reason).toContain("손상");
  });
});
