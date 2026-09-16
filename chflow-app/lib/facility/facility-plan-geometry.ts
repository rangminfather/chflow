/* ============================================================
   비전센터 도면 형상 — 실제 설계도면(대영건축사사무소 A-301~308, A-402) 기준

   FacilityRoomMap / HeatingFloorPlan 이 참조한다. 여기에 층 외곽선(outline)과
   방별 폴리곤(roomPoly)이 있으면 그 층은 폴리곤으로 그려지고, 없으면 기존
   격자 사각형(rect)으로 폴백한다. → config(facility-map-config.ts)와 예약 흐름은
   그대로 두고 형상만 얹는다.

   ── 좌표계 ────────────────────────────────────────────────
   원본 좌표는 **도면 mm**로 적는다. 원점은 건물 북서 모서리(통심선 X1 × Y4),
   +x 동쪽 / +y 남쪽. 도면에서 읽은 치수를 그대로 쓸 수 있어 검증이 쉽다.
   화면에 나갈 때는 MM_PER_UNIT(=50) 으로 나눠 약 790 × 690 짜리 좌표로 줄인다.
   이 축척은 기존 화면 코드(선 굵기·글자 크기가 고정값)를 건드리지 않기 위한 것이다.

   ── 층 번호 ───────────────────────────────────────────────
   여기 키는 **교회에서 부르는 층**(facility-map-config.ts 와 동일)이다.
       교회 1층 = 도면 지하1층(A-301)   교회 5층 = 도면 지상4층(A-305)
       교회 2층 = 도면 지상1층(A-302)   교회 6층 = 도면 지상5층(A-306)
       교회 3층 = 도면 지상2층(A-303)   교회 7층 = 도면 지상6층(A-307)
       교회 4층 = 도면 지상3층(A-304)   교회 옥상 = 도면 옥상층(A-308)

   ── 건물 구성 ─────────────────────────────────────────────
   주동은 동서 33,800 × 남북 16,900(통심선 Y4~Y1). 남동측에 계단·승강기가
   21,570 까지 내려앉고, 동측 끝은 19,400 까지 내려온다.
   남서측 사선 공간(휴게음식점·세미나실·게스트룸·펌프실)은 **본체와 이어진
   같은 건물 내부**다. 북쪽 꼭짓점이 본체 서측 벽에, 동쪽 벽이 본체 남측 벽
   (x≈11,600)에 붙고 그 사이 쐐기 모양이 연결부다. 별동이 아니다.
   ============================================================ */

export type Pt = { x: number; y: number };

/** 도면 mm → 화면 좌표. 1 화면 단위 = 50mm */
const MM_PER_UNIT = 50;

type MM = [number, number];

const P = (mm: MM[]): Pt[] => mm.map(([x, y]) => ({ x: x / MM_PER_UNIT, y: y / MM_PER_UNIT }));

