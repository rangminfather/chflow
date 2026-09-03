"use client";

/* ============================================================
   시설 예약현황 검색 — 두 갈래

     1) 날짜중심 : 달력에서 날짜를 고르면 그 날 전체 시설의 24시간 현황
     2) 시설물중심 : 시설을 여러 곳 고르면 그 달의 날짜별 현황

   둘 다 달 단위로 넘겨본다(◀ ▶). 목록에 올리는 줄은 "대표 공간"뿐이고
   부속(화장실·샤워실 등)은 대표에 딸려 감춘다 — facility-groups.ts.

   신청 자체는 기존 흐름(지도 → 건물 → 층 → 공간)이 그대로 맡는다.
   여기서 빈 칸을 확인한 뒤 "이 시설 신청하기"로 넘어가는 식이다.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { FacilityBuilding } from "@/lib/facility/facility-map-config";
import { listPrimaryRooms, type ParentMap } from "@/lib/facility/facility-groups";
import {
  type MonthCursor,
  type RangeBooking,
  byFacility,
  monthGrid,
  monthLabel,
  monthRange,
  shiftMonth,
  toDateKey,
} from "@/lib/facility/facility-schedule";
import FacilityBookingGrid, { type GridRow } from "./FacilityBookingGrid";

export type SearchMode = "date" | "facility";

type Props = {
  buildings: FacilityBuilding[];
  parents?: ParentMap;
  /** 현황에서 고른 시설로 신청 흐름을 열어 준다 */
  onPickFacility: (facilityId: string) => void;
};

