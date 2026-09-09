"use client";

/* ============================================================
   시설 예약현황 검색 — 두 갈래

     1) 날짜중심 : 달력에서 날짜를 고르면 그 날 전체 시설의 24시간 현황
     2) 시설물중심 : 건물 → 층 → 시설물 순으로 좁혀 고르면(복수 가능)
                    그 달 사용 날짜(달력) + 고른 날의 사용 시간(표)

   시설물중심은 예전에 전체 시설 40여 개를 한 줄로 늘어놓았다. 모바일에서
   답답해서 건물 → 층 → 시설물 3단으로 좁힌다. 고른 시설물은 건물·층을
   옮겨도 유지되므로 여러 건물에 걸쳐 비교할 수 있다.

   둘 다 달 단위로 넘겨본다(◀ ▶). 목록에 올리는 줄은 "대표 공간"뿐이고
   부속(화장실·샤워실 등)은 대표에 딸려 감춘다 — facility-groups.ts.

   신청 자체는 기존 흐름(지도 → 건물 → 층 → 공간)이 그대로 맡는다.
   여기서 빈 칸을 확인한 뒤 "이 시설 신청하기"로 넘어가는 식이다.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, LayoutGrid, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { FacilityBuilding, FacilityFloor } from "@/lib/facility/facility-map-config";
import { listPrimaryRooms, type ParentMap } from "@/lib/facility/facility-groups";
import {
  type MonthCursor,
  type RangeBooking,
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
  /** 페이지 진입 전 고른 검색 방식 — 있으면 안내 카드 없이 바로 이 모드로 연다 */
  initialMode?: SearchMode;
};

