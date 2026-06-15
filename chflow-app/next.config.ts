import type { NextConfig } from "next";

// CSP (Enforced) — 2026-06-14 enforce 전환.
// 외부 출처: Daum 우편번호(t1/*.daumcdn.net), Pretendard(cdn.jsdelivr.net),
//   Supabase(*.supabase.co https+wss), PDF worker(self/blob:), 이미지(data:/blob:/supabase)
// 'unsafe-inline'/'unsafe-eval': Next 하이드레이션·인라인 스타일·pdfjs 필수.
//   향후 nonce 도입으로 축소 가능.
const cspPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://t1.daumcdn.net https://*.daumcdn.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https://*.supabase.co https://*.daumcdn.net",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net",
  "frame-src 'self' https://*.daumcdn.net https://postcode.map.kakao.com",
  "worker-src 'self' blob:",
].join("; ");

// 보안 헤더 — 앱 동작을 깨뜨리지 않는 항목만 적용.
const securityHeaders = [
  { key: "Content-Security-Policy", value: cspPolicy },
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
