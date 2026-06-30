"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Smartphone } from "lucide-react";

export default function InstallPage() {
  const router = useRouter();
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua);
    const standalone = (window.navigator as { standalone?: boolean }).standalone === true;
    setIsIOS(ios);
    setIsStandalone(standalone);

    // 이미 홈화면 앱으로 실행 중이면 바로 로그인으로
    if (standalone) {
      router.replace("/login");
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6">
      {/* 앱 아이콘 */}
      <div className="mb-6">
        <img src="/apple-icon.png" alt="스마트명성" className="w-20 h-20 rounded-2xl shadow-lg" />
      </div>

      <h1 className="text-2xl font-bold text-ink mb-1">스마트명성</h1>
      <p className="text-sm text-ink-soft mb-8">홈 화면에 추가하면 앱처럼 사용할 수 있어요</p>

      {isIOS ? (
        <div className="bg-card rounded-2xl shadow-md p-6 w-full max-w-sm">
          <p className="text-sm font-semibold text-ink-mid mb-4 flex items-center gap-1.5"><Smartphone size={15} strokeWidth={1.8} /> 홈 화면 추가 방법</p>

          <ol className="space-y-4 text-sm text-ink-mid">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
              <div>
                아래 Safari 주소창 옆{" "}
                <span className="inline-flex items-center gap-1 font-semibold text-orange-500">
                  공유
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </span>{" "}
                버튼을 누르세요
              </div>
            </li>

            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
              <div>
                스크롤을 내려{" "}
                <span className="font-semibold text-orange-500">홈 화면에 추가</span>를 누르세요
              </div>
            </li>

            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
              <div>
                오른쪽 위 <span className="font-semibold text-orange-500">추가</span>를 누르면 완료!
              </div>
            </li>
          </ol>

          {/* 화살표 애니메이션 - 공유버튼 위치 안내 */}
          <div className="mt-6 flex flex-col items-center">
            <div className="animate-bounce text-orange-400 text-3xl">↓</div>
            <p className="text-xs text-ink-faint mt-1">Safari 하단 가운데 공유 버튼</p>
          </div>
        </div>
      ) : (
        <div className="bg-card rounded-2xl shadow-md p-6 w-full max-w-sm text-center">
          <p className="text-sm text-ink-mid">
            이 페이지는 <span className="font-semibold text-orange-500">iPhone Safari</span>에서 열어주세요
          </p>
        </div>
      )}

      <button
        onClick={() => router.push("/login")}
        className="mt-8 w-full max-w-sm py-3 rounded-xl bg-orange-500 text-white font-semibold text-sm shadow hover:bg-orange-600 active:bg-orange-700 transition-colors"
      >
        그냥 로그인하러 가기
      </button>

      <p className="mt-4 text-xs text-ink-faint">홈 화면 추가 없이도 이용 가능합니다</p>
    </div>
  );
}
