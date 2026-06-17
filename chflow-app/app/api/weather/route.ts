import { NextResponse } from "next/server";

export const runtime = "nodejs";

const NX = 103;
const NY = 76;
const BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";

function kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
function ymd(d: Date) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
function hhmm(d: Date, suffix: string) {
  return String(d.getUTCHours()).padStart(2, "0") + suffix;
}

// 초단기실황: 매시 00분 발표, 40분부터 안정 조회
function ncstParams() {
  const now = kstNow();
  const min = now.getUTCMinutes();
  const base = new Date(now.getTime() - min * 60000 - (min < 40 ? 3600000 : 0));
  return { baseDate: ymd(base), baseTime: hhmm(base, "00") };
}

// 초단기예보: 매시 30분 발표, 45분부터 안정 조회
function fcstParams() {
  const now = kstNow();
  const min = now.getUTCMinutes();
  const base = min >= 45
    ? new Date(now.getTime() - min * 60000 + 30 * 60000)
    : new Date(now.getTime() - min * 60000 - 30 * 60000);
  return { baseDate: ymd(base), baseTime: hhmm(base, "30") };
}

function buildUrl(endpoint: string, key: string, params: { baseDate: string; baseTime: string }) {
  const u = new URL(`${BASE}/${endpoint}`);
  u.searchParams.set("serviceKey", key);
  u.searchParams.set("numOfRows", "60");
  u.searchParams.set("pageNo", "1");
  u.searchParams.set("dataType", "JSON");
  u.searchParams.set("base_date", params.baseDate);
  u.searchParams.set("base_time", params.baseTime);
  u.searchParams.set("nx", String(NX));
  u.searchParams.set("ny", String(NY));
  return u.toString();
}

export type WeatherCondition = "rain" | "snow" | "cloud" | "clear";

export async function GET() {
  const key = process.env.KMA_API_KEY;
  if (!key) return NextResponse.json({ condition: "clear" });

  try {
    const [ncstRes, fcstRes] = await Promise.all([
      fetch(buildUrl("getUltraSrtNcst", key, ncstParams()), { next: { revalidate: 3600 } }),
      fetch(buildUrl("getUltraSrtFcst", key, fcstParams()), { next: { revalidate: 3600 } }),
    ]);

    const [ncstJson, fcstJson] = await Promise.all([ncstRes.json(), fcstRes.json()]);

    const ncstItems: { category: string; obsrValue: string }[] =
      ncstJson?.response?.body?.items?.item ?? [];
    const fcstItems: { category: string; fcstValue: string; fcstTime: string }[] =
      fcstJson?.response?.body?.items?.item ?? [];

    // 실황에서 강수형태
    const pty = Number(ncstItems.find((i) => i.category === "PTY")?.obsrValue ?? "0");

    // 예보에서 하늘상태 — 가장 이른 fcstTime 기준
    const skyItems = fcstItems
      .filter((i) => i.category === "SKY")
      .sort((a, b) => a.fcstTime.localeCompare(b.fcstTime));
    const sky = Number(skyItems[0]?.fcstValue ?? "1");

    let condition: WeatherCondition = "clear";
    if (pty === 3 || pty === 7) condition = "snow";
    else if (pty === 2 || pty === 6) condition = "snow";
    else if (pty >= 1) condition = "rain";
    else if (sky === 4) condition = "cloud";
    else if (sky === 3) condition = "cloud";

    return NextResponse.json({ condition }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ condition: "clear" });
  }
}
