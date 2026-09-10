/* ============================================================
   시설 사용신청 — 캠퍼스 안내도 좌표계

   1단계 "건물 선택" 지도는 위에서 내려다본 배치도(지적도 느낌)다.
   실측 도면이 아니라 **어느 건물인지 알아보기 위한 안내도**이며,
   다음 관계만 정확히 지키도록 좌표를 잡았다.

     · 명덕6길이 캠퍼스를 남북으로 가른다
     · 비전센터만 길 북쪽에 따로 서 있다
     · 길 남쪽에 서→동으로 바울관주차장 · 바울관 · 맑은숲작은도서관 ·
       맑은숲도서관주차장이 늘어서고, 명성교회 본당이 그 남서쪽에 있다

   비전센터 외곽선만은 건축도면(대영건축사사무소, A-301~402)의 실제
   치수를 축소해 그렸다 — 동서 33.8m 남북 11.9m 주동 + 동측 남향 돌출부
   4.5m×5.6m + 남서측 45° 별동. 1 캠퍼스단위 ≒ 0.1m.

   좌표계
     x: 동쪽(오른쪽), y: 남쪽(아래). 화면 그대로이므로 위가 북쪽이다.
     건물 다각형은 facility-map-config.ts 의 building.footprint 에 있고,
     길·주변 건물처럼 선택 대상이 아닌 배경만 이 파일에 둔다.
   ============================================================ */

export type MapPoint = { x: number; y: number };

/** 건물 하나의 지도상 외곽선 + 이름표 위치 */
export type FacilityFootprint = {
  /** 외곽선 다각형 — 시계방향, 캠퍼스 좌표 */
  points: MapPoint[];
  /** 이름표(아이콘 배지 + 글자) 블록의 중심 */
  pin: MapPoint;
  /** 이름표를 여러 줄로 끊어 쓸 때. 없으면 건물 이름을 한 줄로 쓴다 */
  labelLines?: string[];
};

/** 안내도 전체 크기 — SVG viewBox 와 이름표 % 좌표 계산에 함께 쓴다 */
export const CAMPUS_VIEW = { width: 720, height: 770 } as const;

/** 도로 — 이름표를 도로 위에 눕혀 쓴다 */
export type CampusRoad = {
  name: string;
  points: MapPoint[];
  /** 이름표 위치와 기울기(도) */
  label: MapPoint;
  labelAngle: number;
};

/**
 * 명덕6길. 왼쪽이 높고 오른쪽으로 내려가는 완만한 기울기까지 참고 지도와 맞췄다.
 * 화면 밖까지 이어지도록 좌우로 10 만큼 넘겨 그린다.
 */
export const CAMPUS_ROADS: CampusRoad[] = [
  {
    name: "명덕6길",
    points: [
      { x: -10, y: 240 },
      { x: 730, y: 286 },
      { x: 730, y: 342 },
      { x: -10, y: 296 },
    ],
    label: { x: 436, y: 296 },
    labelAngle: 3.6,
  },
];

/**
 * 주변 건물 — 이름 없이 옅게만 깔아 "지도처럼" 보이게 하는 배경이다.
 * 교회 시설이 아니므로 누를 수 없고 이름도 쓰지 않는다.
 */
export const CAMPUS_CONTEXT: MapPoint[][] = [
  // 비전센터 북서쪽 블록
  [
    { x: 48, y: 60 },
    { x: 150, y: 52 },
    { x: 154, y: 150 },
    { x: 100, y: 176 },
    { x: 44, y: 160 },
  ],
  // 비전센터 동쪽 블록
  [
    { x: 612, y: 66 },
    { x: 712, y: 58 },
    { x: 716, y: 196 },
    { x: 618, y: 204 },
  ],
  // 도서관 남쪽 상가 블록
  [
    { x: 430, y: 552 },
    { x: 600, y: 566 },
    { x: 592, y: 690 },
    { x: 424, y: 676 },
  ],
  // 남동쪽 끝 블록
  [
    { x: 628, y: 588 },
    { x: 720, y: 596 },
    { x: 720, y: 712 },
    { x: 622, y: 704 },
  ],
  // 남쪽 끝 — 아래 여백을 막아 지도가 잘려 이어지는 느낌을 준다
  [
    { x: 400, y: 708 },
    { x: 604, y: 720 },
    { x: 600, y: 770 },
    { x: 396, y: 764 },
  ],
];

/** 다각형 → SVG points 속성 문자열 */
export function polygonPoints(points: MapPoint[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

/** 다각형의 화면상 경계 상자 */
export function polygonBounds(points: MapPoint[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * 캠퍼스 좌표 → 안내도 안에서의 백분율.
 * 이름표는 SVG 가 아니라 위에 겹친 HTML 버튼으로 그리기 때문에(글꼴·아이콘·
 * 줄바꿈을 그대로 쓰려고) 이 변환이 필요하다.
 */
export function toPercent(point: MapPoint): { left: string; top: string } {
  return {
    left: `${round((point.x / CAMPUS_VIEW.width) * 100)}%`,
    top: `${round((point.y / CAMPUS_VIEW.height) * 100)}%`,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
