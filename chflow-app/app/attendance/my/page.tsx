"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, CheckCircle2, Clock3, MapPin, RefreshCw, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { attendancePollingDelay } from "@/lib/pollingPolicies";
import { supabase } from "@/lib/supabase";

type AttendanceStatus = {
  ok: boolean;
  error?: string;
  serverTime: string;
  localDate: string;
  memberLinked: boolean;
  withinOperatingWindow: boolean;
  geofence: {
    name: string;
    radiusM: number;
    dwellSeconds: number;
    windowStart: string;
    windowEnd: string;
    timezone: string;
  } | null;
  candidate: {
    status: "candidate" | "confirmed" | "expired" | "rejected";
    entered_at: string;
    last_seen_at: string;
    dwell_seconds: number;
    updated_at: string;
  } | null;
  attendance: {
    source: "auto_geofence" | "manual" | "corrected";
    recorded_at: string;
  } | null;
};

type NativeDiagnostic = {
  code: string;
  message?: string;
  at: string;
  sessionStartedAt?: string;
  dwellSeconds?: number;
  requiredSeconds?: number;
  distanceM?: number;
  accuracyM?: number;
};

type NativeSnapshot = {
  platform: string;
  foregroundPermission: string;
  backgroundPermission: string;
  geofencingStarted: boolean;
  session: {
    enteredAt: string;
    status: "open" | "closed";
    localDate: string;
    elapsedSeconds: number;
    pendingSubmit: boolean;
    lastSubmitError?: string;
  } | null;
  lastDiagnostic: NativeDiagnostic | null;
};

/** 네이티브가 보고한 사유 코드를 사람이 읽을 수 있는 문장으로 바꾼다. */
const DIAGNOSTIC_LABEL: Record<string, string> = {
  no_geofence: "관리자가 설정한 자동출석 위치를 찾지 못했습니다.",
  config_fetch_failed: "자동출석 설정을 내려받지 못했습니다.",
  config_changed: "자동출석 설정이 바뀌어 체류 기록을 새로 시작합니다.",
  foreground_denied: "위치 권한(앱 사용 중)이 허용되지 않았습니다.",
  background_denied: "위치 권한 '항상 허용'이 필요합니다.",
  geofencing_start_failed: "위치 감지를 시작하지 못했습니다.",
  geofencing_started: "교회 위치 감지를 시작했습니다.",
  geofencing_stopped: "교회 위치 감지를 중지했습니다.",
  outside_window: "자동출석 운영시간이 아닙니다.",
  enter_new: "교회 반경 진입을 새로 기록했습니다.",
  enter_kept: "이미 기록된 진입 시각을 유지했습니다.",
  exit_closed: "교회 반경을 벗어나 체류 기록을 닫았습니다.",
  submit_failed: "서버로 진입 기록을 보내지 못했습니다. 앱을 다시 열면 재전송합니다.",
  submit_retried: "보내지 못했던 진입 기록을 다시 보냈습니다.",
  no_local_session: "진행 중인 체류 기록이 없습니다.",
  date_rolled: "날짜가 바뀌어 체류를 새로 시작합니다.",
  session_expired: "체류 기록이 오래되어 새로 시작합니다.",
  dwell_short: "최소 체류시간이 아직 지나지 않았습니다.",
  position_failed: "현재 위치를 확인하지 못했습니다.",
  outside_radius: "현재 위치가 교회 인정 반경 밖입니다.",
  confirm_failed: "자동출석 확정에 실패했습니다.",
  confirmed: "자동출석을 기록했습니다.",
  already_attended: "오늘 출석이 이미 기록되어 있습니다.",
  candidate_closed: "오늘 후보가 이미 처리되었습니다.",
  task_error: "위치 이벤트 처리 중 오류가 발생했습니다.",
};

const PERMISSION_LABEL: Record<string, string> = {
  granted: "허용",
  denied: "거부",
  undetermined: "미결정",
  unknown: "확인 불가",
};

