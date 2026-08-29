"use client";

/* ============================================================
   2단계 — 층 선택

   선택한 건물을 얇은 판(슬래브)으로 층층이 쌓아 2.5D 로 보여준다.
   층 간격(STEP)은 "손가락으로 누를 수 있는 최소 높이"를 기준으로 잡았다.
   슬래브 하나의 터치 판정은 그 층 앞쪽 STEP 만큼의 띠 전체다(≈45px 이상).
   ============================================================ */

import type { FacilityBuilding } from "@/lib/facility/facility-map-config";
import {
  ISO_UNIT,
  boxFaces,
  emptyBounds,
  growBounds,
  growBoundsWithBox,
  project,
  toViewBox,
} from "@/lib/facility/isometric";

type Props = {
  building: FacilityBuilding;
  selectedFloor: number | null;
  onSelect: (floor: number) => void;
};

const UNIT = ISO_UNIT;
const PLATE_W = 3.2;
const PLATE_D = 2.2;
const PLATE_H = 0.26;   // 판 두께 (얇게)
const STEP = 1.9;       // 층 간격 — 320px 화면까지 유효 터치 띠 44px 이상 유지
const LABEL_GAP = 14;
const LABEL_WIDTH = 96;

export default function FacilityFloorMap({ building, selectedFloor, onSelect }: Props) {
  const floors = building.floors;
  const plate = { x: 0, y: 0, w: PLATE_W, d: PLATE_D, h: PLATE_H };

  let bounds = emptyBounds();
  // 바닥판 + 각 층
  bounds = growBoundsWithBox(bounds, { ...plate, h: 0.2 }, UNIT, -0.5);
  floors.forEach((_, i) => {
    bounds = growBoundsWithBox(bounds, plate, UNIT, i * STEP);
  });
  // 오른쪽 층 이름표가 잘리지 않도록 여유 확보
  const topRight = project(PLATE_W, 0, (floors.length - 1) * STEP, UNIT);
  bounds = growBounds(bounds, { x: topRight.x + LABEL_GAP + LABEL_WIDTH, y: topRight.y });
  const { viewBox, width } = toViewBox(bounds, 16);

  const groundFaces = boxFaces({ ...plate, h: 0.14 }, UNIT, -0.55);

  return (
    <svg
      viewBox={viewBox}
      role="group"
      aria-label={`${building.name} 층 안내도`}
      style={{ width: "100%", maxWidth: width, height: "auto", display: "block", margin: "0 auto", overflow: "visible" }}
    >
      {/* 지면 */}
      <polygon
        points={groundFaces.top}
        fill="color-mix(in srgb, var(--bg-soft) 70%, transparent)"
        stroke="var(--hairline)"
        strokeWidth={1}
        strokeDasharray="5 4"
      />

      {floors.map((floor, i) => {
        const baseZ = i * STEP;
        const selected = floor.floor === selectedFloor;
        const dimmed = selectedFloor !== null && !selected;

        const faces = boxFaces(plate, UNIT, baseZ);
        const anchor = project(PLATE_W, 0, baseZ + PLATE_H, UNIT);
        const labelX = anchor.x + LABEL_GAP;
        const labelY = anchor.y + 4;

        const topFill = selected
          ? "color-mix(in srgb, var(--accent) 30%, var(--card))"
          : "color-mix(in srgb, var(--accent) 13%, var(--card))";
        const rightFill = selected
          ? "color-mix(in srgb, var(--accent) 50%, var(--card))"
          : "color-mix(in srgb, var(--accent) 30%, var(--card))";
        const leftFill = selected
          ? "color-mix(in srgb, var(--accent) 62%, var(--card))"
          : "color-mix(in srgb, var(--accent) 42%, var(--card))";
        const stroke = selected ? "var(--accent-strong)" : "var(--hairline-strong)";

        const reservableCount = floor.rooms.filter((r) => r.reservable).length;

        return (
          <g
            key={floor.floor}
            className="facility-map-target"
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${building.name} ${floor.label} 선택`}
            onClick={() => onSelect(floor.floor)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(floor.floor);
              }
            }}
            style={{
              opacity: dimmed ? 0.78 : 1,
              transform: selected ? "translateX(7px)" : undefined,
            }}
          >
            <title>{`${building.name} ${floor.label} — 신청 가능한 공간 ${reservableCount}곳`}</title>

            {/* 판 자체가 터치 판정 영역이다. 위층 판이 나중에 그려지며 뒤쪽을 덮으므로
                각 층에는 앞쪽 STEP(≈50px) 만큼의 띠가 남는다 — 최소 터치 높이 확보. */}
            <polygon className="facility-map-face" points={faces.left} fill={leftFill} stroke={stroke} strokeWidth={selected ? 1.4 : 1} strokeLinejoin="round" />
            <polygon className="facility-map-face" points={faces.right} fill={rightFill} stroke={stroke} strokeWidth={selected ? 1.4 : 1} strokeLinejoin="round" />
            <polygon className="facility-map-face" points={faces.top} fill={topFill} stroke={stroke} strokeWidth={selected ? 1.4 : 1} strokeLinejoin="round" />
            <polygon className="facility-map-outline" points={faces.hit} fill="none" stroke="none" />

            {/* 층 이름표 — 이름표도 같은 그룹이라 눌러서 선택된다 */}
            <rect x={labelX - 6} y={labelY - 24} width={LABEL_WIDTH} height={46} fill="transparent" />
            <line
              x1={anchor.x + 2}
              y1={anchor.y}
              x2={labelX - 4}
              y2={labelY - 4}
              stroke="var(--hairline-strong)"
              strokeWidth={1}
            />
            <text
              x={labelX}
              y={labelY}
              style={{
                fontSize: selected ? 14 : 13,
                fontWeight: selected ? 700 : 500,
                fill: selected ? "var(--accent-strong)" : "var(--ink-mid)",
                pointerEvents: "none",
              }}
            >
              {floor.label}
            </text>
            <text
              x={labelX}
              y={labelY + 14}
              style={{ fontSize: 10.5, fontWeight: 500, fill: "var(--ink-faint)", pointerEvents: "none" }}
            >
              {reservableCount > 0 ? `신청 ${reservableCount}곳` : "신청 불가"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
