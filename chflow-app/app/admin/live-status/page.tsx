"use client";

// 실시간 예배 감지·알림 점검 (관리자)
//
// 푸시가 안 왔을 때 어디가 막혔는지 한 화면에서 보게 하는 것이 목적이다.
// 확인 순서: ① 폴러가 도는지(마지막 확인 시각) ② 조회 오류 여부 ③ 감지·발송 이력
//
// 이력은 DB에 무기한 쌓인다(하루 평균 2행 수준). 화면은 기본 50건만 보여주고
// 목록 자체가 스크롤을 갖는다 — 페이지 세로 스크롤이 이력 개수만큼 길어지면
// 위쪽 진단 정보가 밀려나 정작 봐야 할 것이 안 보인다.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, RefreshCw, CheckCircle2, AlertTriangle, Radio,
  ChevronDown, ChevronRight, Inbox, ClipboardCopy,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import { WORSHIP_SCHEDULE_TEXT } from "@/lib/worshipSchedule";
import {
  buildLiveOAuthReport,
  evaluateLiveHealth,
  type LiveEnvSnapshot,
  type LiveHealth,
} from "@/lib/liveDiagnostics";
import YmdSelect from "@/components/YmdSelect";

type StatusRow = {
  is_live: boolean;
  video_id: string | null;
  title: string | null;
  started_at: string | null;
  checked_at: string | null;
  last_error: string | null;
  notified_video_id: string | null;
  notified_at: string | null;
  // OAuth 진단 (20260827160000 마이그레이션)
  oauth_last_ok_at: string | null;
  oauth_first_failed_at: string | null;
  oauth_last_failed_at: string | null;
  oauth_consecutive_failures: number | null;
  oauth_last_error_code: string | null;
  oauth_last_error_description: string | null;
  oauth_last_failed_stage: string | null;
  oauth_last_http_status: number | null;
};

type EventRow = {
  id: number;
  event: string;
  video_id: string | null;
  session_key: string | null;
  title: string | null;
  detail: string | null;
  recipients: number | null;
  created_at: string;
};

type HealthTone = "ok" | "warn" | "bad";

const SESSION_LABEL: Record<string, string> = {
  sun_2: "주일 2부",
  sun_3: "주일 3부",
  sun_4: "주일 4부",
  wed_pm: "수요예배",
};

const EVENT_LABEL: Record<string, { text: string; tone: "ok" | "warn" | "bad" | "mute" }> = {
  live_started: { text: "방송 시작 감지", tone: "ok" },
  live_ended: { text: "방송 종료", tone: "mute" },
  notified: { text: "알림 발송", tone: "ok" },
  notify_skipped: { text: "알림 생략", tone: "warn" },
  error: { text: "오류", tone: "bad" },
};

/** detail 에 그대로 들어오는 내부 코드는 사람이 읽는 말로 바꿔 보여준다 */
const DETAIL_LABEL: Record<string, string> = {
  live_started: "방송 시작 알림",
  live_ended: "방송 종료 알림",
};

const TONE_COLOR: Record<string, string> = {
  ok: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--danger)",
  mute: "var(--ink-faint)",
};

/** 다음 주기에서 정상 복구되는 YouTube 측 일시 장애는 설정 오류와 구분한다. */
function isTransientLiveError(detail: string | null | undefined) {
  const value = (detail || "").toLowerCase();
  return [
    "service is currently unavailable",
    "internal_failure",
    "backenderror",
    "internal error",
    "temporarily unavailable",
    "timeout",
    "timed out",
    "econnreset",
    "fetch failed",
    "youtube api 500",
    "youtube api 502",
    "youtube api 503",
    "youtube api 504",
    "livebroadcasts 500",
    "livebroadcasts 502",
    "livebroadcasts 503",
    "livebroadcasts 504",
  ].some((pattern) => value.includes(pattern));
}

