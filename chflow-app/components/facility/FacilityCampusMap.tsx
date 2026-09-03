"use client";

/* ============================================================
   1단계 — 건물 선택 (캠퍼스 안내도)

   위에서 내려다본 배치도다. 건물 외곽선은 SVG 로 그리고,
   이름표(아이콘 배지 + 글자)는 SVG 위에 겹친 HTML 버튼으로 그린다.
   — 글꼴·줄바꿈·lucide 아이콘을 화면 나머지와 똑같이 쓰기 위해서다.
   컨테이너에 안내도와 같은 aspect-ratio 를 주므로 % 좌표가 정확히 맞는다.

   좌표·배치 근거는 lib/facility/campus-map.ts 주석 참고.
   실제 도면 SVG로 교체할 때도 building.footprint 만 갈아끼우면 된다.
   ============================================================ */

import { BookOpen, Building2, Church, School, SquareParking } from "lucide-react";
import type { FacilityBuilding, FacilityIconKey } from "@/lib/facility/facility-map-config";
import { isBuildingSelectable } from "@/lib/facility/facility-map-config";
import {
  CAMPUS_CONTEXT,
  CAMPUS_ROADS,
  CAMPUS_VIEW,
  polygonPoints,
  toPercent,
} from "@/lib/facility/campus-map";

