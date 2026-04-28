import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 함수 번들에 한글 폰트(.otf) 파일 포함시키기 (UMS 주보 PDF 생성용)
  outputFileTracingIncludes: {
    "/api/ums-bulletin-post/**": ["./lib/bulletin/**/*"],
  },
};

export default nextConfig;
