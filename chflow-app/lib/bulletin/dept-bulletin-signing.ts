import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNING_SECRET_ENV = "DEPT_BULLETIN_SIGNING_SECRET";
const MIN_SECRET_BYTES = 32;
const SIGNATURE_RE = /^[0-9a-f]{64}$/i;

export class DeptBulletinSigningConfigurationError extends Error {
  constructor() {
    super("dept_bulletin_signing_secret_unavailable");
    this.name = "DeptBulletinSigningConfigurationError";
  }
}

function signingSecret(): string {
  const secret = process.env[SIGNING_SECRET_ENV];
  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new DeptBulletinSigningConfigurationError();
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("hex");
}

function matchesSignature(expected: string, actual: string): boolean {
  if (!SIGNATURE_RE.test(actual)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function signDeptBulletinPost(no: number, expiresAt: number): string {
  return sign(`samusil:${no}:${expiresAt}`);
}

export function isDeptBulletinUrlExpired(
  expiresAt: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return !Number.isInteger(expiresAt) || expiresAt <= 0 || expiresAt < nowSeconds;
}

export function verifyDeptBulletinPostSignature(
  no: number,
  expiresAt: number,
  signature: string,
): boolean {
  return matchesSignature(signDeptBulletinPost(no, expiresAt), signature);
}

export function signDeptBulletinStoragePath(path: string, expiresAt: number): string {
  return sign(`storage:${path}:${expiresAt}`);
}

export function verifyDeptBulletinStorageSignature(
  path: string,
  expiresAt: number,
  signature: string,
): boolean {
  return matchesSignature(signDeptBulletinStoragePath(path, expiresAt), signature);
}

export function isDeptBulletinSigningConfigurationError(
  error: unknown,
): error is DeptBulletinSigningConfigurationError {
  return error instanceof DeptBulletinSigningConfigurationError;
}
