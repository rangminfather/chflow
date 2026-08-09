"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { LocateFixed, Save, MapPin, Trash2 } from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import { supabase } from "@/lib/supabase";

type Form = { name: string; latitude: string; longitude: string; radiusM: string; dwellMinutes: string; windowStart: string; windowEnd: string; isActive: boolean };
const initial: Form = { name: "본당", latitude: "", longitude: "", radiusM: "150", dwellMinutes: "5", windowStart: "07:00", windowEnd: "15:00", isActive: false };
type SavedLocation = { id: string; name: string; latitude: number; longitude: number; created_at: string; updated_at: string; isRegistered: boolean };

/** 네이티브가 보내는 단계·결과 이벤트. 구버전 앱은 kind 없이 {ok,...} 만 보낸다. */
type NativeLocationEvent = {
  kind?: "step" | "result";
  requestId?: string;
  stage?: string;
  guide?: string;
  ok?: boolean;
  latitude?: number;
  longitude?: number;
  accuracyM?: number | null;
  ageSeconds?: number;
  source?: "gps" | "last_known";
  error?: string;
};

const STAGE_LABEL: Record<string, string> = {
  message_received: "앱이 요청을 받았습니다.",
  services_checked: "기기 위치 서비스를 확인했습니다.",
  permission_requesting: "위치 권한을 확인하고 있습니다…",
  permission_result: "위치 권한 상태를 확인했습니다.",
  position_requesting: "GPS 위치를 받아오는 중입니다…",
  position_timeout: "GPS 응답이 늦어 최근 위치를 찾는 중입니다…",
  fallback_requesting: "마지막 확인 위치를 찾는 중입니다…",
  position_ok: "위치를 확인했습니다.",
  sent_to_web: "결과를 화면으로 보냈습니다.",
  error: "오류가 발생했습니다.",
};

/** 앱이 아예 응답하지 않는 경우를 대비한 웹 자체 감시 시간. 네이티브 최대 대기보다 길게 잡는다. */
const WEB_WATCHDOG_MS = 45_000;

/** 저장 직후 네이티브가 지오펜스를 재등록하고 현재 반경 안인지 판정한 결과 */
type GeofenceAppliedEvent = {
  registered?: boolean;
  inside?: boolean | null;
  distanceM?: number | null;
  radiusM?: number | null;
  enteredAt?: string | null;
  alreadyRecorded?: boolean;
  reason?: string;
  message?: string;
};

