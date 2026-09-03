"use client";

/* ============================================================
   시설 사용신청

   흐름: 건물 선택 → 층 선택 → 공간 선택 → 날짜/시간 → 신청내용 → 신청
   캠퍼스 안내도·건물 단면·평면도는 components/facility/* 가 그리고,
   공간 데이터는 lib/facility/facility-map-config.ts 에서만 온다.
   ============================================================ */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Construction, Landmark, Settings } from "lucide-react";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { EmptyState, LoadingView } from "@/components/StatusViews";
import FacilityCampusMap from "@/components/facility/FacilityCampusMap";
import FacilityFloorMap from "@/components/facility/FacilityFloorMap";
import FacilityRoomMap from "@/components/facility/FacilityRoomMap";
import FacilityRoomEditor from "@/components/facility/FacilityRoomEditor";
import FacilitySelectionCard from "@/components/facility/FacilitySelectionCard";
import {
  findBuilding,
  findBuildingIn,
  findFloor,
  findFloorIn,
  findRoom,
  findRoomIn,
  formatCapacity,
  formatRoomPathIn,
  isBuildingSelectable,
  listBuildings,
} from "@/lib/facility/facility-map-config";
import type { FacilityRoom } from "@/lib/facility/facility-map-config";
import type { FacilityBuildingOverride, FacilityRoomOverride } from "@/lib/facility/facility-overrides";
import { applyOverrides, toBuildingOverrideMap, toOverrideMap } from "@/lib/facility/facility-overrides";
import FacilityScheduleSearch from "@/components/facility/FacilityScheduleSearch";

const APPROVER_ROLES = ["admin", "office", "pastor"];

type Selection = {
  building: string | null;
  floor: number | null;
  facilityId: string | null;
};

type MyBooking = {
  id: string;
  facility_id: string | null;
  building_code: string | null;
  floor: number | null;
  facility_name: string;
  date: string;
  time_start: string;
  time_end: string;
  purpose: string | null;
  headcount: number | null;
  status: string;
  decision_note: string | null;
};

type DayBooking = { time_start: string; time_end: string; status: string };

const STATUS_LABEL: Record<string, string> = {
  pending: "결재 대기",
  approved: "승인",
  rejected: "반려",
  cancelled: "취소됨",
};

const STATUS_COLOR: Record<string, { fg: string; bg: string }> = {
  pending: { fg: "var(--warning)", bg: "var(--warning-soft)" },
  approved: { fg: "var(--success)", bg: "var(--success-soft)" },
  rejected: { fg: "var(--danger)", bg: "var(--danger-soft)" },
  cancelled: { fg: "var(--ink-soft)", bg: "var(--bg-soft)" },
};

function hhmm(value: string): string {
  return value.slice(0, 5);
}

function todayKST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** URL query → 선택 상태. 설정에 없는 값은 버린다. */
function parseSelection(params: URLSearchParams): Selection {
  const building = findBuilding(params.get("building"));
  if (!building) return { building: null, floor: null, facilityId: null };

  const floorParam = params.get("floor");
  const floorNumber = floorParam === null ? null : Number(floorParam);
  const floor = Number.isFinite(floorNumber) ? findFloor(building.code, floorNumber) : null;
  if (!floor) return { building: building.code, floor: null, facilityId: null };

  // 대여 가능 여부는 관리자가 바꿀 수 있으므로 여기서 판정하지 않는다.
  // 설정 파일에 있는 공간인지, 이 건물·층 소속인지만 본다.
  const room = findRoom(params.get("facility"));
  const roomOk = room && room.building === building.code && room.floor === floor.floor;
  return { building: building.code, floor: floor.floor, facilityId: roomOk ? room.id : null };
}

