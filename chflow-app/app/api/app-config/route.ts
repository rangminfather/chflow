import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  // min: 미만이면 강제 업데이트(차단). latest: 미만이면 권장 업데이트(닫기 가능 배너).
  // LATEST_ANDROID_BUILD는 Play 자동 감지가 없는 v16 이하 앱을 v18로 전환하기 위한 호환 설정이다.
  // v18 이상은 Google Play 공개 버전을 직접 감지하므로 일반 릴리스마다 이 값을 변경하지 않는다.
  // 치명적 변경일 때만 MIN_ANDROID_BUILD를 올려 강제 업데이트한다.
  const min = parseInt(process.env.MIN_ANDROID_BUILD ?? "5", 10);
  const latest = parseInt(process.env.LATEST_ANDROID_BUILD ?? String(min), 10);
  return NextResponse.json({
    min_android_build: min,
    latest_android_build: latest,
    play_store_url: "market://details?id=com.smartmyungsung.app",
    play_store_url_web: "https://play.google.com/store/apps/details?id=com.smartmyungsung.app",
  });
}
