import type { NextConfig } from "next";

// CSP (Report-Only) — 차단하지 않고 위반만 브라우저 콘솔에 보고한다.
// 목적: 실제 로드되는 출처를 수집해, 이후 enforce(Content-Security-Policy)로
// 전환할 때 깨지는 곳을 미리 파악한다. report-only 라 앱 동작에 영향 없음.
//
// 반영된 실외부 출처(2026-06-14 코드 조사 기준):
//  - Daum 우편번호: t1.daumcdn.net(스크립트) + *.daumcdn.net(iframe)  [signup]
//  - Pretendard 폰트: cdn.jsdelivr.net(CSS+폰트)  [layout]
//  - Supabase: *.supabase.co (https REST/Storage) + wss(Realtime; Talk)
//  - PDF 뷰어: pdfjs 번들 + /pdf.worker.min.mjs(자체 오리진) → worker-src 'self' blob:
//  - 이미지: data:(매뉴얼 base64)·blob:(pdf 캔버스/미리보기)·supabase storage
// 'unsafe-inline'/'unsafe-eval' 은 Next 하이드레이션·인라인 스타일·pdfjs 때문에
// 우선 허용. enforce 전환 시 nonce 도입으로 좁힐 수 있음.
const cspReportOnly = [
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
  "frame-src 'self' https://*.daumcdn.net",
  "worker-src 'self' blob:",
].join("; ");

// 보안 헤더 — 앱 동작을 깨뜨리지 않는 항목만 적용.
const securityHeaders = [
  // CSP 는 우선 report-only 로 관측만 한다(비차단). enforce 는 위반 로그 확인 후.
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
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