function time(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function MyAttendancePage() {
  const router = useRouter();
  const [data, setData] = useState<AttendanceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [snapshot, setSnapshot] = useState<NativeSnapshot | null>(null);
  const [diagnostic, setDiagnostic] = useState<NativeDiagnostic | null>(null);
  const mountedRef = useRef(false);
  const statusRef = useRef<AttendanceStatus | null>(null);
  const statusRequestInFlightRef = useRef(false);

  const load = useCallback(async (): Promise<AttendanceStatus | null> => {
    if (statusRequestInFlightRef.current) return statusRef.current;
    statusRequestInFlightRef.current = true;
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        router.replace("/login");
        return null;
      }
      const response = await fetch("/api/mobile/attendance-status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as AttendanceStatus | null;
      if (!response.ok || !payload?.ok) {
        if (mountedRef.current) {
          setError(payload?.error || "자동출석 상태를 확인하지 못했습니다.");
        }
        return null;
      }
      statusRef.current = payload;
      if (mountedRef.current) {
        setData(payload);
        setError(null);
      }
      return payload;
    } catch {
      if (mountedRef.current) setError("자동출석 상태를 확인하지 못했습니다.");
      return null;
    } finally {
      statusRequestInFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    mountedRef.current = true;
    let stopped = false;
    let statusTimer: number | null = null;

    const clearStatusTimer = () => {
      if (statusTimer) window.clearTimeout(statusTimer);
      statusTimer = null;
    };

    const schedule = (status: AttendanceStatus | null) => {
      clearStatusTimer();
      if (stopped || document.visibilityState !== "visible") return;
      const delay = attendancePollingDelay(status);
      if (delay === null) return;
      statusTimer = window.setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      const next = await load();
      if (!stopped) schedule(next ?? statusRef.current);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearStatusTimer();
        return;
      }
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisibilityChange);
    const clockTimer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      stopped = true;
      mountedRef.current = false;
      clearStatusTimer();
      window.clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  // 네이티브(앱) 쪽 진단 상태 — 권한·지오펜스 등록·전송 실패를 화면에 드러낸다.
  useEffect(() => {
    const nativeWindow = window as typeof window & {
      ReactNativeWebView?: { postMessage: (message: string) => void };
    };

    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{
        kind?: string;
        snapshot?: NativeSnapshot;
        diagnostic?: NativeDiagnostic;
        message?: string;
      }>).detail;
      if (detail?.kind === "snapshot" && detail.snapshot) {
        setSnapshot(detail.snapshot);
        if (detail.snapshot.lastDiagnostic) setDiagnostic(detail.snapshot.lastDiagnostic);
        return;
      }
      if (detail?.kind === "diagnostic" && detail.diagnostic) {
        setDiagnostic(detail.diagnostic);
        return;
      }
      if (detail?.kind === "snapshot-error") {
        setDiagnostic({ code: "task_error", message: detail.message, at: new Date().toISOString() });
      }
    };

    window.addEventListener("chflow-native-attendance", receive);
    const ask = () => nativeWindow.ReactNativeWebView?.postMessage(
      JSON.stringify({ type: "CHFLOW_ATTENDANCE_DIAGNOSE" }),
    );
    let timer: number | null = null;
    const stopPolling = () => {
      if (timer) window.clearInterval(timer);
      timer = null;
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState !== "visible") return;
      ask();
      timer = window.setInterval(ask, 10_000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") startPolling();
      else stopPolling();
    };
    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("chflow-native-attendance", receive);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopPolling();
    };
  }, []);

  const elapsedSeconds = useMemo(() => {
    if (!data?.candidate?.entered_at) return 0;
    return Math.max(0, Math.floor((now.getTime() - Date.parse(data.candidate.entered_at)) / 1000));
  }, [data?.candidate?.entered_at, now]);

  // 서버 candidate.entered_at 은 '당일 최초 진입'이고 이탈해도 지워지지 않는다.
  // 앱이 현재 세션 상태를 알려주면 그 값을 기준으로 삼아, 반경 밖에서 카운터가 계속 도는 것을 막는다.
  const nativeSession = snapshot?.session ?? null;
  const nativeSessionOpen = nativeSession?.status === "open";
  const enteredAtLabel = snapshot
    ? (nativeSessionOpen ? time(nativeSession!.enteredAt) : "—")
    : time(data?.candidate?.entered_at);
  const dwellLabel = snapshot
    ? (nativeSessionOpen
      ? `${Math.floor(nativeSession!.elapsedSeconds / 60)}분 ${nativeSession!.elapsedSeconds % 60}초`
      : "—")
    : (data?.candidate ? `${Math.floor(elapsedSeconds / 60)}분 ${elapsedSeconds % 60}초` : "—");

  const beginSetup = () => {
    const nativeWindow = window as typeof window & {
      ReactNativeWebView?: { postMessage: (message: string) => void };
    };
    if (!nativeWindow.ReactNativeWebView) {
      setNotice("스마트명성 앱(Android·iOS)에서 이 버튼을 사용해 주세요.");
      return;
    }
    nativeWindow.ReactNativeWebView.postMessage(JSON.stringify({
      type: "CHFLOW_ATTENDANCE_SETUP",
    }));
    setNotice("휴대폰 안내창에서 위치정보 사용 여부를 선택해 주세요.");
  };

  const isAutomatic = data?.attendance?.source === "auto_geofence";
  const isAttended = Boolean(data?.attendance);
  const isCandidate = Boolean(data?.candidate) && !isAttended;
  // 앱이 세션을 닫았다면(이탈·확정·만료) 체류 확인 중이라고 표시하지 않는다.
  const outsideNow = Boolean(snapshot) && !nativeSessionOpen && isCandidate;
  const statusLabel = isAutomatic
    ? "자동출석 완료"
    : isAttended
      ? "출석 확인 완료"
      : outsideNow
        ? "교회 반경 밖"
        : isCandidate
          ? "교회 체류 확인 중"
          : "오늘은 아직 미출석";
  const statusColor = isAttended ? "#16794f" : (isCandidate && !outsideNow) ? "#a35b00" : "var(--ink-mid)";

  return (
    <>
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button type="button" onClick={() => router.push("/home")} style={backStyle}>
          <ArrowLeft size={16} /> 홈
        </button>
        <strong style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <MapPin size={18} /> 내 자동출석
        </strong>
      </div>
      <main style={{ maxWidth: 680, margin: "0 auto", padding: "26px 18px 64px" }}>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 13 }}>화면 녹화용 확인 정보</p>
        <h1 style={{ margin: "6px 0 8px", fontSize: 30, letterSpacing: "-0.04em" }}>내 자동출석</h1>
        <p style={{ margin: 0, color: "var(--ink-mid)", fontSize: 14, lineHeight: 1.65 }}>
          앱이 닫혀 있거나 사용 중이 아닐 때 교회 반경 진입을 감지하고,
          최소 체류시간이 지나면 자동출석으로 기록합니다.
        </p>

        <section style={{ ...card, borderColor: isAttended ? "#77bd9e" : "var(--hairline)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, color: statusColor }}>
            {isAttended ? <CheckCircle2 size={22} /> : <Clock3 size={22} />}
            <strong style={{ fontSize: 20 }}>{loading ? "확인 중…" : statusLabel}</strong>
          </div>
          <dl style={details}>
            <Row label="현재 시각" value={time(now.toISOString())} />
            <Row label="출석 날짜" value={data?.localDate || "—"} />
            <Row label="교회 진입 시각" value={enteredAtLabel} />
            <Row label="현재 체류시간" value={dwellLabel} />
            <Row
              label="자동출석 완료 시각"
              value={time(data?.attendance?.recorded_at)}
              accent={isAutomatic}
            />
          </dl>
        </section>

        <section style={card}>
          <h2 style={sectionTitle}>자동출석 기준</h2>
          {data?.geofence ? (
            <dl style={details}>
              <Row label="출석 위치" value={data.geofence.name} />
              <Row label="인정 반경" value={`${data.geofence.radiusM}m`} />
              <Row label="최소 체류" value={`${Math.round(data.geofence.dwellSeconds / 60)}분`} />
              <Row label="운영시간" value={`${data.geofence.windowStart}–${data.geofence.windowEnd}`} />
            </dl>
          ) : (
            <p style={warning}>관리자가 자동출석 위치를 아직 설정하지 않았습니다.</p>
          )}
        </section>

        {snapshot && (
          <section style={card}>
            <h2 style={sectionTitle}>기기 상태 (진단)</h2>
            {(
              <dl style={details}>
                <Row label="플랫폼" value={snapshot.platform} />
                <Row
                  label="위치 권한 (앱 사용 중)"
                  value={PERMISSION_LABEL[snapshot.foregroundPermission] || snapshot.foregroundPermission}
                />
                <Row
                  label="위치 권한 (항상 허용)"
                  value={PERMISSION_LABEL[snapshot.backgroundPermission] || snapshot.backgroundPermission}
                  accent={snapshot.backgroundPermission === "granted"}
                />
                <Row
                  label="교회 위치 감지"
                  value={snapshot.geofencingStarted ? "등록됨" : "등록 안 됨"}
                  accent={snapshot.geofencingStarted}
                />
                <Row
                  label="기기 체류 시작"
                  value={snapshot.session?.status === "open" ? time(snapshot.session.enteredAt) : "—"}
                />
                <Row
                  label="기기 체류시간"
                  value={
                    snapshot.session?.status === "open"
                      ? `${Math.floor(snapshot.session.elapsedSeconds / 60)}분 ${snapshot.session.elapsedSeconds % 60}초`
                      : "—"
                  }
                />
                {snapshot.session?.pendingSubmit && (
                  <Row label="서버 전송" value="미완료 (앱 재실행 시 재전송)" />
                )}
              </dl>
            )}
            {diagnostic && (
              <p style={{ margin: "14px 0 0", color: "var(--ink-mid)", fontSize: 13, lineHeight: 1.6 }}>
                <strong style={{ color: "var(--ink)" }}>최근 상태 </strong>
                {time(diagnostic.at)} · {DIAGNOSTIC_LABEL[diagnostic.code] || diagnostic.code}
                {diagnostic.message ? ` (${diagnostic.message})` : ""}
                {typeof diagnostic.distanceM === "number"
                  ? ` · 거리 ${Math.round(diagnostic.distanceM)}m / 정확도 ${Math.round(diagnostic.accuracyM ?? 0)}m`
                  : ""}
              </p>
            )}
            {snapshot?.session?.lastSubmitError && (
              <p role="alert" style={warning}>전송 실패 사유: {snapshot.session.lastSubmitError}</p>
            )}
          </section>
        )}

        {data?.geofence && !data.withinOperatingWindow && (
          <p style={warning}>
            현재는 자동출석 운영시간 밖입니다. 이 시간에는 교회 반경 안에 있어도 진입시각을 기록하지 않습니다.
          </p>
        )}
        {!data?.memberLinked && (
          <p style={warning}>현재 계정과 연결된 성도 정보를 찾지 못했습니다.</p>
        )}
        {error && <p role="alert" style={warning}>{error}</p>}
        {notice && <p role="status" style={{ color: "var(--ink-mid)", fontSize: 13 }}>{notice}</p>}

        <div style={{ display: "grid", gap: 9, marginTop: 18 }}>
          <button type="button" onClick={beginSetup} disabled={!data?.geofence} style={primary}>
            <Smartphone size={17} /> 위치 안내·권한 설정
          </button>
          <button type="button" onClick={() => void load()} style={secondary}>
            <RefreshCw size={17} /> 상태 새로고침
          </button>
        </div>
      </main>
    </>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 18 }}>
      <dt style={{ color: "var(--ink-soft)" }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: "right", fontWeight: accent ? 800 : 650, color: accent ? "#16794f" : "var(--ink)" }}>
        {value}
      </dd>
    </div>
  );
}

const headerStyle: CSSProperties = {
  background: "var(--card)",
  borderBottom: "1px solid var(--hairline)",
};
const backStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: 0,
  background: "transparent",
  color: "var(--ink-soft)",
};
const card: CSSProperties = {
  marginTop: 18,
  padding: 18,
  border: "1px solid var(--hairline)",
  borderRadius: 18,
  background: "var(--card)",
  boxShadow: "0 2px 14px rgba(26,22,18,.04)",
};
const details: CSSProperties = {
  display: "grid",
  gap: 11,
  margin: "18px 0 0",
  fontSize: 14,
};
const sectionTitle: CSSProperties = {
  margin: 0,
  fontSize: 17,
};
const primary: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  minHeight: 46,
  border: 0,
  borderRadius: 11,
  background: "var(--accent)",
  color: "white",
  fontWeight: 800,
};
const secondary: CSSProperties = {
  ...primary,
  border: "1px solid var(--hairline)",
  background: "var(--card)",
  color: "var(--ink)",
};
const warning: CSSProperties = {
  padding: 13,
  borderRadius: 10,
  background: "color-mix(in srgb, #d97706 11%, var(--card))",
  color: "var(--ink-mid)",
  fontSize: 13,
  lineHeight: 1.55,
};
