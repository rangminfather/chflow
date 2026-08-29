"use client";

/* ============================================================
   3단계 — 공간 선택 (간이 평면도)

   실제 건축 평면도가 아니라 공간의 상대적 위치만 알아보기 위한 배치다.
   격자 한 칸(58x72px)은 실제 면적비가 아니라 터치 크기 기준이다.
   실제 도면이 준비되면 이 파일의 사각형 그리기만 교체하면 되고,
   room.id(=DB facility_id) 와 선택 흐름은 그대로 유지된다.
   ============================================================ */

import type { FacilityFloor, FacilityRoom } from "@/lib/facility/facility-map-config";
import { formatCapacity } from "@/lib/facility/facility-map-config";

type Props = {
  floor: FacilityFloor;
  buildingName: string;
  selectedRoomId: string | null;
  onSelect: (room: FacilityRoom) => void;
};

const CELL_W = 58;
const CELL_H = 72;   // 세로를 넉넉히 — 한 칸짜리 공간도 좁은 화면에서 44px 이상
const GAP = 6;
const PAD = 10;
const LIFT = 5; // 반입체 느낌을 주는 아랫면 두께

export default function FacilityRoomMap({ floor, buildingName, selectedRoomId, onSelect }: Props) {
  const width = floor.planCols * CELL_W + PAD * 2;
  const height = floor.planRows * CELL_H + PAD * 2 + LIFT;

  return (
    // 폭은 화면에 맞춰 줄어들지만 격자 세로가 넉넉해, 320px 화면에서도
    // 한 칸짜리 공간이 44px 아래로 내려가지 않는다. 가로 스크롤은 만들지 않는다.
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={`${buildingName} ${floor.label} 평면도`}
      style={{ width: "100%", maxWidth: width, height: "auto", display: "block", margin: "0 auto" }}
    >
      {floor.rooms.map((room) => {
        const x = PAD + room.plan.x * CELL_W;
        const y = PAD + room.plan.y * CELL_H;
        const w = room.plan.w * CELL_W - GAP;
        const h = room.plan.h * CELL_H - GAP;
        const selected = room.id === selectedRoomId;
        const capacity = formatCapacity(room);

        const fill = !room.reservable
          ? "color-mix(in srgb, var(--ink) 6%, var(--card))"
          : selected
            ? "color-mix(in srgb, var(--accent) 26%, var(--card))"
            : "color-mix(in srgb, var(--accent) 8%, var(--card))";
        const stroke = !room.reservable
          ? "var(--hairline)"
          : selected
            ? "var(--accent-strong)"
            : "var(--hairline-strong)";
        const baseFill = !room.reservable
          ? "color-mix(in srgb, var(--ink) 12%, var(--card))"
          : selected
            ? "color-mix(in srgb, var(--accent) 52%, var(--card))"
            : "color-mix(in srgb, var(--accent) 24%, var(--card))";
        const nameColor = room.reservable ? "var(--ink)" : "var(--ink-faint)";
        // 이름 아래 한 줄 — 수용인원, 없으면 신청 대상이 아니라는 표시
        const subLabel = capacity
          ? capacity.replace("수용인원 ", "")
          : room.reservable ? null : "신청 불가";

        const body = (
          <>
            {/* 아랫면 — 살짝 두께가 있는 느낌만 준다 */}
            <rect x={x} y={y + LIFT} width={w} height={h} rx={9} fill={baseFill} />
            <rect
              className="facility-map-face"
              x={x}
              y={y}
              width={w}
              height={h}
              rx={9}
              fill={fill}
              stroke={stroke}
              strokeWidth={selected ? 1.8 : 1}
            />
            <rect className="facility-map-outline" x={x} y={y} width={w} height={h} rx={9} fill="none" stroke="none" />
            <text
              x={x + w / 2}
              y={subLabel ? y + h / 2 - 2 : y + h / 2 + 4}
              textAnchor="middle"
              style={{ fontSize: 12.5, fontWeight: 700, fill: nameColor, pointerEvents: "none" }}
            >
              {room.name}
            </text>
            {subLabel && (
              <text
                x={x + w / 2}
                y={y + h / 2 + 14}
                textAnchor="middle"
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  fill: room.reservable ? "var(--ink-soft)" : "var(--ink-faint)",
                  pointerEvents: "none",
                }}
              >
                {subLabel}
              </text>
            )}
          </>
        );

        if (!room.reservable) {
          return (
            <g key={room.id} role="img" aria-label={`${room.name}, 신청 대상 아님`}>
              <title>{`${room.name} — 신청 대상이 아닙니다`}</title>
              {body}
            </g>
          );
        }

        return (
          <g
            key={room.id}
            className="facility-map-target"
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${room.name} 선택${capacity ? `, ${capacity}` : ""}`}
            onClick={() => onSelect(room)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(room);
              }
            }}
            style={selected ? { transform: "translateY(-3px)" } : undefined}
          >
            <title>{`${room.name}${capacity ? ` — ${capacity}` : ""}`}</title>
            {body}
          </g>
        );
      })}
    </svg>
  );
}
