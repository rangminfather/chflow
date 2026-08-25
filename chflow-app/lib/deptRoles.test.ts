import { describe, it, expect } from "vitest";
import {
  roleGrade,
  isReplaceableRole,
  defaultRoleForGrade,
  resolveRoleLabel,
  isTeacherRosterGrade,
  isStandardRole,
  roleOptionsByGrade,
  ROLE_OPTIONS,
  GRADE_OPTIONS,
} from "./deptRoles";

describe("roleGrade", () => {
  it("표준 직책을 등급으로 매핑한다", () => {
    expect(roleGrade("전도사")).toBe(0);
    expect(roleGrade("교육사")).toBe(0);
    expect(roleGrade("부장")).toBe(1);
    expect(roleGrade("부부장")).toBe(2);
    expect(roleGrade("총무")).toBe(2);
    expect(roleGrade("부총무")).toBe(2);
    expect(roleGrade("서기")).toBe(2);
    expect(roleGrade("부서기")).toBe(2);
    expect(roleGrade("회계")).toBe(2);
    expect(roleGrade("부회계")).toBe(2);
    expect(roleGrade("교사")).toBe(3);
    expect(roleGrade("학부모")).toBe(4);
  });

  it("사용자 지정·레거시·빈 값은 null", () => {
    expect(roleGrade("부감")).toBeNull();
    expect(roleGrade("member")).toBeNull();
    expect(roleGrade("")).toBeNull();
    expect(roleGrade(null)).toBeNull();
  });
});

describe("isReplaceableRole", () => {
  it("빈 값과 레거시 영문 라벨만 교체 대상", () => {
    expect(isReplaceableRole(null)).toBe(true);
    expect(isReplaceableRole("")).toBe(true);
    expect(isReplaceableRole("member")).toBe(true);
    expect(isReplaceableRole("teacher")).toBe(true);
    expect(isReplaceableRole("Leader")).toBe(true);
    expect(isReplaceableRole("총무")).toBe(false);
    expect(isReplaceableRole("부감")).toBe(false);
  });
});

describe("isStandardRole", () => {
  it("목록에 있는 직책만 표준", () => {
    expect(isStandardRole("회계")).toBe(true);
    expect(isStandardRole("부회계")).toBe(true);
    expect(isStandardRole("교육사")).toBe(true);
    expect(isStandardRole("부감")).toBe(false);
    expect(isStandardRole("member")).toBe(false);
    expect(isStandardRole("")).toBe(false);
    expect(isStandardRole(null)).toBe(false);
  });
});

describe("roleOptionsByGrade", () => {
  it("2등급 임원 직책 7종을 순서대로 준다", () => {
    expect(roleOptionsByGrade(2).map((o) => o.role)).toEqual([
      "부부장", "총무", "부총무", "서기", "부서기", "회계", "부회계",
    ]);
  });

  it("0등급은 전도사·교육사를 각각 고를 수 있다", () => {
    expect(roleOptionsByGrade(0).map((o) => o.role)).toEqual(["전도사", "교육사"]);
  });

  it("없는 등급은 빈 배열", () => {
    expect(roleOptionsByGrade(9)).toEqual([]);
  });
});

