"use client";

// 실시간 예배 — YouTube Live 공식 iframe 임베드.
//
// 상태는 /api/live/status 에서 받는다. 그 라우트가 캐시(youtube_live_status)를 읽고,
// 3분 이상 오래됐을 때만 YouTube 를 한 번 조회해 갱신한다(동시요청 선점).
// 화면이 직접 YouTube 를 부르지 않는 이유는 일일 쿼터 때문이다.
//
// 모바일 브라우저는 소리 있는 자동재생을 막으므로 재생은 사용자 탭으로 시작된다.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, RefreshCw, Radio } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import { worshipNowLabel, WORSHIP_GUIDE_TEXT } from "@/lib/worshipSchedule";
import SermonArchive from "@/components/SermonArchive";

type LiveStatus = {
  channel_id: string | null;
  is_live: boolean;
  video_id: string | null;
  title: string | null;
  started_at: string | null;
  checked_at: string | null;
  /** 상태 갱신이 오래 멈춘 상태 — '방송 없음'이라 단정하지 않는다 */
  stale: boolean;
};

const DEFAULT_CHANNEL_ID = "UCGqoK8XTWHLkyU8Nt-as1og"; // 울산명성교회

function channelUrl(channelId: string) {
  return `https://www.youtube.com/channel/${channelId}`;
}

