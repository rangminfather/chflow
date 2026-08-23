import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../app/departments/d/[id]/attendance/page.tsx"), "utf8");

describe("출결·달란트 통합표 틀고정", () => {
  it("주차 헤더와 번호·이름 열을 함께 고정한다", () => {
    expect(source).toContain('className="attendance-grid-scroll"');
    expect(source).toContain('className="att-student-row"');
    expect(source).toMatch(/\.att-table thead th\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/);
    expect(source).toMatch(/\.att-table th:nth-child\(2\),[\s\S]*?left:\s*40px;/);
    expect(source).not.toContain(".att-table th:nth-child(3)");
    expect(source).toContain(".att-table thead th:nth-child(-n+2) { z-index: 4; }");
  });

  it("등반 상태를 별도 열 대신 이름 셀의 배지로 표시한다", () => {
    expect(source).not.toContain('<th style={thStyle(44)}>등반</th>');
    expect(source).toContain('newFriendMap[s.id] ? "등반" : "등반전"');
  });
});