describe("resolveRoleLabel — 등급 변경 시 직책 보존 규칙", () => {
  it("같은 등급 안의 구체 직책은 보존된다 (총무·서기·회계 손실 방지)", () => {
    expect(resolveRoleLabel(2, "총무")).toBe("총무");
    expect(resolveRoleLabel(2, "부총무")).toBe("부총무");
    expect(resolveRoleLabel(2, "서기")).toBe("서기");
    expect(resolveRoleLabel(2, "부서기")).toBe("부서기");
    expect(resolveRoleLabel(2, "회계")).toBe("회계");
    expect(resolveRoleLabel(2, "부회계")).toBe("부회계");
    expect(resolveRoleLabel(2, "부부장")).toBe("부부장");
    expect(resolveRoleLabel(0, "교육사")).toBe("교육사");
  });

  it("다른 등급으로 바뀌면 그 등급의 기본 직책이 된다", () => {
    expect(resolveRoleLabel(3, "총무")).toBe("교사");
    expect(resolveRoleLabel(3, "회계")).toBe("교사");
    expect(resolveRoleLabel(1, "교사")).toBe("부장");
    expect(resolveRoleLabel(2, "교사")).toBe("부부장");
    expect(resolveRoleLabel(4, "교사")).toBe("학부모");
  });

  it("사용자가 직접 넣은 직책은 등급이 바뀌어도 지우지 않는다", () => {
    expect(resolveRoleLabel(0, "부감")).toBe("부감");
    expect(resolveRoleLabel(3, "부감")).toBe("부감");
  });

  it("레거시·빈 라벨은 등급 기본 직책으로 정리된다", () => {
    expect(resolveRoleLabel(3, "teacher")).toBe("교사");
    expect(resolveRoleLabel(0, "member")).toBe("전도사");
    expect(resolveRoleLabel(1, null)).toBe("부장");
    expect(resolveRoleLabel(2, "  ")).toBe("부부장");
  });

  it("공백이 섞여 있어도 보존된다", () => {
    expect(resolveRoleLabel(2, " 총무 ")).toBe("총무");
    expect(resolveRoleLabel(2, " 부회계 ")).toBe("부회계");
  });

  it("같은 등급으로 다시 해석해도 값이 변하지 않는다 (멱등)", () => {
    for (const r of ["총무", "부총무", "서기", "부서기", "회계", "부회계", "부부장", "부감", "교사", "부장", "전도사", "교육사", "학부모"]) {
      const g = roleGrade(r) ?? 3;
      expect(resolveRoleLabel(g, resolveRoleLabel(g, r))).toBe(resolveRoleLabel(g, r));
    }
  });
});

describe("defaultRoleForGrade", () => {
  it("등급별 기본 직책", () => {
    expect(defaultRoleForGrade(0)).toBe("전도사");
    expect(defaultRoleForGrade(1)).toBe("부장");
    expect(defaultRoleForGrade(2)).toBe("부부장");
    expect(defaultRoleForGrade(3)).toBe("교사");
    expect(defaultRoleForGrade(4)).toBe("학부모");
  });
});

describe("isTeacherRosterGrade — 교사 출석 대상", () => {
  it("grade 0~3 만 교사 명단 대상이고 학부모(4)는 제외", () => {
    expect(isTeacherRosterGrade(0)).toBe(true);
    expect(isTeacherRosterGrade(3)).toBe(true);
    expect(isTeacherRosterGrade(4)).toBe(false);
    expect(isTeacherRosterGrade(null)).toBe(false);
    expect(isTeacherRosterGrade(undefined)).toBe(false);
  });
});

describe("옵션 목록 정합성", () => {
  it("ROLE_OPTIONS의 직책은 모두 자기 등급으로 매핑된다", () => {
    for (const o of ROLE_OPTIONS) {
      expect(roleGrade(o.role)).toBe(o.grade);
    }
  });

  it("GRADE_OPTIONS는 0~4를 모두 덮는다", () => {
    expect(GRADE_OPTIONS.map((g) => g.value)).toEqual([0, 1, 2, 3, 4]);
  });

  it("모든 등급이 최소 한 개의 직책 옵션을 가진다", () => {
    for (const g of GRADE_OPTIONS) {
      expect(roleOptionsByGrade(g.value).length).toBeGreaterThan(0);
    }
  });

  it("직책 이름은 중복되지 않는다", () => {
    const roles = ROLE_OPTIONS.map((o) => o.role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it("각 등급의 기본 직책은 그 등급 옵션에 들어 있다", () => {
    for (const g of GRADE_OPTIONS) {
      expect(roleOptionsByGrade(g.value).map((o) => o.role)).toContain(defaultRoleForGrade(g.value));
    }
  });
});