function liveErrorLabel(detail: string | null | undefined) {
  const value = detail || "YouTube 조회 실패";
  if (value.includes("internal_failure")) {
    return "YouTube 인증 서버 일시 응답 없음 · 다음 점검에서 자동 재시도";
  }
  if (isTransientLiveError(value)) {
    return "YouTube 일시 응답 없음 · 다음 점검에서 자동 재시도";
  }
  return value;
}

/** 이력 필터 — key 별로 조회할 event 값. null 이면 전체 */
const FILTERS: { key: string; label: string; events: string[] | null }[] = [
  { key: "all", label: "전체", events: null },
  { key: "detect", label: "감지", events: ["live_started", "live_ended"] },
  { key: "notify", label: "발송", events: ["notified", "notify_skipped"] },
  { key: "error", label: "오류·재시도", events: ["error"] },
];

/** 기간 필터 — days 가 있으면 '지금부터 N일 전까지', custom 은 날짜 직접 입력 */
const PERIODS: { key: string; label: string; days: number | null; custom?: boolean }[] = [
  { key: "all", label: "전체", days: null },
  { key: "7d", label: "7일", days: 7 },
  { key: "30d", label: "30일", days: 30 },
  { key: "custom", label: "직접", days: null, custom: true },
];

/** 한 번에 보여주는 이력 건수 */
const PAGE = 50;

/** yyyy-mm-dd 입력값을 그 날의 시작(로컬)으로. 비면 null */
function dayStartISO(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).toISOString();
}

/** 종료일은 그 날을 포함해야 하므로 다음 날 0시 직전까지 본다 */
function dayEndISO(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).toISOString();
}

/** 폴러는 1분 간격이다. 이보다 한참 지났으면 폴러가 멈춘 것으로 본다. */
const POLLER_STALL_MS = 5 * 60 * 1000;

/** 이력 기간 직접 지정에서 고를 수 있는 연도 범위 — 서비스 시작 이후만 보여준다 */
const HISTORY_MIN_YEAR = new Date().getFullYear() - 2;

