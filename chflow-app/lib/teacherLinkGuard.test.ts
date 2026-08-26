import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, "../../MS_AX/chflow-project/supabase/migrations/20260826170000_teacher_role_change_link_guard.sql"),
  "utf8",
);
const membersGrade = readFileSync(
  resolve(here, "../app/departments/d/[id]/members-grade/page.tsx"),
  "utf8",
);
const teacherAssign = readFileSync(
  resolve(here, "../app/departments/d/[id]/teacher-assign/page.tsx"),
  "utf8",
);

describe("teacher identity recurrence guard", () => {
  it("blocks a silent duplicate unless linking or an explicit same-name override is supplied", () => {
    expect(migration).toContain("p_link_placeholder_id uuid DEFAULT NULL");
    expect(migration).toContain("p_allow_duplicate     boolean DEFAULT false");
    expect(migration).toContain("AND t.member_id IS NULL");
    expect(migration).toContain("AND t.user_id IS NULL");
    expect(migration).toContain("동일인 연결 또는 동명이인 여부를 먼저 확인");
  });

  it("changes the role and merges the selected placeholder in one database call", () => {
    expect(migration).toContain("PERFORM public.edu_sync_roster_member(");
    expect(migration).toContain("PERFORM public.edu_link_teacher_account(p_link_placeholder_id, v_member_id)");
    expect(membersGrade).toContain("p_link_placeholder_id: linkPlaceholderId");
    expect(membersGrade).toContain("p_allow_duplicate: allowDuplicate");
    expect(membersGrade).toContain("같은 사람 — 연결");
    expect(membersGrade).toContain("동명이인으로 유지");
  });

  it("allows an already-linked identity to be selected as the merge destination", () => {
    expect(teacherAssign).toContain('u.already_linked ? "기존 연결과 병합" : "선택"');
    expect(teacherAssign).not.toContain("disabled={u.already_linked}");
  });
});
