"use client";

// 예배 생방송 — YouTube Live 공식 iframe 임베드.
//
// 상태는 youtube_live_status 테이블(cron 갱신)에서 읽는다. 사용자가 이 화면을
// 열 때마다 YouTube API 를 호출하지 않는 이유는 일일 쿼터 때문이다.
// (갱신은 /api/cron/youtube-live 가 담당)
//
// 모바일 브라우저는 소리 있는 자동재생을 막으므로 재생은 사용자 탭으로 시작된다.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, RefreshCw, Radio } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";

type LiveStatus = {
  channel_id: string;
  is_live: boolean;
  video_id: string | null;
  title: string | null;
  started_at: string | null;
  checked_at: string | null;
};

// cron 은 5분 간격으로 갱신한다. 이보다 한참 오래됐으면 상태를 신뢰하지 않는다.
const STALE_AFTER_MS = 20 * 60 * 1000;

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

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    const { data } = await supabase
      .from("youtube_live_status")
      .select("channel_id, is_live, video_id, title, started_at, checked_at")
      .eq("id", "main")
      .maybeSingle();
    setStatus((data as LiveStatus) ?? null);
    setLoading(false);
    setRefreshing(false);
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
    const timer = setInterval(() => load(), 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <LoadingView />;

  const isLive = !!status?.is_live && !!status?.video_id;
  const chUrl = channelUrl(status?.channel_id || "");

  // 상태 갱신이 멈춘 경우(키 미설정·cron 실패 등)에는 '방송 없음'이라고 단정하지 않는다.
  // 실제로 방송 중인데 없다고 표시하면 안내가 거짓이 된다.
  const checkedMs = status?.checked_at ? new Date(status.checked_at).getTime() : NaN;
  const stale = !status || Number.isNaN(checkedMs) || Date.now() - checkedMs > STALE_AFTER_MS;

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
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>예배 생방송</div>
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
                src={`https://www.youtube.com/embed/${status!.video_id}?rel=0&playsinline=1`}
                title={status?.title || "예배 생방송"}
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
                : "예배가 시작되면 이 화면에서 바로 보실 수 있습니다. 지난 예배는 유튜브 채널에서 다시 보실 수 있습니다."}
            </p>
          </div>
        )}

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
          {isLive ? "유튜브 앱에서 보기" : stale ? "유튜브 채널에서 확인하기" : "유튜브 채널에서 지난 예배 보기"}
        </a>
      </div>
    </div>
  );
}
