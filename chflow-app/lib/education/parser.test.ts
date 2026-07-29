import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseEducationHwpxBuffer } from "./parser";

function cell(col: number, row: number, value: string, colSpan = 1): string {
  return `<hp:tc><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="${colSpan}" rowSpan="1"/><hp:p><hp:run><hp:t>${value}</hp:t></hp:run></hp:p></hp:tc>`;
}
function row(index: number, values: string[]): string {
  return `<hp:tr>${values.map((value, col) => cell(col, index, value)).join("")}</hp:tr>`;
}
async function fixture(rows: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("Contents/section0.xml", `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="hs" xmlns:hp="hp"><hp:tbl>${rows.join("")}</hp:tbl></hs:sec>`);
  return zip.generateAsync({ type: "uint8array" });
}

describe("structured HWPX parsers", () => {
  it("일반 명부의 반복 헤더와 병합 셀을 처리한다", async () => {
    const bytes = await fixture([
      row(0, ["일련번호", "부서(과목)명", "이름", "강사명", "년 월 일", "비고"]),
      `<hp:tr>${cell(0, 1, "1", 1)}${cell(1, 1, "제3기생명의삶B")}${cell(2, 1, "김순희(장)집사")}${cell(3, 1, "강사")}${cell(4, 1, "2004.02.29")}${cell(5, 1, "")}</hp:tr>`,
      row(2, ["일련번호", "부서(과목)명", "이름", "강사명", "년 월 일", "비고"]),
    ]);
    const result = await parseEducationHwpxBuffer(bytes, "general_education_history");
    expect(result.report.repeatedHeaderRows).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ cohort_no: 3, class_variant: "B", person_name_normalized: "김순희" });
    expect(result.rows[0].raw_data.cells[0].colSpan).toBe(1);
  });

  it("LMTC의 수료와 이수 상태, 기수 범위를 분리한다", async () => {
    const bytes = await fixture([
      row(0, ["일련번호", "부서(과목)명", "이름", "증서번호", "수료일", "비고"]),
      row(1, ["1", "울산LMTC3기-5기", "김하늘집사", "A-1", "2020.09.19", "이수"]),
      row(2, ["2", "울산LMTC6기", "이사랑권사", "A-2", "2021.09.19", "수료"]),
    ]);
    const result = await parseEducationHwpxBuffer(bytes, "lmtc_history");
    expect(result.rows[0]).toMatchObject({ cohort_no: null, cohort_from: 3, cohort_to: 5, attendance_status: "attended" });
    expect(result.rows[1]).toMatchObject({ cohort_no: 6, attendance_status: "completed" });
  });
});
