"use client";

/* ============================================================
   시설 예약현황 검색 — 두 갈래

     1) 날짜중심 : 달력에서 날짜를 고르면 그 날 전체 시설의 24시간 현황
     2) 시설물중심 : 건물 → 층 → 시설물 3단 wizard. 신청 흐름과 같은 지도
                    (캠퍼스 안내도 → 건물 단면 → 평면도)를 그대로 쓴다.

   시설물중심 wizard
     · 단계마다 ‹ › 로 앞/뒷 단계를 오간다. 고른 건물·층·시설물은 그대로
       남으므로 오며가며 여러 건물에 걸쳐 복수 선택할 수 있다.
     · 고른 시설물마다 그 달 예약현황을 1~10 / 11~20 / 21~31 세 칸으로
       보여준다. 칸에 예약이 있으면 건수가 뜨고, 칸 아래에 그 구간의 실제
       예약 날짜가 붙는다. 날짜를 누르면 그 날 시간별 현황을 편다.
     · 시설물중심일 때 page.tsx 는 아래 1~3단계(건물·층·공간)를 감춘다.
       같은 지도가 한 화면에 두 번 나오지 않게 하려는 것이다.

   둘 다 달 단위로 넘겨본다(◀ ▶). 고를 수 있는 줄은 "대표 공간"뿐이고
   부속(화장실·샤워실 등)은 대표에 딸려 감춘다 — facility-groups.ts.

   신청은 wizard에서 고른 시설물의 "이 시설 신청하기"로 넘어간다.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, LayoutGrid, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { FacilityBuilding } from "@/lib/facility/facility-map-config";
import { listPrimaryRooms, type ParentMap } from "@/lib/facility/facility-groups";
import FacilityCampusMap from "./FacilityCampusMap";
import FacilityFloorMap from "./FacilityFloorMap";
import FacilityRoomMap from "./FacilityRoomMap";
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

/** 시설물중심 wizard 단계 */
type WizardStep = "building" | "floor" | "room";
const STEP_ORDER: WizardStep[] = ["building", "floor", "room"];
const STEP_LABEL: Record<WizardStep, string> = { building: "건물", floor: "층", room: "시설물" };

/** 월별 예약현황을 나누는 세 칸 */
const SEGMENTS = [
  { key: "1-10", label: "1~10", from: 1, to: 10 },
  { key: "11-20", label: "11~20", from: 11, to: 20 },
  { key: "21-31", label: "21~31", from: 21, to: 31 },
] as const;

const WEEKDAY = "일월화수목금토";

function dayOf(dateKey: string) {
  return Number(dateKey.slice(8, 10));
}

function dayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `${m}월 ${d}일(${WEEKDAY[new Date(y, m - 1, d).getDay()]})`;
}

type Props = {
  buildings: FacilityBuilding[];
  parents?: ParentMap;
  /** 현황에서 고른 시설로 신청 흐름을 열어 준다 */
  onPickFacility: (facilityId: string) => void;
  /** 페이지 진입 전 고른 검색 방식 — 있으면 안내 카드 없이 바로 이 모드로 연다 */
  initialMode?: SearchMode;
  /**
   * 지금 열려 있는 검색 방식을 페이지에 알린다.
   * 페이지는 시설물중심일 때 아래 1~3단계를 감춘다(지도 중복 방지).
   */
  onModeChange?: (mode: SearchMode | null) => void;
};

