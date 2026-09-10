import { afterEach, describe, expect, it } from "vitest";
import {
  DeptBulletinSigningConfigurationError,
  isDeptBulletinUrlExpired,
  signDeptBulletinPost,
  signDeptBulletinStoragePath,
  verifyDeptBulletinPostSignature,
  verifyDeptBulletinStorageSignature,
} from "./dept-bulletin-signing";

const originalSecret = process.env.DEPT_BULLETIN_SIGNING_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.DEPT_BULLETIN_SIGNING_SECRET;
  else process.env.DEPT_BULLETIN_SIGNING_SECRET = originalSecret;
});

describe("department bulletin URL signing", () => {
  it("creates and verifies post and storage signatures with the dedicated secret", () => {
    process.env.DEPT_BULLETIN_SIGNING_SECRET = "a-secure-test-secret-with-at-least-32-bytes";
    const expiresAt = 2_000_000_000;

    const postSignature = signDeptBulletinPost(123, expiresAt);
    const storageSignature = signDeptBulletinStoragePath("dept/youth/2026-09-06_123.hwp", expiresAt);

    expect(verifyDeptBulletinPostSignature(123, expiresAt, postSignature)).toBe(true);
    expect(verifyDeptBulletinStorageSignature("dept/youth/2026-09-06_123.hwp", expiresAt, storageSignature)).toBe(true);
    expect(verifyDeptBulletinPostSignature(124, expiresAt, postSignature)).toBe(false);
    expect(verifyDeptBulletinPostSignature(123, expiresAt, `${postSignature.slice(0, -1)}0`)).toBe(false);
  });

  it("fails closed when the dedicated secret is absent or too short", () => {
    delete process.env.DEPT_BULLETIN_SIGNING_SECRET;
    expect(() => signDeptBulletinPost(123, 2_000_000_000)).toThrow(
      DeptBulletinSigningConfigurationError,
    );

    process.env.DEPT_BULLETIN_SIGNING_SECRET = "too-short";
    expect(() => signDeptBulletinPost(123, 2_000_000_000)).toThrow(
      DeptBulletinSigningConfigurationError,
    );
  });

  it("identifies expired URLs", () => {
    expect(isDeptBulletinUrlExpired(100, 101)).toBe(true);
    expect(isDeptBulletinUrlExpired(101, 101)).toBe(false);
  });
});