type Props = {
  buildings: FacilityBuilding[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
};

const ICONS: Record<FacilityIconKey, typeof Church> = {
  church: Church,
  vision: Building2,
  hall: School,
  library: BookOpen,
  parking: SquareParking,
};

/** 좁은 화면에서도 이름표가 서로 붙지 않도록 글자·배지를 화면폭에 맞춰 줄인다 */
const BADGE = "clamp(22px, 6.2vw, 30px)";
const GLYPH = "clamp(12px, 3.4vw, 16px)";
const LABEL = "clamp(9.5px, 2.7vw, 12.5px)";

export default function FacilityCampusMap({ buildings, selectedCode, onSelect }: Props) {
  return (
    <div>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: `${CAMPUS_VIEW.width} / ${CAMPUS_VIEW.height}`,
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid var(--hairline)",
          background: "color-mix(in srgb, var(--bg-soft) 55%, var(--card))",
        }}
      >
        <svg
          viewBox={`0 0 ${CAMPUS_VIEW.width} ${CAMPUS_VIEW.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="명성교회 캠퍼스 안내도"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            {/* 주차장 — 사선 해칭으로 "건물이 아닌 포장면"임을 표시 */}
            <pattern id="facility-lot-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="10" height="10" fill="color-mix(in srgb, var(--ink) 5%, var(--card))" />
              <line x1="0" y1="0" x2="0" y2="10" stroke="color-mix(in srgb, var(--ink) 13%, transparent)" strokeWidth="1.6" />
            </pattern>
          </defs>

          {/* 주변 건물 — 이름 없이 옅게만 */}
          {CAMPUS_CONTEXT.map((shape, i) => (
            <polygon
              key={`context-${i}`}
              points={polygonPoints(shape)}
              fill="color-mix(in srgb, var(--ink) 3.5%, transparent)"
              stroke="var(--hairline)"
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
          ))}

          {/* 도로 */}
          {CAMPUS_ROADS.map((road) => (
            <g key={road.name}>
              <polygon points={polygonPoints(road.points)} fill="var(--card)" stroke="var(--hairline)" strokeWidth={1.2} />
              <text
                x={road.label.x}
                y={road.label.y}
                textAnchor="middle"
                transform={`rotate(${road.labelAngle} ${road.label.x} ${road.label.y})`}
                style={{ fontSize: 17, fontWeight: 600, fill: "var(--ink-faint)", letterSpacing: 0.6 }}
              >
                {road.name}
              </text>
            </g>
          ))}

          {/* 교회 시설 */}
          {buildings.map((building) => {
            const selected = building.code === selectedCode;
            const state = mapState(building);
            const tappable = state !== "lot";
            const points = polygonPoints(building.footprint.points);

            const fill =
              state === "lot"
                ? "url(#facility-lot-hatch)"
                : state === "pending"
                  ? "color-mix(in srgb, var(--ink) 6%, var(--card))"
                  : selected
                    ? "color-mix(in srgb, var(--accent) 24%, var(--card))"
                    : "color-mix(in srgb, var(--accent) 11%, var(--card))";
            const stroke = selected
              ? "var(--accent-strong)"
              : state === "open"
                ? "var(--accent-line)"
                : "var(--hairline-strong)";

            return (
              <g key={building.code} aria-hidden="true">
                {/* 선택된 건물 뒤에 옅은 테를 한 겹 더 둬서 지도에서 바로 눈에 띄게 */}
                {selected && (
                  <polygon
                    points={points}
                    fill="none"
                    stroke="color-mix(in srgb, var(--accent) 26%, transparent)"
                    strokeWidth={9}
                    strokeLinejoin="round"
                  />
                )}
                <polygon
                  className={tappable ? "facility-map-shape" : undefined}
                  points={points}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={selected ? 2.6 : 1.6}
                  strokeDasharray={state === "open" || selected ? undefined : "6 4"}
                  strokeLinejoin="round"
                  onClick={tappable ? () => onSelect(building.code) : undefined}
                  style={{ cursor: tappable ? "pointer" : "default" }}
                />
              </g>
            );
          })}
        </svg>

        {/* 방위 — 도면과 같은 북쪽 위 기준임을 알려준다 */}
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            alignItems: "center",
            gap: 3,
            padding: "3px 7px",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--card) 88%, transparent)",
            border: "1px solid var(--hairline)",
            fontSize: 10,
            fontWeight: 700,
            color: "var(--ink-soft)",
            pointerEvents: "none",
          }}
        >
          <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden="true">
            <polygon points="4,0 8,9 4,6.6 0,9" fill="var(--ink-soft)" />
          </svg>
          N
        </div>

        {/* 이름표 = 실제 버튼 */}
        {buildings.map((building) => {
          const selected = building.code === selectedCode;
          const state = mapState(building);
          const tappable = state !== "lot";
          const Icon = ICONS[building.iconKey];
          const lines = building.footprint.labelLines ?? [building.name];
          const { left, top } = toPercent(building.footprint.pin);

          const badgeBg = selected
            ? "var(--accent)"
            : state === "open"
              ? "var(--accent-strong)"
              : state === "pending"
                ? "var(--ink-soft)"
                : "var(--ink-faint)";
          const labelColor = selected
            ? "var(--accent-strong)"
            : state === "open"
              ? "var(--ink)"
              : "var(--ink-soft)";

          const label = (
            <>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: BADGE,
                  height: BADGE,
                  borderRadius: 999,
                  background: badgeBg,
                  color: "var(--card)",
                  boxShadow: selected
                    ? "0 0 0 4px color-mix(in srgb, var(--accent) 28%, transparent)"
                    : "0 1px 3px color-mix(in srgb, var(--ink) 18%, transparent)",
                  flexShrink: 0,
                }}
              >
                <Icon size={16} strokeWidth={2} style={{ width: GLYPH, height: GLYPH }} />
              </span>
              <span
                style={{
                  marginTop: 3,
                  fontSize: LABEL,
                  fontWeight: selected ? 800 : 700,
                  lineHeight: 1.25,
                  color: labelColor,
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  textShadow:
                    "0 1px 2px var(--card), 0 -1px 2px var(--card), 1px 0 2px var(--card), -1px 0 2px var(--card)",
                }}
              >
                {lines.map((line) => (
                  <span key={line} style={{ display: "block" }}>
                    {line}
                  </span>
                ))}
              </span>
            </>
          );

          const anchor: React.CSSProperties = {
            position: "absolute",
            left,
            top,
            transform: "translate(-50%, -50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: 0,
            border: "none",
            background: "transparent",
            fontFamily: "inherit",
          };

          if (!tappable) {
            return (
              <div key={building.code} style={{ ...anchor, pointerEvents: "none" }} aria-hidden="true">
                {label}
              </div>
            );
          }

          return (
            <button
              key={building.code}
              type="button"
              className="facility-map-pin"
              aria-pressed={selected}
              aria-label={
                state === "pending"
                  ? `${building.name} 선택 — ${building.description}, 세부 공간 확인 중`
                  : `${building.name} 선택 — ${building.description}`
              }
              onClick={() => onSelect(building.code)}
              style={{ ...anchor, cursor: "pointer" }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginTop: 12 }}>
        <LegendSwatch label="신청 가능" state="open" />
        <LegendSwatch label="세부 공간 확인 중" state="pending" />
        <LegendSwatch label="주차장" state="lot" />
      </div>
    </div>
  );
}

/** 안내도에서의 세 가지 표시 상태 */
type MapState = "open" | "pending" | "lot";

function mapState(building: FacilityBuilding): MapState {
  if (building.mapKind === "lot") return "lot";
  return isBuildingSelectable(building) ? "open" : "pending";
}

function LegendSwatch({ label, state }: { label: string; state: MapState }) {
  const fill =
    state === "open"
      ? "color-mix(in srgb, var(--accent) 18%, var(--card))"
      : state === "pending"
        ? "color-mix(in srgb, var(--ink) 6%, var(--card))"
        : "url(#facility-legend-hatch)";
  const stroke = state === "open" ? "var(--accent-line)" : "var(--hairline-strong)";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 600 }}>
      <svg width="16" height="16" aria-hidden="true" style={{ flexShrink: 0 }}>
        {state === "lot" && (
          <defs>
            <pattern id="facility-legend-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="10" height="10" fill="color-mix(in srgb, var(--ink) 5%, var(--card))" />
              <line x1="0" y1="0" x2="0" y2="10" stroke="color-mix(in srgb, var(--ink) 13%, transparent)" strokeWidth="1.6" />
            </pattern>
          </defs>
        )}
        <rect
          x="1"
          y="1"
          width="14"
          height="14"
          rx="4"
          fill={fill}
          stroke={stroke}
          strokeWidth="1.4"
          strokeDasharray={state === "open" ? undefined : "4 3"}
        />
      </svg>
      {label}
    </span>
  );
}