function fmt(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** 목록용 짧은 시각 — 08/19 20:33 (24시간제, 목록에서 열이 흔들리지 않게 직접 만든다) */
function fmtShort(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** now 를 인자로 받는다 — 렌더 중 Date.now() 를 부르면 순수성 규칙에 걸린다 */
function ago(value: string | null, nowMs: number) {
  if (!value) return "";
  const diff = nowMs - new Date(value).getTime();
  if (Number.isNaN(diff)) return "";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}

export default function AdminLiveStatusPage() {
  const router = useRouter();
  const [status, setStatus] = useState<StatusRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filterKey, setFilterKey] = useState("all");
  const [periodKey, setPeriodKey] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [envSnapshot, setEnvSnapshot] = useState<LiveEnvSnapshot | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  // 렌더 중 Date.now() 를 부르지 않기 위해 조회 시각을 상태로 들고 간다
  const [nowMs, setNowMs] = useState(0);
  const loadInFlightRef = useRef(false);
  // 자동 새로고침이 '더 보기'로 펼쳐 둔 범위·필터를 되돌리지 않도록 최신 값을 참조로 읽는다
  const viewRef = useRef({ filterKey, limit, periodKey, fromDate, toDate });
  viewRef.current = { filterKey, limit, periodKey, fromDate, toDate };

  const load = useCallback(async (isRefresh = false) => {
    if (loadInFlightRef.current || document.visibilityState !== "visible") return;
    loadInFlightRef.current = true;
    if (isRefresh) setRefreshing(true);
    try {
      const view = viewRef.current;
      const filterEvents = FILTERS.find((f) => f.key === view.filterKey)?.events ?? null;
      let eventQuery = supabase
        .from("youtube_live_events")
        .select("id, event, video_id, session_key, title, detail, recipients, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(0, Math.max(PAGE, view.limit) - 1);
      if (filterEvents) eventQuery = eventQuery.in("event", filterEvents);

      const period = PERIODS.find((p) => p.key === view.periodKey);
      if (period?.days) {
        const since = new Date(Date.now() - period.days * 24 * 60 * 60 * 1000).toISOString();
        eventQuery = eventQuery.gte("created_at", since);
      } else if (period?.custom) {
        const from = dayStartISO(view.fromDate);
        const to = dayEndISO(view.toDate);
        if (from) eventQuery = eventQuery.gte("created_at", from);
        if (to) eventQuery = eventQuery.lte("created_at", to);
      }

      const [{ data: s }, { data: e, count }] = await Promise.all([
        supabase
          .from("youtube_live_status")
          .select("is_live, video_id, title, started_at, checked_at, last_error, notified_video_id, notified_at, oauth_last_ok_at, oauth_first_failed_at, oauth_last_failed_at, oauth_consecutive_failures, oauth_last_error_code, oauth_last_error_description, oauth_last_failed_stage, oauth_last_http_status")
          .eq("id", "main")
          .maybeSingle(),
        eventQuery,
      ]);
      setNowMs(Date.now());
      setStatus((s as StatusRow) ?? null);
      setEvents((e as EventRow[]) ?? []);
      setTotal(count ?? 0);
    } finally {
      loadInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        router.replace("/login");
        return;
      }
      const { data: prof } = await supabase.rpc("get_my_status");
      const role = prof?.[0]?.role;
      if (!["admin", "office", "pastor"].includes(String(role))) {
        setDenied(true);
        setLoading(false);
        return;
      }
      // 진단 보조 정보(환경변수 설정 여부·배포 식별자)는 서버 route 만 알 수 있다.
      // 실패해도 화면은 그대로 동작한다 — 리포트에서 '확인 불가'로 표기된다.
      void (async () => {
        try {
          const token = sess.session?.access_token;
          if (!token) return;
          const res = await fetch("/api/live/diagnostics", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          if (!res.ok) return;
          const payload = await res.json() as { ok?: boolean; env?: LiveEnvSnapshot };
          if (payload?.ok && payload.env) setEnvSnapshot(payload.env);
        } catch {
          // 진단 보조 정보는 부가 기능이다
        }
      })();
      await load();
    })();
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState === "visible") {
        timer = setInterval(() => load(), 60_000);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        stopPolling();
        return;
      }
      void load();
      startPolling();
    };
    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, load]);

  /** 필터를 바꾸면 처음 50건부터 다시 본다 */
  /** 조건을 바꾸면 항상 처음 PAGE 건부터 다시 본다 */
  function applyView(next: Partial<typeof viewRef.current>) {
    viewRef.current = { ...viewRef.current, limit: PAGE, ...next };
    setLimit(viewRef.current.limit);
    if (next.filterKey !== undefined) setFilterKey(next.filterKey);
    if (next.periodKey !== undefined) setPeriodKey(next.periodKey);
    if (next.fromDate !== undefined) setFromDate(next.fromDate);
    if (next.toDate !== undefined) setToDate(next.toDate);
    void load(true);
  }

  function loadMore() {
    const next = limit + PAGE;
    setLimit(next);
    viewRef.current = { ...viewRef.current, limit: next };
    void load(true);
  }

  if (loading) return <LoadingView />;

  if (denied) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", color: "var(--ink-mid)", fontSize: 14 }}>
          관리자만 볼 수 있는 화면입니다.
          <div style={{ marginTop: 14 }}>
            <button onClick={() => router.push("/home")} style={btnStyle}>홈으로</button>
          </div>
        </div>
      </div>
    );
  }

  const checkedMs = status?.checked_at ? new Date(status.checked_at).getTime() : NaN;
  const pollerStalled = !status || Number.isNaN(checkedMs) || nowMs - checkedMs > POLLER_STALL_MS;
  const hasError = !!status?.last_error;
  const transientError = hasError && isTransientLiveError(status?.last_error);
  const needsAttention = pollerStalled || (hasError && !transientError);
  const healthTone: HealthTone = needsAttention ? "bad" : transientError ? "warn" : "ok";
  const healthLabel = needsAttention ? "점검 필요" : transientError ? "자동 재시도 중" : "정상";
  const hasMore = events.length < total;

  // 이상징후 판정과 리포트는 lib/liveDiagnostics 의 순수 함수가 담당한다 (테스트가 같은 함수를 검증)
  const health: LiveHealth = evaluateLiveHealth(status, nowMs || Date.now());
  const copyDiagnosticReport = async () => {
    const text = buildLiveOAuthReport({
      status,
      events,
      env: envSnapshot,
      health,
      nowMs: nowMs || Date.now(),
    });
    try {
      await navigator.clipboard.writeText(text);
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2200);
    } catch {
      // clipboard 미지원 브라우저 — 무시
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "'Noto Sans KR', sans-serif", paddingBottom: 40 }}>
      {/* 행마다 가로 스크롤이라 스크롤바가 50줄 보이면 지저분하다 — 막대만 숨기고 동작은 남긴다 */}
      <style>{`
        .live-evt-row { scrollbar-width: none; -ms-overflow-style: none; }
        .live-evt-row::-webkit-scrollbar { display: none; }
      `}</style>
      <header style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        background: "var(--card)", borderBottom: "1px solid var(--hairline)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <button onClick={() => router.push("/home")} style={btnStyle} aria-label="홈으로">
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span style={{ marginLeft: 4 }}>홈</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>실시간 예배 점검</div>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 1 }}>감지·알림이 정상인지 확인</div>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} style={btnStyle} aria-label="새로고침">
          <RefreshCw size={15} strokeWidth={1.9} style={refreshing ? { opacity: 0.45 } : undefined} />
        </button>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>

        {/* ── 이상징후 배너 ── 정상일 때는 화면을 늘리지 않는다 (아래 '지금 상태' 카드가 정상 표시를 담당) ── */}
        {health.severity !== "ok" && (
          <div
            role="status"
            style={{
              border: `1px solid ${health.severity === "critical" ? "color-mix(in srgb, var(--danger) 45%, transparent)" : "color-mix(in srgb, var(--warning) 45%, transparent)"}`,
              background: health.severity === "critical" ? "var(--danger-soft)" : "var(--warning-soft)",
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <AlertTriangle
                size={15}
                strokeWidth={2}
                color={health.severity === "critical" ? "var(--danger)" : "var(--warning)"}
              />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--ink)" }}>
                {health.severity === "critical" ? "예배 생방송 감지 점검 필요" : "YouTube OAuth 이상징후 감지"}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-mid)", lineHeight: 1.65 }}>
              {health.headline} — {health.serviceImpact}
            </div>

            <div style={{
              marginTop: 10, display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "4px 12px",
            }}>
              <DiagLine label="오류 코드" value={status?.oauth_last_error_code ?? "-"} />
              <DiagLine label="실패 단계" value={status?.oauth_last_failed_stage ?? "-"} />
              <DiagLine label="연속 실패" value={`${status?.oauth_consecutive_failures ?? 0}회`} />
              <DiagLine label="최초 발생" value={fmt(status?.oauth_first_failed_at ?? null)} />
              <DiagLine label="최근 발생" value={fmt(status?.oauth_last_failed_at ?? null)} />
              <DiagLine label="마지막 OAuth 정상" value={fmt(status?.oauth_last_ok_at ?? null)} />
              <DiagLine label="공개 API 키 경로" value={health.fallbackHealthy ? "정상" : "실패"} />
              <DiagLine label="마지막 확인" value={fmt(status?.checked_at ?? null)} />
            </div>

            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <button type="button" onClick={copyDiagnosticReport} style={btnStyle}>
                <ClipboardCopy size={14} strokeWidth={1.9} />
                <span style={{ marginLeft: 5 }}>Codex 상담용 리포트 복사</span>
              </button>
              <button type="button" onClick={() => setDiagOpen((v) => !v)} style={btnStyle}>
                {diagOpen ? "진단 상세 닫기" : "진단 상세 보기"}
              </button>
              {reportCopied && (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--success)" }}>
                  진단 리포트를 복사했습니다
                </span>
              )}
            </div>

            {diagOpen && (
              <div style={{
                marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--hairline)",
                fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.7,
              }}>
                {status?.oauth_last_error_description && (
                  <div>· 오류 설명: {status.oauth_last_error_description}</div>
                )}
                {status?.oauth_last_http_status != null && (
                  <div>· HTTP status: {status.oauth_last_http_status}</div>
                )}
                {health.findings.map((f) => <div key={f}>· {f}</div>)}
                <div style={{ marginTop: 6 }}>
                  · 환경변수: CLIENT_ID {envSnapshot?.youtube_oauth_client_id ?? "확인 불가"} /
                  {" "}SECRET {envSnapshot?.youtube_oauth_client_secret ?? "확인 불가"} /
                  {" "}REFRESH_TOKEN {envSnapshot?.youtube_oauth_refresh_token ?? "확인 불가"} /
                  {" "}API_KEY {envSnapshot?.youtube_api_key ?? "확인 불가"}
                </div>
                <div>· 배포 SHA: {envSnapshot?.deploy_sha?.slice(0, 12) ?? "확인 불가"}</div>
                <div style={{ marginTop: 6, color: "var(--ink-faint)" }}>
                  credential 값은 화면·리포트·로그 어디에도 포함되지 않습니다.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 지금 상태 ── 방송 여부와 진단 두 줄을 한 카드로 묶는다 ── */}
        <Card>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "11px 13px", borderRadius: 11,
            background: status?.is_live
              ? "color-mix(in srgb, var(--success) 12%, transparent)"
              : "var(--bg-soft)",
          }}>
            <span style={{
              width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
              background: status?.is_live ? "var(--success)" : "var(--ink-faint)",
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                {status?.is_live ? "방송 중 (ON AIR)" : "방송 없음 (OFF AIR)"}
              </div>
              {status?.is_live && status.title && (
                <div style={{ fontSize: 12, color: "var(--ink-mid)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {status.title}
                </div>
              )}
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700, flexShrink: 0,
              padding: "3px 8px", borderRadius: 999,
              background: healthTone === "ok"
                ? "color-mix(in srgb, var(--success) 15%, transparent)"
                : healthTone === "warn"
                  ? "color-mix(in srgb, var(--warning) 15%, transparent)"
                  : "color-mix(in srgb, var(--danger) 15%, transparent)",
              color: healthTone === "ok" ? "var(--success)" : healthTone === "warn" ? "var(--warning)" : "var(--danger)",
            }}>
              {healthLabel}
            </span>
          </div>

          <div style={{ marginTop: 4 }}>
            <Check
              tone={pollerStalled ? "bad" : "ok"}
              text={pollerStalled
                ? `감지기가 멈춘 것 같습니다 · 마지막 확인 ${status?.checked_at ? ago(status.checked_at, nowMs) : "기록 없음"}`
                : `감지기 정상 동작 중 · 마지막 확인 ${ago(status?.checked_at ?? null, nowMs)}`}
              hint="Cloudflare Worker 의 Cron Trigger(1분)와 LIVE_POLL_SECRET 을 확인하세요."
            />
            <Check
              tone={transientError ? "warn" : hasError ? "bad" : "ok"}
              text={transientError
                ? liveErrorLabel(status?.last_error)
                : hasError
                  ? `YouTube 조회 오류: ${status?.last_error ?? ""}`
                  : "YouTube 조회 오류 없음"}
              hint={transientError
                ? "기존 방송 상태는 유지되며 다음 1분 점검에서 자동으로 다시 확인합니다."
                : "YOUTUBE_API_KEY의 유효기간·쿼터·API 제한을 확인하세요."}
            />
          </div>

          <Disclosure open={detailOpen} onToggle={() => setDetailOpen((v) => !v)} label="세부 값">
            <Row label="마지막 확인" value={`${fmt(status?.checked_at ?? null)}  (${ago(status?.checked_at ?? null, nowMs)})`} />
            <Row label="현재 영상 ID" value={status?.video_id ?? "-"} />
            <Row label="방송 시작 시각" value={fmt(status?.started_at ?? null)} />
            <Row label="알림 보낸 영상" value={status?.notified_video_id ?? "-"} />
            <Row label="알림 발송 시각" value={`${fmt(status?.notified_at ?? null)}${status?.notified_at ? `  (${ago(status.notified_at, nowMs)})` : ""}`} />
            <Row label="마지막 조회 문제" value={status?.last_error ? liveErrorLabel(status.last_error) : "없음"} />
          </Disclosure>
        </Card>

        {/* ── 감지·발송 이력 ── 목록이 자체 스크롤을 갖는다 ── */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Radio size={14} strokeWidth={1.9} color="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", flex: 1, minWidth: 0 }}>
              감지·발송 이력
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 600, flexShrink: 0 }}>
              {events.length > 0 ? `${events.length} / ${total}건` : `${total}건`}
            </span>
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            {FILTERS.map((f) => (
              <SegButton
                key={f.key}
                label={f.label}
                active={f.key === filterKey}
                onClick={() => applyView({ filterKey: f.key })}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {PERIODS.map((p) => (
              <SegButton
                key={p.key}
                label={p.label}
                active={p.key === periodKey}
                onClick={() => applyView({ periodKey: p.key })}
              />
            ))}
          </div>

          {periodKey === "custom" && (
            <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
              <div>
                <div style={dateFieldLabelStyle}>시작일</div>
                <YmdSelect
                  groupLabel="조회 시작일"
                  value={fromDate}
                  onChange={(next) => applyView({ fromDate: next })}
                  minYear={HISTORY_MIN_YEAR}
                  selectStyle={dateInputStyle}
                />
              </div>
              <div>
                <div style={dateFieldLabelStyle}>종료일</div>
                <YmdSelect
                  groupLabel="조회 종료일"
                  value={toDate}
                  onChange={(next) => applyView({ toDate: next })}
                  minYear={HISTORY_MIN_YEAR}
                  selectStyle={dateInputStyle}
                />
              </div>
            </div>
          )}

          {events.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              padding: "26px 2px", color: "var(--ink-soft)", fontSize: 13,
            }}>
              <Inbox size={22} strokeWidth={1.6} color="var(--ink-faint)" />
              {filterKey === "all" && periodKey === "all"
                ? "아직 기록이 없습니다. 첫 방송이 감지되면 여기에 남습니다."
                : "이 조건에 맞는 기록이 없습니다. 유형이나 기간을 넓혀 보세요."}
            </div>
          ) : (
            <>
              <div style={{
                maxHeight: 372, overflowY: "auto",
                overscrollBehavior: "contain",
                WebkitOverflowScrolling: "touch",
                border: "1px solid var(--hairline)", borderRadius: 10,
                background: "var(--bg-soft)",
              }}>
                {/* 가로 스크롤은 '행마다' 따로 둔다. 목록 전체를 한 트랙으로 밀면
                    짧은 메시지가 고정된 시각 칸 뒤로 숨어 버린다 — 행별이면 각 행이
                    자기 길이만큼만 밀리므로 어떤 줄도 가려지지 않는다. */}
                <div>
                {events.map((ev, i) => {
                  const transient = ev.event === "error" && isTransientLiveError(ev.detail);
                  const meta = transient
                    ? { text: "일시적 조회 실패", tone: "warn" as const }
                    : EVENT_LABEL[ev.event] ?? { text: ev.event, tone: "mute" as const };
                  const tone = TONE_COLOR[meta.tone];
                  const note = transient
                    ? liveErrorLabel(ev.detail)
                    : (ev.detail && DETAIL_LABEL[ev.detail]) || ev.title || ev.detail;
                  const showNote = !!note && meta.tone === "bad";
                  return (
                    <div key={ev.id} className="live-evt-row" style={{
                      display: "flex", alignItems: "stretch",
                      overflowX: "auto",
                      overscrollBehaviorInline: "contain",
                      WebkitOverflowScrolling: "touch",
                      borderTop: i === 0 ? undefined : "1px solid var(--hairline)",
                    }}>
                      {/* 시각은 좌측 고정 — 옆으로 밀어 메시지를 읽는 동안에도 언제 것인지 보여야 한다.
                          배경을 목록과 같은 색으로 깔아 흘러오는 글자를 가린다. */}
                      <div style={{
                        position: "sticky", left: 0, zIndex: 1, flexShrink: 0,
                        display: "flex", alignItems: "flex-start", gap: 9,
                        padding: "8px 9px 8px 11px",
                        background: "var(--bg-soft)",
                      }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: "50%", background: tone,
                          flexShrink: 0, marginTop: 6,
                        }} />
                        <span style={{
                          fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 500,
                          flexShrink: 0, fontVariantNumeric: "tabular-nums", lineHeight: "18px",
                        }}>{fmtShort(ev.created_at)}</span>
                      </div>
                      {/* 오른쪽 여백은 끝까지 밀었을 때 글자가 플로팅 버튼에 가리지 않게 두는 공간 */}
                      <div style={{ flexShrink: 0, padding: "8px 52px 8px 0" }}>
                        <div style={{
                          fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
                          whiteSpace: "nowrap", lineHeight: "18px",
                        }} title={note || undefined}>
                          {meta.text}
                          {ev.session_key && (
                            <span style={{
                              marginLeft: 6, padding: "1px 6px", borderRadius: 5,
                              background: "var(--accent-soft)", color: "var(--accent-strong)",
                              fontSize: 10, fontWeight: 700,
                            }}>{SESSION_LABEL[ev.session_key] ?? ev.session_key}</span>
                          )}
                          {typeof ev.recipients === "number" && (
                            <span style={{
                              marginLeft: 6, fontSize: 11, fontWeight: 700, color: "var(--ink-soft)",
                              fontVariantNumeric: "tabular-nums",
                            }}>{ev.recipients.toLocaleString("ko-KR")}명</span>
                          )}
                          {!showNote && note && (
                            <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 400, color: "var(--ink-soft)" }}>
                              {note}
                            </span>
                          )}
                        </div>
                        {showNote && (
                          <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 2, lineHeight: 1.55, whiteSpace: "nowrap" }}>
                            {note}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>

              {hasMore && (
                <button type="button" onClick={loadMore} disabled={refreshing} style={{ ...btnStyle, width: "100%", marginTop: 9 }}>
                  이전 기록 {Math.min(PAGE, total - events.length)}건 더 보기
                </button>
              )}
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8, lineHeight: 1.6 }}>
                노란색은 자동 재시도되는 일시 문제 · 빨간색만 관리자 점검 필요<br />
                메시지가 길면 그 줄을 옆으로 밀어 보세요 · 자동 삭제 없이 계속 보관 · {PAGE}건씩 표시
              </div>
            </>
          )}
        </Card>

        {/* ── 알림 문구 기준 시간표 ── 참고 자료라 기본으로 접어 둔다 ── */}
        <Card>
          <Disclosure
            open={scheduleOpen}
            onToggle={() => setScheduleOpen((v) => !v)}
            label="알림 문구 기준 시간표"
            first
          >
            <p style={{ fontSize: 12, color: "var(--ink-mid)", lineHeight: 1.75, margin: "0 0 8px" }}>
              방송이 시작된 시각으로 회차를 판별해 &ldquo;주일 3부 예배가 시작되었습니다&rdquo; 처럼 보냅니다.
              아래 시간대에 없는 방송은 회차 없이 &ldquo;실시간 예배가 시작되었습니다&rdquo; 로 나갑니다.
              교회 전체 예배 시간표가 아니라 <b>실시간 중계를 하는 예배만</b> 담겨 있습니다.
            </p>
            {WORSHIP_SCHEDULE_TEXT.map((g) => (
              <Row key={g.when} label={g.when} value={g.items.join("  ·  ")} />
            ))}
          </Disclosure>
        </Card>
      </div>
    </div>
  );
}