export default function FacilityScheduleSearch({ buildings, parents, onPickFacility }: Props) {
  const [mode, setMode] = useState<SearchMode | null>(null);
  const [cursor, setCursor] = useState<MonthCursor>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [pickedDate, setPickedDate] = useState<string>(() => toDateKey(new Date()));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bookings, setBookings] = useState<RangeBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 표에 올릴 대표 공간들
  const primaries = useMemo(() => listPrimaryRooms(buildings, parents), [buildings, parents]);

  const load = useCallback(async (target: MonthCursor, ids: string[]) => {
    const { from, to } = monthRange(target);
    const { data, error: rpcError } = await supabase.rpc("get_facility_range_bookings", {
      p_from: from,
      p_to: to,
      p_facility_ids: ids.length > 0 ? ids : null,
    });
    setLoading(false);
    setError("");
    if (rpcError) {
      setError(`예약 현황을 불러오지 못했습니다: ${rpcError.message}`);
      setBookings([]);
      return;
    }
    setBookings((data as RangeBooking[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (mode === null) return;
    void load(cursor, mode === "facility" ? selectedIds : []);
  }, [mode, cursor, selectedIds, load]);

  if (mode === null) {
    return (
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <EntryCard
          icon={<CalendarDays size={20} strokeWidth={1.8} />}
          title="날짜중심검색"
          desc="원하는 날짜에 시설물 예약상태 조회"
          onClick={() => { setLoading(true); setMode("date"); }}
        />
        <EntryCard
          icon={<LayoutGrid size={20} strokeWidth={1.8} />}
          title="시설물중심검색"
          desc="이용하려는 시설물의 예약상태 조회"
          onClick={() => { setLoading(true); setMode("facility"); }}
        />
      </div>
    );
  }

  const dayBookings = bookings.filter((b) => b.date.slice(0, 10) === pickedDate);
  const dayRows: GridRow[] = primaries.map(({ building, floor, group }) => ({
    facilityId: group.primary.id,
    label: group.primary.name,
    sublabel: `${building.name} · ${floor.label}`,
    bookings: dayBookings.filter((b) => b.facility_id === group.primary.id),
  }));

  const perFacility = byFacility(bookings);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setMode(null)} style={backBtn}>
          <X size={14} strokeWidth={2} /> 검색 닫기
        </button>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <button type="button" onClick={() => { setLoading(true); setMode("date"); }} style={tabBtn(mode === "date")}>날짜중심</button>
          <button type="button" onClick={() => { setLoading(true); setMode("facility"); }} style={tabBtn(mode === "facility")}>시설물중심</button>
        </div>
      </div>

      {/* 달 이동 */}
      <div style={monthBar}>
        <button type="button" onClick={() => { setLoading(true); setCursor((c) => shiftMonth(c, -1)); }} aria-label="이전 달" style={monthNav}>
          <ChevronLeft size={17} strokeWidth={2.2} />
        </button>
        <strong style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{monthLabel(cursor)}</strong>
        <button type="button" onClick={() => { setLoading(true); setCursor((c) => shiftMonth(c, 1)); }} aria-label="다음 달" style={monthNav}>
          <ChevronRight size={17} strokeWidth={2.2} />
        </button>
        {loading && <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 600 }}>불러오는 중...</span>}
      </div>

      {error && (
        <p style={{ margin: "0 0 10px", fontSize: 12.5, fontWeight: 700, color: "var(--danger)" }}>{error}</p>
      )}

      {mode === "date" ? (
        <>
          <MonthCalendar
            cursor={cursor}
            picked={pickedDate}
            countOf={(key) => bookings.filter((b) => b.date.slice(0, 10) === key).length}
            onPick={setPickedDate}
          />
          <div style={{ marginTop: 14 }}>
            <FacilityBookingGrid
              rows={dayRows}
              caption={`${pickedDate} — 교회 전체 시설 예약 현황입니다. 칸을 누르면 누가 무슨 목적으로 쓰는지 볼 수 있습니다.`}
              emptyText="표시할 시설이 없습니다."
            />
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: "0 0 8px", fontSize: 12.5, fontWeight: 700, color: "var(--ink-mid)" }}>
            이용하고자 하는 시설물을 선택해주세요 (복수 선택 가능)
          </p>
          <div style={chipWrap}>
            {primaries.map(({ building, floor, group }) => {
              const id = group.primary.id;
              const on = selectedIds.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setLoading(true); setSelectedIds((prev) => (on ? prev.filter((x) => x !== id) : [...prev, id])); }}
                  aria-pressed={on}
                  style={chip(on)}
                >
                  {group.primary.name}
                  <span style={{ fontSize: 10, opacity: 0.75, marginLeft: 4 }}>{building.name} {floor.label}</span>
                </button>
              );
            })}
          </div>

          {selectedIds.length === 0 ? (
            <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--ink-soft)", fontWeight: 600 }}>
              시설을 하나 이상 고르면 그 달의 예약 현황이 바로 나옵니다.
            </p>
          ) : (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
              {selectedIds.map((id) => {
                const found = primaries.find((p) => p.group.primary.id === id);
                if (!found) return null;
                const mine = perFacility.get(id) ?? [];
                const grid = monthGrid(cursor);
                return (
                  <section key={id} style={facilityBlock}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 14, color: "var(--ink)" }}>{found.group.primary.name}</strong>
                      <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 600 }}>
                        {found.building.name} · {found.floor.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => onPickFacility(id)}
                        style={{ ...backBtn, marginLeft: "auto" }}
                      >이 시설 신청하기</button>
                    </div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                      {grid.filter((key): key is string => key !== null).map((key) => {
                        const day = mine.filter((b) => b.date.slice(0, 10) === key);
                        if (day.length === 0) return null;
                        return (
                          <li key={key} style={dayLine}>
                            <span style={{ fontWeight: 800, fontSize: 12.5, color: "var(--ink)", minWidth: 78 }}>
                              {key.slice(5).replace("-", "/")} ({"일월화수목금토"[new Date(key).getDay()]})
                            </span>
                            <span style={{ fontSize: 12, color: "var(--ink-mid)", fontWeight: 600 }}>
                              {day.map((b) => `${b.time_start.slice(0, 5)}~${b.time_end.slice(0, 5)} ${b.requester_name}${b.purpose ? ` (${b.purpose})` : ""}${b.contact ? ` · ${b.contact}` : ""}`).join(" / ")}
                            </span>
                          </li>
                        );
                      })}
                      {mine.length === 0 && (
                        <li style={{ fontSize: 12.5, color: "var(--success)", fontWeight: 700 }}>
                          이 달에는 예약이 없습니다 — 아무 날이나 신청할 수 있습니다.
                        </li>
                      )}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EntryCard({ icon, title, desc, onClick }: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 16,
        minHeight: 76,
        borderRadius: 14,
        border: "1.5px solid var(--hairline)",
        background: "var(--card)",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <span style={{
        width: 42, height: 42, borderRadius: 12, flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "color-mix(in srgb, var(--accent) 13%, transparent)",
        color: "var(--accent-strong)",
      }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>{title}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>{desc}</span>
      </span>
      <Search size={16} strokeWidth={2} style={{ marginLeft: "auto", flexShrink: 0, color: "var(--ink-faint)" }} />
    </button>
  );
}

function MonthCalendar({ cursor, picked, countOf, onPick }: {
  cursor: MonthCursor;
  picked: string;
  countOf: (key: string) => number;
  onPick: (key: string) => void;
}) {
  const cells = monthGrid(cursor);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {["일", "월", "화", "수", "목", "금", "토"].map((label) => (
          <div key={label} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 800, color: "var(--ink-faint)" }}>{label}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((key, index) => {
          if (key === null) return <div key={`pad-${index}`} />;
          const count = countOf(key);
          const on = key === picked;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-pressed={on}
              style={{
                minHeight: 46,
                borderRadius: 9,
                border: `1.5px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
                background: on ? "color-mix(in srgb, var(--accent) 14%, var(--card))" : "var(--card)",
                color: on ? "var(--accent-strong)" : "var(--ink)",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: on ? 800 : 600,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                padding: 2,
              }}
            >
              {Number(key.slice(8))}
              {count > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 999,
                  background: "color-mix(in srgb, var(--danger) 16%, transparent)", color: "var(--danger)",
                }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const backBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minHeight: 32,
  padding: "6px 12px",
  borderRadius: 9,
  border: "1px solid var(--hairline-strong)",
  background: "var(--card)",
  color: "var(--ink-mid)",
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    minHeight: 32,
    padding: "6px 14px",
    borderRadius: 9,
    border: `1.5px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
    background: active ? "color-mix(in srgb, var(--accent) 12%, var(--card))" : "var(--card)",
    color: active ? "var(--accent-strong)" : "var(--ink-soft)",
    fontSize: 12,
    fontWeight: 800,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}

const monthBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 12,
};
const monthNav: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  borderRadius: 9,
  border: "1px solid var(--hairline)",
  background: "var(--card)",
  color: "var(--ink-mid)",
  cursor: "pointer",
};
const chipWrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};
function chip(on: boolean): React.CSSProperties {
  return {
    minHeight: 34,
    padding: "6px 12px",
    borderRadius: 999,
    border: `1.5px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
    background: on ? "color-mix(in srgb, var(--accent) 14%, var(--card))" : "var(--card)",
    color: on ? "var(--accent-strong)" : "var(--ink-soft)",
    fontSize: 12,
    fontWeight: on ? 800 : 600,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}
const facilityBlock: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "var(--card)",
  border: "1px solid var(--hairline)",
};
const dayLine: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "baseline",
  flexWrap: "wrap",
  padding: "6px 8px",
  borderRadius: 8,
  background: "var(--bg-soft)",
};
