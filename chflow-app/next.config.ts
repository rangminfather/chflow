import type { NextConfig } from "next";

// 보안 헤더 — 앱 동작을 깨뜨리지 않는 항목만 적용.
// (CSP 는 다음 우편번호 iframe·PDF 뷰어·Supabase 연결 등과 충돌 위험이 있어
//  별도 테스트 후 도입 예정 — H-4 후속 과제)
const securityHeaders = [
  // HTTPS 강제 (1년). Vercel 이 HTTPS 를 제공하므로 안전.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // 클릭재킹 방지: 외부 사이트의 iframe 임베드 차단. WebView 셸은 영향 없음.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // MIME 스니핑 방지
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 외부로 전체 URL referrer 유출 최소화
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 사용하지 않는 강력 기능 차단
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Vercel 함수 번들에 한글 폰트(.otf) 파일 포함시키기 (UMS 주보 PDF 생성용)
  outputFileTracingIncludes: {
    "/api/ums-bulletin-post/**": ["./lib/bulletin/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
