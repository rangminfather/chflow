import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../app/departments/d/[id]/attendance/page.tsx"), "utf8");

describe("출결·달란트 통합표 틀고정", () => {
  it("주차 헤더와 학생 기본정보 열을 함께 고정한다", () => {
    expect(source).toContain('className="attendance-grid-scroll"');
    expect(source).toContain('className="att-student-row"');
    expect(source).toMatch(/\.att-table thead th\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/);
    expect(source).toMatch(/\.att-table th:nth-child\(3\),[\s\S]*?left:\s*120px;/);
    expect(source).toContain(".att-table thead th:nth-child(-n+3) { z-index: 4; }");
  });
});