// ── 작은 조각들 ──────────────────────────────────────────────
const btnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "7px 11px", borderRadius: 10,
  border: "1px solid var(--hairline-strong)",
  background: "var(--bg-soft)", color: "var(--ink-mid)",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit",
};

const dateInputStyle: React.CSSProperties = {
  flex: "1 1 0", minWidth: 0, padding: "8px 8px",
  border: "1px solid var(--hairline-strong)", borderRadius: 8,
  background: "var(--card)", color: "var(--ink)",
  fontFamily: "inherit", fontSize: 14, fontWeight: 600,
};

const dateFieldLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4,
};

/** 유형·기간 필터에 함께 쓰는 세그먼트 버튼 */
function SegButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: "1 1 0", minWidth: 0, padding: "7px 4px",
        border: 0, borderRadius: 8, cursor: "pointer",
        fontFamily: "inherit", fontSize: 11.5,
        fontWeight: active ? 800 : 600,
        background: active ? "var(--accent-soft)" : "var(--bg-soft)",
        color: active ? "var(--accent-strong)" : "var(--ink-soft)",
      }}
    >{label}</button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--hairline)",
      borderRadius: 14, padding: "14px 16px",
    }}>{children}</div>
  );
}

/** 접었다 펴는 구역 — 참고 정보가 진단 화면을 밀어내지 않게 한다 */
function Disclosure({ open, onToggle, label, children, first }: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div style={first ? undefined : { marginTop: 8, borderTop: "1px solid var(--hairline)", paddingTop: 6 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 5, width: "100%",
          padding: "5px 0", border: 0, background: "transparent", cursor: "pointer",
          fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "var(--ink-mid)",
          textAlign: "left",
        }}
      >
        {open
          ? <ChevronDown size={14} strokeWidth={2} color="var(--ink-soft)" />
          : <ChevronRight size={14} strokeWidth={2} color="var(--ink-soft)" />}
        {label}
      </button>
      {open && <div style={{ paddingTop: 2 }}>{children}</div>}
    </div>
  );
}