function FacilityRequestView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [authChecked, setAuthChecked] = useState(false);
  const [isApprover, setIsApprover] = useState(false);
  const [selection, setSelection] = useState<Selection>(() => parseSelection(new URLSearchParams(searchParams.toString())));

  const [formOpen, setFormOpen] = useState(() => Boolean(parseSelection(new URLSearchParams(searchParams.toString())).facilityId));
  const [date, setDate] = useState("");
  const [timeStart, setTimeStart] = useState("09:00");
  const [timeEnd, setTimeEnd] = useState("11:00");
  const [headcount, setHeadcount] = useState("");
  const [contact, setContact] = useState("");
  const [purpose, setPurpose] = useState("");

  const [dayBookings, setDayBookings] = useState<DayBooking[]>([]);
  const [myBookings, setMyBookings] = useState<MyBooking[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [overrides, setOverrides] = useState(() => toOverrideMap([]));
  const [buildingOverrides, setBuildingOverrides] = useState(() => toBuildingOverrideMap([]));
  const [editorOpen, setEditorOpen] = useState(false);

  const formRef = useRef<HTMLElement | null>(null);

  // 설정 파일 목록 위에 관리자가 고친 이름·대여 여부를 덮어쓴 것이 화면의 진실이다
  const defaults = useMemo(() => listBuildings(), []);
  const buildings = useMemo(
    () => applyOverrides(defaults, overrides, buildingOverrides),
    [defaults, overrides, buildingOverrides],
  );
  // 대표·부속 분류 — 관리자가 지정한 값만 넘기고, 없으면 kind 로 자동 분류된다
  const parentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [facilityId, row] of overrides) {
      if (typeof row.parent_id === "string") map.set(facilityId, row.parent_id);
    }
    return map;
  }, [overrides]);

  const building = findBuildingIn(buildings, selection.building);
  const floor = findFloorIn(buildings, selection.building, selection.floor);
  const picked = findRoomIn(buildings, selection.facilityId);
  const room = picked && picked.reservable ? picked : null;

  const loadOverrides = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("get_facility_room_overrides");
    if (rpcError) {
      setError(`공간 정보를 불러오지 못했습니다: ${rpcError.message}`);
      return;
    }
    setOverrides(toOverrideMap(data as FacilityRoomOverride[] | null));

    const { data: buildingData, error: buildingError } = await supabase.rpc("get_facility_building_overrides");
    if (buildingError) {
      setError(`건물 정보를 불러오지 못했습니다: ${buildingError.message}`);
      return;
    }
    setBuildingOverrides(toBuildingOverrideMap(buildingData as FacilityBuildingOverride[] | null));
  }, []);

  const loadMyBookings = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("get_my_facility_bookings");
    if (rpcError) setError(`신청 내역을 불러오지 못했습니다: ${rpcError.message}`);
    setMyBookings((data as MyBooking[] | null) ?? []);
    setListLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: profileData } = await supabase.rpc("get_my_status");
      const profile = profileData?.[0];
      setIsApprover(Boolean(profile && APPROVER_ROLES.includes(profile.role)));
      setAuthChecked(true);
      await Promise.all([loadOverrides(), loadMyBookings()]);
    })();
  }, [router, loadOverrides, loadMyBookings]);

  // 선택한 공간·날짜의 기존 신청 현황 (시간 겹침 안내)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!selection.facilityId || !date) {
        if (alive) setDayBookings([]);
        return;
      }
      const { data } = await supabase.rpc("get_facility_day_bookings", {
        p_facility_id: selection.facilityId,
        p_date: date,
      });
      if (alive) setDayBookings((data as DayBooking[] | null) ?? []);
    })();
    return () => { alive = false; };
  }, [selection.facilityId, date]);

  /** 선택 상태와 URL 을 함께 갱신 — 새로고침·공유해도 같은 화면이 뜬다 */
  const applySelection = useCallback((next: Selection) => {
    setSelection(next);
    const params = new URLSearchParams();
    if (next.building) params.set("building", next.building);
    if (next.floor !== null) params.set("floor", String(next.floor));
    if (next.facilityId) params.set("facility", next.facilityId);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router]);

  function handleBuilding(code: string) {
    setNotice("");
    if (selection.building === code) {
      applySelection({ building: null, floor: null, facilityId: null });
      return;
    }
    applySelection({ building: code, floor: null, facilityId: null });
  }

  function handleFloor(floorNumber: number) {
    setNotice("");
    applySelection({ building: selection.building, floor: floorNumber, facilityId: null });
  }

  function handleRoom(picked: FacilityRoom) {
    setNotice("");
    applySelection({ building: picked.building, floor: picked.floor, facilityId: picked.id });
  }

  function openForm() {
    setFormOpen(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!room) return setError("신청할 공간을 먼저 선택해주세요");
    if (!date) return setError("사용 날짜를 선택해주세요");
    if (timeEnd <= timeStart) return setError("종료 시각은 시작 시각보다 늦어야 합니다");
    if (!purpose.trim()) return setError("사용 목적을 입력해주세요");

    setSubmitting(true);
    const { error: rpcError } = await supabase.rpc("create_facility_booking", {
      p_facility_id: room.id,
      p_building_code: room.building,
      p_floor: room.floor,
      p_facility_name: formatRoomPathIn(buildings, room),
      p_date: date,
      p_time_start: timeStart,
      p_time_end: timeEnd,
      p_purpose: purpose.trim(),
      p_headcount: headcount ? Number(headcount) : null,
      p_contact: contact.trim() || null,
    });
    setSubmitting(false);

    if (rpcError) { setError(rpcError.message); return; }

    setNotice("신청이 접수되었습니다. 결재 결과는 신청 내역에서 확인할 수 있습니다.");
    setPurpose("");
    setHeadcount("");
    setFormOpen(false);
    await loadMyBookings();
  }

  async function handleCancel(id: string) {
    setError("");
    setNotice("");
    const { error: rpcError } = await supabase.rpc("cancel_facility_booking", { p_id: id });
    if (rpcError) { setError(rpcError.message); return; }
    setNotice("신청을 취소했습니다.");
    await loadMyBookings();
  }

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "var(--app-sans)" }}>
      {/* 헤더 */}
      <div style={{
        background: "var(--card)", borderBottom: "1px solid var(--hairline)",
        padding: "14px 20px", display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={() => router.push("/home")} style={iconBtn} aria-label="홈으로">←</button>
        <HeaderLogo />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Landmark size={16} strokeWidth={1.8} /> 시설 사용신청
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>건물과 공간을 고르고 사용 시간을 신청하세요</div>
        </div>
        {isApprover && (
          <button onClick={() => router.push("/admin/facility")} style={manageBtn}>신청 결재</button>
        )}
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "18px 16px 60px" }}>
        {/* 구현 중 안내 — 어디까지 확인된 정보인지 화면 맨 위에 고정으로 밝힌다.
            층별 세부 공간이 모두 채워지면 이 블록을 지운다. */}
        <div style={wipBanner}>
          <Construction size={16} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 800 }}>현재 시설신청은 구현 중입니다.</div>
            <div style={{ marginTop: 2, fontWeight: 600 }}>
              비전센터 공간은 건축도면을 기준으로 넣었습니다. 수용인원·비품과 바울관·본당·도서관의 세부 공간은 확인 중입니다.
            </div>
          </div>
        </div>

        {notice && (
          <div style={{ ...banner, background: "var(--success-soft)", color: "var(--success)" }}>
            <CheckCircle2 size={14} strokeWidth={1.8} /> {notice}
          </div>
        )}
        {error && (
          <div style={{ ...banner, background: "var(--danger-soft)", color: "var(--danger)" }}>
            <AlertTriangle size={14} strokeWidth={1.8} /> {error}
          </div>
        )}

        {/* 예약현황 검색 — 신청 전에 언제 비어 있는지 먼저 본다 */}
        <section style={card}>
          <StepTitle
            step={0}
            title="예약현황 검색"
            hint="신청 전에 원하는 날짜·시설이 비어 있는지 먼저 확인하세요"
          />
          <FacilityScheduleSearch
            buildings={buildings}
            parents={parentMap}
            onPickFacility={(facilityId) => {
              const found = findRoomIn(buildings, facilityId);
              if (!found) return;
              applySelection({ building: found.building, floor: found.floor, facilityId });
              setFormOpen(true);
            }}
          />
        </section>

        {/* 1단계 — 건물 */}
        <section style={card}>
          <StepTitle
            step={1}
            title="건물 선택"
            hint={building ? `${building.name} — ${building.description}` : "지도에서 건물을 눌러 고르세요"}
          />
          <FacilityCampusMap buildings={buildings} selectedCode={selection.building} onSelect={handleBuilding} />
          <p style={caption}>
            위가 북쪽인 안내도입니다. 실제 대지 측량도가 아니라 건물끼리의 위치 관계를 보여줍니다.
          </p>
        </section>

        {/* 2단계 — 층 */}
        {building && (
          <section style={card}>
            <StepTitle
              step={2}
              title="층 선택"
              hint={
                floor
                  ? `${building.name} ${floor.label}`
                  : isBuildingSelectable(building)
                    ? `${building.name} — 층을 고르세요`
                    : `${building.name} — 층별 세부 공간을 확인하는 중입니다`
              }
              action={
                isApprover ? (
                  <button
                    type="button"
                    onClick={() => setEditorOpen(true)}
                    style={editBtn}
                    aria-label={`${building.name} 공간 편집`}
                  >
                    <Settings size={13} strokeWidth={2} />
                    공간 편집
                  </button>
                ) : undefined
              }
            />
            <FacilityFloorMap building={building} selectedFloor={selection.floor} onSelect={handleFloor} />
          </section>
        )}

        {/* 3단계 — 공간 */}
        {building && floor && (
          <section style={card}>
            <StepTitle
              step={3}
              title="공간 선택"
              hint={room ? room.name : `${building.name} ${floor.label} — 신청할 공간을 고르세요`}
            />
            <FacilityRoomMap
              floor={floor}
              buildingName={building.name}
              selectedRoomId={selection.facilityId}
              onSelect={handleRoom}
            />
            {room && (
              <FacilitySelectionCard room={room} actionLabel="이 공간 신청하기" onAction={openForm} />
            )}
          </section>
        )}

        {/* 4단계 — 날짜/시간 + 신청내용 */}
        {room && formOpen && (
          <section style={card} ref={formRef}>
            <StepTitle step={4} title="날짜·시간과 신청내용" hint={formatRoomPathIn(buildings, room)} />

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label style={label} htmlFor="facility-date">사용 날짜 *</label>
                <input
                  id="facility-date"
                  type="date"
                  value={date}
                  min={todayKST()}
                  onChange={(e) => setDate(e.target.value)}
                  style={{ ...input, marginTop: 6 }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={label} htmlFor="facility-start">시작 시각 *</label>
                  <input id="facility-start" type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} style={{ ...input, marginTop: 6 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label} htmlFor="facility-end">종료 시각 *</label>
                  <input id="facility-end" type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} style={{ ...input, marginTop: 6 }} />
                </div>
              </div>

              {date && (
                <div style={{
                  marginBottom: 12, padding: "10px 12px", borderRadius: 10,
                  background: "var(--surface)", border: "1px solid var(--hairline)",
                  fontSize: 12, color: "var(--ink-mid)", fontWeight: 500, lineHeight: 1.7,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 4 }}>
                    <CalendarClock size={13} strokeWidth={1.8} /> {date} 신청 현황
                  </div>
                  {dayBookings.length === 0
                    ? "이 날짜에 등록된 신청이 없습니다."
                    : dayBookings.map((b, i) => (
                        <div key={i}>
                          {hhmm(b.time_start)}~{hhmm(b.time_end)} · {STATUS_LABEL[b.status] ?? b.status}
                        </div>
                      ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={label} htmlFor="facility-headcount">사용 인원</label>
                  <input
                    id="facility-headcount"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={headcount}
                    onChange={(e) => setHeadcount(e.target.value)}
                    placeholder={room.capacity ? `최대 ${room.capacity}` : "인원"}
                    style={{ ...input, marginTop: 6 }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label} htmlFor="facility-contact">연락처</label>
                  <input
                    id="facility-contact"
                    type="tel"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="010-0000-0000"
                    style={{ ...input, marginTop: 6 }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={label} htmlFor="facility-purpose">사용 목적 *</label>
                <textarea
                  id="facility-purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  rows={4}
                  maxLength={300}
                  placeholder="예: 교사 월례회 — 부서 교사 20명"
                  style={{ ...input, marginTop: 6, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
                />
              </div>

              {room.capacity !== null && Number(headcount) > room.capacity && (
                <div style={{ ...banner, background: "var(--warning-soft)", color: "var(--warning)" }}>
                  <AlertTriangle size={14} strokeWidth={1.8} /> {formatCapacity(room)} — 인원을 다시 확인해주세요
                </div>
              )}

              <button type="submit" disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? "신청 중..." : "신청하기"}
              </button>
            </form>
          </section>
        )}

        {/* 내 신청 내역 */}
        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 800, color: "var(--ink)", marginBottom: 12 }}>
            <ClipboardList size={15} strokeWidth={1.8} /> 내 신청 내역
          </div>
          {listLoading ? (
            <LoadingView padding={24} />
          ) : myBookings.length === 0 ? (
            <EmptyState message="아직 신청한 시설이 없습니다" hint="위에서 건물과 공간을 골라 신청해보세요" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {myBookings.map((b) => {
                const color = STATUS_COLOR[b.status] ?? STATUS_COLOR.cancelled;
                return (
                  <div key={b.id} style={{
                    padding: 14, borderRadius: 12,
                    background: "var(--surface)", border: "1px solid var(--hairline)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{b.facility_name}</div>
                      <span style={{
                        padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                        color: color.fg, background: color.bg,
                      }}>
                        {STATUS_LABEL[b.status] ?? b.status}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-mid)", fontWeight: 500 }}>
                      {b.date} · {hhmm(b.time_start)}~{hhmm(b.time_end)}
                      {b.headcount ? ` · ${b.headcount}명` : ""}
                    </div>
                    {b.purpose && (
                      <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.6 }}>{b.purpose}</div>
                    )}
                    {b.decision_note && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-mid)", fontWeight: 600 }}>
                        결재 의견: {b.decision_note}
                      </div>
                    )}
                    {b.status === "pending" && (
                      <button type="button" onClick={() => handleCancel(b.id)} style={cancelBtn}>신청 취소</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {editorOpen && building && (
        <FacilityRoomEditor
          building={building}
          defaults={findBuildingIn(defaults, building.code) ?? building}
          overrides={overrides}
          onClose={() => setEditorOpen(false)}
          onSaved={async (message) => {
            setEditorOpen(false);
            setError("");
            setNotice(message);
            await loadOverrides();
          }}
        />
      )}
    </div>
  );
}

export default function FacilityPage() {
  return (
    <Suspense fallback={<LoadingView full />}>
      <FacilityRequestView />
    </Suspense>
  );
}

function StepTitle({
  step,
  title,
  hint,
  action,
}: {
  step: number;
  title: string;
  hint: string;
  /** 제목 오른쪽에 붙는 버튼 (예: 관리자 공간 편집) */
  action?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 999, display: "inline-flex",
          alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800,
          color: "var(--accent-strong)", background: "var(--accent-soft)",
        }}>{step}</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{title}</span>
        {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
      </div>
      <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-soft)", fontWeight: 500 }}>{hint}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 16,
  padding: 16,
  marginBottom: 14,
};
const iconBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, background: "var(--bg-soft)",
  border: "none", fontSize: 16, cursor: "pointer", color: "var(--ink-mid)", flexShrink: 0,
};
const editBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "7px 11px", minHeight: 34, borderRadius: 999,
  border: "1px solid var(--hairline)", background: "var(--card)",
  color: "var(--ink-mid)", fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
};
const manageBtn: React.CSSProperties = {
  padding: "8px 12px", minHeight: 36, borderRadius: 10, border: "1px solid var(--accent-line)",
  background: "var(--accent-soft)", color: "var(--accent-strong)",
  fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
};
const label: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", letterSpacing: 0.3,
};
const input: React.CSSProperties = {
  width: "100%", padding: "12px 14px", fontSize: 14, minHeight: 46,
  background: "var(--card)", border: "1.5px solid var(--hairline)", borderRadius: 10,
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
  color: "var(--ink)", fontWeight: 500,
};
const primaryBtn: React.CSSProperties = {
  width: "100%", minHeight: 48, padding: "14px 16px", fontSize: 15, fontWeight: 800,
  color: "var(--card)", background: "var(--accent)",
  border: "none", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
};
const cancelBtn: React.CSSProperties = {
  marginTop: 10, minHeight: 40, padding: "8px 14px", fontSize: 12.5, fontWeight: 700,
  color: "var(--danger)", background: "var(--danger-soft)", border: "none",
  borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
};
const banner: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "10px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, marginBottom: 12,
};
const wipBanner: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 8,
  padding: "12px 14px", borderRadius: 12, marginBottom: 14,
  background: "var(--warning-soft)", color: "var(--warning)",
  border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
  fontSize: 13, lineHeight: 1.5,
};
const caption: React.CSSProperties = {
  margin: "10px 0 0", fontSize: 11.5, color: "var(--ink-faint)", textAlign: "center", lineHeight: 1.6,
};
