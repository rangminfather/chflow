import { describe, expect, it } from "vitest";
import { maskSignupAddress, maskSignupBirthDate, maskSignupName, maskSignupPhone, normalizeSignupGender, normalizeSignupSearchText, signupDisplayGender, signupErrorMessage } from "./signup-utils";

describe("signup helpers", () => {
  it("normalizes gender values in both display directions", () => {
    expect(signupDisplayGender("M")).toBe("남");
    expect(normalizeSignupGender("여")).toBe("F");
  });

  it("normalizes pasture search and safe errors", () => {
    expect(normalizeSignupSearchText(" 새빛 · 목장 ")).toBe("새빛");
    expect(signupErrorMessage({})).toBe("알 수 없는 오류");
  });

  it("masks personally identifying values in lookup results", () => {
    expect(maskSignupName("김성헌")).toBe("김*헌");
    expect(maskSignupBirthDate("1988-02-12")).toBe("19**-**-12");
    expect(maskSignupPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskSignupAddress("울산광역시 동구 방어진순환로 995")).toBe("울산광역시 동구 ***");
  });

  it("keeps malformed or short values safe and predictable", () => {
    expect(maskSignupName("김")).toBe("김*");
    expect(maskSignupBirthDate("19")).toBe("**");
    expect(maskSignupPhone("전화 없음")).toBe("전화 없음");
    expect(maskSignupAddress("울산 동구")).toBe("울산 동구");
  });
});
