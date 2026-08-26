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
    expect(pageSource).toContain("반별 담임");
    expect(apiSource).toContain('rpc("list_dept_classes_full"');
    expect(apiSource).toContain('.lte("grade", 2)');
    expect(apiSource).toContain("displayRole(row.member_role, row.grade)");
  });

  it("requires department membership and does not expose contact fields", () => {
    expect(apiSource).toContain('rpc("is_edu_member_or_admin"');
    expect(apiSource).not.toMatch(/select\([^)]*(?:phone|email|address)/);
  });
});
