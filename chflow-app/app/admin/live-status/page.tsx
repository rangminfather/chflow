"use client";

// 실시간 예배 감지·알림 점검 (관리자)
//
// 푸시가 안 왔을 때 어디가 막혔는지 한 화면에서 보게 하는 것이 목적이다.
// 확인 순서: ① 폴러가 도는지(마지막 확인 시각) ② 조회 오류 여부 ③ 감지·발송 이력

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, CheckCircle2, AlertTriangle, Radio } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // 렌더 중 Date.now() 를 부르지 않기 위해 조회 시각을 상태로 들고 간다
  const [nowMs, setNowMs] = useState(0);
  const loadInFlightRef = useRef(false);

  const load = useCallback(async (isRefresh = false) => {
    if (loadInFlightRef.current || document.visibilityState !== "visible") return;
    loadInFlightRef.current = true;
    if (isRefresh) setRefreshing(true);
    try {
      const [{ data: s }, { data: e }] = await Promise.all([
        supabase
          .from("youtube_live_status")
          .select("is_live, video_id, title, started_at, checked_at, last_error, notified_video_id, notified_at")
          .eq("id", "main")
          .maybeSingle(),
        supabase
          .from("youtube_live_events")
          .select("id, event, video_id, session_key, title, detail, recipients, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      setNowMs(Date.now());
      setStatus((s as StatusRow) ?? null);
      setEvents((e as EventRow[]) ?? []);
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
          <RefreshCw size={15} strokeWidth={1.9} />
        </button>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* ── 한눈에 진단 ── */}
        <Card>
          <SectionTitle>지금 상태</SectionTitle>
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
          <div style={{
            marginTop: 10, padding: "11px 13px", borderRadius: 10,
            background: status?.is_live
              ? "color-mix(in srgb, var(--success) 12%, transparent)"
              : "var(--bg-soft)",
            display: "flex", alignItems: "center", gap: 9,
          }}>
            <span style={{
              width: 9, height: 9, borderRadius: "50%",
              background: status?.is_live ? "var(--success)" : "var(--ink-faint)",
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                {status?.is_live ? "방송 중 (ON AIR)" : "방송 없음 (OFF AIR)"}
              </div>
              {status?.is_live && status.title && (
                <div style={{ fontSize: 12, color: "var(--ink-mid)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {status.title}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* ── 상세 ── */}
        <Card>
          <SectionTitle>세부 값</SectionTitle>
          <Row label="마지막 확인" value={`${fmt(status?.checked_at ?? null)}  (${ago(status?.checked_at ?? null, nowMs)})`} />
          <Row label="현재 영상 ID" value={status?.video_id ?? "-"} />
          <Row label="방송 시작 시각" value={fmt(status?.started_at ?? null)} />
          <Row label="알림 보낸 영상" value={status?.notified_video_id ?? "-"} />
          <Row label="알림 발송 시각" value={`${fmt(status?.notified_at ?? null)}${status?.notified_at ? `  (${ago(status.notified_at, nowMs)})` : ""}`} />
          <Row label="마지막 오류" value={status?.last_error ?? "없음"} />
        </Card>

        {/* ── 이력 ── */}
        <Card>
          <SectionTitle>감지·발송 이력 (최근 50건 · 30일 보관)</SectionTitle>
          {events.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--ink-soft)", padding: "16px 2px", textAlign: "center" }}>
              아직 기록이 없습니다. 첫 방송이 감지되면 여기에 남습니다.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {events.map((ev) => {
                const meta = EVENT_LABEL[ev.event] ?? { text: ev.event, tone: "mute" as const };
                const tone = {
                  ok: "var(--success)", warn: "var(--warning)", bad: "var(--danger)", mute: "var(--ink-faint)",
                }[meta.tone];
                return (
                  <div key={ev.id} style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    padding: "10px 2px", borderTop: "1px solid var(--hairline)",
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone, marginTop: 6, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                        {meta.text}
                        {ev.session_key && (
                          <span style={{
                            marginLeft: 6, padding: "1px 6px", borderRadius: 5,
                            background: "var(--accent-soft)", color: "var(--accent-strong)",
                            fontSize: 10, fontWeight: 700,
                          }}>{SESSION_LABEL[ev.session_key] ?? ev.session_key}</span>
                        )}
                        {typeof ev.recipients === "number" && (
                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: "var(--ink-soft)" }}>
                            {ev.recipients}명
                          </span>
                        )}
                      </div>
                      {(ev.title || ev.detail) && (
                        <div style={{ fontSize: 12, color: "var(--ink-mid)", marginTop: 2, lineHeight: 1.6, wordBreak: "break-all" }}>
                          {ev.detail || ev.title}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 3 }}>
                        {fmt(ev.created_at)} · {ago(ev.created_at, nowMs)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── 실시간 예배 시간표 ── */}
        <Card>
          <SectionTitle>알림 문구 기준 시간표</SectionTitle>
          <p style={{ fontSize: 12, color: "var(--ink-mid)", lineHeight: 1.75, margin: "0 0 8px" }}>
            방송이 시작된 시각으로 회차를 판별해 &ldquo;주일 3부 예배가 시작되었습니다&rdquo; 처럼 보냅니다.
            아래 시간대에 없는 방송은 회차 없이 &ldquo;실시간 예배가 시작되었습니다&rdquo; 로 나갑니다.
            교회 전체 예배 시간표가 아니라 <b>실시간 중계를 하는 예배만</b> 담겨 있습니다.
          </p>
          {WORSHIP_SCHEDULE_TEXT.map((g) => (
            <Row key={g.when} label={g.when} value={g.items.join("  ·  ")} />
          ))}
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
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--hairline)",
      borderRadius: 14, padding: "14px 16px",
    }}>{children}</div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
      <Radio size={14} strokeWidth={1.9} color="var(--accent)" />
      <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>{children}</span>
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
