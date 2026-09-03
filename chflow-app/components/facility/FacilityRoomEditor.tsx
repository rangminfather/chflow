"use client";

/* ============================================================
   건물별 공간 편집 (결재 권한자 전용)

   고칠 수 있는 것은 **공간 이름 · 대여 가능/불가 · 수용인원(단위) ·
   비품 · 안내 문구** 다섯 가지다.
   공간이 몇 개 있는지·평면도 어디에 놓이는지는 설정 파일
   (lib/facility/facility-map-config.ts)이 정하고, 여기서 고친 값은
   facility_room_overrides 테이블에 덮어쓰기로만 쌓인다.

   기본값과 같아진 행은 저장할 때 지운다 — 그래야 나중에 설정 파일을
   고쳤을 때 낡은 덮어쓰기가 조용히 이기지 않는다.
   ============================================================ */

import { useMemo, useState } from "react";
import { AlertTriangle, RotateCcw, Save, Settings, X } from "lucide-react";
import ModalBackdrop from "@/components/ModalBackdrop";
import { supabase } from "@/lib/supabase";
import type { FacilityBuilding } from "@/lib/facility/facility-map-config";
import type { BuildingDraft, OverrideMap, RoomDraft } from "@/lib/facility/facility-overrides";
import {
  BUILDING_DESC_MAX,
  BUILDING_NAME_MAX,
  buildBuildingSavePayload,
  draftFromBuilding,
  isSameBuildingDraft,
  validateBuildingDraft,
  CAPACITY_UNIT_MAX,
  DEFAULT_CAPACITY_UNIT,
  ROOM_NAME_MAX,
  ROOM_NOTE_MAX,
  buildSavePayload,
  draftFromRoom,
  isSameDraft,
  validateDrafts,
} from "@/lib/facility/facility-overrides";

type Props = {
  /** 지금 화면에 보이는 건물 (덮어쓰기가 이미 적용된 값) */
  building: FacilityBuilding;
  /** 설정 파일 원본 건물 — 기본값 비교에 쓴다 */
  defaults: FacilityBuilding;
  overrides: OverrideMap;
  onClose: () => void;
  onSaved: (message: string) => void;
};