export default function FacilityScheduleSearch({ buildings, parents, onPickFacility, initialMode }: Props) {
  const [mode, setMode] = useState<SearchMode | null>(initialMode ?? null);
  const [cursor, setCursor] = useState<MonthCursor>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [pickedDate, setPickedDate] = useState<string>(() => toDateKey(new Date()));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 시설물중심에서 좁혀 보는 위치 — 건물을 바꾸면 층은 다시 고른다
  const [pickedBuilding, setPickedBuilding] = useState<string | null>(null);
  const [pickedFloor, setPickedFloor] = useState<number | null>(null);
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

  // 시설물중심 — 건물 → 층 → 시설물
  const buildingRows: { building: FacilityBuilding; count: number }[] = [];
  const buildingSeen = new Map<string, { building: FacilityBuilding; count: number }>();
  for (const { building } of primaries) {
    const row = buildingSeen.get(building.code);
    if (row) { row.count += 1; continue; }
    const created = { building, count: 1 };
    buildingSeen.set(building.code, created);
    buildingRows.push(created);
  }

  const floorRows: { floor: FacilityFloor; count: number }[] = [];
  const floorSeen = new Map<number, { floor: FacilityFloor; count: number }>();
  for (const { building, floor } of primaries) {
    if (building.code !== pickedBuilding) continue;
    const row = floorSeen.get(floor.floor);
    if (row) { row.count += 1; continue; }
    const created = { floor, count: 1 };
    floorSeen.set(floor.floor, created);
    floorRows.push(created);
  }

  const floorFacilities = primaries.filter(
    ({ building, floor }) => building.code === pickedBuilding && floor.floor === pickedFloor,
  );

  // 고른 시설물 — 고른 순서를 지킨다
  const selectedRows = selectedIds
    .map((id) => primaries.find((row) => row.group.primary.id === id))
    .filter((row): row is (typeof primaries)[number] => Boolean(row));

  // 달을 넘겼는데 고른 날이 그 달이 아니면 그 달 1일을 본다
  const monthPrefix = `${cursor.year}-${String(cursor.month).padStart(2, "0")}`;
  const facilityDate = pickedDate.startsWith(monthPrefix) ? pickedDate : `${monthPrefix}-01`;
  const facilityDayBookings = bookings.filter((b) => b.date.slice(0, 10) === facilityDate);
  const facilityRows: GridRow[] = selectedRows.map(({ building, floor, group }) => ({
    facilityId: group.primary.id,
    label: group.primary.name,
    sublabel: `${building.name} · ${floor.label}`,
    bookings: facilityDayBookings.filter((b) => b.facility_id === group.primary.id),
  }));

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
          {/* 건물 → 층 → 시설물. 40여 개를 한 줄로 늘어놓지 않기 위한 3단이다. */}
          <div style={pickerRow}>
            <span style={pickerLabel}>건물</span>
            <div style={chipWrap}>
              {buildingRows.map(({ building, count }) => {
                const on = building.code === pickedBuilding;
                return (
                  <button
                    key={building.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setPickedBuilding(on ? null : building.code);
                      setPickedFloor(null);
                    }}
                    style={chip(on)}
                  >
                    {building.name}
                    <span style={countTag}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {pickedBuilding && (
            <div style={pickerRow}>
              <span style={pickerLabel}>층</span>
              <div style={chipWrap}>
                {floorRows.map(({ floor, count }) => {
                  const on = floor.floor === pickedFloor;
                  return (
                    <button
                      key={floor.floor}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPickedFloor(on ? null : floor.floor)}
                      style={chip(on)}
                    >
                      {floor.label}
                      <span style={countTag}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {pickedBuilding && pickedFloor !== null && (
            <div style={pickerRow}>
              <span style={pickerLabel}>
                시설물 <span style={{ fontWeight: 600, color: "var(--ink-faint)" }}>복수 선택 가능</span>
              </span>
              <div style={chipWrap}>
                {floorFacilities.map(({ group }) => {
                  const id = group.primary.id;
                  const on = selectedIds.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setLoading(true);
                        setSelectedIds((prev) => (on ? prev.filter((x) => x !== id) : [...prev, id]));
                      }}
                      style={chip(on)}
                    >
                      {on && <Check size={12} strokeWidth={3} style={{ verticalAlign: -1, marginRight: 3 }} />}
                      {group.primary.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!pickedBuilding && <p style={hintText}>건물을 먼저 고르세요 — 건물 → 층 → 시설물 순으로 좁혀집니다.</p>}
          {pickedBuilding && pickedFloor === null && <p style={hintText}>층을 고르면 그 층의 시설물이 나옵니다.</p>}

          {/* 고른 시설물 — 건물·층을 옮겨도 남는다 */}
          {selectedRows.length > 0 && (
            <div style={selectedBox}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <strong style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink)" }}>
                  고른 시설물 {selectedRows.length}곳
                </strong>
                <button
                  type="button"
                  onClick={() => { setLoading(true); setSelectedIds([]); }}
                  style={{ ...backBtn, marginLeft: "auto" }}
                >
                  <X size={13} strokeWidth={2} /> 전체 해제
                </button>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {selectedRows.map(({ building, floor, group }) => (
                  <li key={group.primary.id} style={selectedLine}>
                    <strong style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>{group.primary.name}</strong>
                    <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 600 }}>
                      {building.name} · {floor.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => onPickFacility(group.primary.id)}
                      style={{ ...backBtn, marginLeft: "auto" }}
                    >이 시설 신청하기</button>
                    <button
                      type="button"
                      aria-label={`${group.primary.name} 선택 해제`}
                      onClick={() => {
                        setLoading(true);
                        setSelectedIds((prev) => prev.filter((x) => x !== group.primary.id));
                      }}
                      style={iconBtn}
                    >
                      <X size={14} strokeWidth={2.2} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 사용현황 — 윗층은 그 달 사용 날짜, 아래층은 고른 날의 사용 시간 */}
          {selectedRows.length === 0 ? (
            <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--ink-soft)", fontWeight: 600 }}>
              시설을 하나 이상 고르면 그 달의 사용현황이 바로 나옵니다.
            </p>
          ) : (
            <div style={{ marginTop: 14 }}>
              <MonthCalendar
                cursor={cursor}
                picked={facilityDate}
                countOf={(key) => bookings.filter((b) => b.date.slice(0, 10) === key).length}
                onPick={setPickedDate}
              />
              {bookings.length === 0 && (
                <p style={hintText}>이 달에는 예약이 없습니다 — 아무 날이나 신청할 수 있습니다.</p>
              )}
              <div style={{ marginTop: 14 }}>
                <FacilityBookingGrid
                  rows={facilityRows}
                  caption={`${facilityDate} — 고른 시설물의 사용 시간입니다. 칸을 누르면 누가 무슨 목적으로 쓰는지 볼 수 있습니다.`}
                  emptyText="고른 시설물이 없습니다."
                />
                {facilityDayBookings.length === 0 && (
                  <p style={hintText}>이날은 예약이 없습니다 — 아무 시간이나 신청할 수 있습니다.</p>
                )}
              </div>
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
const pickerRow: React.CSSProperties = {
  marginBottom: 12,
};
const pickerLabel: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 800,
  color: "var(--ink-mid)",
};
const countTag: React.CSSProperties = {
  marginLeft: 5,
  fontSize: 10,
  fontWeight: 700,
  opacity: 0.7,
};
const hintText: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: 11.5,
  lineHeight: 1.5,
  color: "var(--ink-faint)",
  fontWeight: 600,
};
const selectedBox: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  background: "var(--bg-soft)",
  border: "1px solid var(--hairline)",
};
const selectedLine: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
  padding: "6px 8px",
  borderRadius: 8,
  background: "var(--card)",
};
const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "1px solid var(--hairline)",
  background: "var(--card)",
  color: "var(--ink-faint)",
  cursor: "pointer",
  flexShrink: 0,
};
