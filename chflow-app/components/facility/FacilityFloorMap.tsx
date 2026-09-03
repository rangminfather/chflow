"use client";

/* ============================================================
   2단계 — 층 선택 (건물 단면)

   건물을 옆에서 자른 것처럼 위층부터 아래로 쌓아 보여준다.
   층이 8개까지 있고(비전센터) 지하층도 있어서, 예전의 아이소메트릭
   슬래브 더미로는 지면 위/아래가 구분되지 않고 세로로만 길어졌다.
   여기서는 층마다 한 줄을 주고, 지면선으로 지상·지하를 갈라 놓는다.

   한 줄이 곧 터치 영역(최소 52px)이고, 줄 안에 그 층의 대표 공간과
   신청 가능한 곳 수를 같이 보여줘서 층을 눌러보지 않고도 고를 수 있다.
   ============================================================ */

import { ChevronRight } from "lucide-react";
import type { FacilityBuilding } from "@/lib/facility/facility-map-config";
import { countReservableRooms, summarizeFloor } from "@/lib/facility/facility-map-config";

type Props = {
  building: FacilityBuilding;
  selectedFloor: number | null;
  onSelect: (floor: number) => void;
};

export default function FacilityFloorMap({ building, selectedFloor, onSelect }: Props) {
  // 위층이 위로 오도록 내림차순. config 의 floors 배열은 오름차순이다.
  const descending = [...building.floors].sort((a, b) => b.floor - a.floor);
  const hasBasement = descending.some((f) => f.floor < 0);
  // 지상 마지막 층의 index — 그 아래에 지면선을 넣는다
  const lastAboveGround = descending.reduce((last, f, i) => (f.floor > 0 ? i : last), -1);

  return (
    <div
      role="group"
      aria-label={`${building.name} 층 선택`}
      style={{
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid var(--hairline)",
        background: "var(--surface)",
      }}
    >
      {/* 지붕 — 건물 단면임을 한눈에 알리는 장식 */}
      <div
        aria-hidden="true"
        style={{
          height: 14,
          background: "color-mix(in srgb, var(--accent) 32%, var(--card))",
          clipPath: "polygon(3% 100%, 11% 0%, 89% 0%, 97% 100%)",
        }}
      />

      {descending.map((floor, index) => {
        const selected = floor.floor === selectedFloor;
        const reservable = countReservableRooms(floor);
        const selectable = reservable > 0;
        const summary = summarizeFloor(floor);

        const row = (
          <>
            <span
              aria-hidden="true"
              style={{
                width: 54,
                flexShrink: 0,
                padding: "6px 0",
                borderRadius: 8,
                textAlign: "center",
                fontSize: 12.5,
                fontWeight: 800,
                letterSpacing: -0.2,
                color: selected ? "var(--card)" : selectable ? "var(--accent-strong)" : "var(--ink-faint)",
                background: selected
                  ? "var(--accent)"
                  : selectable
                    ? "color-mix(in srgb, var(--accent) 14%, var(--card))"
                    : "var(--bg-soft)",
              }}
            >
              {floor.label}
            </span>

            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <span
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: selected ? 800 : 600,
                  color: selectable ? "var(--ink)" : "var(--ink-faint)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {summary}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  fontSize: 11,
                  fontWeight: 600,
                  color: selectable ? "var(--ink-soft)" : "var(--ink-faint)",
                }}
              >
                {selectable ? `신청 가능 ${reservable}곳` : "신청 가능한 공간 없음"}
              </span>
            </span>

            {selectable && (
              <ChevronRight
                size={16}
                strokeWidth={2}
                aria-hidden="true"
                style={{ flexShrink: 0, color: selected ? "var(--accent-strong)" : "var(--ink-faint)" }}
              />
            )}
          </>
        );

        const shared: React.CSSProperties = {
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          minHeight: 52,
          padding: "8px 12px",
          border: "none",
          borderTop: index === 0 ? "none" : "1px solid var(--hairline)",
          borderLeft: selected ? "3px solid var(--accent)" : "3px solid transparent",
          background: selected ? "color-mix(in srgb, var(--accent) 10%, var(--card))" : "var(--card)",
          fontFamily: "inherit",
          textAlign: "left",
          boxSizing: "border-box",
        };

        return (
          <div key={floor.floor}>
            {selectable ? (
              <button
                type="button"
                className="facility-floor-row"
                aria-pressed={selected}
                aria-label={`${building.name} ${floor.label} 선택 — 신청 가능한 공간 ${reservable}곳`}
                onClick={() => onSelect(floor.floor)}
                style={{ ...shared, cursor: "pointer" }}
              >
                {row}
              </button>
            ) : (
              <div style={shared} aria-label={`${floor.label} — 신청 가능한 공간이 없습니다`}>
                {row}
              </div>
            )}

            {/* 지면선 — 지상 마지막 층과 지하 첫 층 사이 */}
            {hasBasement && index === lastAboveGround && (
              <div
                aria-hidden="true"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 12px",
                  background: "color-mix(in srgb, var(--ink) 5%, var(--card))",
                  borderTop: "1px solid var(--hairline-strong)",
                  borderBottom: "1px solid var(--hairline-strong)",
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 800, color: "var(--ink-faint)", letterSpacing: 0.6 }}>지면</span>
                <span style={{ flex: 1, borderTop: "1px dashed var(--hairline-strong)" }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
