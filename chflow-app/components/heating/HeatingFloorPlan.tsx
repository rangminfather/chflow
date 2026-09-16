"use client";

import type { KeyboardEvent } from "react";
import type { FacilityFloor, FacilityRoom } from "@/lib/facility/facility-map-config";

// 격자 폴백 좌표(시설물신청 FacilityRoomMap 과 동일). 폴리곤(poly/outline)이 config 에
// 들어오면 실제 도면 형상으로 자동 전환된다.
const CELL_W = 60;
const CELL_H = 48;
const GAP = 4;
const PAD = 8;

export interface RoomDeviceView {
  planned?: boolean;
  online?: boolean;
  powerOn?: boolean;
  run?: boolean;
}

type Pt = { x: number; y: number };
type RoomWithPoly = FacilityRoom & { poly?: Pt[] };
type FloorWithOutline = FacilityFloor & { outline?: { points: Pt[] } };

interface Props {
  floor: FacilityFloor;
  deviceByRoom: Record<string, RoomDeviceView>; // key = room.id (= device.facilityId)
  selectedId: string | null;
  onSelect: (roomId: string) => void;
}

function stateColor(dv: RoomDeviceView): { fill: string; stroke: string; dot: string } {
  if (dv.planned) return { fill: "color-mix(in srgb, var(--brass) 16%, var(--card))", stroke: "var(--brass)", dot: "var(--brass)" };
  if (!dv.online) return { fill: "color-mix(in srgb, var(--danger) 12%, var(--card))", stroke: "var(--danger)", dot: "var(--danger)" };
  if (dv.run) return { fill: "color-mix(in srgb, var(--warning) 26%, var(--card))", stroke: "var(--warning)", dot: "var(--warning)" };
  if (dv.powerOn) return { fill: "color-mix(in srgb, var(--success) 26%, var(--card))", stroke: "var(--success)", dot: "var(--success)" };
  return { fill: "color-mix(in srgb, var(--ink) 8%, var(--card))", stroke: "var(--ink-faint)", dot: "var(--ink-faint)" };
}

export default function HeatingFloorPlan({ floor, deviceByRoom, selectedId, onSelect }: Props) {
  const outline = (floor as FloorWithOutline).outline?.points;
  const useMm = !!outline && outline.length > 2;

  let vbW: number;
  let vbH: number;
  if (useMm && outline) {
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    vbW = Math.max(...xs) + Math.min(...xs);
    vbH = Math.max(...ys) + Math.min(...ys);
  } else {
    vbW = floor.planCols * CELL_W + PAD * 2;
    vbH = floor.planRows * CELL_H + PAD * 2;
  }

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      style={{ width: "100%", height: "auto", display: "block", touchAction: "manipulation" }}
      role="img"
      aria-label={`${floor.label} 난방 배치도`}
    >
      {useMm && outline && (
        <polygon points={outline.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth={vbW / 340} strokeLinejoin="round" />
      )}
      {floor.rooms.map((room) => {
        const dv = deviceByRoom[room.id];
        const hasDevice = !!dv;
        const selected = selectedId === room.id;
        const poly = (room as RoomWithPoly).poly;

        const x = PAD + room.plan.x * CELL_W;
        const y = PAD + room.plan.y * CELL_H;
        const w = room.plan.w * CELL_W - GAP;
        const h = room.plan.h * CELL_H - GAP;

        let fill = "color-mix(in srgb, var(--ink) 5%, var(--card))";
        let stroke = "var(--hairline)";
        let dot = "";
        if (hasDevice) {
          const c = stateColor(dv);
          fill = c.fill;
          stroke = c.stroke;
          dot = c.dot;
        }
        let strokeWidth = selected ? 3 : hasDevice ? 2 : 1.2;
        if (selected) stroke = "var(--accent-strong)";
        if (useMm) strokeWidth *= vbW / 760;

        // label + device-dot anchor
        let cx: number;
        let cy: number;
        let dotX: number;
        let dotY: number;
        if (poly && useMm) {
          const xs = poly.map((p) => p.x);
          const ys = poly.map((p) => p.y);
          cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          dotX = Math.max(...xs) - 14;
          dotY = Math.min(...ys) + 14;
        } else {
          cx = x + w / 2;
          cy = y + h / 2;
          dotX = x + w - 9;
          dotY = y + 9;
        }

        const clickable = hasDevice;
        const fontSize = useMm ? vbW / 55 : h < 44 ? 9 : 11;

        return (
          <g
            key={room.id}
            {...(clickable
              ? {
                  role: "button",
                  tabIndex: 0,
                  onClick: () => onSelect(room.id),
                  onKeyDown: (e: KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(room.id);
                    }
                  },
                }
              : {})}
            style={{ cursor: clickable ? "pointer" : "default" }}
          >
            {poly && useMm ? (
              <polygon points={poly.map((p) => `${p.x},${p.y}`).join(" ")} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
            ) : (
              <rect x={x} y={y} width={w} height={h} rx={hasDevice ? 4 : 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
            )}
            <text x={cx} y={cy + (hasDevice ? -2 : 3)} textAnchor="middle" fontSize={fontSize} fill="var(--ink-mid)" style={{ pointerEvents: "none" }}>
              {room.name}
            </text>
            {hasDevice && <circle cx={dotX} cy={dotY} r={useMm ? vbW / 120 : 4} fill={dot} stroke="var(--card)" strokeWidth={1.2} style={{ pointerEvents: "none" }} />}
          </g>
        );
      })}
    </svg>
  );
}
