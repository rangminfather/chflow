import { describe, expect, it } from "vitest";
import { getSignupPhotoStoragePath } from "./signup-photo";

describe("getSignupPhotoStoragePath", () => {
  it("returns a plain member photo object path", () => {
    expect(getSignupPhotoStoragePath("/api/storage/member-photos/family/member.jpg"))
      .toBe("family/member.jpg");
  });

  it("removes cache-busting query and hash suffixes", () => {
    expect(getSignupPhotoStoragePath("/api/storage/member-photos/family/member.jpg?t=123#photo"))
      .toBe("family/member.jpg");
  });

  it("rejects unrelated or empty paths", () => {
    expect(getSignupPhotoStoragePath("https://example.com/member.jpg")).toBeNull();
    expect(getSignupPhotoStoragePath("/api/storage/member-photos/?t=123")).toBeNull();
    expect(getSignupPhotoStoragePath(null)).toBeNull();
  });
});
