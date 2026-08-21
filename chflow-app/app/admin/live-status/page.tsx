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
  ChevronDown, ChevronRight, Inbox,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import { WORSHIP_SCHEDULE_TEXT } from "@/lib/worshipSchedule";

type StatusRow = {
  is_live: boolean;
  video_id: string | null;
  title: string | null;
  started_at: string | null;
  checked_at: string | null;
  last_error: string | null;
  notified_video_id: string | null;
  notified_at: string | null;
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

/** 이력 필터 — key 별로 조회할 event 값. null 이면 전체 */
const FILTERS: { key: string; label: string; events: string[] | null }[] = [
  { key: "all", label: "전체", events: null },
  { key: "detect", label: "감지", events: ["live_started", "live_ended"] },
  { key: "notify", label: "발송", events: ["notified", "notify_skipped"] },
  { key: "error", label: "오류", events: ["error"] },
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
          .select("is_live, video_id, title, started_at, checked_at, last_error, notified_video_id, notified_at")
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
  const healthy = !pollerStalled && !hasError;
  const hasMore = events.length < total;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "'Noto Sans KR', sans-serif", paddingBottom: 40 }}>
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
              background: healthy
                ? "color-mix(in srgb, var(--success) 15%, transparent)"
                : "color-mix(in srgb, var(--danger) 15%, transparent)",
              color: healthy ? "var(--success)" : "var(--danger)",
            }}>
              {healthy ? "정상" : "점검 필요"}
            </span>
          </div>

          <div style={{ marginTop: 4 }}>
            <Check
              ok={!pollerStalled}
              okText={`감지기 정상 동작 중 · 마지막 확인 ${ago(status?.checked_at ?? null, nowMs)}`}
              badText={`감지기가 멈춘 것 같습니다 · 마지막 확인 ${status?.checked_at ? ago(status.checked_at, nowMs) : "기록 없음"}`}
              hint="Cloudflare Worker 의 Cron Trigger(1분)와 LIVE_POLL_SECRET 을 확인하세요."
            />
            <Check
              ok={!hasError}
              okText="YouTube 조회 오류 없음"
              badText={`YouTube 조회 오류: ${status?.last_error ?? ""}`}
              hint="YOUTUBE_API_KEY 의 유효기간·쿼터·API 제한을 확인하세요."
            />
          </div>

          <Disclosure open={detailOpen} onToggle={() => setDetailOpen((v) => !v)} label="세부 값">
            <Row label="마지막 확인" value={`${fmt(status?.checked_at ?? null)}  (${ago(status?.checked_at ?? null, nowMs)})`} />
            <Row label="현재 영상 ID" value={status?.video_id ?? "-"} />
            <Row label="방송 시작 시각" value={fmt(status?.started_at ?? null)} />
            <Row label="알림 보낸 영상" value={status?.notified_video_id ?? "-"} />
            <Row label="알림 발송 시각" value={`${fmt(status?.notified_at ?? null)}${status?.notified_at ? `  (${ago(status.notified_at, nowMs)})` : ""}`} />
            <Row label="마지막 오류" value={status?.last_error ?? "없음"} />
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => applyView({ fromDate: e.currentTarget.value })}
                aria-label="조회 시작일"
                style={dateInputStyle}
              />
              <span style={{ fontSize: 12, color: "var(--ink-faint)", flexShrink: 0 }}>~</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => applyView({ toDate: e.currentTarget.value })}
                aria-label="조회 종료일"
                style={dateInputStyle}
              />
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
                border: "1px solid var(--hairline)", borderRadius: 10,
                background: "var(--bg-soft)",
              }}>
                {events.map((ev, i) => {
                  const meta = EVENT_LABEL[ev.event] ?? { text: ev.event, tone: "mute" as const };
                  const tone = TONE_COLOR[meta.tone];
                  const note = (ev.detail && DETAIL_LABEL[ev.detail]) || ev.title || ev.detail;
                  const showNote = !!note && meta.tone === "bad";
                  return (
                    <div key={ev.id} style={{
                      display: "flex", gap: 9, alignItems: "baseline",
                      padding: "8px 11px",
                      borderTop: i === 0 ? undefined : "1px solid var(--hairline)",
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%", background: tone,
                        flexShrink: 0, transform: "translateY(-1px)",
                      }} />
                      <span style={{
                        fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 500,
                        flexShrink: 0, fontVariantNumeric: "tabular-nums",
                      }}>{fmtShort(ev.created_at)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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
                          <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 2, lineHeight: 1.55, wordBreak: "break-all" }}>
                            {note}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {hasMore && (
                <button type="button" onClick={loadMore} disabled={refreshing} style={{ ...btnStyle, width: "100%", marginTop: 9 }}>
                  이전 기록 {Math.min(PAGE, total - events.length)}건 더 보기
                </button>
              )}
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8, lineHeight: 1.6 }}>
자동 삭제 없이 계속 보관 · {PAGE}건씩 표시
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
  flex: "1 1 0", minWidth: 0, padding: "6px 8px",
  border: "1px solid var(--hairline-strong)", borderRadius: 8,
  background: "var(--card)", color: "var(--ink)",
  fontFamily: "inherit", fontSize: 12, fontWeight: 500,
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

function Check({ ok, okText, badText, hint }: { ok: boolean; okText: string; badText: string; hint: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0" }}>
      {ok
        ? <CheckCircle2 size={16} strokeWidth={2} color="var(--success)" style={{ flexShrink: 0, marginTop: 1 }} />
        : <AlertTriangle size={16} strokeWidth={2} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: ok ? "var(--ink)" : "var(--danger)", fontWeight: ok ? 500 : 700, lineHeight: 1.55 }}>
          {ok ? okText : badText}
        </div>
        {!ok && (
          <div style={{ fontSize: 11.5, color: "var(--ink-mid)", marginTop: 3, lineHeight: 1.6 }}>{hint}</div>
        )}
      </div>
    </div>
  );
}