export default function FacilityScheduleSearch({
  buildings,
  parents,
  onPickFacility,
  initialMode,
  onModeChange,
}: Props) {
  const [mode, setMode] = useState<SearchMode | null>(initialMode ?? null);
  const [cursor, setCursor] = useState<MonthCursor>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [pickedDate, setPickedDate] = useState<string>(() => toDateKey(new Date()));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 시설물중심 wizard — 단계를 오가도 고른 값은 남는다
  const [step, setStep] = useState<WizardStep>("building");
  const [pickedBuilding, setPickedBuilding] = useState<string | null>(null);
  const [pickedFloor, setPickedFloor] = useState<number | null>(null);
  // 시간별 현황을 펼친 칸 (시설물 + 날짜)
  const [openDay, setOpenDay] = useState<{ facilityId: string; date: string } | null>(null);
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

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  /** wizard 단계 이동 — 고른 값이 없는 단계로는 앞서 가지 않는다 */
  const stepIndex = STEP_ORDER.indexOf(step);
  const canEnter = (target: WizardStep) => {
    if (target === "floor") return pickedBuilding !== null;
    if (target === "room") return pickedBuilding !== null && pickedFloor !== null;
    return true;
  };
  const prevStep = stepIndex > 0 ? STEP_ORDER[stepIndex - 1] : null;
  const nextCandidate = stepIndex < STEP_ORDER.length - 1 ? STEP_ORDER[stepIndex + 1] : null;
  const nextStep = nextCandidate && canEnter(nextCandidate) ? nextCandidate : null;

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

  // 시설물중심 wizard — 지금 보고 있는 건물·층
  const wizardBuilding = buildings.find((b) => b.code === pickedBuilding) ?? null;
  const wizardFloor = wizardBuilding?.floors.find((f) => f.floor === pickedFloor) ?? null;

  // 이 층에서 고를 수 있는 공간 = 대표 공간만. 설정 파일은 계단·전기실까지
  // reservable: true 라서 평면도에 그냥 맡기면 그런 곳도 눌린다.
  const floorPrimaryIds = primaries
    .filter(({ building, floor }) => building.code === pickedBuilding && floor.floor === pickedFloor)
    .map(({ group }) => group.primary.id);

  // 고른 시설물 — 고른 순서를 지킨다
  const selectedRows = selectedIds
    .map((id) => primaries.find((row) => row.group.primary.id === id))
    .filter((row): row is (typeof primaries)[number] => Boolean(row));

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
          {/* 단계 이동 — 고른 값은 남으므로 오며가며 복수 선택할 수 있다 */}
          <div style={wizardBar}>
            <button
              type="button"
              onClick={() => prevStep && setStep(prevStep)}
              disabled={!prevStep}
              style={stepNavBtn(Boolean(prevStep))}
            >
              <ChevronLeft size={15} strokeWidth={2.2} />
              {prevStep ? STEP_LABEL[prevStep] : "앞 단계"}
            </button>
            <div style={stepTrail} aria-label="검색 단계">
              {STEP_ORDER.map((key, i) => (
                <span key={key} style={{ display: "inline-flex", alignItems: "center" }}>
                  {i > 0 && <span aria-hidden="true" style={{ opacity: 0.4, margin: "0 4px" }}>›</span>}
                  <button
                    type="button"
                    onClick={() => canEnter(key) && setStep(key)}
                    disabled={!canEnter(key)}
                    aria-current={key === step ? "step" : undefined}
                    style={stepTrailBtn(key === step, canEnter(key))}
                  >
                    {STEP_LABEL[key]}
                  </button>
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => nextStep && setStep(nextStep)}
              disabled={!nextStep}
              style={stepNavBtn(Boolean(nextStep))}
            >
              {nextCandidate ? STEP_LABEL[nextCandidate] : "뒷 단계"}
              <ChevronRight size={15} strokeWidth={2.2} />
            </button>
          </div>

          {/* 단계 화면 — key 를 바꿔 단계가 넘어갈 때마다 스르륵 들어온다 */}
          <div key={step} className="chflow-step-in">
            {step === "building" && (
              <>
                <p style={stepHint}>
                  {wizardBuilding
                    ? `${wizardBuilding.name} — 다른 건물을 누르면 바뀝니다`
                    : "지도에서 건물을 눌러 고르세요"}
                </p>
                <FacilityCampusMap
                  buildings={buildings}
                  selectedCode={pickedBuilding}
                  onSelect={(code) => {
                    setPickedBuilding(code);
                    setPickedFloor(null);
                    setStep("floor");
                  }}
                />
              </>
            )}

            {step === "floor" && (
              wizardBuilding ? (
                <>
                  <p style={stepHint}>{wizardBuilding.name} — 층을 누르면 그 층 시설물이 나옵니다</p>
                  <FacilityFloorMap
                    building={wizardBuilding}
                    selectedFloor={pickedFloor}
                    onSelect={(floorNumber) => {
                      setPickedFloor(floorNumber);
                      setStep("room");
                    }}
                  />
                </>
              ) : (
                <p style={stepHint}>건물을 먼저 고르세요.</p>
              )
            )}

            {step === "room" && (
              wizardBuilding && wizardFloor ? (
                <>
                  <p style={stepHint}>
                    {wizardBuilding.name} {wizardFloor.label} — 여러 곳을 고를 수 있습니다
                    {floorPrimaryIds.length === 0 && " (이 층에는 신청할 수 있는 공간이 없습니다)"}
                  </p>
                  <FacilityRoomMap
                    floor={wizardFloor}
                    buildingName={wizardBuilding.name}
                    selectedRoomId={null}
                    selectedRoomIds={selectedIds}
                    selectableIds={floorPrimaryIds}
                    onSelect={(room) => {
                      setLoading(true);
                      setOpenDay(null);
                      setSelectedIds((prev) => (
                        prev.includes(room.id) ? prev.filter((x) => x !== room.id) : [...prev, room.id]
                      ));
                    }}
                  />
                </>
              ) : (
                <p style={stepHint}>건물과 층을 먼저 고르세요.</p>
              )
            )}
          </div>

          {/* 고른 시설물 — 단계를 오가도 남는다 */}
          {selectedRows.length > 0 && (
            <div style={selectedBar}>
              <strong style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink)" }}>
                고른 시설물 {selectedRows.length}곳
              </strong>
              <button
                type="button"
                onClick={() => { setLoading(true); setOpenDay(null); setSelectedIds([]); }}
                style={{ ...backBtn, marginLeft: "auto" }}
              >
                <X size={13} strokeWidth={2} /> 전체 해제
              </button>
            </div>
          )}

          {/* 시설물별 월 예약현황 — 1~10 / 11~20 / 21~31 */}
          {selectedRows.length === 0 ? (
            <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--ink-soft)", fontWeight: 600 }}>
              시설물을 하나 이상 고르면 그 달 예약현황이 바로 나옵니다.
            </p>
          ) : (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              {selectedRows.map(({ building, floor, group }) => {
                const id = group.primary.id;
                const mine = bookings.filter((b) => b.facility_id === id);
                const open = openDay && openDay.facilityId === id ? openDay.date : null;
                const openBookings = open ? mine.filter((b) => b.date.slice(0, 10) === open) : [];
                return (
                  <section key={id} style={facilityCard}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      <strong style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{group.primary.name}</strong>
                      <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 600 }}>
                        {building.name} · {floor.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => onPickFacility(id)}
                        style={{ ...backBtn, marginLeft: "auto" }}
                      >이 시설 신청하기</button>
                      <button
                        type="button"
                        aria-label={`${group.primary.name} 선택 해제`}
                        onClick={() => {
                          setLoading(true);
                          setOpenDay(null);
                          setSelectedIds((prev) => prev.filter((x) => x !== id));
                        }}
                        style={unpickBtn}
                      >
                        <X size={14} strokeWidth={2.2} />
                      </button>
                    </div>

                    <div style={segGrid}>
                      {SEGMENTS.map((seg) => {
                        const days = Array.from(new Set(
                          mine
                            .map((b) => b.date.slice(0, 10))
                            .filter((key) => {
                              const d = dayOf(key);
                              return d >= seg.from && d <= seg.to;
                            }),
                        )).sort();
                        const count = mine.filter((b) => {
                          const d = dayOf(b.date.slice(0, 10));
                          return d >= seg.from && d <= seg.to;
                        }).length;
                        return (
                          <div key={seg.key} style={segCol}>
                            <div style={segHead(count > 0)}>
                              <span>{seg.label}</span>
                              {/* 예약이 있는 칸만 표시한다 */}
                              {count > 0 && <span style={segCount}>{count}건</span>}
                            </div>
                            <div style={segBody}>
                              {days.length === 0 ? (
                                <span style={subNote}>예약 없음</span>
                              ) : (
                                days.map((key) => (
                                  <button
                                    key={key}
                                    type="button"
                                    aria-pressed={open === key}
                                    onClick={() => setOpenDay(
                                      open === key ? null : { facilityId: id, date: key },
                                    )}
                                    style={dayChip(open === key)}
                                  >
                                    {dayOf(key)}일
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {mine.length === 0 && (
                      <p style={subNoteBlock}>이 달에는 예약이 없습니다 — 아무 날이나 신청할 수 있습니다.</p>
                    )}

                    {/* 날짜를 누르면 그 날 시간별 현황 */}
                    {open && (
                      <div style={{ marginTop: 12 }} className="chflow-step-in">
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <Clock size={14} strokeWidth={2} style={{ color: "var(--ink-faint)" }} />
                          <strong style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink)" }}>
                            {dayLabel(open)} 시간별 현황
                          </strong>
                          <button
                            type="button"
                            onClick={() => setOpenDay(null)}
                            style={{ ...backBtn, marginLeft: "auto" }}
                          >
                            <X size={13} strokeWidth={2} /> 닫기
                          </button>
                        </div>
                        <FacilityBookingGrid
                          rows={[{
                            facilityId: id,
                            label: group.primary.name,
                            sublabel: `${building.name} · ${floor.label}`,
                            bookings: openBookings,
                          }] satisfies GridRow[]}
                        />
                        <p style={subNoteBlock}>비어 있는 시간대는 아무 때나 신청할 수 있습니다.</p>
                      </div>
                    )}
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
const wizardBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 10,
};
function stepNavBtn(enabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    minHeight: 32,
    padding: "6px 10px",
    borderRadius: 9,
    border: "1px solid var(--hairline-strong)",
    background: "var(--card)",
    color: enabled ? "var(--ink-mid)" : "var(--ink-faint)",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.45,
  };
}
const stepTrail: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  margin: "0 auto",
};
function stepTrailBtn(active: boolean, enabled: boolean): React.CSSProperties {
  return {
    minHeight: 28,
    padding: "4px 9px",
    borderRadius: 999,
    border: "none",
    background: active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
    color: active ? "var(--accent-strong)" : enabled ? "var(--ink-soft)" : "var(--ink-faint)",
    fontSize: 12,
    fontWeight: active ? 800 : 600,
    fontFamily: "inherit",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.5,
  };
}
const stepHint: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--ink-soft)",
  fontWeight: 600,
};
const selectedBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 12,
  padding: "8px 10px",
  borderRadius: 10,
  background: "var(--bg-soft)",
  border: "1px solid var(--hairline)",
};
const facilityCard: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "var(--card)",
  border: "1px solid var(--hairline)",
};
const segGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 6,
};
const segCol: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  overflow: "hidden",
  background: "var(--surface)",
};
function segHead(hasBooking: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minHeight: 30,
    padding: "4px 6px",
    background: hasBooking
      ? "color-mix(in srgb, var(--danger) 10%, var(--card))"
      : "var(--card)",
    color: hasBooking ? "var(--ink)" : "var(--ink-faint)",
    fontSize: 11.5,
    fontWeight: 800,
    borderBottom: "1px solid var(--hairline)",
  };
}
const segCount: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  padding: "1px 6px",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--danger) 16%, transparent)",
  color: "var(--danger)",
};
const segBody: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  justifyContent: "center",
  minHeight: 38,
  padding: "6px 5px",
};
function dayChip(open: boolean): React.CSSProperties {
  return {
    minHeight: 26,
    padding: "3px 8px",
    borderRadius: 999,
    border: `1.5px solid ${open ? "var(--accent)" : "var(--hairline-strong)"}`,
    background: open ? "color-mix(in srgb, var(--accent) 14%, var(--card))" : "var(--card)",
    color: open ? "var(--accent-strong)" : "var(--ink)",
    fontSize: 11.5,
    fontWeight: open ? 800 : 700,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}
const subNote: React.CSSProperties = {
  fontSize: 10.5,
  color: "var(--ink-faint)",
  fontWeight: 600,
  alignSelf: "center",
};
const subNoteBlock: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--ink-faint)",
  fontWeight: 600,
};
const unpickBtn: React.CSSProperties = {
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
