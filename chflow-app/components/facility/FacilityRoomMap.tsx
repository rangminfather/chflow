"use client";

/* ============================================================
   3단계 — 공간 선택 (간이 평면도 + 번호 목록)

   실제 건축 평면도가 아니라 공간의 상대적 위치만 알아보기 위한 배치다.
   비전센터는 격자가 8칸까지 넓어지는데, 좁은 화면에서는 칸 하나가 30~40px
   밖에 안 돼 공간 이름이 읽히지 않는다. 그래서 평면도에는 번호와
   (자리가 되는 칸에만) 이름을 넣고, 바로 아래에 번호를 붙인 목록을 둔다.
   둘 중 어느 쪽을 눌러도 같은 공간이 선택된다.

   실제 도면이 준비되면 이 파일의 사각형 그리기만 교체하면 되고,
   room.id(=DB facility_id) 와 선택 흐름은 그대로 유지된다.
   ============================================================ */

import type { FacilityFloor, FacilityRoom, FacilityRoomKind } from "@/lib/facility/facility-map-config";
import { formatCapacity } from "@/lib/facility/facility-map-config";

type Props = {
  floor: FacilityFloor;
  buildingName: string;
  selectedRoomId: string | null;
  onSelect: (room: FacilityRoom) => void;
};

/** 격자 한 칸의 viewBox 크기 — 실제 면적비가 아니라 배치 관계만 나타낸다 */
const CELL_W = 60;
const CELL_H = 48;
const GAP = 4;
const PAD = 8;

/** 신청 대상이 아닌 공간의 색 — 종류별로 조금씩 달리해 평면도가 읽히게 한다 */
const KIND_TINT: Record<FacilityRoomKind, number> = {
  room: 7,
  hall: 7,
  office: 9,
  corridor: 4,
  storage: 11,
  service: 6,
  outdoor: 5,
};

