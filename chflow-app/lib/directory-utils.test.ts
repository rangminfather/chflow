import { describe, expect, it } from "vitest";
import { buildQuickEditChanges, directoryAccountDetail, directoryAccountLabel, directoryDisplayText, directoryGenderText, emptyQuickEditDraft } from "./directory-utils";

describe("directory display helpers", () => {
  it("formats account state without exposing missing values", () => {
    expect(directoryAccountLabel({ has_app_account: false })).toBe("앱 미가입");
    expect(directoryAccountDetail({ has_app_account: true, app_status: "active", app_username: "member1" })).toBe("앱 가입 · member1");
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
});
