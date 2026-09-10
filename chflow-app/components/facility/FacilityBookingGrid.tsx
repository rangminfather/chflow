"use client";

/* ============================================================
   예약 현황 표 — 시설 × 시간대

   PC 는 24칸을 그대로 펼치고, 모바일은 오전(0~11)/오후(12~23) 탭으로 나눠
   2시간씩 6칸만 보여준다. 어느 쪽이든 칸을 누르면 그 시간대에 걸린 예약
   상세(누가·무슨 목적·언제까지·연락처)를 아래에 편다.

   여기서 그리는 줄은 "대표 공간"뿐이다. 부속(화장실·샤워실 등)은
   대표를 빌리면 따라오므로 표에 올리지 않는다 — facility-groups.ts 참고.
   ============================================================ */

import { useState } from "react";
import { ChevronUp, Users } from "lucide-react";
import {
  type HalfDay,
  type RangeBooking,
  blocksOf,
  bookingsAt,
  formatRange,
} from "@/lib/facility/facility-schedule";

export type GridRow = {
  facilityId: string;
  label: string;
  sublabel: string;
  bookings: RangeBooking[];
};

type Props = {
  rows: GridRow[];
  /** 표 위에 붙일 안내 (없으면 생략) */
  caption?: string;
  emptyText?: string;
};

