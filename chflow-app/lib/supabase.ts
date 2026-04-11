import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 사용자 ID → 합성 이메일 변환 (Supabase Auth는 이메일 기반)
// .local TLD는 Supabase Auth가 거부하므로 유효한 TLD 사용
export function usernameToEmail(username: string): string {
  return `${username.toLowerCase()}@smartms.app`;
}

// ID 형식 검증
export function validateUsername(username: string): { valid: boolean; error?: string } {
  const lower = username.toLowerCase();
  if (lower.length < 4) return { valid: false, error: "아이디는 최소 4자 이상이어야 합니다" };
  if (lower.length > 20) return { valid: false, error: "아이디는 최대 20자까지 가능합니다" };
  if (!/^[a-z0-9._]+$/.test(lower)) {
    return { valid: false, error: "영문 소문자, 숫자, 마침표(.), 언더스코어(_)만 사용 가능합니다" };
  }
  return { valid: true };
}

// 비밀번호 검증
export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) return { valid: false, error: "비밀번호는 최소 8자 이상이어야 합니다" };
  if (password.length > 64) return { valid: false, error: "비밀번호는 최대 64자까지 가능합니다" };
  return { valid: true };
}

// 전화번호 정규화
export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}
