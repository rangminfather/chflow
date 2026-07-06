import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import GlobalNotifications from "@/components/GlobalNotifications";
import HardwareBackBridge from "@/components/HardwareBackBridge";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import "./globals.css";

const appSans = localFont({
  src: "../public/fonts/NanumGothic-Regular.ttf",
  variable: "--font-geist-sans",
  display: "swap",
});

const appMono = localFont({
  src: "../public/fonts/NanumGothic-Regular.ttf",
  variable: "--font-geist-mono",
  display: "swap",
});

const notoSansKr = localFont({
  src: "../public/fonts/NanumGothic-Regular.ttf",
  variable: "--font-noto-sans-kr",
  display: "swap",
});

const notoSerifKr = localFont({
  src: "../public/fonts/NanumGothic-Regular.ttf",
  variable: "--font-noto-serif-kr",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F1E8" },
    { media: "(prefers-color-scheme: dark)", color: "#191613" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "스마트명성",
  description: "스마트명성 - 교회 통합 관리 시스템",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-96.png", sizes: "96x96", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "스마트명성",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${appSans.variable} ${appMono.variable} ${notoSansKr.variable} ${notoSerifKr.variable} h-full antialiased`}
    >
      <head>
        {/* 다크모드 수동설정 복원 — 렌더 전 실행해서 FOWT 방지 */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('chflow-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}` }} />
        {/* 글자 크기 비례 확대 복원 — 렌더 전 적용해서 깜빡임 방지 */}
        <script dangerouslySetInnerHTML={{ __html: `try{var f=localStorage.getItem('chflow-font-scale');var m={'1':'1','2':'1.15','3':'1.3'};if(m[f])document.documentElement.style.setProperty('--app-zoom',m[f]);}catch(e){}` }} />
        {/* 본문: Pretendard (CDN), 한글 fallback: next/font */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        {/* 스플래시 민들레 이미지 선로딩 — JS 번들보다 먼저 다운로드 시작 */}
        <link rel="preload" as="image" href="/launch-dandelion.webp" fetchPriority="high" />
      </head>
      <body className="min-h-full flex flex-col">
        {/* 글자 크기 확대 배율은 이 래퍼에만 적용 — 플로팅 dock(가/벨)은 바깥이라 확대 안 됨 */}
        <div id="app-zoom-root" className="min-h-full flex flex-col flex-1">
          <ConfirmProvider>
            {children}
          </ConfirmProvider>
        </div>
        <GlobalNotifications />
        <HardwareBackBridge />
      </body>
    </html>
  );
}
