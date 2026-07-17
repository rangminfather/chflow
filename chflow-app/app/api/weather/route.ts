import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 명성교회 인근 고정 격자 (기상청 격자좌표)
const NX = 103;
const NY = 76;
const BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";

export type WeatherCondition = "rain" | "shower" | "snow" | "thunderstorm" | "clear";

function kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
function ymd(d: Date) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
function hh(d: Date) {
  return String(d.getUTCHours()).padStart(2, "0");
}

// 초단기실황: 매시 정시 발표, 40분부터 안정 조회
function ncstBase() {
  const now = kstNow();
  const min = now.getUTCMinutes();
  const b = new Date(now.getTime() - min * 60000 - (min < 40 ? 3600000 : 0));
  return { date: ymd(b), time: hh(b) + "00" };
}
// 초단기예보: 매시 30분 발표, 45분부터 안정 조회
function fcstBase() {
  const now = kstNow();
  const min = now.getUTCMinutes();
  const b = new Date(now.getTime() - (min < 45 ? 3600000 : 0));
  return { date: ymd(b), time: hh(b) + "30" };
}

function buildUrl(endpoint: string, key: string, base: { date: string; time: string }, rows: number) {
  const u = new URL(`${BASE}/${endpoint}`);
  u.searchParams.set("serviceKey", key);
  u.searchParams.set("numOfRows", String(rows));
  u.searchParams.set("pageNo", "1");
  u.searchParams.set("dataType", "JSON");
  u.searchParams.set("base_date", base.date);
  u.searchParams.set("base_time", base.time);
  u.searchParams.set("nx", String(NX));
  u.searchParams.set("ny", String(NY));
  return u.toString();
}

type KmaItem = { category: string; obsrValue?: string; fcstValue?: string; fcstDate?: string; fcstTime?: string };

async function fetchItems(endpoint: string, key: string, base: { date: string; time: string }, rows: number): Promise<KmaItem[] | null> {
  const res = await fetch(buildUrl(endpoint, key, base, rows), { next: { revalidate: 600 } });
  if (!res.ok) {
    console.warn(`[weather] ${endpoint} HTTP ${res.status}`);
    return null;
  }
  const json = await res.json();
  const code = json?.response?.header?.resultCode;
  if (code && code !== "00") {
    console.warn(`[weather] ${endpoint} resultCode ${code} ${json?.response?.header?.resultMsg ?? ""}`);
    return null;
  }
  return json?.response?.body?.items?.item ?? [];
}

// 예보 응답에서 '지금'에 가장 가까운 예보시각(fcstDate+fcstTime)의 값 추출기 반환
function nearestForecast(items: KmaItem[]): (cat: string) => number {
  const nowMs = kstNow().getTime(); // KST wall-clock 를 +9h 로 표현 (예보시각도 동일 규칙)
  const slots = [...new Set(items.map((i) => `${i.fcstDate}${i.fcstTime}`))];
  let best = "";
  let bestDiff = Infinity;
  for (const s of slots) {
    if (s.length < 12) continue;
    const ms = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
    const diff = Math.abs(ms - nowMs);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return (cat: string) => Number(items.find((i) => `${i.fcstDate}${i.fcstTime}` === best && i.category === cat)?.fcstValue ?? "0");
}

export async function GET() {
  // Why trim: Vercel 의 KMA_API_KEY 끝에 개행(\n)이 섞이면 serviceKey=...%0A → 401 → 무조건 clear.
  const key = process.env.KMA_API_KEY?.trim();
  if (!key) return NextResponse.json({ condition: "clear" });

  try {
    // 실황(지금 강수형태) + 예보(소나기 PTY=4·낙뢰 LGT) 동시 호출 후 융합
    const [ncst, fcst] = await Promise.all([
      fetchItems("getUltraSrtNcst", key, ncstBase(), 10),
      fetchItems("getUltraSrtFcst", key, fcstBase(), 100),
    ]);

    // 실황 PTY: 0없음 1비 2비/눈 3눈 5빗방울 6빗방울눈날림 7눈날림
    const nPty = ncst ? Number(ncst.find((i) => i.category === "PTY")?.obsrValue ?? "0") : 0;

    // 예보 PTY: 0없음 1비 2비/눈 3눈 4소나기 / LGT: 낙뢰(>0 이면 뇌우)
    let fPty = 0;
    let lgt = 0;
    if (fcst && fcst.length) {
      const at = nearestForecast(fcst);
      fPty = at("PTY");
      lgt = at("LGT");
    }

    const precip = nPty > 0 || fPty > 0;
    let condition: WeatherCondition = "clear";
    if (precip) {
      if (lgt > 0)                                       condition = "thunderstorm"; // 낙뢰 동반 = 뇌우
      else if (fPty === 4)                               condition = "shower";       // 소나기(예보 전용 코드)
      else if (nPty === 3 || nPty === 7 || fPty === 3)   condition = "snow";         // 눈
      else if (nPty === 2 || nPty === 6 || fPty === 2)   condition = "snow";         // 진눈깨비→눈 처리
      else                                               condition = "rain";         // 비(실황 1/5, 예보 1)
    }

    return NextResponse.json({ condition }, {
      // 최대 지연을 1시간→10분으로 단축 (KMA 예보는 30분 주기라 origin 호출은 넉넉)
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300" },
    });
  } catch (e) {
    console.warn("[weather] fetch 실패 — clear 로 대체:", e instanceof Error ? e.message : e);
    return NextResponse.json({ condition: "clear" });
  }
}