export default function AttendanceSettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<Form>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmLocate, setConfirmLocate] = useState(false);
  const [applying, setApplying] = useState(false);
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationBusyId, setLocationBusyId] = useState<string | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  /** 성공 안내는 2.5초 후 사라지는 토스트로, 오류는 사라지지 않는 안내문으로 구분한다. */
  const showToast = useCallback((text: string) => {
    setMessage(null);
    setToast(text);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);
  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);
  async function load() {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return;
    setLocationsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [geofenceResponse, locationsResponse] = await Promise.all([
        fetch("/api/attendance/geofence", { headers }),
        fetch("/api/attendance/geofence-locations", { headers }),
      ]);
      const geofencePayload = await geofenceResponse.json();
      const locationsPayload = await locationsResponse.json();
      if (!geofenceResponse.ok) throw new Error(geofencePayload.error || "자동출석 설정을 불러오지 못했습니다.");
      if (!locationsResponse.ok) throw new Error(locationsPayload.error || "저장된 위치를 불러오지 못했습니다.");
      if (geofencePayload.geofence) setForm({ name: geofencePayload.geofence.name, latitude: String(geofencePayload.geofence.latitude), longitude: String(geofencePayload.geofence.longitude), radiusM: String(geofencePayload.geofence.radius_m), dwellMinutes: String(Math.round(geofencePayload.geofence.dwell_seconds / 60)), windowStart: String(geofencePayload.geofence.window_start).slice(0, 5), windowEnd: String(geofencePayload.geofence.window_end).slice(0, 5), isActive: geofencePayload.geofence.is_active });
      setLocations(Array.isArray(locationsPayload.locations) ? locationsPayload.locations : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자동출석 설정을 불러오지 못했습니다.");
    } finally {
      setLocationsLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const receiveNativeLocation = (event: Event) => {
      const detail = (event as CustomEvent<NativeLocationEvent>).detail;
      if (!detail) return;

      // 단계 진행 상황 — 어디서 멈췄는지 화면에서 바로 보이게 한다.
      if (detail.kind === "step") {
        const stage = detail.stage || "";
        setStage(stage);
        const label = STAGE_LABEL[stage];
        if (label) setMessage(stage === "permission_result" && detail.guide ? `${label} — ${detail.guide}` : label);
        return;
      }

      // 최종 결과 (신규) 또는 구버전 앱의 {ok,...} 응답
      if (detail.kind === "result" || typeof detail.ok === "boolean") {
        clearWatchdog();
        setStage(null);
        if (detail.requestId) {
          const nativeWindow = window as typeof window & {
            ReactNativeWebView?: { postMessage: (message: string) => void };
          };
          nativeWindow.ReactNativeWebView?.postMessage(
            JSON.stringify({ type: "CHFLOW_LOCATION_ACK", requestId: detail.requestId }),
          );
        }
        if (!detail.ok || typeof detail.latitude !== "number" || typeof detail.longitude !== "number") {
          setMessage(detail.error || "현재 위치를 확인하지 못했습니다.");
          return;
        }
        setForm((current) => ({
          ...current,
          latitude: detail.latitude!.toFixed(6),
          longitude: detail.longitude!.toFixed(6),
        }));
        const accuracy = typeof detail.accuracyM === "number" ? ` (정확도 약 ${Math.round(detail.accuracyM)}m)` : "";
        if (detail.source === "last_known") {
          // 오래된 좌표는 사라지는 토스트로 넘기지 않고 출처·경과 시간을 계속 보여 준다.
          setToast(null);
          setMessage(`마지막 확인 위치를 입력했습니다${accuracy}. ${detail.ageSeconds ?? 0}초 전 기록이라 실외에서 다시 확인하시길 권합니다. 저장 버튼을 눌러 최종 반영해 주세요.`);
          return;
        }
        showToast(`현재 위치를 입력했습니다${accuracy}. 저장 버튼을 눌러 최종 반영해 주세요.`);
      }
    };
    // 저장 후 네이티브가 지오펜스를 재등록하고 즉시 진입 여부를 판정한 결과
    const receiveGeofenceApplied = (event: Event) => {
      const detail = (event as CustomEvent<GeofenceAppliedEvent>).detail;
      if (!detail) return;
      setApplying(false);
      setToast(null);

      // 재등록 실패 — DB 저장은 성공했음을 분명히 구분해 알린다.
      if (!detail.registered) {
        const reason = detail.message ? ` (${detail.message})` : "";
        setMessage(`교회 위치는 저장됐지만 이 기기의 자동출석 위치 적용에 실패했습니다. 앱을 다시 실행하거나 권한을 확인해 주세요.${reason}`);
        return;
      }

      // 재등록 성공. 현재 위치 판정 결과는 별개로 덧붙인다.
      let presence: string;
      if (detail.inside === null || detail.inside === undefined) {
        presence = " 다만 현재 위치를 확인하지 못해 교회 반경 안인지는 판정하지 못했습니다.";
      } else if (detail.inside === false) {
        const away = typeof detail.distanceM === "number" ? ` (약 ${Math.round(detail.distanceM)}m 떨어짐)` : "";
        presence = ` 현재는 교회 반경 밖입니다.${away}`;
      } else if (detail.enteredAt && !detail.alreadyRecorded) {
        presence = " 현재 교회 반경 안에 있어 진입 시각을 기록했습니다.";
      } else {
        presence = " 현재 교회 반경 안에 있습니다. 오늘 진입 기록이 이미 있어 그대로 유지했습니다.";
      }
      setMessage(`교회 위치를 저장하고 자동출석 위치를 새로 적용했습니다.${presence}`);
    };

    window.addEventListener("chflow-native-location", receiveNativeLocation);
    window.addEventListener("chflow-native-geofence-applied", receiveGeofenceApplied);
    return () => {
      window.removeEventListener("chflow-native-location", receiveNativeLocation);
      window.removeEventListener("chflow-native-geofence-applied", receiveGeofenceApplied);
      clearWatchdog();
    };
  }, [clearWatchdog, showToast]);
  // 좌표가 갑자기 바뀌는 것을 막기 위해 항상 확인창을 먼저 띄운다. (Android·iOS 동일 UX)
  const locate = () => setConfirmLocate(true);

  const runLocate = () => {
    setConfirmLocate(false);
    const nativeWindow = window as typeof window & {
      ReactNativeWebView?: { postMessage: (message: string) => void };
    };
    if (nativeWindow.ReactNativeWebView) {
      setMessage("휴대폰 GPS 위치를 확인하고 있습니다.");
      setStage("requested");
      // 앱이 어떤 이유로도 응답하지 않으면 화면이 계속 멈춰 있지 않도록 한다.
      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        setStage(null);
        setMessage("앱이 응답하지 않았습니다. 앱을 완전히 종료 후 다시 실행하거나, 위도·경도를 직접 입력해 주세요.");
      }, WEB_WATCHDOG_MS);
      nativeWindow.ReactNativeWebView.postMessage(JSON.stringify({
        type: "CHFLOW_GET_CURRENT_LOCATION",
      }));
      return;
    }
    if (!navigator.geolocation) {
      setMessage("현재 설치된 앱에서는 위치 기능을 사용할 수 없습니다. 최신 Android 앱으로 업데이트해 주세요.");
      return;
    }
    setMessage("현재 위치를 확인하고 있습니다.");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }));
        setMessage("현재 위치를 입력했습니다.");
      },
      () => setMessage("위치 권한을 허용한 뒤 다시 눌러 주세요."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const save = async (location?: SavedLocation) => {
    const latitudeText = location ? String(location.latitude) : form.latitude.trim();
    const longitudeText = location ? String(location.longitude) : form.longitude.trim();
    if (!latitudeText || !longitudeText) {
      setMessage("현재 위치를 먼저 입력해 주세요.");
      return;
    }
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
      setMessage("현재 위치 좌표가 올바르지 않습니다.");
      return;
    }

    setSaving(true);
    setMessage(null);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      setMessage("로그인이 필요합니다.");
      setSaving(false);
      return;
    }
    const response = await fetch("/api/attendance/geofence", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: location?.name ?? form.name,
        latitude,
        longitude,
        radiusM: Number(form.radiusM),
        dwellSeconds: Number(form.dwellMinutes) * 60,
        windowStart: form.windowStart,
        windowEnd: form.windowEnd,
        isActive: form.isActive,
        locationId: location?.id,
      }),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      setToast(null);
      setMessage(payload.error || "저장하지 못했습니다.");
      return;
    }
    await load();

    // 저장만으로는 기기에 등록된 지오펜스가 바뀌지 않는다. 앱에 재등록을 지시한다.
    const nativeWindow = window as typeof window & {
      ReactNativeWebView?: { postMessage: (message: string) => void };
    };
    if (!nativeWindow.ReactNativeWebView) {
      setToast(null);
      setMessage("자동출석 설정을 저장했습니다. 위치 감지를 새 좌표로 바꾸려면 스마트명성 앱에서 이 화면을 열고 저장해 주세요.");
      return;
    }
    setApplying(true);
    setToast(null);
    setMessage("저장했습니다. 자동출석 위치 감지를 새 좌표로 다시 등록하고 있습니다…");
    nativeWindow.ReactNativeWebView.postMessage(JSON.stringify({
      type: "CHFLOW_ATTENDANCE_APPLY_GEOFENCE",
    }));
  };
  const applyLocation = async (location: SavedLocation) => {
    if (location.isRegistered) return;
    if (!window.confirm(`"${location.name}"을 현재 자동출석 등록지점으로 지정할까요?\n다른 모바일 기기에도 적용되는 전역 설정입니다.`)) return;
    setForm((current) => ({ ...current, name: location.name, latitude: String(location.latitude), longitude: String(location.longitude) }));
    setLocationBusyId(location.id);
    try {
      await save(location);
    } finally {
      setLocationBusyId(null);
    }
  };
  const deleteLocation = async (location: SavedLocation) => {
    if (location.isRegistered) {
      setMessage("현재 등록지점은 먼저 다른 위치로 변경한 뒤 삭제해 주세요.");
      return;
    }
    if (!window.confirm(`"${location.name}" 저장 위치를 삭제할까요?`)) return;
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      setMessage("로그인이 필요합니다.");
      return;
    }
    setLocationBusyId(location.id);
    try {
      const response = await fetch(`/api/attendance/geofence-locations/${location.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || "저장 위치를 삭제하지 못했습니다.");
        return;
      }
      await load();
      showToast("저장 위치를 삭제했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 위치를 삭제하지 못했습니다.");
    } finally {
      setLocationBusyId(null);
    }
  };
  const set = (key: keyof Form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  return <><div className="app-subpage-header" style={subpageHeaderStyle}><HeaderLogo /><button className="app-header-back" onClick={() => router.push("/attendance")} style={headerBackStyle} aria-label="출석 현황으로">← 출석 현황</button><div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 16, fontWeight: 800, color: "var(--ink)" }}><MapPin size={18} strokeWidth={1.8} /> 자동출석 설정</div></div><main style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px 64px" }}><h1 style={{ margin: "22px 0 8px", fontSize: 30, letterSpacing: "-0.04em" }}>자동출석 설정</h1><p style={{ color: "var(--ink-mid)", fontSize: 14, lineHeight: 1.6 }}>교회 좌표와 운영 시간 안에서만 위치 후보를 수집합니다. 자동출석은 목회 참고용입니다.</p><section style={card}><label style={label}>위치 이름<input value={form.name} onChange={(e) => set("name", e.target.value)} style={input} /></label><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><label style={label}>위도<input inputMode="decimal" value={form.latitude} onChange={(e) => set("latitude", e.target.value)} style={input} /></label><label style={label}>경도<input inputMode="decimal" value={form.longitude} onChange={(e) => set("longitude", e.target.value)} style={input} /></label></div><button type="button" onClick={locate} style={secondary}><LocateFixed size={16} /> 현재 내 위치 적용</button><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}><label style={label}>반경(m)<input type="number" min="50" max="500" value={form.radiusM} onChange={(e) => set("radiusM", e.target.value)} style={input} /></label><label style={label}>최소 체류(분)<input type="number" min="5" max="60" value={form.dwellMinutes} onChange={(e) => set("dwellMinutes", e.target.value)} style={input} /></label></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}><label style={label}>시작<input type="time" value={form.windowStart} onChange={(e) => set("windowStart", e.target.value)} style={input} /></label><label style={label}>종료<input type="time" value={form.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} style={input} /></label></div><label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, fontSize: 14 }}><input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} /> 설정 활성화</label></section><section style={locationsCard}><div style={locationsHeader}><div><h2 style={locationsTitle}>저장된 GPS 위치</h2><p style={locationsDescription}>저장 후 목록에서 현재 자동출석 등록지점으로 지정할 수 있습니다.</p></div>{locationsLoading && <span style={locationsLoadingText}>불러오는 중...</span>}</div>{locations.length === 0 ? <p style={locationsEmpty}>저장된 GPS 위치가 없습니다. 위 위치를 저장하면 목록에 자동으로 추가됩니다.</p> : <div style={locationsList}>{locations.map((location) => <div key={location.id} style={locationRow}><div style={{ minWidth: 0 }}><div style={locationNameLine}><strong style={locationName}>{location.name}</strong>{location.isRegistered && <span style={registeredBadge}>현재 등록지점</span>}</div><div style={locationCoordinates}>{Number(location.latitude).toFixed(6)} · {Number(location.longitude).toFixed(6)}</div></div><div style={locationActions}>{location.isRegistered ? <span style={currentLocationText}>사용 중</span> : <button type="button" onClick={() => void applyLocation(location)} disabled={saving || applying || locationBusyId !== null} style={locationApplyButton}>등록지점으로 지정</button>}<button type="button" onClick={() => void deleteLocation(location)} disabled={location.isRegistered || saving || applying || locationBusyId !== null} style={locationDeleteButton} title={location.isRegistered ? "현재 등록지점은 삭제할 수 없습니다." : "저장 위치 삭제"}><Trash2 size={15} /> 삭제</button></div></div>)}</div>}</section>{message && <p role="status" style={{ color: "var(--ink-mid)", fontSize: 14 }}>{message}</p>}{stage && <p style={{ color: "var(--ink-soft)", fontSize: 12, margin: "4px 0 0" }}>진행 단계: {stage}</p>}<button type="button" onClick={() => void save()} disabled={saving || applying} style={primary}><Save size={16} /> {saving ? "저장 중..." : applying ? "위치 감지 등록 중..." : "저장"}</button></main>{confirmLocate && (
    <ModalBackdrop onClose={() => setConfirmLocate(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="locate-confirm-title" style={dialog}>
        <h2 id="locate-confirm-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>현재 위치를 적용하시겠습니까?</h2>
        <p style={{ margin: "10px 0 20px", color: "var(--ink-mid)", fontSize: 14, lineHeight: 1.6 }}>지금 휴대폰의 위치를 교회 위치로 입력합니다.</p>
        <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => setConfirmLocate(false)} style={dialogCancel}>취소</button>
          <button type="button" onClick={runLocate} style={dialogConfirm}>적용</button>
        </div>
      </div>
    </ModalBackdrop>
  )}{toast && <div role="status" aria-live="polite" style={toastStyle}>{toast}</div>}</>;
}

const card: CSSProperties = { marginTop: 24, padding: 20, border: "1px solid var(--hairline)", borderRadius: 18, background: "var(--card)" };
const locationsCard: CSSProperties = { marginTop: 16, padding: 20, border: "1px solid var(--hairline)", borderRadius: 18, background: "var(--card)" };
const locationsHeader: CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 };
const locationsTitle: CSSProperties = { margin: 0, color: "var(--ink)", fontSize: 18 };
const locationsDescription: CSSProperties = { margin: "6px 0 0", color: "var(--ink-mid)", fontSize: 13, lineHeight: 1.5 };
const locationsLoadingText: CSSProperties = { color: "var(--ink-soft)", fontSize: 12, whiteSpace: "nowrap" };
const locationsEmpty: CSSProperties = { margin: "18px 0 0", color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.5 };
const locationsList: CSSProperties = { display: "grid", gap: 10, marginTop: 18 };
const locationRow: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 0", borderTop: "1px solid var(--hairline)" };
const locationNameLine: CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 };
const locationName: CSSProperties = { color: "var(--ink)", fontSize: 14 };
const registeredBadge: CSSProperties = { padding: "3px 7px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 11, fontWeight: 700 };
const locationCoordinates: CSSProperties = { marginTop: 5, color: "var(--ink-soft)", fontSize: 12, fontVariantNumeric: "tabular-nums" };
const locationActions: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 7, flexShrink: 0 };
const locationApplyButton: CSSProperties = { border: "1px solid var(--hairline-strong)", borderRadius: 8, padding: "7px 9px", background: "var(--bg-soft)", color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600 };
const locationDeleteButton: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--hairline)", borderRadius: 8, padding: "7px 9px", background: "transparent", color: "var(--ink-soft)", cursor: "pointer", fontFamily: "inherit", fontSize: 12 };
const currentLocationText: CSSProperties = { color: "var(--accent)", fontSize: 12, fontWeight: 700 };
const label: CSSProperties = { display: "block", marginBottom: 14, color: "var(--ink-mid)", fontSize: 13 };
const input: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", marginTop: 7, padding: "10px 11px", border: "1px solid var(--hairline)", borderRadius: 9, background: "var(--paper)", color: "var(--ink)" };
const secondary: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--hairline)", borderRadius: 9, padding: "9px 12px", background: "var(--card)", color: "var(--ink)", cursor: "pointer" };
const primary: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, border: 0, borderRadius: 9, padding: "11px 16px", background: "var(--accent)", color: "var(--paper)", cursor: "pointer", fontWeight: 700 };

const dialog: CSSProperties = { width: "100%", maxWidth: 380, padding: 20, borderRadius: 16, border: "1px solid var(--hairline)", background: "var(--card)", boxShadow: "0 12px 40px rgba(26,22,18,.18)" };
const dialogCancel: CSSProperties = { border: "1px solid var(--hairline-strong)", borderRadius: 9, padding: "9px 15px", background: "var(--bg-soft)", color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", fontSize: 14 };
const dialogConfirm: CSSProperties = { border: 0, borderRadius: 9, padding: "9px 17px", background: "var(--accent)", color: "var(--paper)", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700 };
const toastStyle: CSSProperties = { position: "fixed", left: "50%", bottom: 32, transform: "translateX(-50%)", zIndex: 120, maxWidth: "min(560px, calc(100vw - 32px))", padding: "12px 18px", borderRadius: 12, background: "color-mix(in srgb, var(--ink) 88%, transparent)", color: "var(--paper)", fontSize: 14, lineHeight: 1.5, boxShadow: "0 8px 28px rgba(26,22,18,.24)", textAlign: "center" };

/* 하위 화면 공통 헤더 스타일 — /attendance 와 동일 규칙 */
const subpageHeaderStyle: CSSProperties = {
  background: "var(--card)",
  borderBottom: "1px solid var(--hairline)",
  padding: "12px 20px",
};

const headerBackStyle: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: "1px solid var(--hairline-strong)",
  background: "var(--bg-soft)",
  color: "var(--ink-mid)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
