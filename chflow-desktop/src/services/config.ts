// 런타임 설정 — Vite 환경변수(VITE_*)에서 로드.
// 비밀값 없음: anon key는 공개 가능, service_role 절대 포함 금지.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[config] 환경변수 ${name} 가 비어 있습니다. .env(.env.example 참고)를 설정하세요.`
    );
  }
  return value;
}

export const config = {
  supabaseUrl: required("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY),
  // 자체 호스팅 API 베이스 (username 로그인 / 첨부 프록시). 끝 슬래시 제거.
  apiBaseUrl: required("VITE_CHFLOW_API_BASE_URL", import.meta.env.VITE_CHFLOW_API_BASE_URL).replace(/\/+$/, ""),
};
