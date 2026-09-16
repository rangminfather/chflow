"use client";

/* ============================================================
   난방 원격관리 (UTH-170WF)

   가정 테스트 단계: 초등1부 402호 스테이징 장비로 전원 ON/OFF·상태 확인.
   실제 TCP 통신은 서버(app/api/facility/thermostat/*)에서만 수행하고,
   화면은 의미값(전원/난방/온도/단수)만 주고받는다. MAC·포트·패킷 비노출.
   교회 실기기 확장·온도추이 통계는 다음 단계.
   ============================================================ */

import { useCallback, useEffect, useState } from "react";
import { Flame, Power, RefreshCw, ThermometerSun, Wifi, WifiOff, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";

interface PublicDevice {
  id: string;
  facilityId: string;
  roomNo: string;
  label: string;
  dept?: string;
  controlEnabled: boolean;
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
      const j = await authFetch("/api/facility/thermostat/status", {
        method: "POST",
        body: JSON.stringify({ deviceId }),
      });
      if (j.ok) setStatuses((s) => ({ ...s, [deviceId]: { online: j.online, state: j.state, error: j.error, updatedAt: j.updatedAt } }));
      else setStatuses((s) => ({ ...s, [deviceId]: { online: false, state: null, error: j.error } }));
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
    setDevices(j.devices);
    setLoading(false);
    await Promise.all((j.devices as PublicDevice[]).map((d) => loadStatus(d.id)));
  }, [authFetch, loadStatus]);

  useEffect(() => {
    if (authReady && token) loadAll();
    else if (authReady && !token) setLoading(false);
  }, [authReady, token, loadAll]);

  const power = useCallback(
    async (deviceId: string, on: boolean) => {
      setBusy(deviceId);
      setNote(null);
      const j = await authFetch("/api/facility/thermostat/control", {
        method: "POST",
        body: JSON.stringify({ deviceId, action: "power", on }),
      });
      if (j.ok) {
        setStatuses((s) => ({ ...s, [deviceId]: { online: true, state: j.after, updatedAt: j.updatedAt } }));
        setNote(`전원 ${on ? "켜짐" : "꺼짐"} 완료`);
      } else {
        setNote(j.error || "제어 실패");
      }
      setBusy(null);
    },
    [authFetch]
  );

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
        <button
          type="button"
          onClick={loadAll}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--ink-mid)]"
        >
          <RefreshCw size={15} /> 새로고침
        </button>
      </div>

      <p className="mb-4 text-sm text-[var(--ink-soft)]">
        가정 테스트 단계입니다. 초등1부 402호 스테이징 장비로 전원 원격 켜기/끄기를 확인합니다.
      </p>

      {note && (
        <div className="mb-4 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--ink)]">
          {note}
        </div>
      )}

      {devices.length === 0 ? (
        <EmptyState message="등록된 난방 장비가 없습니다" />
      ) : (
        <div className="flex flex-col gap-4">
          {devices.map((d) => {
            const st = statuses[d.id];
            const online = st?.online ?? false;
            const s = st?.state ?? null;
            const isBusy = busy === d.id;
            return (
              <div key={d.id} className="rounded-2xl border border-[var(--hairline)] bg-[var(--card)] p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-bold text-[var(--ink)]">{d.roomNo}호</span>
                      <span className="text-sm text-[var(--ink-mid)]">{d.label}</span>
                    </div>
                    {d.dept && <span className="text-xs text-[var(--ink-faint)]">{d.dept}</span>}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      online
                        ? "bg-[var(--success-soft)] text-[var(--success)]"
                        : "bg-[var(--danger-soft)] text-[var(--danger)]"
                    }`}
                  >
                    {online ? <Wifi size={13} /> : <WifiOff size={13} />} {online ? "온라인" : "오프라인"}
                  </span>
                </div>

                <div className="my-4 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${
                      s?.powerOn
                        ? "bg-[var(--success-soft)] text-[var(--success)]"
                        : "bg-[var(--bg-soft)] text-[var(--ink-faint)]"
                    }`}
                  >
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
                  {s?.error?.any && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--danger-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--danger)]">
                      오류
                    </span>
                  )}
                </div>

                <div className="mb-4 flex items-center gap-6 text-sm">
                  {s?.mode === "temp" && (
                    <>
                      <div className="flex items-center gap-1.5 text-[var(--ink-mid)]">
                        <ThermometerSun size={16} /> 현재
                        <span className="font-mono text-base font-bold text-[var(--ink)]">{s.curTemp ?? "—"}°C</span>
                      </div>
                      <div className="text-[var(--ink-mid)]">
                        설정 <span className="font-mono text-base font-bold text-[var(--ink)]">{s.powerOn ? `${s.setTemp}°C` : "OFF"}</span>
                      </div>
                    </>
                  )}
                  {s?.mode === "level" && (
                    <>
                      <div className="text-[var(--ink-mid)]">
                        반복주기 <span className="font-mono text-base font-bold text-[var(--ink)]">{s.timeCycle}</span>
                      </div>
                      <div className="text-[var(--ink-mid)]">
                        난방단수 <span className="font-mono text-base font-bold text-[var(--ink)]">{s.powerOn ? s.heatLevel : "OFF"}</span>
                      </div>
                    </>
                  )}
                  {!s && <span className="text-[var(--ink-faint)]">{st?.error || "상태 없음"}</span>}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isBusy || !online || s?.powerOn === true || !d.controlEnabled}
                    onClick={() => power(d.id, true)}
                    className="flex-1 rounded-xl bg-[var(--success)] px-4 py-2.5 text-sm font-bold text-[var(--card)] disabled:opacity-40"
                  >
                    {isBusy ? "처리중…" : "켜기"}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || !online || s?.powerOn === false || !d.controlEnabled}
                    onClick={() => power(d.id, false)}
                    className="flex-1 rounded-xl bg-[var(--bg-soft)] px-4 py-2.5 text-sm font-bold text-[var(--ink)] disabled:opacity-40"
                  >
                    {isBusy ? "처리중…" : "끄기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => loadStatus(d.id)}
                    className="rounded-xl border border-[var(--hairline)] px-3 py-2.5 text-[var(--ink-mid)]"
                    aria-label="상태 새로고침"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
                {st?.updatedAt && (
                  <p className="mt-3 text-right text-xs text-[var(--ink-faint)]">
                    조회 {new Date(st.updatedAt).toLocaleTimeString("ko-KR")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
