import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IOS_VERSION_PATTERN = /^\d+(?:\.\d+)*$/;
const SAFE_MIN_IOS_VERSION = "0.0.0";
const CURRENT_IOS_VERSION = "1.1.12";

function validIosVersion(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && IOS_VERSION_PATTERN.test(trimmed) ? trimmed : fallback;
}

export async function GET() {
  // min: 미만이면 강제 업데이트(차단). latest: 미만이면 권장 업데이트(닫기 가능 배너).
  // 정식 배포 때마다 LATEST_ANDROID_BUILD 를 새 versionCode 로 올리면 사용자에게 권장 안내가 뜬다.
  // 치명적 변경일 때만 MIN_ANDROID_BUILD 를 함께 올려 강제한다.
  const min = parseInt(process.env.MIN_ANDROID_BUILD ?? "5", 10);
  const latest = parseInt(process.env.LATEST_ANDROID_BUILD ?? String(min), 10);
  // iOS 최소 버전은 자동화가 변경하지 않는다. 미설정/오입력 시 0.0.0으로
  // 내려 기존 앱을 차단하지 않고, latest만 현재 공개 버전으로 안전하게 안내한다.
  const minIos = validIosVersion(process.env.MIN_IOS_VERSION, SAFE_MIN_IOS_VERSION);
  const latestIos = validIosVersion(process.env.LATEST_IOS_VERSION, CURRENT_IOS_VERSION);
  return NextResponse.json(
    {
      min_android_build: min,
      latest_android_build: latest,
      play_store_url: "market://details?id=com.smartmyungsung.app",
      play_store_url_web: "https://play.google.com/store/apps/details?id=com.smartmyungsung.app",
      min_ios_version: minIos,
      latest_ios_version: latestIos,
      app_store_url: "itms-apps://apps.apple.com/app/id6795782758",
      app_store_url_web: "https://apps.apple.com/kr/app/id6795782758",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