/** 이상징후 배너 안의 요약 한 줄 (라벨 + 값) */
function DiagLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
      <span style={{ fontSize: 11, color: "var(--ink-soft)", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink)", minWidth: 0, wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "baseline",
      padding: "6px 0", borderTop: "1px solid var(--hairline)",
    }}>
      <span style={{ fontSize: 12, color: "var(--ink-soft)", width: 96, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: "var(--ink)", flex: 1, minWidth: 0, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function Check({ tone, text, hint }: { tone: HealthTone; text: string; hint: string }) {
  const color = tone === "ok" ? "var(--success)" : tone === "warn" ? "var(--warning)" : "var(--danger)";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0" }}>
      {tone === "ok"
        ? <CheckCircle2 size={16} strokeWidth={2} color="var(--success)" style={{ flexShrink: 0, marginTop: 1 }} />
        : <AlertTriangle size={16} strokeWidth={2} color={color} style={{ flexShrink: 0, marginTop: 1 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: tone === "ok" ? "var(--ink)" : color, fontWeight: tone === "ok" ? 500 : 700, lineHeight: 1.55 }}>
          {text}
        </div>
        {tone !== "ok" && (
          <div style={{ fontSize: 11.5, color: "var(--ink-mid)", marginTop: 3, lineHeight: 1.6 }}>{hint}</div>
        )}
      </div>
    </div>
  );
}
