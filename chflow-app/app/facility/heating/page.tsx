"use client";

/* ============================================================
   난방 원격관리 (UTH-170WF) — 맵 기반

   비전센터 층별 도면에서 패널이 설치된 방을 눌러 상태 확인·제어.
   도면은 시설물신청 config(lib/facility) 를 재사용하며, 폴리곤(poly/outline)이
   config 에 들어오면 실제 형상으로 자동 전환된다.
   실제 TCP 통신은 서버(app/api/facility/thermostat/*)에서만. MAC/포트/패킷 비노출.
   설치 예정(planned) 방은 지도에 표시만 되고 제어는 실기기 등록 후 활성화된다.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, Power, RefreshCw, ThermometerSun, Wifi, WifiOff, Lock, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { findFloor, type FacilityFloor } from "@/lib/facility/facility-map-config";
import HeatingFloorPlan, { type RoomDeviceView } from "@/components/heating/HeatingFloorPlan";

const BUILDING = "vision";

interface PublicDevice {
  id: string;
  facilityId: string;
  roomNo: string;
  label: string;
  dept?: string;
  floor: number;
  controlEnabled: boolean;
  planned?: boolean;
}
interface DisplayState {
  powerOn: boolean;
  run: boolean;
  lock: boolean;
  mode: "temp" | "level";
  curTemp: number | null;
  setTemp: number | null;
  timeCycle: number | null;
  heatLevel: string | null;
  error: { overheat: boolean; sensorOpen: boolean; sensorShort: boolean; any: boolean };
}
interface StatusResult {
  online: boolean;
  planned?: boolean;
  state: DisplayState | null;
  error?: string;
  updatedAt?: string;
}

export default function HeatingPage() {
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [devices, setDevices] = useState<PublicDevice[]>([]);
  const [statuses, setStatuses] = useState<Record<string, StatusResult>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [activeFloor, setActiveFloor] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setToken(data.session?.access_token ?? null);
      setAuthReady(true);
    })();
  }, []);

  const authFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const res = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
      });
      return res.json();
    },
    [token]
  );

  const loadStatus = useCallback(
    async (deviceId: string) => {
      const j = await authFetch("/api/facility/thermostat/status", { method: "POST", body: JSON.stringify({ deviceId }) });
      setStatuses((s) => ({
        ...s,
        [deviceId]: j.ok
          ? { online: j.online, planned: j.planned, state: j.state, error: j.error, updatedAt: j.updatedAt }
          : { online: false, state: null, error: j.error },
      }));
    },
    [authFetch]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    const j = await authFetch("/api/facility/thermostat/devices");
    if (!j.ok) {
      setNote(j.error || "장비 목록을 불러오지 못했습니다");
      setDevices([]);
      setLoading(false);
      return;
    }
    const list = j.devices as PublicDevice[];
    setDevices(list);
    const floors = Array.from(new Set(list.map((d) => d.floor))).sort((a, b) => a - b);
    setActiveFloor((prev) => prev ?? floors[floors.length - 1] ?? null); // 기본: 가장 높은 층(테스트기 있는 4층)
    setSelectedId((prev) => prev ?? list.find((d) => !d.planned)?.id ?? list[0]?.id ?? null);
    setLoading(false);
    await Promise.all(list.map((d) => loadStatus(d.id)));
  }, [authFetch, loadStatus]);

  useEffect(() => {
    if (authReady && token) loadAll();
    else if (authReady && !token) setLoading(false);
  }, [authReady, token, loadAll]);

  const act = useCallback(
    async (deviceId: string, payload: Record<string, unknown>, okMsg?: string) => {
      setBusy(deviceId);
      setNote(null);
      const j = await authFetch("/api/facility/thermostat/control", { method: "POST", body: JSON.stringify({ deviceId, ...payload }) });
      if (j.ok) {
        setStatuses((s) => ({ ...s, [deviceId]: { online: true, state: j.after, updatedAt: j.updatedAt } }));
        if (okMsg) setNote(okMsg);
      } else {
        setNote(j.error || "제어 실패");
      }
      setBusy(null);
    },
    [authFetch]
  );

  const floors = useMemo(() => Array.from(new Set(devices.map((d) => d.floor))).sort((a, b) => a - b), [devices]);
  const floorConfig: FacilityFloor | null = useMemo(
    () => (activeFloor != null ? findFloor(BUILDING, activeFloor) : null),
    [activeFloor]
  );

  const deviceByRoom = useMemo(() => {
    const map: Record<string, RoomDeviceView> = {};
    for (const d of devices) {
      if (d.floor !== activeFloor) continue;
      const st = statuses[d.id];
      map[d.facilityId] = {
        planned: d.planned || st?.planned,
        online: st?.online,
        powerOn: st?.state?.powerOn,
        run: st?.state?.run,
      };
    }
    return map;
  }, [devices, statuses, activeFloor]);

  const selected = devices.find((d) => d.id === selectedId) ?? null;
  const selSt = selectedId ? statuses[selectedId] : undefined;

  if (loading || !authReady) return <LoadingView label="난방 장비를 불러오는 중" />;
  if (!token)
    return (
      <div className="mx-auto max-w-md p-6">
        <EmptyState message="로그인이 필요합니다" hint="난방 제어는 로그인 후 이용할 수 있습니다." />
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16" style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 12px)" }}>
      <div className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-2">
          <HeaderLogo />
          <h1 className="text-lg font-bold text-[var(--ink)]">난방 원격관리</h1>
        </div>
        <button type="button" onClick={loadAll} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--ink-mid)]">
          <RefreshCw size={15} /> 새로고침
        </button>
      </div>

      <p className="mb-3 text-sm text-[var(--ink-soft)]">비전센터 도면에서 패널이 설치된 방을 눌러 상태를 확인하고 제어합니다. 초록=가동, 회색=꺼짐, 주황=난방중, 노랑테=설치예정.</p>

      {note && <div className="mb-3 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--ink)]">{note}</div>}

      {/* 층 탭 */}
      {floors.length > 0 && (
        <div className="mb-3 flex gap-2">
          {floors.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setActiveFloor(f)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                activeFloor === f ? "bg-[var(--accent)] text-[var(--card)]" : "border border-[var(--hairline)] bg-[var(--card)] text-[var(--ink-mid)]"
              }`}
            >
              {f}층
            </button>
          ))}
        </div>
      )}

      {/* 도면 */}
      {floorConfig ? (
        <div className="mb-4 rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-3 shadow-sm">
          <HeatingFloorPlan floor={floorConfig} deviceByRoom={deviceByRoom} selectedId={selected?.facilityId ?? null} onSelect={(roomId) => {
            const dev = devices.find((d) => d.facilityId === roomId);
            if (dev) setSelectedId(dev.id);
          }} />
        </div>
      ) : (
        <EmptyState message="도면을 불러올 수 없습니다" />
      )}

      {/* 선택한 방 제어 패널 */}
      {selected ? (
        <DeviceCard device={selected} st={selSt} busy={busy === selected.id} act={act} reload={() => loadStatus(selected.id)} />
      ) : (
        <EmptyState message="도면에서 방을 선택하세요" />
      )}
    </div>
  );
}

function DeviceCard({
  device,
  st,
  busy,
  act,
  reload,
}: {
  device: PublicDevice;
  st: StatusResult | undefined;
  busy: boolean;
  act: (deviceId: string, payload: Record<string, unknown>, okMsg?: string) => void;
  reload: () => void;
}) {
  const s = st?.state ?? null;
  const online = st?.online ?? false;
  const planned = device.planned || st?.planned;

  return (
    <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-bold text-[var(--ink)]">{device.roomNo}호</span>
            <span className="text-sm text-[var(--ink-mid)]">{device.label}</span>
          </div>
          {device.dept && <span className="text-xs text-[var(--ink-faint)]">{device.dept}</span>}
        </div>
        {planned ? (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-[var(--brass)]" style={{ background: "color-mix(in srgb, var(--brass) 16%, transparent)" }}>
            <MapPin size={13} /> 설치 예정
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${online ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>
            {online ? <Wifi size={13} /> : <WifiOff size={13} />} {online ? "온라인" : "오프라인"}
          </span>
        )}
      </div>

      {planned ? (
        <p className="mt-4 text-sm text-[var(--ink-soft)]">실기기 설치 후 원격 제어가 활성화됩니다. (현재는 배치도 표시만)</p>
      ) : (
        <>
          <div className="my-4 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${s?.powerOn ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--bg-soft)] text-[var(--ink-faint)]"}`}>
              <Power size={15} /> {s?.powerOn ? "전원 ON" : "전원 OFF"}
            </span>
            {s?.run && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--warning-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--warning)]">
                <Flame size={15} /> 난방 가동중
              </span>
            )}
            {s?.lock && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--bg-soft)] px-3 py-1.5 text-sm text-[var(--ink-mid)]">
                <Lock size={14} /> 잠금
              </span>
            )}
            {s?.error?.any && <span className="inline-flex items-center rounded-lg bg-[var(--danger-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--danger)]">오류</span>}
          </div>

          <div className="mb-4 flex items-center gap-6 text-sm">
            {s?.mode === "temp" && (
              <>
                <div className="flex items-center gap-1.5 text-[var(--ink-mid)]">
                  <ThermometerSun size={16} /> 현재 <span className="font-mono text-base font-bold text-[var(--ink)]">{s.curTemp ?? "—"}°C</span>
                </div>
                <div className="text-[var(--ink-mid)]">설정 <span className="font-mono text-base font-bold text-[var(--ink)]">{s.powerOn ? `${s.setTemp}°C` : "OFF"}</span></div>
              </>
            )}
            {s?.mode === "level" && (
              <>
                <div className="text-[var(--ink-mid)]">반복주기 <span className="font-mono text-base font-bold text-[var(--ink)]">{s.timeCycle}</span></div>
                <div className="text-[var(--ink-mid)]">난방단수 <span className="font-mono text-base font-bold text-[var(--ink)]">{s.powerOn ? s.heatLevel : "OFF"}</span></div>
              </>
            )}
            {!s && <span className="text-[var(--ink-faint)]">{st?.error || "상태 없음"}</span>}
          </div>

          {s?.powerOn && device.controlEnabled && online && (
            <div className="mb-3 flex items-center justify-between rounded-xl border border-[var(--hairline)] px-3 py-2">
              <span className="text-sm text-[var(--ink-mid)]">{s.mode === "temp" ? "설정온도" : "난방단수"}</span>
              <div className="flex items-center gap-3">
                <button type="button" disabled={busy} onClick={() => act(device.id, { action: "step", dir: "down" })} className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--bg-soft)] text-lg font-bold text-[var(--ink)] disabled:opacity-40" aria-label="내리기">−</button>
                <span className="min-w-[52px] text-center font-mono text-lg font-bold text-[var(--ink)]">{s.mode === "temp" ? `${s.setTemp}°C` : s.heatLevel}</span>
                <button type="button" disabled={busy} onClick={() => act(device.id, { action: "step", dir: "up" })} className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--bg-soft)] text-lg font-bold text-[var(--ink)] disabled:opacity-40" aria-label="올리기">+</button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" disabled={busy || !online || s?.powerOn === true || !device.controlEnabled} onClick={() => act(device.id, { action: "power", on: true }, "전원 켜짐 완료")} className="flex-1 rounded-xl bg-[var(--success)] px-4 py-2.5 text-sm font-bold text-[var(--card)] disabled:opacity-40">
              {busy ? "처리중…" : "켜기"}
            </button>
            <button type="button" disabled={busy || !online || s?.powerOn === false || !device.controlEnabled} onClick={() => act(device.id, { action: "power", on: false }, "전원 꺼짐 완료")} className="flex-1 rounded-xl bg-[var(--bg-soft)] px-4 py-2.5 text-sm font-bold text-[var(--ink)] disabled:opacity-40">
              {busy ? "처리중…" : "끄기"}
            </button>
            <button type="button" disabled={busy || !online || !device.controlEnabled} onClick={() => act(device.id, { action: "lock", on: !s?.lock }, s?.lock ? "잠금 해제 완료" : "잠금 완료")} className="rounded-xl border border-[var(--hairline)] px-3 py-2.5 text-[var(--ink-mid)] disabled:opacity-40" aria-label={s?.lock ? "잠금 해제" : "잠금"}>
              <Lock size={16} />
            </button>
            <button type="button" onClick={reload} className="rounded-xl border border-[var(--hairline)] px-3 py-2.5 text-[var(--ink-mid)]" aria-label="상태 새로고침">
              <RefreshCw size={16} />
            </button>
          </div>
          {st?.updatedAt && <p className="mt-3 text-right text-xs text-[var(--ink-faint)]">조회 {new Date(st.updatedAt).toLocaleTimeString("ko-KR")}</p>}
        </>
      )}
    </div>
  );
}
