/* ============================================================
   비전센터 도면 폴리곤 지오메트리 (실제 도면 형상)

   FacilityRoomMap / HeatingFloorPlan 이 참조한다. 여기에 층 외곽선(outline)과
   방별 폴리곤(roomPoly)이 있으면 그 층은 폴리곤으로 그려지고, 없으면 기존
   격자 사각형(rect)으로 폴백한다. → config(facility-map-config.ts)와 예약 흐름은
   그대로 두고 형상만 얹는다.

   좌표계: 대영건축 도면(지상2층=교회3층, 지상3층=교회4층) 기반 개략 재구성.
   단위는 도면 비례 좌표(약 760×690). 좌하단 45° 별동·우하단 계단 돌출·복도 반영.
   3·4층은 동일 외곽(같은 건물). 1·2·5·6·7층은 추후 추가.
   ============================================================ */

export type Pt = { x: number; y: number };
const P = (pts: [number, number][]): Pt[] => pts.map(([x, y]) => ({ x, y }));

// 공통 외곽(메인 블록 + 우하단 계단 돌출). 별동은 방 폴리곤으로 별도 표현.
const MAIN_OUTLINE: Pt[] = P([
  [240, 44], [690, 44], [690, 470], [625, 470], [625, 548], [545, 548], [545, 470], [240, 470],
]);

const WING: [number, number][] = [[273, 438], [327, 510], [150, 660], [96, 588]];

export const FLOOR_OUTLINE: Record<string, Pt[]> = {
  "vision-3f": MAIN_OUTLINE,
  "vision-4f": MAIN_OUTLINE,
};

export const ROOM_POLY: Record<string, Pt[]> = {
  // 4층 (도면 지상3층)
  "vision-4f-class1": P([[244, 48], [362, 48], [362, 298], [244, 298]]),
  "vision-4f-teacher1": P([[362, 48], [466, 48], [466, 130], [362, 130]]),
  "vision-4f-teacher2": P([[362, 130], [466, 130], [466, 214], [362, 214]]),
  "vision-4f-teacher3": P([[362, 214], [466, 214], [466, 298], [362, 298]]),
  "vision-4f-class2": P([[470, 48], [686, 48], [686, 298], [470, 298]]),
  "vision-4f-hall": P([[560, 302], [620, 302], [620, 362], [560, 362]]),
  "vision-4f-class3": P([[620, 302], [686, 302], [686, 362], [620, 362]]),
  "vision-4f-corridor": P([[244, 326], [544, 326], [544, 366], [244, 366]]),
  "vision-4f-restroom": P([[414, 376], [532, 376], [532, 462], [414, 462]]),
  "vision-4f-stair": P([[250, 372], [320, 372], [320, 464], [250, 464]]),
  "vision-4f-storage": P([[324, 372], [376, 372], [376, 420], [324, 420]]),
  "vision-4f-cafe": P(WING),
  // 3층 (도면 지상2층)
  "vision-3f-infant": P([[244, 48], [434, 48], [434, 298], [244, 298]]),
  "vision-3f-seminar": P([[438, 48], [686, 48], [686, 298], [438, 298]]),
  "vision-3f-hall": P([[560, 302], [620, 302], [620, 362], [560, 362]]),
  "vision-3f-kids-library": P([[620, 302], [686, 302], [686, 362], [620, 362]]),
  "vision-3f-corridor": P([[244, 326], [544, 326], [544, 366], [244, 366]]),
  "vision-3f-restroom": P([[414, 376], [532, 376], [532, 462], [414, 462]]),
  "vision-3f-stair": P([[250, 372], [320, 372], [320, 464], [250, 464]]),
  "vision-3f-support": P([[324, 372], [376, 372], [376, 420], [324, 420]]),
  "vision-3f-storage": P([[380, 376], [410, 376], [410, 418], [380, 418]]),
  "vision-3f-seminar-annex": P(WING),
};

/** 방 목록에서 층 키("vision-4f" 등)를 뽑는다 — room.id 접두 2세그먼트. */
export function floorKeyOf(rooms: { id: string }[]): string | null {
  const id = rooms[0]?.id;
  if (!id) return null;
  const parts = id.split("-");
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : null;
}

export function floorOutline(floorKey: string | null): Pt[] | null {
  return floorKey ? FLOOR_OUTLINE[floorKey] ?? null : null;
}

export function roomPoly(roomId: string): Pt[] | null {
  return ROOM_POLY[roomId] ?? null;
}

export function bboxOf(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function polyPoints(pts: Pt[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}
