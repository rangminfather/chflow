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

function buildUrl(endpoint: string, key: string, params: { baseDate: string; baseTime: string }) {
  const u = new URL(`${BASE}/${endpoint}`);
  u.searchParams.set("serviceKey", key);
  u.searchParams.set("numOfRows", "10");
  u.searchParams.set("pageNo", "1");
  u.searchParams.set("dataType", "JSON");
  u.searchParams.set("base_date", params.baseDate);
  u.searchParams.set("base_time", params.baseTime);
  u.searchParams.set("nx", String(NX));
  u.searchParams.set("ny", String(NY));
  return u.toString();
}

export type WeatherCondition = "rain" | "shower" | "snow" | "clear";

export async function GET() {
  // Why trim: Vercel 에 저장된 KMA_API_KEY 끝에 개행(\n)이 섞여 있으면
  // serviceKey=...%0A 로 전송되어 기상청 게이트웨이가 401 을 반환한다.
  // (이 개행 하나로 한 달간 날씨 효과가 무조건 clear 였음)
  const key = process.env.KMA_API_KEY?.trim();
  if (!key) return NextResponse.json({ condition: "clear" });

  try {
    const res = await fetch(buildUrl("getUltraSrtNcst", key, ncstParams()), {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      console.warn(`[weather] KMA HTTP ${res.status} — clear 로 대체`);
      return NextResponse.json({ condition: "clear" });
    }
    const json = await res.json();
    const resultCode = json?.response?.header?.resultCode;
    if (resultCode && resultCode !== "00") {
      console.warn(`[weather] KMA resultCode ${resultCode} ${json?.response?.header?.resultMsg ?? ""} — clear 로 대체`);
      return NextResponse.json({ condition: "clear" });
    }
    const items: { category: string; obsrValue: string }[] =
      json?.response?.body?.items?.item ?? [];

    const pty = Number(items.find((i) => i.category === "PTY")?.obsrValue ?? "0");

    let condition: WeatherCondition = "clear";
    if (pty === 3 || pty === 7)      condition = "snow";    // 눈, 눈날림
    else if (pty === 2 || pty === 6) condition = "snow";    // 진눈깨비
    else if (pty === 4 || pty === 5) condition = "shower";  // 소나기
    else if (pty === 1)              condition = "rain";    // 비

    return NextResponse.json({ condition }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" },
    });
  } catch (e) {
    console.warn("[weather] KMA fetch 실패 — clear 로 대체:", e instanceof Error ? e.message : e);
    return NextResponse.json({ condition: "clear" });
  }
}
