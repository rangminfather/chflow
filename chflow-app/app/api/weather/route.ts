import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 3600; // 1시간 캐시

const NX = 103;
const NY = 76;

function getNowParams() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  // 초단기실황: 매시 40분 이후 발표 → 현재 시각 기준 가장 최근 정시
  let hh = now.getUTCHours();
  if (now.getUTCMinutes() < 40) hh -= 1;
  if (hh < 0) hh = 23;
  return {
    baseDate: `${yyyy}${mm}${dd}`,
    baseTime: String(hh).padStart(2, "0") + "00",
  };
}

export type WeatherCondition = "rain" | "snow" | "cloud" | "clear";

export async function GET() {
  const key = process.env.KMA_API_KEY;
  if (!key) return NextResponse.json({ condition: "clear" });

  const { baseDate, baseTime } = getNowParams();
  const url = new URL(
    "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
  );
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("numOfRows", "10");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", baseDate);
  url.searchParams.set("base_time", baseTime);
  url.searchParams.set("nx", String(NX));
  url.searchParams.set("ny", String(NY));

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    const json = await res.json();
    const items: { category: string; obsrValue: string }[] =
      json?.response?.body?.items?.item ?? [];

    const get = (cat: string) =>
      items.find((i) => i.category === cat)?.obsrValue ?? "0";

    const pty = Number(get("PTY")); // 강수형태
    const sky = Number(get("SKY")); // 하늘상태

    let condition: WeatherCondition = "clear";
    if (pty === 3 || pty === 7) condition = "snow";      // 눈, 눈날림
    else if (pty === 2 || pty === 6) condition = "snow"; // 진눈깨비
    else if (pty >= 1) condition = "rain";               // 비, 소나기
    else if (sky >= 3) condition = "cloud";              // 구름많음/흐림

    return NextResponse.json({ condition }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ condition: "clear" });
  }
}
