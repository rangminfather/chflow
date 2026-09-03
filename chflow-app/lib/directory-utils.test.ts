import { describe, expect, it } from "vitest";
import { buildQuickEditChanges, directoryAccountDetail, directoryAccountLabel, directoryDisplayText, directoryGenderText, emptyQuickEditDraft, getDirectoryFilterOptions, hasDirectorySearchCriteria, moveDirectoryChild, quickEditNoChangeMessage } from "./directory-utils";

describe("directory display helpers", () => {
  it("moves a child without mutating the original order", () => {
    const original = ["first", "second", "third"];
    expect(moveDirectoryChild(original, "third", -1)).toEqual(["first", "third", "second"]);
    expect(original).toEqual(["first", "second", "third"]);
  });

  it("rejects a child move beyond either end", () => {
    expect(moveDirectoryChild(["first", "second"], "first", -1)).toBeNull();
    expect(moveDirectoryChild(["first", "second"], "second", 1)).toBeNull();
  });

  it("formats account state without exposing missing values", () => {
    expect(directoryAccountLabel({ has_app_account: false })).toBe("앱 미가입");
    expect(directoryAccountDetail({ has_app_account: true, app_status: "active", app_username: "member1" })).toBe("앱 가입 · member1");
  });

  // 로그인 아이디 노출 정책: directory_member_profile 이 시스템 staff(admin/office/pastor)
  // 에게만 app_username 실제 값을 주고 일반 사용자에게는 null 을 준다.
  // 그래서 같은 헬퍼가 역할에 따라 두 가지 문구를 만든다 (헬퍼 자체에 역할 인자는 없다).
  it("hides the login id for non-staff viewers and keeps it for staff", () => {
    // 일반 로그인 사용자 — 서버가 app_username 을 null 로 내려준다
    expect(directoryAccountDetail({ has_app_account: true, app_status: "active", app_username: null })).toBe("앱 가입");
    expect(directoryAccountDetail({ has_app_account: true, app_status: "active" })).toBe("앱 가입");
    // 시스템 staff — 서버가 실제 아이디를 내려준다
    expect(directoryAccountDetail({ has_app_account: true, app_status: "active", app_username: "member1" })).toBe("앱 가입 · member1");
    // 앱 미가입 성도는 아이디 유무와 무관하게 기존 표현 유지
    expect(directoryAccountDetail({ has_app_account: false, app_username: null })).toBe("앱 미가입");
  });

  it("formats common profile values", () => {
    expect(directoryDisplayText(false)).toBe("아니오");
    expect(directoryDisplayText(" ")).toBe("없음");
    expect(directoryGenderText("F")).toBe("여");
  });

  it("builds only meaningful quick-edit changes and preserves clear requests", () => {
    const member = { name: "김성헌", phone: "010-1234-5678", home_phone: null, family_church: "새빛", sub_role: null, spouse_name: "배우자", gender: "M", is_child: false };
    expect(buildQuickEditChanges(member, { ...emptyQuickEditDraft, name: " 김성헌 ", phone: "", clearPhone: true, gender: "F", is_child: "true" })).toEqual([
      { key: "phone", label: "휴대폰", before: "010-1234-5678", after: "없음", nextValue: "" },
      { key: "gender", label: "성별", before: "남", after: "여", nextValue: "F" },
      { key: "is_child", label: "자녀 여부", before: "성인", after: "자녀", nextValue: true },
    ]);
  });

  it("does not create a change for blank or unchanged optional fields", () => {
    const member = { name: "김성헌", phone: null, home_phone: null, family_church: null, sub_role: null, spouse_name: null, gender: null, is_child: null };
    expect(buildQuickEditChanges(member, emptyQuickEditDraft)).toEqual([]);
  });

  it.each([
    ["name", { name: "김성훈" }],
    ["phone", { phone: "010-9999-8888" }],
    ["home_phone", { home_phone: "052-111-2222" }],
    ["family_church", { family_church: "기쁨" }],
    ["sub_role", { sub_role: "집사" }],
    ["spouse_name", { spouse_name: "새 배우자" }],
    ["gender", { gender: "F" as const }],
    ["is_child", { is_child: "true" as const }],
  ])("detects a standalone %s change", (key, patch) => {
    const member = { name: "김성헌", phone: "010-1234-5678", home_phone: null, family_church: "새빛", sub_role: null, spouse_name: "배우자", gender: "M", is_child: false };
    expect(buildQuickEditChanges(member, { ...emptyQuickEditDraft, ...patch }).map((change) => change.key)).toEqual([key]);
  });

  it("explains when gender or child status already matches the saved value", () => {
    const member = { name: "송영훈", phone: null, home_phone: null, family_church: null, sub_role: null, spouse_name: null, gender: "M", is_child: true };
    expect(quickEditNoChangeMessage(member, { ...emptyQuickEditDraft, gender: "M" })).toBe("성별의 현재 저장값이 이미 '남'입니다.");
    expect(quickEditNoChangeMessage(member, { ...emptyQuickEditDraft, is_child: "true" })).toBe("자녀 여부의 현재 저장값이 이미 '자녀'입니다.");
  });

  it("derives dependent directory filter options", () => {
    const rows = [
      { plain_name: "2평원", plain_order: 2, grassland_name: "나초원", pasture_name: "A목장" },
      { plain_name: "1평원", plain_order: 1, grassland_name: "가초원", pasture_name: "B목장" },
      { plain_name: "1평원", plain_order: 1, grassland_name: "가초원", pasture_name: "C목장" },
    ];
    expect(getDirectoryFilterOptions(rows, "1평원", "가초원")).toEqual({ plains: [{ name: "1평원", order: 1 }, { name: "2평원", order: 2 }], grasslands: ["가초원"], pastures: ["B목장", "C목장"] });
    expect(hasDirectorySearchCriteria(" ", "", "", "")).toBe(false);
    expect(hasDirectorySearchCriteria("김", "", "", "")).toBe(true);
  });
});