/** 축에 나란한 방 — 도면에서 그대로 읽은 (x, y, 가로, 세로) */
const R = (x: number, y: number, w: number, h: number): MM[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

// -------------------------------------------------------------
// 외곽선
// -------------------------------------------------------------

/** 3층~옥상 공통 외곽 — 주동 + 남동측 돌출 + 남서측 사선부(연결부 포함) */
const OUTLINE_MAIN: MM[] = [
  [0, 0], [33800, 0], [33800, 19400], [29460, 19400], [29460, 21570],
  [22250, 21570], [22250, 16900], [11600, 16900],
  [7952, 24517], [4518, 29770], [-3434, 24573], [0, 19320],
];

/** 1층(도면 지하1층) — 북서측 주차 베이(4,400)와 동측 차량 경사로가 더 있다 */
const OUTLINE_B1: MM[] = [
  [0, -4400], [11900, -4400], [11900, 0], [36200, 0], [36200, 11500], [33800, 11500],
  [33800, 21570], [22250, 21570], [22250, 16900], [11600, 16900],
  [7952, 24517], [4518, 29770], [-3434, 24573], [0, 19320],
];

/** 2층(도면 지상1층) — 필로티. 사선부는 아직 건물이 아니라 외부 포장면이다 */
const OUTLINE_F2: MM[] = [
  [0, -4400], [33800, -4400], [33800, 19400], [29460, 19400], [29460, 21570],
  [22250, 21570], [22250, 16900], [0, 16900],
];

// -------------------------------------------------------------
// 남서측 사선 공간 — 6,277 × 9,500 직사각형이 약 33.2° 돌아앉아 있다
// -------------------------------------------------------------

/** 사선부 전체 (A=북, B=동, C=남, D=서) */
const WING: MM[] = [[0, 19320], [7952, 24517], [4518, 29770], [-3434, 24573]];

/** 사선부 북서쪽 2,200 띠 — 5·6층 게스트룸의 욕실이 여기 붙는다 */
const WING_BATH: MM[] = [[0, 19320], [1841, 20523], [-1593, 25776], [-3434, 24573]];

/** 사선부 나머지 */
const WING_MAIN: MM[] = [[1841, 20523], [7952, 24517], [4518, 29770], [-1593, 25776]];

// -------------------------------------------------------------
// 층 공용 코어 — 3층~7층이 같은 자리다
// -------------------------------------------------------------

const CORE = {
  /** 복도 — 동서로 관통하고 서측 계단 앞에서 남쪽으로 한 번 꺾인다 */
  corridor: [
    [4530, 11900], [33800, 11900], [33800, 14000],
    [7110, 14000], [7110, 16900], [4530, 16900],
  ] as MM[],
  storageW: R(0, 11900, 4530, 2100),
  stairW: R(0, 14000, 4530, 2900),
  storageM: R(7110, 14000, 3040, 2900),
  linen: R(10150, 14000, 1430, 2900),
  restroom: R(11580, 14000, 8320, 2900),
  es: R(19900, 14000, 2350, 2900),
  storageE: R(22250, 14000, 2570, 1300),
  elevator: R(22250, 15300, 2570, 2650),
  hall: R(24820, 14000, 4640, 3950),
  stairE: R(22250, 17950, 7210, 3620),
  /** 남동측 끝 방 (4층 교육실3 · 3층 Kids 도서관) */
  eastRoom: R(29460, 14000, 4340, 5400),
};

/** 연결부 쐐기 안에 들어가는 작은 방 (1층 전기실 · 3층 부속실) */
const wedgeRoom = (w: number, h: number): MM[] => R(500, 17300, w, h);

// -------------------------------------------------------------
// 층별 외곽선
// -------------------------------------------------------------

export const FLOOR_OUTLINE: Record<string, Pt[]> = {
  "vision-1f": P(OUTLINE_B1),
  "vision-2f": P(OUTLINE_F2),
  "vision-3f": P(OUTLINE_MAIN),
  "vision-4f": P(OUTLINE_MAIN),
  "vision-5f": P(OUTLINE_MAIN),
  "vision-6f": P(OUTLINE_MAIN),
  "vision-7f": P(OUTLINE_MAIN),
  // 옥상층 공간 id 는 "vision-roof-…" 라서 층 키도 vision-roof 로 잡힌다
  "vision-roof": P(OUTLINE_MAIN),
};

// -------------------------------------------------------------
// 방별 폴리곤 (도면 mm)
// -------------------------------------------------------------

const ROOM_MM: Record<string, MM[]> = {
  // ── 1층 (도면 지하1층 · A-301) — GL-200, 주차 18대 ──────────
  "vision-1f-parking": [[0, -4400], [11900, -4400], [11900, 0], [33800, 0], [33800, 14000], [0, 14000]],
  "vision-1f-ramp": R(33800, 0, 2400, 11500),
  "vision-1f-stair": CORE.stairW,
  "vision-1f-es": CORE.es,
  "vision-1f-storage": CORE.storageE,
  "vision-1f-elevator": CORE.elevator,
  "vision-1f-hall": CORE.hall,
  "vision-1f-electric": wedgeRoom(6000, 3000),
  "vision-1f-stair-e": CORE.stairE,
  "vision-1f-safety": R(29600, 19400, 3200, 2100),
  "vision-1f-pump": WING,

  // ── 2층 (도면 지상1층 · A-302) — GL+3,000 필로티, 주차 20대 ──
  "vision-2f-queue": R(0, -4400, 7000, 9400),
  "vision-2f-gate": R(7000, -4400, 26800, 4400),
  "vision-2f-parking": [[7000, 0], [33800, 0], [33800, 14000], [0, 14000], [0, 5000], [7000, 5000]],
  "vision-2f-stair": CORE.stairW,
  "vision-2f-es": CORE.es,
  "vision-2f-storage": CORE.storageE,
  "vision-2f-elevator": CORE.elevator,
  "vision-2f-hall": CORE.hall,
  "vision-2f-stair-e": CORE.stairE,

  // ── 3층 (도면 지상2층 · A-303) ───────────────────────────────
  "vision-3f-infant": R(0, 0, 12000, 11900),
  "vision-3f-seminar": R(12000, 0, 21800, 11900),
  "vision-3f-restroom-kids": CORE.storageW,
  "vision-3f-corridor": CORE.corridor,
  "vision-3f-stair": CORE.stairW,
  "vision-3f-storage": CORE.storageM,
  "vision-3f-linen": CORE.linen,
  "vision-3f-restroom": CORE.restroom,
  "vision-3f-es": CORE.es,
  "vision-3f-storage-e": CORE.storageE,
  "vision-3f-elevator": CORE.elevator,
  "vision-3f-hall": CORE.hall,
  "vision-3f-stair-e": CORE.stairE,
  "vision-3f-kids-library": CORE.eastRoom,
  "vision-3f-support": wedgeRoom(3400, 2600),
  "vision-3f-seminar-annex": WING,

  // ── 4층 (도면 지상3층 · A-304) ───────────────────────────────
  "vision-4f-class1": R(0, 0, 13900, 11900),
  "vision-4f-teacher1": R(13900, 0, 6000, 4000),
  "vision-4f-teacher2": R(13900, 4000, 6000, 3900),
  "vision-4f-teacher3": R(13900, 7900, 6000, 4000),
  "vision-4f-class2": R(19900, 0, 13900, 11900),
  "vision-4f-storage-w": CORE.storageW,
  "vision-4f-corridor": CORE.corridor,
  "vision-4f-stair": CORE.stairW,
  "vision-4f-storage": CORE.storageM,
  "vision-4f-linen": CORE.linen,
  "vision-4f-restroom": CORE.restroom,
  "vision-4f-es": CORE.es,
  "vision-4f-storage-e": CORE.storageE,
  "vision-4f-elevator": CORE.elevator,
  "vision-4f-hall": CORE.hall,
  "vision-4f-stair-e": CORE.stairE,
  "vision-4f-class3": CORE.eastRoom,
  "vision-4f-cafe": WING,

  // ── 5층 (도면 지상4층 · A-305) — 북측 2,100 후퇴(옥상) ────────
  "vision-5f-roof-n": R(0, 0, 33800, 2100),
  "vision-5f-council": R(0, 2100, 8000, 10150),
  "vision-5f-class": R(8000, 2100, 21900, 10150),
  "vision-5f-mid1": R(29900, 2100, 3900, 4450),
  "vision-5f-high1": R(29900, 6550, 3900, 5700),
  "vision-5f-mid2": R(29900, 12250, 3900, 3550),
  "vision-5f-high2": R(29900, 15800, 3900, 3600),
  "vision-5f-storage-w": R(0, 12250, 4530, 1750),
  "vision-5f-corridor": [
    [4530, 12250], [29900, 12250], [29900, 14000],
    [7110, 14000], [7110, 16900], [4530, 16900],
  ],
  "vision-5f-stair": CORE.stairW,
  "vision-5f-storage": CORE.storageM,
  "vision-5f-linen": CORE.linen,
  "vision-5f-restroom": CORE.restroom,
  "vision-5f-es": CORE.es,
  "vision-5f-storage-e": CORE.storageE,
  "vision-5f-elevator": CORE.elevator,
  "vision-5f-hall": CORE.hall,
  "vision-5f-stair-e": CORE.stairE,
  "vision-5f-guest": WING_MAIN,
  "vision-5f-bath": WING_BATH,

  // ── 6층 (도면 지상5층 · A-306) — 체육관(2개 층 높이) ──────────
  "vision-6f-roof-n": R(0, 0, 29900, 4100),
  "vision-6f-gym": R(0, 4100, 29900, 9900),
  "vision-6f-roofdeck": R(29900, 0, 3900, 14000),
  "vision-6f-stair": CORE.stairW,
  "vision-6f-storage": R(7110, 14000, 1790, 2900),
  "vision-6f-laundry": R(8900, 14000, 1700, 2900),
  "vision-6f-locker-w": R(10600, 14000, 5400, 2900),
  "vision-6f-shower-w": R(16000, 14000, 3900, 2900),
  "vision-6f-es": CORE.es,
  "vision-6f-storage-e": CORE.storageE,
  "vision-6f-elevator": CORE.elevator,
  "vision-6f-hall": CORE.hall,
  "vision-6f-stair-e": CORE.stairE,
  "vision-6f-guest": WING_MAIN,
  "vision-6f-bath": WING_BATH,

  // ── 7층 (도면 지상6층 · A-307) — 체육관 상부 열림 ─────────────
  "vision-7f-roof-n": R(0, 0, 29900, 5650),
  "vision-7f-gym-void": R(0, 5650, 29900, 8350),
  "vision-7f-roof-e": R(29900, 0, 3900, 14000),
  "vision-7f-stair": CORE.stairW,
  "vision-7f-locker-m": R(7110, 14000, 3500, 2900),
  "vision-7f-shower-m": R(10610, 14000, 3800, 2900),
  "vision-7f-storage": R(14410, 14000, 5490, 2900),
  "vision-7f-es": CORE.es,
  "vision-7f-storage-east": CORE.storageE,
  "vision-7f-elevator": CORE.elevator,
  "vision-7f-hall": CORE.hall,
  "vision-7f-stair-e": CORE.stairE,
  "vision-7f-seminar": WING,

  // ── 옥상 (도면 옥상층 · A-308) ───────────────────────────────
  "vision-roof-deck": R(0, 0, 29900, 14000),
  "vision-roof-east": R(29900, 0, 3900, 14000),
  "vision-roof-stair": CORE.stairW,
  "vision-roof-machine": CORE.elevator,
  "vision-roof-hall": CORE.hall,
  "vision-roof-stair-e": CORE.stairE,
  "vision-roof-wing": WING,
};

export const ROOM_POLY: Record<string, Pt[]> = Object.fromEntries(
  Object.entries(ROOM_MM).map(([id, mm]) => [id, P(mm)]),
);

// -------------------------------------------------------------
// 층 높이 — 횡단면도(A-402) 기준. 보조 정보다.
// -------------------------------------------------------------

export type FloorLevel = {
  /** 도로면(G.L ±0) 기준 바닥 높이, mm */
  slabMm: number;
  /** 바로 위층까지의 층고, mm. 옥상은 null */
  heightMm: number | null;
};

export const VISION_FLOOR_LEVEL: Record<number, FloorLevel> = {
  1: { slabMm: -200, heightMm: 3100 },
  2: { slabMm: 2900, heightMm: 3400 },
  3: { slabMm: 6300, heightMm: 4000 },
  4: { slabMm: 10300, heightMm: 4000 },
  5: { slabMm: 14300, heightMm: 4000 },
  6: { slabMm: 18300, heightMm: 3100 },
  7: { slabMm: 21400, heightMm: 3100 },
  8: { slabMm: 24500, heightMm: null },
};

/** "G.L +10,300 · 층고 4.0m" — 층 안내 한 줄 */
export function formatFloorLevel(floor: number): string | null {
  const level = VISION_FLOOR_LEVEL[floor];
  if (!level) return null;
  const sign = level.slabMm < 0 ? "−" : "+";
  const slab = `G.L ${sign}${Math.abs(level.slabMm).toLocaleString("en-US")}`;
  if (level.heightMm === null) return slab;
  return `${slab} · 층고 ${(level.heightMm / 1000).toFixed(1)}m`;
}

// -------------------------------------------------------------
// 면적·치수 — 도면 mm 에서 계산한 보조 정보
// -------------------------------------------------------------

export type RoomMetrics = {
  /** 바닥 면적 m² */
  areaM2: number;
  /** 가로 × 세로 m. 사선 방은 두 변의 길이 */
  widthM: number;
  depthM: number;
};

function shoelaceMm(pts: MM[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** 방의 면적·치수. 도면에 없는 방이면 null */
export function roomMetrics(roomId: string): RoomMetrics | null {
  const mm = ROOM_MM[roomId];
  if (!mm) return null;
  const edge = (a: number, b: number) => Math.hypot(mm[b][0] - mm[a][0], mm[b][1] - mm[a][1]) / 1000;
  const xs = mm.map((p) => p[0]);
  const ys = mm.map((p) => p[1]);
  const rectangular = mm.length === 4;
  return {
    areaM2: shoelaceMm(mm) / 1e6,
    widthM: rectangular ? edge(0, 1) : (Math.max(...xs) - Math.min(...xs)) / 1000,
    depthM: rectangular ? edge(1, 2) : (Math.max(...ys) - Math.min(...ys)) / 1000,
  };
}

/** "약 13.9 × 11.9m · 165.4㎡" — 공간 상세에 붙이는 한 줄 */
export function formatRoomMetrics(roomId: string): string | null {
  const m = roomMetrics(roomId);
  if (!m) return null;
  return `약 ${m.widthM.toFixed(1)} × ${m.depthM.toFixed(1)}m · ${m.areaM2.toFixed(1)}㎡`;
}

// -------------------------------------------------------------
// 조회 헬퍼
// -------------------------------------------------------------

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
