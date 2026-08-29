"use client";

/* ============================================================
   4단계 — 선택 정보 요약 + 신청 진입

   건물도 바로 아래에 "무엇을 고른 상태인지"를 한 번 더 문장으로 보여준다.
   ============================================================ */

import { MapPin, Users } from "lucide-react";
import type { FacilityRoom } from "@/lib/facility/facility-map-config";
import { formatCapacity, formatRoomPath } from "@/lib/facility/facility-map-config";

type Props = {
  room: FacilityRoom;
  actionLabel: string;
  onAction: () => void;
};

export default function FacilitySelectionCard({ room, actionLabel, onAction }: Props) {
  const capacity = formatCapacity(room);

  return (
    <div
      style={{
        marginTop: 14,
        padding: 16,
        borderRadius: 14,
        background: "color-mix(in srgb, var(--accent) 7%, var(--card))",
        border: "1px solid var(--accent-line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
        <MapPin size={15} strokeWidth={1.8} style={{ flexShrink: 0, color: "var(--accent)" }} />
        {formatRoomPath(room)}
      </div>

      {capacity && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13, fontWeight: 600, color: "var(--ink-mid)" }}>
          <Users size={13} strokeWidth={1.8} style={{ flexShrink: 0 }} />
          {capacity}
        </div>
      )}

      {room.facilities.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {room.facilities.map((item) => (
            <span
              key={item}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--ink-mid)",
                background: "var(--bg-soft)",
                border: "1px solid var(--hairline)",
              }}
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {room.note && (
        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 500, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {room.note}
        </div>
      )}

      <button
        type="button"
        onClick={onAction}
        style={{
          width: "100%",
          marginTop: 14,
          minHeight: 48,
          padding: "12px 16px",
          fontSize: 15,
          fontWeight: 800,
          color: "var(--card)",
          background: "var(--accent)",
          border: "none",
          borderRadius: 12,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}
