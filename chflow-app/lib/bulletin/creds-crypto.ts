// AES-256-GCM 암호화 helper
// UMS 비번 같은 민감 정보를 DB 에 저장하기 전 암호화 / 복호화 시 사용.
//
// 마스터 키: Vercel env BULLETIN_CREDS_ENCRYPTION_KEY (64자 hex = 32 bytes)
//
// 암호화 결과 포맷: "iv_base64:ciphertext_base64:authtag_base64"

import crypto from "node:crypto";

const ALG = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.BULLETIN_CREDS_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("BULLETIN_CREDS_ENCRYPTION_KEY env 변수가 설정되지 않았습니다");
  }
  if (hex.length !== 64) {
    throw new Error(`암호화 키는 64자 hex 여야 합니다 (현재 ${hex.length}자)`);
  }
  return Buffer.from(hex, "hex");
}

export function encryptString(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);  // GCM 권장 IV 12 bytes
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${ciphertext.toString("base64")}:${authTag.toString("base64")}`;
}

export function decryptString(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("encrypted format invalid");
  const [ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
