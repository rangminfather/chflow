"use client";

/* ============================================================
   1단계 — 건물 선택 (반입체 2.5D 안내도)

   실제 건축도면이 아니라 "어느 건물인지" 알아보기 위한 안내용 그림이다.
   실제 도면 SVG가 준비되면 이 파일의 <svg> 내용만 교체하면 되고,
   선택 상태(onSelect(code))와 config 의 building code 는 그대로 쓴다.
   ============================================================ */

import type { FacilityBuilding } from "@/lib/facility/facility-map-config";
import {
  ISO_UNIT,
  boxFaces,
  depthKey,
  emptyBounds,
  growBoundsWithBox,
  project,
  toViewBox,
} from "@/lib/facility/isometric";

type Props = {
  buildings: FacilityBuilding[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
};

const UNIT = ISO_UNIT;

export default function FacilityBuildingMap({ buildings, selectedCode, onSelect }: Props) {
  // 대지(바닥판) 범위 — 모든 건물을 감싸는 사각형
  const gridMinX = Math.min(...buildings.map((b) => b.block.x)) - 0.5;
  const gridMinY = Math.min(...buildings.map((b) => b.block.y)) - 0.5;
  const gridMaxX = Math.max(...buildings.map((b) => b.block.x + b.block.w)) + 0.5;
  const gridMaxY = Math.max(...buildings.map((b) => b.block.y + b.block.d)) + 0.5;

  const groundBox = { x: gridMinX, y: gridMinY, w: gridMaxX - gridMinX, d: gridMaxY - gridMinY, h: 0 };
  const ground = boxFaces(groundBox, UNIT);

  let bounds = growBoundsWithBox(emptyBounds(), groundBox, UNIT);
  for (const building of buildings) {
    // 선택 시 살짝 떠오르므로 위쪽 여유를 조금 더 준다
    bounds = growBoundsWithBox(bounds, { ...building.block, h: building.block.h + 0.3 }, UNIT);
  }
  const { viewBox, width } = toViewBox(bounds, 18);

  const ordered = [...buildings].sort((a, b) => depthKey(a.block) - depthKey(b.block));

  return (
    <svg
      viewBox={viewBox}
      role="group"
      aria-label="교회 건물 안내도"
      style={{ width: "100%", maxWidth: width, height: "auto", display: "block", margin: "0 auto", overflow: "visible" }}
    >
      {/* 대지 */}
      <polygon
        points={ground.top}
        fill="color-mix(in srgb, var(--bg-soft) 75%, transparent)"
        stroke="var(--hairline)"
        strokeWidth={1}
        strokeDasharray="5 4"
      />

      {ordered.map((building) => {
        const selected = building.code === selectedCode;
        const faces = boxFaces(building.block, UNIT);
        const label = building.name;
        const floorCount = building.floors.length;

        // 선택 여부에 따른 색 — 강조는 "약간 밝아짐 + 얇은 강조선" 정도로만
        const topFill = selected
          ? "color-mix(in srgb, var(--accent) 30%, var(--card))"
          : "color-mix(in srgb, var(--accent) 10%, var(--card))";
        const rightFill = selected
          ? "color-mix(in srgb, var(--accent) 46%, var(--card))"
          : "color-mix(in srgb, var(--accent) 22%, var(--card))";
        const leftFill = selected
          ? "color-mix(in srgb, var(--accent) 60%, var(--card))"
          : "color-mix(in srgb, var(--accent) 34%, var(--card))";
        const stroke = selected ? "var(--accent-strong)" : "var(--hairline-strong)";

        return (
          <g
            key={building.code}
            className="facility-map-target"
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${building.name} 선택`}
            onClick={() => onSelect(building.code)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(building.code);
              }
            }}
            style={selected ? { transform: "translateY(-6px)" } : undefined}
          >
            <title>{`${building.name} — ${building.description}`}</title>

            <polygon className="facility-map-face" points={faces.left} fill={leftFill} stroke={stroke} strokeWidth={selected ? 1.4 : 1} strokeLinejoin="round" />
            <polygon className="facility-map-face" points={faces.right} fill={rightFill} stroke={stroke} strokeWidth={selected ? 1.4 : 1} strokeLinejoin="round" />
            <polygon className="facility-map-face" points={faces.top} fill={topFill} stroke={stroke} strokeWidth={selected ? 1.4 : 1} strokeLinejoin="round" />

            {/* 층 구분선 힌트 — 높이가 있는 건물만 */}
            {building.block.h >= 1 &&
              Array.from({ length: Math.max(0, floorCount - 1) }, (_, i) => {
                const z = ((i + 1) * building.block.h) / floorCount;
                const a = project(building.block.x + building.block.w, building.block.y, z, UNIT);
                const b = project(building.block.x + building.block.w, building.block.y + building.block.d, z, UNIT);
                const c = project(building.block.x, building.block.y + building.block.d, z, UNIT);
                return (
                  <polyline
                    key={i}
                    points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`}
                    fill="none"
                    stroke="color-mix(in srgb, var(--ink) 12%, transparent)"
                    strokeWidth={0.8}
                  />
                );
              })}

            {/* 포커스 표시용 외곽선 */}
            <polygon className="facility-map-outline" points={faces.hit} fill="none" stroke="none" />

            <text
              x={faces.topCenter.x}
              y={faces.topCenter.y - 2}
              textAnchor="middle"
              style={{ fontSize: 14, fontWeight: 700, fill: "var(--ink)", pointerEvents: "none" }}
            >
              {label}
            </text>
            <text
              x={faces.topCenter.x}
              y={faces.topCenter.y + 13}
              textAnchor="middle"
              style={{ fontSize: 10.5, fontWeight: 500, fill: "var(--ink-soft)", pointerEvents: "none" }}
            >
              {floorCount > 1 ? `${floorCount}개 층` : building.description}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
