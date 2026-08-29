/* ============================================================
   반입체(2.5D) 아이소메트릭 투영 헬퍼 — 순수 계산만 담당한다.

   시설 데이터(facility-map-config.ts)와 완전히 분리되어 있으므로,
   나중에 실제 도면 기반 SVG로 교체할 때 이 파일만 버리거나
   좌표 규칙만 바꾸면 된다. React·DOM 의존성 없음.

   좌표계
     x: 오른쪽-아래 방향, y: 왼쪽-아래 방향, z: 위(층) 방향
     화면 x = (x - y) * unit * COS30
     화면 y = (x + y) * unit * 0.5 - z * unit * RISE
   ============================================================ */

export const ISO_UNIT = 34;      // 격자 1칸의 화면 크기(px)
const COS30 = 0.866;             // 2:1 아이소메트릭 가로 비율
const RISE = 0.85;               // 높이 1칸이 위로 올라가는 비율

export type IsoPoint = { x: number; y: number };

/** 격자 좌표 → 화면 좌표 */
export function project(x: number, y: number, z: number, unit: number = ISO_UNIT): IsoPoint {
  return {
    x: (x - y) * unit * COS30,
    y: (x + y) * unit * 0.5 - z * unit * RISE,
  };
}

/** 아이소메트릭 직육면체 — x,y는 바닥 시작점, w/d는 바닥 크기, h는 높이 */
export type IsoBox = { x: number; y: number; w: number; d: number; h: number };

export type IsoBoxFaces = {
  /** 윗면 */
  top: string;
  /** 왼쪽(앞-왼쪽) 면 */
  left: string;
  /** 오른쪽(앞-오른쪽) 면 */
  right: string;
  /** 윗면 중앙 — 라벨 위치용 */
  topCenter: IsoPoint;
  /** 상자 전체를 덮는 6각형 — 터치 판정용 */
  hit: string;
};

function pts(list: IsoPoint[]): string {
  return list.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 직육면체의 보이는 3면 + 라벨 위치 + 터치 판정 폴리곤 */
export function boxFaces(box: IsoBox, unit: number = ISO_UNIT, baseZ = 0): IsoBoxFaces {
  const { x, y, w, d, h } = box;
  const z0 = baseZ;
  const z1 = baseZ + h;
  const p = (px: number, py: number, pz: number) => project(px, py, pz, unit);

  const topA = p(x, y, z1);
  const topB = p(x + w, y, z1);
  const topC = p(x + w, y + d, z1);
  const topD = p(x, y + d, z1);

  const botB = p(x + w, y, z0);
  const botC = p(x + w, y + d, z0);
  const botD = p(x, y + d, z0);

  return {
    top: pts([topA, topB, topC, topD]),
    left: pts([topD, topC, botC, botD]),
    right: pts([topB, topC, botC, botB]),
    topCenter: {
      x: round((topA.x + topC.x) / 2),
      y: round((topA.y + topC.y) / 2),
    },
    // 위 3면을 감싸는 외곽선(6각형) — 얇은 슬래브도 손가락으로 누를 수 있게 별도 확장은 호출부에서 처리
    hit: pts([topA, topB, botB, botC, botD, topD]),
  };
}

/** 화면에서 뒤에 있는 것부터 그리도록 정렬(화가 알고리즘) — 값이 작을수록 멀다 */
export function depthKey(box: IsoBox): number {
  return box.x + box.y;
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function growBounds(bounds: Bounds, point: IsoPoint): Bounds {
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

/** 상자 하나가 차지하는 화면 영역을 bounds에 반영 */
export function growBoundsWithBox(bounds: Bounds, box: IsoBox, unit: number = ISO_UNIT, baseZ = 0): Bounds {
  const { x, y, w, d, h } = box;
  let next = bounds;
  for (const [px, py, pz] of [
    [x, y, baseZ + h],
    [x + w, y, baseZ + h],
    [x + w, y + d, baseZ + h],
    [x, y + d, baseZ + h],
    [x, y, baseZ],
    [x + w, y, baseZ],
    [x + w, y + d, baseZ],
    [x, y + d, baseZ],
  ] as const) {
    next = growBounds(next, project(px, py, pz, unit));
  }
  return next;
}

/** bounds + 여백 → SVG viewBox 문자열과 크기 */
export function toViewBox(bounds: Bounds, pad = 16): { viewBox: string; width: number; height: number } {
  const width = Math.max(1, bounds.maxX - bounds.minX + pad * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + pad * 2);
  return {
    viewBox: `${round(bounds.minX - pad)} ${round(bounds.minY - pad)} ${round(width)} ${round(height)}`,
    width: Math.round(width),
    height: Math.round(height),
  };
}
