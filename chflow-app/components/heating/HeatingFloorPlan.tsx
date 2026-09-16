"use client";

import type { KeyboardEvent } from "react";
import type { FacilityFloor } from "@/lib/facility/facility-map-config";
import { floorKeyOf, floorOutline, roomPoly, bboxOf, polyPoints } from "@/lib/facility/facility-plan-geometry";

// 격자 폴백 좌표(시설물신청 FacilityRoomMap 과 동일). 폴리곤 지오메트리가 있으면
// 실제 도면 형상으로 자동 전환된다.
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
  const outline = floorOutline(floorKeyOf(floor.rooms));
  const useMm = !!outline;

  let vbX = 0;
  let vbY = 0;
  let vbW = floor.planCols * CELL_W + PAD * 2;
  let vbH = floor.planRows * CELL_H + PAD * 2;
  if (useMm && outline) {
    const all = [...outline];
    for (const r of floor.rooms) {
      const rp = roomPoly(r.id);
      if (rp) all.push(...rp);
    }
    const b = bboxOf(all);
    const m = 18;
    vbX = b.minX - m;
    vbY = b.minY - m;
    vbW = b.maxX - b.minX + m * 2;
    vbH = b.maxY - b.minY + m * 2;
  }

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      style={{ width: "100%", height: "auto", display: "block", touchAction: "manipulation" }}
      role="img"
      aria-label={`${floor.label} 난방 배치도`}
    >
      {useMm && outline && (
        <polygon points={polyPoints(outline)} fill="color-mix(in srgb, var(--bg-soft) 45%, var(--card))" stroke="var(--ink)" strokeWidth={vbW / 340} strokeLinejoin="round" />
      )}
      {floor.rooms.map((room) => {
        const dv = deviceByRoom[room.id];
        const hasDevice = !!dv;
        const selected = selectedId === room.id;
        const rp = useMm ? roomPoly(room.id) : null;

        let x: number;
        let y: number;
        let w: number;
        let h: number;
        if (rp) {
          const b = bboxOf(rp);
          x = b.minX;
          y = b.minY;
          w = b.maxX - b.minX;
          h = b.maxY - b.minY;
        } else {
          x = PAD + room.plan.x * CELL_W;
          y = PAD + room.plan.y * CELL_H;
          w = room.plan.w * CELL_W - GAP;
          h = room.plan.h * CELL_H - GAP;
        }
        const cx = x + w / 2;
        const cy = y + h / 2;

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
            {rp ? (
              <polygon points={polyPoints(rp)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
            ) : (
              <rect x={x} y={y} width={w} height={h} rx={hasDevice ? 4 : 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
            )}
            <text x={cx} y={cy + (hasDevice ? -2 : 3)} textAnchor="middle" fontSize={fontSize} fill="var(--ink-mid)" style={{ pointerEvents: "none" }}>
              {room.name}
            </text>
            {hasDevice && <circle cx={x + w - (useMm ? 10 : 9)} cy={y + (useMm ? 10 : 9)} r={useMm ? vbW / 120 : 4} fill={dot} stroke="var(--card)" strokeWidth={1.2} style={{ pointerEvents: "none" }} />}
          </g>
        );
      })}
    </svg>
  );
}