export default function FacilityRoomEditor({ building, defaults, overrides, onClose, onSaved }: Props) {
  const defaultRooms = useMemo(
    () => defaults.floors.flatMap((floor) => floor.rooms),
    [defaults],
  );
  const defaultById = useMemo(
    () => new Map(defaultRooms.map((room) => [room.id, room])),
    [defaultRooms],
  );

  const [drafts, setDrafts] = useState<Map<string, RoomDraft>>(() => {
    const initial = new Map<string, RoomDraft>();
    for (const floor of building.floors) {
      for (const room of floor.rooms) initial.set(room.id, draftFromRoom(room));
    }
    return initial;
  });
  const [buildingDraft, setBuildingDraft] = useState<BuildingDraft>(() => draftFromBuilding(building));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 위층부터 — 층 선택 화면과 같은 순서
  const descending = useMemo(
    () => [...building.floors].sort((a, b) => b.floor - a.floor),
    [building],
  );

  function update(id: string, patch: Partial<RoomDraft>) {
    setError("");
    setDrafts((prev) => {
      const current = prev.get(id);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(id, { ...current, ...patch });
      return next;
    });
  }

  function resetRow(id: string) {
    const base = defaultById.get(id);
    if (!base) return;
    update(id, draftFromRoom(base));
  }

  // 화면을 연 시점의 값과 견줘 "지금 몇 곳을 손댔는지"
  const shownRooms = useMemo(() => building.floors.flatMap((floor) => floor.rooms), [building]);
  const changedCount = useMemo(() => {
    let count = 0;
    for (const room of shownRooms) {
      const draft = drafts.get(room.id);
      if (draft && !isSameDraft(draft, draftFromRoom(room))) count += 1;
    }
    return count;
  }, [shownRooms, drafts]);

  async function handleSave() {
    setError("");
    const headProblem = validateBuildingDraft(buildingDraft);
    if (headProblem) { setError(headProblem); return; }
    const problem = validateDrafts(defaultRooms, drafts);
    if (problem) { setError(problem); return; }

    const payload = buildSavePayload(defaultRooms, drafts, overrides);
    const headChanged = !isSameBuildingDraft(buildingDraft, draftFromBuilding(building));
    if (payload.rows.length === 0 && payload.resets.length === 0 && !headChanged) {
      onSaved("바뀐 내용이 없습니다.");
      return;
    }

    setSaving(true);
    // 건물 이름 → 공간 순서로 저장한다. 앞이 실패하면 뒤는 시도하지 않는다.
    if (headChanged) {
      const headPayload = buildBuildingSavePayload(defaults, buildingDraft);
      if (headPayload) {
        const { error: headError } = await supabase.rpc("save_facility_building_override", headPayload);
        if (headError) { setSaving(false); setError(headError.message); return; }
      }
    }
    const { error: rpcError } = payload.rows.length > 0 || payload.resets.length > 0
      ? await supabase.rpc("save_facility_room_overrides", {
          p_rows: payload.rows,
          p_resets: payload.resets,
        })
      : { error: null };
    setSaving(false);

    if (rpcError) { setError(rpcError.message); return; }
    onSaved(`${buildingDraft.name.trim() || building.name} 정보를 저장했습니다.`);
  }

  return (
    <ModalBackdrop onClose={onClose} style={{ alignItems: "flex-start", padding: 0 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${building.name} 공간 편집`}
        style={{
          width: "100%",
          maxWidth: 640,
          margin: "0 auto",
          // 높이를 화면에 못박아야 가운데 목록만 스크롤되고 저장 버튼이 아래에 붙는다.
          // minHeight 로 두면 공간이 70곳쯤 되는 비전센터에서 저장 버튼이 화면 밖으로 밀린다.
          height: "100dvh",
          maxHeight: "100dvh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
        }}
      >
        {/* 머리말 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            background: "var(--card)",
            borderBottom: "1px solid var(--hairline)",
            flexShrink: 0,
          }}
        >
          <Settings size={17} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>공간 편집</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 500 }}>{building.name}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" style={iconBtn}>
            <X size={17} strokeWidth={2} />
          </button>
        </div>

        {/* 내용 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 16px" }}>
          {/* 건물 머리말 — 이름·설명도 관리자가 고친다 */}
          <div style={{ ...row, marginBottom: 12 }}>
            <label style={fieldLabel}>
              건물 이름
              <input
                value={buildingDraft.name}
                onChange={(e) => { setError(""); setBuildingDraft((d) => ({ ...d, name: e.target.value })); }}
                maxLength={BUILDING_NAME_MAX}
                aria-label="건물 이름"
                style={input}
              />
            </label>
            <label style={{ ...fieldLabel, marginTop: 8 }}>
              건물 설명
              <input
                value={buildingDraft.description}
                onChange={(e) => { setError(""); setBuildingDraft((d) => ({ ...d, description: e.target.value })); }}
                maxLength={BUILDING_DESC_MAX}
                placeholder="예: 1~7층 (1·2층 주차장)"
                aria-label="건물 설명"
                style={input}
              />
            </label>
            {!isSameBuildingDraft(buildingDraft, draftFromBuilding(defaults)) && (
              <button
                type="button"
                onClick={() => { setError(""); setBuildingDraft(draftFromBuilding(defaults)); }}
                style={{ ...secondaryBtn, marginTop: 8, minHeight: 34, padding: "6px 12px", fontSize: 12 }}
              >
                <RotateCcw size={13} strokeWidth={2} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                건물 이름·설명 기본값으로
              </button>
            )}
          </div>

          <p style={hint}>
            공간 이름 · 대여 여부 · 수용인원 · 비품 · 안내 문구를 고칠 수 있습니다.
            모든 공간이 기본 &quot;대여 가능&quot;이니, 신청받지 않을 곳은 여기서 &quot;대여 불가&quot;로 바꿔 주세요.
            수용인원과 비품은 실측 전 임의 기본값이니 확인되는 대로 여기서 고쳐 주세요.
            공간을 새로 만들거나 없애는 것은 여기서 할 수 없습니다.
            이름을 바꿔도 이미 접수된 신청 내역의 표기는 그대로 남습니다.
          </p>

          {error && (
            <div style={errorBanner}>
              <AlertTriangle size={14} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </div>
          )}

          {descending.map((floor) => (
            <section key={floor.floor} style={{ marginBottom: 16 }}>
              <div style={floorHeader}>
                <span style={floorChip}>{floor.label}</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 600 }}>
                  공간 {floor.rooms.length}곳
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {floor.rooms.map((room) => {
                  const draft = drafts.get(room.id) ?? draftFromRoom(room);
                  const base = defaultById.get(room.id);
                  const differsFromDefault = base ? !isSameDraft(draft, draftFromRoom(base)) : false;

                  return (
                    <div key={room.id} data-facility-row={room.id} style={row}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          value={draft.name}
                          onChange={(e) => update(room.id, { name: e.target.value })}
                          maxLength={ROOM_NAME_MAX}
                          aria-label={`${floor.label} ${room.name} 이름`}
                          style={input}
                        />
                        {differsFromDefault && (
                          <button
                            type="button"
                            onClick={() => resetRow(room.id)}
                            aria-label={`${floor.label} ${room.name} 기본값으로 되돌리기`}
                            title="기본값으로 되돌리기"
                            style={iconBtn}
                          >
                            <RotateCcw size={15} strokeWidth={2} />
                          </button>
                        )}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <StateButton
                            label="대여 가능"
                            active={draft.reservable}
                            tone="open"
                            onClick={() => update(room.id, { reservable: true })}
                          />
                          <StateButton
                            label="대여 불가"
                            active={!draft.reservable}
                            tone="closed"
                            onClick={() => update(room.id, { reservable: false })}
                          />
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <label style={fieldLabel}>
                          수용인원
                          <input
                            value={draft.capacity}
                            onChange={(e) => update(room.id, { capacity: e.target.value })}
                            inputMode="numeric"
                            placeholder="미지정"
                            maxLength={4}
                            aria-label={`${floor.label} ${room.name} 수용인원`}
                            style={{ ...input, flex: "none", width: 82 }}
                          />
                        </label>
                        <label style={fieldLabel}>
                          단위
                          <input
                            value={draft.capacityUnit}
                            onChange={(e) => update(room.id, { capacityUnit: e.target.value })}
                            placeholder={DEFAULT_CAPACITY_UNIT}
                            maxLength={CAPACITY_UNIT_MAX}
                            aria-label={`${floor.label} ${room.name} 수용 단위`}
                            style={{ ...input, flex: "none", width: 66 }}
                          />
                        </label>
                      </div>

                      <label style={{ ...fieldLabel, marginTop: 8 }}>
                        비품 (쉼표로 구분)
                        <input
                          value={draft.facilities}
                          onChange={(e) => update(room.id, { facilities: e.target.value })}
                          placeholder="예: 빔프로젝터, 화이트보드"
                          aria-label={`${floor.label} ${room.name} 비품`}
                          style={input}
                        />
                      </label>

                      <label style={{ ...fieldLabel, marginTop: 8 }}>
                        안내 문구
                        <input
                          value={draft.note}
                          onChange={(e) => update(room.id, { note: e.target.value })}
                          placeholder="신청 화면에 함께 보여줄 안내 (없으면 비워 두세요)"
                          maxLength={ROOM_NOTE_MAX}
                          aria-label={`${floor.label} ${room.name} 안내 문구`}
                          style={input}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* 발문 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            background: "var(--card)",
            borderTop: "1px solid var(--hairline)",
            flexShrink: 0,
            paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          }}
        >
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>
            {changedCount > 0 ? `${changedCount}곳 수정됨` : "수정한 내용 없음"}
          </span>
          <button type="button" onClick={onClose} style={secondaryBtn}>취소</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}
          >
            <Save size={15} strokeWidth={2} />
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function StateButton({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone: "open" | "closed";
  onClick: () => void;
}) {
  const accent = tone === "open" ? "var(--success)" : "var(--ink-soft)";
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        minHeight: 36,
        padding: "6px 12px",
        borderRadius: 999,
        border: `1.5px solid ${active ? accent : "var(--hairline)"}`,
        background: active ? `color-mix(in srgb, ${accent} 14%, var(--card))` : "var(--card)",
        color: active ? accent : "var(--ink-soft)",
        fontSize: 12.5,
        fontWeight: active ? 800 : 600,
        fontFamily: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

const hint: React.CSSProperties = {
  margin: "0 0 14px",
  fontSize: 12,
  lineHeight: 1.6,
  color: "var(--ink-soft)",
  fontWeight: 500,
};
const errorBanner: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  padding: "10px 12px",
  borderRadius: 10,
  marginBottom: 12,
  background: "var(--danger-soft)",
  color: "var(--danger)",
  fontSize: 12.5,
  fontWeight: 600,
  lineHeight: 1.5,
};
const floorHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};
const floorChip: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 8,
  background: "color-mix(in srgb, var(--accent) 14%, var(--card))",
  color: "var(--accent-strong)",
  fontSize: 12.5,
  fontWeight: 800,
};
const row: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "var(--card)",
  border: "1px solid var(--hairline)",
};
const input: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "10px 12px",
  minHeight: 42,
  fontSize: 14,
  fontWeight: 600,
  color: "var(--ink)",
  background: "var(--card)",
  border: "1.5px solid var(--hairline)",
  borderRadius: 10,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minWidth: 0,
  flex: 1,
  fontSize: 11,
  fontWeight: 700,
  color: "var(--ink-faint)",
};
const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  borderRadius: 10,
  background: "var(--bg-soft)",
  border: "none",
  color: "var(--ink-mid)",
  cursor: "pointer",
  flexShrink: 0,
};
const secondaryBtn: React.CSSProperties = {
  minHeight: 42,
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  background: "var(--card)",
  color: "var(--ink-mid)",
  fontSize: 13.5,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 42,
  padding: "10px 18px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "var(--card)",
  fontSize: 13.5,
  fontWeight: 800,
  fontFamily: "inherit",
  cursor: "pointer",
};