export default function FacilityBookingGrid({ rows, caption, emptyText }: Props) {
  const [half, setHalf] = useState<HalfDay>("pm");
  const [open, setOpen] = useState<{ facilityId: string; from: number; to: number } | null>(null);

  if (rows.length === 0) {
    return (
      <p style={{ margin: 0, padding: "18px 4px", fontSize: 13, color: "var(--ink-soft)", fontWeight: 600 }}>
        {emptyText ?? "표시할 시설이 없습니다."}
      </p>
    );
  }

  const mobileBlocks = blocksOf(half);
  const openRow = open ? rows.find((r) => r.facilityId === open.facilityId) : null;
  const openBookings = open && openRow ? bookingsAt(openRow.bookings, open.from, open.to) : [];

  return (
    <div>
      {caption && (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-soft)", fontWeight: 600, lineHeight: 1.5 }}>
          {caption}
        </p>
      )}

      {/* 모바일 전용 — 오전/오후 전환 */}
      <div className="facility-grid-half" style={{ display: "none", gap: 6, marginBottom: 10 }}>
        {([["am", "오전 0~12시"], ["pm", "오후 12~24시"]] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => { setHalf(value); setOpen(null); }}
            aria-pressed={half === value}
            style={{
              flex: 1,
              minHeight: 38,
              borderRadius: 10,
              border: `1.5px solid ${half === value ? "var(--accent)" : "var(--hairline)"}`,
              background: half === value ? "color-mix(in srgb, var(--accent) 12%, var(--card))" : "var(--card)",
              color: half === value ? "var(--accent-strong)" : "var(--ink-soft)",
              fontSize: 12.5,
              fontWeight: 800,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >{label}</button>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        {/* PC — 24칸 */}
        <table className="facility-grid-wide" style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...headCell, textAlign: "left", minWidth: 140, position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 }}>시설물</th>
              {Array.from({ length: 24 }, (_, hour) => (
                <th key={hour} style={{ ...headCell, minWidth: 26 }}>{hour}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.facilityId}>
                <th scope="row" style={{ ...rowHead, position: "sticky", left: 0, background: "var(--card)", zIndex: 1 }}>
                  <span style={{ fontWeight: 800, fontSize: 12.5, color: "var(--ink)" }}>{row.label}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-faint)", fontWeight: 600 }}>{row.sublabel}</span>
                </th>
                {Array.from({ length: 24 }, (_, hour) => {
                  const hit = bookingsAt(row.bookings, hour, hour + 1);
                  const active = open?.facilityId === row.facilityId && open.from === hour;
                  return (
                    <td key={hour} style={cellWrap}>
                      <button
                        type="button"
                        onClick={() => setOpen(active ? null : { facilityId: row.facilityId, from: hour, to: hour + 1 })}
                        aria-label={`${row.label} ${hour}시 ${hit.length > 0 ? "예약 있음" : "비어 있음"}`}
                        style={slotStyle(hit, active)}
                      >{hit.length > 0 ? "●" : ""}</button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* 모바일 — 2시간 6칸 */}
        <table className="facility-grid-narrow" style={{ ...tableStyle, display: "none" }}>
          <thead>
            <tr>
              <th style={{ ...headCell, textAlign: "left", minWidth: 96 }}>시설물</th>
              {mobileBlocks.map((block) => (
                <th key={block.from} style={{ ...headCell, minWidth: 34 }}>{block.from}~{block.to}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.facilityId}>
                <th scope="row" style={rowHead}>
                  <span style={{ fontWeight: 800, fontSize: 12, color: "var(--ink)" }}>{row.label}</span>
                  <span style={{ display: "block", fontSize: 10, color: "var(--ink-faint)", fontWeight: 600 }}>{row.sublabel}</span>
                </th>
                {mobileBlocks.map((block) => {
                  const hit = bookingsAt(row.bookings, block.from, block.to);
                  const active = open?.facilityId === row.facilityId && open.from === block.from;
                  return (
                    <td key={block.from} style={cellWrap}>
                      <button
                        type="button"
                        onClick={() => setOpen(active ? null : { facilityId: row.facilityId, from: block.from, to: block.to })}
                        aria-label={`${row.label} ${block.from}시부터 ${block.to}시 ${hit.length > 0 ? "예약 있음" : "비어 있음"}`}
                        style={slotStyle(hit, active)}
                      >{hit.length > 0 ? "●" : ""}</button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div style={detailBox}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <strong style={{ fontSize: 13, color: "var(--ink)" }}>
              {openRow?.label} · {open.from}시~{open.to}시
            </strong>
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="닫기"
              style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--ink-faint)", cursor: "pointer", display: "inline-flex" }}
            >
              <ChevronUp size={16} strokeWidth={2} />
            </button>
          </div>
          {openBookings.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--success)", fontWeight: 700 }}>비어 있습니다 — 신청할 수 있습니다.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {openBookings.map((b) => (
                <li key={b.id} style={detailRow}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 12.5, color: "var(--ink)" }}>{formatRange(b)}</span>
                    <span style={statusChip(b.status)}>{b.status === "approved" ? "승인" : "대기"}</span>
                    {b.is_mine && <span style={{ ...statusChip("mine") }}>내 신청</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-mid)", fontWeight: 600, marginTop: 3 }}>
                    {b.requester_name}
                    {b.headcount ? ` · ${b.headcount}명` : ""}
                    {b.contact ? ` · ${b.contact}` : ""}
                  </div>
                  {b.purpose && (
                    <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{b.purpose}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, fontSize: 11, color: "var(--ink-faint)", fontWeight: 600, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ ...legendDot, background: "color-mix(in srgb, var(--danger) 55%, transparent)" }} /> 예약됨
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ ...legendDot, background: "var(--card)", border: "1px solid var(--hairline-strong)" }} /> 비어 있음
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Users size={12} strokeWidth={2} /> 칸을 누르면 예약자·목적이 보입니다
        </span>
      </div>
    </div>
  );
}

function slotStyle(hit: RangeBooking[], active: boolean): React.CSSProperties {
  const booked = hit.length > 0;
  const mine = hit.some((b) => b.is_mine);
  return {
    width: "100%",
    minWidth: 22,
    height: 26,
    padding: 0,
    borderRadius: 5,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 9,
    lineHeight: 1,
    border: active ? "2px solid var(--accent-strong)" : "1px solid var(--hairline)",
    background: booked
      ? mine
        ? "color-mix(in srgb, var(--accent) 45%, transparent)"
        : "color-mix(in srgb, var(--danger) 55%, transparent)"
      : "var(--card)",
    color: "var(--card)",
  };
}

function statusChip(kind: string): React.CSSProperties {
  const color = kind === "approved" ? "var(--success)" : kind === "mine" ? "var(--accent-strong)" : "var(--warning)";
  return {
    padding: "2px 7px",
    borderRadius: 999,
    background: `color-mix(in srgb, ${color} 15%, transparent)`,
    color,
    fontSize: 10,
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}

const tableStyle: React.CSSProperties = {
  borderCollapse: "separate",
  borderSpacing: 2,
  width: "100%",
};
const headCell: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "var(--ink-faint)",
  padding: "2px 0",
  textAlign: "center",
  whiteSpace: "nowrap",
};
const rowHead: React.CSSProperties = {
  textAlign: "left",
  padding: "4px 8px 4px 2px",
  verticalAlign: "middle",
};
const cellWrap: React.CSSProperties = { padding: 0 };
const detailBox: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  background: "var(--card)",
  border: "1px solid var(--hairline)",
};
const detailRow: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 9,
  background: "var(--bg-soft)",
};
const legendDot: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 3,
  display: "inline-block",
};