function formatChecked(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function LivePage() {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadInFlightRef = useRef(false);

  async function load(isRefresh = false) {
    if (loadInFlightRef.current || document.visibilityState !== "visible") return;
    loadInFlightRef.current = true;
    if (isRefresh) setRefreshing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        const res = await fetch("/api/live/status", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (res.ok) setStatus((await res.json()) as LiveStatus);
      }
    } catch {
      // 네트워크 실패 시 이전 상태를 유지한다
    } finally {
      loadInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      load();
    });
    // 방송 시작·종료를 화면에 반영하기 위해 1분마다 캐시만 다시 읽는다(YouTube 호출 아님)
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
    const loadWhenVisible = () => {
      if (document.visibilityState !== "visible") {
        stopPolling();
        return;
      }
      load();
      startPolling();
    };
    const loadWhenActive = () => {
      if (document.visibilityState === "visible") load();
    };
    startPolling();
    document.addEventListener("visibilitychange", loadWhenVisible);
    window.addEventListener("focus", loadWhenActive);
    window.addEventListener("pageshow", loadWhenActive);
    window.addEventListener("chflow:app-active", loadWhenActive);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", loadWhenVisible);
      window.removeEventListener("focus", loadWhenActive);
      window.removeEventListener("pageshow", loadWhenActive);
      window.removeEventListener("chflow:app-active", loadWhenActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <LoadingView />;

  const isLive = !!status?.is_live && !!status?.video_id;
  const chUrl = channelUrl(status?.channel_id || DEFAULT_CHANNEL_ID);

  // 상태 갱신이 멈춘 경우(키 미설정·조회 실패 등)에는 '방송 없음'이라고 단정하지 않는다.
  // 실제로 방송 중인데 없다고 표시하면 안내가 거짓이 된다.
  const stale = !status || status.stale;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <header
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px",
          background: "var(--card)",
          borderBottom: "1px solid var(--hairline)",
          position: "sticky", top: 0, zIndex: 10,
        }}
      >
        <button
          onClick={() => router.push("/home")}
          aria-label="홈으로"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "7px 11px", borderRadius: 10,
            border: "1px solid var(--hairline-strong)",
            background: "var(--bg-soft)", color: "var(--ink-mid)",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>홈</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>예배</div>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 1 }}>
            울산명성교회 유튜브
            {status?.checked_at && ` · ${formatChecked(status.checked_at)} 확인`}
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          aria-label="새로고침"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: 10,
            border: "1px solid var(--hairline-strong)",
            background: "var(--bg-soft)", color: "var(--ink-mid)",
            cursor: refreshing ? "default" : "pointer",
          }}
        >
          <RefreshCw size={15} strokeWidth={1.9} />
        </button>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: 14 }}>
        {isLive ? (
          <>
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 11px", borderRadius: 999,
                background: "var(--danger)", color: "var(--paper)",
                fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: "var(--paper)", display: "inline-block",
                }}
              />
              LIVE
            </div>
            {/* 지금이 어느 예배인지 (시간표 기준) */}
            <div style={{ marginLeft: 8, display: "inline-block", fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
              {worshipNowLabel(status?.started_at ? new Date(status.started_at) : new Date())}
            </div>

            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "16 / 9",
                borderRadius: 12,
                overflow: "hidden",
                background: "var(--ink)",
                border: "1px solid var(--hairline)",
              }}
            >
              <iframe
                src={`https://www.youtube.com/embed/${status!.video_id}?rel=0&playsinline=1&autoplay=1`}
                title={status?.title || "실시간 예배"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            </div>

            {status?.title && (
              <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700, color: "var(--ink)", lineHeight: 1.45 }}>
                {status.title}
              </div>
            )}

            <p style={{ marginTop: 10, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
              소리가 나오지 않으면 화면을 한 번 눌러 재생해 주세요. 휴대폰은 자동재생이 제한됩니다.
            </p>
          </>
        ) : (
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--hairline)",
              borderRadius: 14,
              padding: "34px 20px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 52, height: 52, borderRadius: 15,
                background: "var(--bg-soft)", color: "var(--ink-faint)",
                marginBottom: 14,
              }}
            >
              <Radio size={24} strokeWidth={1.8} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
              {stale ? "방송 여부를 확인하지 못했습니다" : "지금은 생방송이 없습니다"}
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-mid)", lineHeight: 1.8, margin: "0 auto", maxWidth: 320 }}>
              {stale
                ? "아래 버튼으로 유튜브 채널에서 직접 확인해 주세요. 방송 중이라면 채널에 표시됩니다."
                : "예배가 시작되면 이 화면에서 바로 보실 수 있습니다."}
            </p>

            {/* 예배안내: 전체 일정은 텍스트로 간단히 보여주고 생방송 예배만 배지로 구분한다. */}
            <div style={{
              marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--hairline)",
              display: "flex", flexDirection: "column", gap: 6, textAlign: "left",
              maxWidth: 430, marginLeft: "auto", marginRight: "auto",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-mid)" }}>예배안내</div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10.5, fontWeight: 700 }}>
                  <Radio size={11} strokeWidth={2} /> 실시간 중계
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.6, marginBottom: 4 }}>
                실시간 표시가 있는 예배는 생방송으로 시청할 수 있습니다.
              </div>
              {WORSHIP_GUIDE_TEXT.map((g) => (
                <div key={g.when} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, color: "var(--ink-mid)", lineHeight: 1.7 }}>
                  <span style={{ width: 58, flexShrink: 0, fontWeight: 700, color: "var(--ink)" }}>{g.when}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: "3px 8px", flex: 1, minWidth: 0 }}>
                    {g.items.map((item) => (
                      <span key={`${item.label ?? "main"}-${item.time}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                        <span>{[item.label, item.time].filter(Boolean).join(" ")}{item.note ? ` (${item.note})` : ""}</span>
                        {item.live && (
                          <span style={{ display: "inline-flex", alignItems: "center", padding: "1px 4px", borderRadius: 4, background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", fontSize: 9.5, fontWeight: 800, lineHeight: 1.3 }}>
                            실시간
                          </span>
                        )}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 오프에어에는 유튜브 버튼을 두지 않는다 (지난 말씀은 아래 목록에서 본다) */}
        {(isLive || stale) && (
        <a
          href={isLive ? `https://www.youtube.com/watch?v=${status!.video_id}` : `${chUrl}/streams`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            marginTop: 14, padding: "13px 16px", borderRadius: 12,
            background: "var(--card)", border: "1px solid var(--hairline-strong)",
            color: "var(--ink-mid)", fontSize: 13, fontWeight: 700,
            textDecoration: "none",
          }}
        >
          <ExternalLink size={15} strokeWidth={1.9} />
          {isLive ? "유튜브 앱에서 보기" : "유튜브 채널에서 확인하기"}
        </a>
        )}

        {/* 지난 말씀 듣기 — UMS 설교 게시판 목록 */}
        <SermonArchive />
      </div>
    </div>
  );
}
