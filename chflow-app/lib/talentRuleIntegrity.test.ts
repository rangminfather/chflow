import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const talentSource = readFileSync(resolve(here, "../app/departments/d/[id]/talent/page.tsx"), "utf8");
const integratedSource = readFileSync(resolve(here, "../app/departments/d/[id]/attendance/page.tsx"), "utf8");

describe("talent rule and direct-entry integrity", () => {
  it("does not add default rules to a department that already has weekly rules", () => {
    expect(talentSource).toContain("if (current.length === 0)");
    expect(talentSource).not.toContain("const missing = DEFAULT_WEEKLY_RULES.filter");
  });

  it.each([
    ["homeroom talent passbook", talentSource],
    ["integrated talent screen", integratedSource],
  ])("adds and individually deletes repeated direct entries in %s", (_label, source) => {
    expect(source).toContain("p_id: null");
    expect(source).toMatch(/(?:function|const) getOthers/);
    expect(source).toContain("edu_delete_talent");
    expect(source).toContain('.order("created_at", { ascending: true })');
  });

  it("includes automatic attendance and every direct entry in the integrated total", () => {
    expect(integratedSource).toContain("getAutoAttendancePoints");
    expect(integratedSource).toContain("directRecords.reduce");
  });
});
