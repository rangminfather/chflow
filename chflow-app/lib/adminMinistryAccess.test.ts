import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const migrationSource = readFileSync(
  resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260827110000_admin_access_all_ministry_departments.sql"),
  "utf8",
);
const gradePolicySource = readFileSync(
  resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260711150000_get_user_grade_admin_priority.sql"),
  "utf8",
);

describe("admin ministry department access", () => {
  it("treats every active ministry department as approved for system admins", () => {
    expect(migrationSource).toContain("when public.get_user_role() = 'admin' then 'approved'::text");
    expect(migrationSource).toContain("public.get_user_role() = 'admin' or dm.id is not null");
    expect(migrationSource).toContain("d.is_active = true");
  });

  it("uses the existing top-grade policy for all department functions", () => {
    expect(gradePolicySource).toMatch(
      /case when public\.get_user_role\(\) in \('admin', 'office', 'pastor'\) then 0::smallint/,
    );
  });

  it("keeps the change scoped to ministry departments", () => {
    expect(migrationSource).toContain("public.departments");
    expect(migrationSource).toContain("public.department_members");
    expect(migrationSource).not.toMatch(/pasture|mokjang|cell_group/i);
  });

  it("does not expose the functions to anonymous users", () => {
    expect(migrationSource).toContain("from public, anon");
    expect(migrationSource).toContain("to authenticated");
  });
});
