import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  // min: 미만이면 강제 업데이트(차단). latest: 미만이면 권장 업데이트(닫기 가능 배너).
  // 정식 배포 때마다 LATEST_ANDROID_BUILD 를 새 versionCode 로 올리면 사용자에게 권장 안내가 뜬다.
  // 치명적 변경일 때만 MIN_ANDROID_BUILD 를 함께 올려 강제한다.
  const min = parseInt(process.env.MIN_ANDROID_BUILD ?? "5", 10);
  const latest = parseInt(process.env.LATEST_ANDROID_BUILD ?? String(min), 10);
  return NextResponse.json({
    min_android_build: min,
    latest_android_build: latest,
    play_store_url: "market://details?id=com.smartmyungsung.app",
    play_store_url_web: "https://play.google.com/store/apps/details?id=com.smartmyungsung.app",
  });
}
