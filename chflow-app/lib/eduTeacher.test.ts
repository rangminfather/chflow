import { describe, it, expect } from "vitest";
import {
  isManualTeacher,
  isMemberTeacher,
  canEditInRoster,
  pickCanonicalTeacher,
  resolveMemberIdForLink,
  moveInOrder,
  buildSaveTeacherPayload,
} from "./eduTeacher";

const manual = { id: "t-manual", member_id: null, user_id: null };
const memberOnly = { id: "t-member", member_id: "m-1", user_id: null };   // 앱 미가입 성도
const userOnly = { id: "t-user", member_id: null, user_id: "u-1" };       // 반쪽 연결(구버전 잔재)
const linked = { id: "t-linked", member_id: "m-2", user_id: "u-2" };

describe("교사 identity 판별", () => {
  it("수동 교사는 member_id·user_id 가 모두 없는 행뿐이다", () => {
    expect(isManualTeacher(manual)).toBe(true);
    expect(isManualTeacher(memberOnly)).toBe(false);
    expect(isManualTeacher(userOnly)).toBe(false);
    expect(isManualTeacher(linked)).toBe(false);
  });

  it("user_id 가 없어도 member_id 가 있으면 성도 교사다 (placeholder 오판 방지)", () => {
    expect(isMemberTeacher(memberOnly)).toBe(true);
    expect(isManualTeacher(memberOnly)).toBe(false);
  });

  it("출석부에서 수정 가능한 것은 수동 교사뿐이다", () => {
    expect(canEditInRoster(manual)).toBe(true);
    expect(canEditInRoster(memberOnly)).toBe(false);
    expect(canEditInRoster(userOnly)).toBe(false);
    expect(canEditInRoster(linked)).toBe(false);
  });
});

describe("pickCanonicalTeacher — 중복 행 대표 선택", () => {
  it("성도 연결 행이 수동 행보다 우선한다", () => {
    expect(pickCanonicalTeacher([manual, memberOnly])!.id).toBe("t-member");
    expect(pickCanonicalTeacher([userOnly, linked])!.id).toBe("t-linked");
  });

  it("같은 조건이면 활성 행이 우선한다", () => {
    const a = { id: "a", member_id: "m", user_id: null, is_active: false };
    const b = { id: "b", member_id: "m", user_id: null, is_active: true };
    expect(pickCanonicalTeacher([a, b])!.id).toBe("b");
  });

  it("활성 여부까지 같으면 먼저 만들어진 행이 우선한다", () => {
    const a = { id: "a", member_id: "m", user_id: null, is_active: true, created_at: "2026-05-01" };
    const b = { id: "b", member_id: "m", user_id: null, is_active: true, created_at: "2026-01-01" };
    expect(pickCanonicalTeacher([a, b])!.id).toBe("b");
  });

  it("빈 목록은 null", () => {
    expect(pickCanonicalTeacher([])).toBeNull();
  });
});

describe("resolveMemberIdForLink — 성도 연결 기준", () => {
  it("members.app_user_id 로 찾은 값이 profiles.member_id 보다 우선한다", () => {
    expect(resolveMemberIdForLink({ memberIdByAppUser: "m-real", profileMemberId: "m-stale" })).toBe("m-real");
  });

  it("members 쪽이 없으면 profiles.member_id 를 보조로 쓴다", () => {
    expect(resolveMemberIdForLink({ memberIdByAppUser: null, profileMemberId: "m-fallback" })).toBe("m-fallback");
  });

  it("둘 다 없으면 null (성도 미연결)", () => {
    expect(resolveMemberIdForLink({ memberIdByAppUser: null, profileMemberId: null })).toBeNull();
  });
});

describe("moveInOrder — 순서만 바꾸고 행은 그대로", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("위로 한 칸 이동", () => {
    expect(moveInOrder(list, "b", -1).map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("아래로 한 칸 이동", () => {
    expect(moveInOrder(list, "b", 1).map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("경계를 넘어가면 그대로 둔다", () => {
    expect(moveInOrder(list, "a", -1).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(moveInOrder(list, "c", 1).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("이동해도 행 집합과 개수는 변하지 않는다 (출석 기록 영향 없음)", () => {
    const moved = moveInOrder(list, "a", 1);
    expect(moved).toHaveLength(list.length);
    expect([...moved.map((x) => x.id)].sort()).toEqual(["a", "b", "c"]);
  });

  it("없는 id 는 무시", () => {
    expect(moveInOrder(list, "zzz", 1)).toBe(list);
  });
});

describe("buildSaveTeacherPayload — 수정은 기존 행 id 를 유지", () => {
  it("추가는 p_id 가 null 이고 순서는 서버가 정한다", () => {
    const p = buildSaveTeacherPayload({ editing: null, deptId: "d1", name: " 홍길동 ", role: " 교사 " });
    expect(p.p_id).toBeNull();
    expect(p.p_dept_id).toBe("d1");
    expect(p.p_name).toBe("홍길동");
    expect(p.p_role).toBe("교사");
    expect(p.p_order_no).toBeNull();
  });

  it("수정은 기존 teacher id 를 그대로 넘긴다 (삭제 후 재등록이 아니라 UPDATE)", () => {
    const p = buildSaveTeacherPayload({
      editing: { ...manual, order_no: 4 },
      deptId: "d1",
      name: "김철수",
      role: "부장",
    });
    expect(p.p_id).toBe("t-manual");
    expect(p.p_order_no).toBe(4);
  });

  it("직책을 비우면 null 로 저장된다", () => {
    const p = buildSaveTeacherPayload({ editing: null, deptId: "d1", name: "이름", role: "   " });
    expect(p.p_role).toBeNull();
  });
});
