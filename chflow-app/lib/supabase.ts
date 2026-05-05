import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 🔬 UMS 자동등록 진단 — 콘솔에서 `await chflowDiag()` 1줄로 1·2단계 라이브 검증 (v3 spam-rotate)
if (typeof window !== "undefined") {
  const w = window as unknown as {
    __chflowSupabase?: typeof supabase;
    chflowDiag?: () => Promise<{ write_form_attempts?: unknown[] } | null>;
    chflowDiagN?: (n?: number) => Promise<unknown[]>;
  };
  w.__chflowSupabase = supabase;
  w.chflowDiag = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { console.error("🔬 chflowDiag: 로그인 필요"); return null; }
    const r = await fetch("/api/ums-bulletin/post-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        dept_name: "진단",
        date: new Date().toISOString().slice(0, 10),
        subject: "[진단] dryRun",
        memo: "진단용 1회 호출 — 글 등록 X",
        dryRun: true,
      }),
    });
    const j = await r.json();
    console.log("🔬 진단 결과:", j);
    if (j.debug) {
      console.log("=== 단계별 ===");
      console.table(j.debug.map((d: { step: string; status: number; body_len: number }) =>
        ({ step: d.step, status: d.status, len: d.body_len })));
    }
    if (j.write_form_attempts) {
      console.log("=== write.php 시도별 다변수 (D 진단) ===");
      console.table(j.write_form_attempts);
    }
    return j;
  };
  // 🔬 N번 호출 자동 반복 + 종합 표. 사용자 1줄로 끝.
  w.chflowDiagN = async (n = 5) => {
    const all: Array<Record<string, unknown>> = [];
    for (let k = 1; k <= n; k++) {
      console.log(`\n>>> 호출 ${k}/${n}...`);
      const j = await w.chflowDiag!();
      const attempts = (j as { write_form_attempts?: unknown[] } | null)?.write_form_attempts || [];
      attempts.forEach((att) => all.push({ call: k, ...(att as object) }));
      if (k < n) await new Promise((r) => setTimeout(r, 2000));
    }
    console.log("\n=== 종합 (전체 호출 × 시도) ===");
    console.table(all);
    return all;
  };
}

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

// 전화번호 정규화 (숫자만 남김)
export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

// 전화번호 자동 하이픈 포맷 (한국 번호 기준)
// 입력 길이에 따라 점진적으로 하이픈 삽입 — 예: "01012345678" → "010-1234-5678"
export function formatPhone(input: string): string {
  const d = (input || "").replace(/[^0-9]/g, "");
  if (!d) return "";
  if (d.startsWith("02")) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}