export default function FacilityRoomMap({ floor, buildingName, selectedRoomId, onSelect }: Props) {
  const width = floor.planCols * CELL_W + PAD * 2;
  const height = floor.planRows * CELL_H + PAD * 2;

  // 평면도와 목록이 같은 번호를 쓰도록 여기서 한 번만 매긴다
  const numbers = new Map<string, number>();
  floor.rooms.filter((r) => r.reservable).forEach((room, i) => numbers.set(room.id, i + 1));

  const reservable = floor.rooms.filter((r) => r.reservable);
  const others = floor.rooms.filter((r) => !r.reservable);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${buildingName} ${floor.label} 평면도`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* 바닥판 — 평면도 한 장처럼 보이게 하는 테두리 */}
        <rect
          x={2}
          y={2}
          width={width - 4}
          height={height - 4}
          rx={10}
          fill="color-mix(in srgb, var(--bg-soft) 45%, var(--card))"
          stroke="var(--hairline)"
          strokeWidth={1.2}
        />

        {floor.rooms.map((room) => {
          const x = PAD + room.plan.x * CELL_W;
          const y = PAD + room.plan.y * CELL_H;
          const w = room.plan.w * CELL_W - GAP;
          const h = room.plan.h * CELL_H - GAP;
          const selected = room.id === selectedRoomId;
          const number = numbers.get(room.id);
          const capacity = formatCapacity(room);

          const fill = room.reservable
            ? selected
              ? "color-mix(in srgb, var(--accent) 26%, var(--card))"
              : "color-mix(in srgb, var(--accent) 9%, var(--card))"
            : `color-mix(in srgb, var(--ink) ${KIND_TINT[room.kind]}%, var(--card))`;
          const stroke = room.reservable
            ? selected
              ? "var(--accent-strong)"
              : "var(--accent-line)"
            : "var(--hairline)";

          // 한 줄 높이 칸은 번호를 왼쪽에 세로 가운데로 두고 이름을 그 옆에 쓴다.
          // 번호를 왼쪽 위에 두면 짧은 칸에서는 이름과 겹친다.
          const short = h < 60;
          const badge = number === undefined
            ? null
            : { cx: x + 15, cy: short ? y + h / 2 : y + 15 };
          const textLeft = badge && short ? x + 28 : x;
          const textWidth = badge && short ? w - 30 : w;
          const label = fitLabel(room.name, textWidth, room.reservable);
          const labelBase = short ? y + h / 2 : y + h / 2 + (badge ? 9 : 4);

          const body = (
            <>
              <rect
                className="facility-map-face"
                x={x}
                y={y}
                width={w}
                height={h}
                rx={7}
                fill={fill}
                stroke={stroke}
                strokeWidth={selected ? 2.2 : 1.2}
                strokeDasharray={room.reservable ? undefined : "5 4"}
              />
              <rect className="facility-map-outline" x={x} y={y} width={w} height={h} rx={7} fill="none" stroke="none" />

              {/* 번호 — 아래 목록과 짝을 맞춘다 */}
              {badge && (
                <>
                  <circle cx={badge.cx} cy={badge.cy} r={11} fill={selected ? "var(--accent)" : "var(--accent-strong)"} />
                  <text
                    x={badge.cx}
                    y={badge.cy + 4.5}
                    textAnchor="middle"
                    style={{ fontSize: 13, fontWeight: 800, fill: "var(--card)", pointerEvents: "none" }}
                  >
                    {number}
                  </text>
                </>
              )}

              {/* 이름 — 칸이 좁으면 생략하고 아래 목록에 맡긴다 */}
              {label && (
                <text
                  textAnchor="middle"
                  style={{
                    fontSize: label.size,
                    fontWeight: room.reservable ? 700 : 500,
                    fill: room.reservable ? "var(--ink)" : "var(--ink-soft)",
                    pointerEvents: "none",
                  }}
                >
                  {label.lines.map((line, i) => (
                    <tspan
                      key={line + i}
                      x={textLeft + textWidth / 2}
                      y={labelBase + 4 + (i - (label.lines.length - 1) / 2) * (label.size + 2)}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              )}
            </>
          );

          if (!room.reservable) {
            return (
              <g key={room.id}>
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
              aria-label={`${number}번 ${room.name} 선택${capacity ? `, ${capacity}` : ""}`}
              onClick={() => onSelect(room)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(room);
                }
              }}
            >
              <title>{`${room.name}${capacity ? ` — ${capacity}` : ""}`}</title>
              {body}
            </g>
          );
        })}
      </svg>

      {/* 번호 목록 — 좁은 화면에서 평면도 글자가 작아도 여기서 고를 수 있다 */}
      {reservable.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {reservable.map((room) => {
            const selected = room.id === selectedRoomId;
            return (
              <button
                key={room.id}
                type="button"
                className="facility-room-chip"
                aria-pressed={selected}
                onClick={() => onSelect(room)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  minHeight: 40,
                  padding: "6px 12px 6px 7px",
                  borderRadius: 999,
                  border: `1.5px solid ${selected ? "var(--accent)" : "var(--hairline)"}`,
                  background: selected ? "color-mix(in srgb, var(--accent) 14%, var(--card))" : "var(--card)",
                  color: selected ? "var(--accent-strong)" : "var(--ink)",
                  fontSize: 13,
                  fontWeight: selected ? 800 : 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: selected ? "var(--accent)" : "var(--accent-strong)",
                    color: "var(--card)",
                    fontSize: 11.5,
                    fontWeight: 800,
                  }}
                >
                  {numbers.get(room.id)}
                </span>
                {room.name}
              </button>
            );
          })}
        </div>
      )}

      {others.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 11.5, lineHeight: 1.6, color: "var(--ink-faint)", fontWeight: 500 }}>
          신청 대상이 아닌 공간: {others.map((r) => r.name).join(" · ")}
        </p>
      )}
    </div>
  );
}

/**
 * 칸 폭에 맞는 글자 크기와 줄바꿈을 고른다.
 * 한글 한 자의 폭을 글자 크기와 같게 보고 계산한다(대략치).
 * 어떤 크기로도 두 줄에 안 들어가면 null — 평면도에서는 이름을 생략하고
 * 아래 번호 목록에 맡긴다.
 */
function fitLabel(name: string, cellWidth: number, reservable: boolean): { lines: string[]; size: number } | null {
  const usable = cellWidth - 10;
  const sizes = reservable ? [15, 13, 11.5, 10] : [12.5, 11, 10];

  for (const size of sizes) {
    const perLine = Math.floor(usable / size);
    if (perLine < 2) continue;
    if (name.length <= perLine) return { lines: [name], size };

    const lines = splitTwo(name);
    if (lines.every((line) => line.length <= perLine)) return { lines, size };
  }
  return null;
}

/** 두 줄로 끊기 — 띄어쓰기가 있으면 거기서, 없으면 한가운데서 */
function splitTwo(name: string): string[] {
  const space = name.indexOf(" ");
  if (space > 0) return [name.slice(0, space), name.slice(space + 1)];
  const half = Math.ceil(name.length / 2);
  return [name.slice(0, half), name.slice(half)];
}
