import { describe, expect, it } from "vitest";
import { matchMemberByIdentity } from "./matching";

const members = [
  { id: "1", name: "김하늘", sub_role: "집사" },
  { id: "2", name: "이사랑", sub_role: "권사" },
  { id: "3", name: "이사랑", sub_role: "집사" },
];

describe("education member matching", () => {
  it("정확한 이름 한 명은 추천만 하고 자동 승인하지 않는다", () => {
    expect(matchMemberByIdentity("김하늘", members)).toMatchObject({
      status: "recommended", suggestedMemberId: "1",
    });
  });
  it("동명이인은 ambiguous로 둔다", () => {
    expect(matchMemberByIdentity("이사랑", members).status).toBe("ambiguous");
  });
  it("미등록과 유사 이름은 자동 확정하지 않는다", () => {
    expect(matchMemberByIdentity("박없는", members).status).toBe("unmatched");
    expect(matchMemberByIdentity("김하눌", members).status).toBe("unmatched");
  });
  it("검증 별칭은 추천하며 현재 직분은 비교에서 제외한다", () => {
    expect(matchMemberByIdentity("김하늘(옛)", members, [{
      id: "a", member_id: "1", person_name_normalized: "김하늘(옛)", active: true,
    }])).toMatchObject({ status: "recommended", suggestedMemberId: "1" });
  });
});
