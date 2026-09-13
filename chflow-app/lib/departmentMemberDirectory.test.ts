import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const menuSource = readFileSync(resolve(here, "../app/departments/d/[id]/page.tsx"), "utf8");
const pageSource = readFileSync(resolve(here, "../app/departments/d/[id]/department-members/page.tsx"), "utf8");
const apiSource = readFileSync(resolve(here, "../app/api/departments/members/route.ts"), "utf8");

describe("department member directory", () => {
  it("is available to parents from the common menu", () => {
    expect(menuSource).toContain('id: "department-members"');
    expect(menuSource).toMatch(/id: "department-members"[^\n]+maxGrade: 4/);
  });

  it("shows executives and homeroom assignments", () => {
    expect(pageSource).toContain("임원진");
    // 탭 이름은 부서 편성에 따라 "학년·반별 담임"(초등부) / "반별 담임"(유아부 목장반) 으로 갈린다
    expect(pageSource).toContain("반별 담임");
    expect(pageSource).toContain("gradeFieldLabel(departmentName)");
    expect(apiSource).toContain('rpc("list_dept_classes_full"');
    expect(apiSource).toContain('.lte("grade", 2)');
    expect(apiSource).toContain("displayRole(row.member_role, row.grade)");
  });

  it("계정 없이 교사 명부에만 있는 임원도 임원진에 넣는다", () => {
    expect(apiSource).toContain('from("edu_teachers")');
    expect(apiSource).toContain("isExecutiveRole(row.teacher_role)");
    // 계정이 있는 사람은 department_members 쪽만 남겨 중복되지 않게 한다
    expect(apiSource).toContain("linkedUserIds");
  });

  it("requires department membership and does not expose contact fields", () => {
    expect(apiSource).toContain('rpc("is_edu_member_or_admin"');
    expect(apiSource).not.toMatch(/select\([^)]*(?:phone|email|address)/);
  });
});
