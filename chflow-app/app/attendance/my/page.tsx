"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, CheckCircle2, Clock3, MapPin, RefreshCw, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

type AttendanceStatus = {
  ok: boolean;
  error?: string;
  serverTime: string;
  localDate: string;
  memberLinked: boolean;
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

  const load = useCallback(async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }
    const response = await fetch("/api/mobile/attendance-status", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as AttendanceStatus | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "자동출석 상태를 확인하지 못했습니다.");
    } else {
      setData(payload);
      setError(null);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0);
    const statusTimer = window.setInterval(() => void load(), 10_000);
    const clockTimer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(statusTimer);
      window.clearInterval(clockTimer);
    };
  }, [load]);

  const elapsedSeconds = useMemo(() => {
    if (!data?.candidate?.entered_at) return 0;
    return Math.max(0, Math.floor((now.getTime() - Date.parse(data.candidate.entered_at)) / 1000));
  }, [data?.candidate?.entered_at, now]);

  const beginSetup = () => {
    const nativeWindow = window as typeof window & {
      ReactNativeWebView?: { postMessage: (message: string) => void };
    };
    if (!nativeWindow.ReactNativeWebView) {
      setNotice("스마트명성 Android 앱에서 이 버튼을 사용해 주세요.");
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
  const statusLabel = isAutomatic
    ? "자동출석 완료"
    : isAttended
      ? "출석 확인 완료"
      : isCandidate
        ? "교회 체류 확인 중"
        : "오늘은 아직 미출석";
  const statusColor = isAttended ? "#16794f" : isCandidate ? "#a35b00" : "var(--ink-mid)";

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
            <Row label="교회 진입 시각" value={time(data?.candidate?.entered_at)} />
            <Row
              label="현재 체류시간"
              value={data?.candidate ? `${Math.floor(elapsedSeconds / 60)}분 ${elapsedSeconds % 60}초` : "—"}
            />
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
