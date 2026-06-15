import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    min_android_build: parseInt(process.env.MIN_ANDROID_BUILD ?? "5", 10),
    play_store_url: "market://details?id=com.smartmyungsung.app",
    play_store_url_web: "https://play.google.com/store/apps/details?id=com.smartmyungsung.app",
  });
}
