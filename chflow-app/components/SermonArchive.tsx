"use client";

// 지난 말씀 듣기 — UMS 설교 게시판 목록.
//
// 영상은 UMS VOD 서버(http)에 있고 Cloudflare Worker 가 https 로 중계한다.
// 프록시가 아직 설정되지 않았으면(NEXT_PUBLIC_VOD_PROXY_URL 없음) 목록만 보여주고
// UMS 홈페이지로 안내한다 — 재생이 안 되는 버튼을 내놓지 않기 위해서다.
//
// 설교 영상은 한 편에 수백 MB다. 재생 전에 용량을 반드시 보여준다(모바일 데이터).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  ExternalLink,
  X,
  Maximize,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/components/StatusViews";

type Board = { id: string; label: string };

type Sermon = {
  board: string;
  post_no: number;
  title: string;
  preacher: string | null;
  bible: string | null;
  preached_on: string | null;
  byte_size: number | null;
  video_url: string | null;
  thumb_url: string | null;
};

const UMS_VIEW = (board: string, no: number) =>
  `http://www.ums.or.kr/bbs/zboard.php?id=${board}&no=${no}`;

function fmtDate(value: string | null) {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}` : value;
}

function fmtSize(bytes: number | null) {
  if (!bytes) return null;
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.round(mb)}MB`;
}

function fmtPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

const playerButtonStyle: React.CSSProperties = {
  height: 40,
  padding: "0 11px",
  border: "1px solid color-mix(in srgb, var(--paper) 22%, transparent)",
  borderRadius: 11,
  background: "color-mix(in srgb, var(--paper) 12%, transparent)",
  color: "var(--paper)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  fontFamily: "inherit",
  fontSize: 11.5,
  fontWeight: 750,
  cursor: "pointer",
};


/**
 * 전체화면 + 가로 고정.
 *
 * - 아이폰 사파리는 표준 Fullscreen API 대신 video.webkitEnterFullscreen 을 쓴다.
 *   이 경우 iOS 기본 플레이어가 열리고 기기 방향에 따라 알아서 회전한다
 *   (iOS 는 screen.orientation.lock 을 지원하지 않는다).
 * - 안드로이드 크롬은 컨테이너를 전체화면으로 만든 뒤 가로로 고정한다.
 * - 어느 것도 안 되면 조용히 넘어간다. 재생 자체는 계속된다.
 */
type FsVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

async function goFullscreenLandscape(box: HTMLElement | null, video: HTMLVideoElement | null) {
  const v = video as FsVideo | null;
  if (v?.webkitEnterFullscreen && !document.fullscreenEnabled) {
    v.webkitEnterFullscreen();
    return;
  }
  try {
    if (box && !document.fullscreenElement) await box.requestFullscreen();
  } catch {
    // 전체화면이 거부되면 가로 고정도 의미가 없다
    return;
  }
  try {
    await (screen.orientation as LockableOrientation)?.lock?.("landscape");
  } catch {
    // 데스크톱·아이폰 등 미지원 환경
  }
}

function releaseOrientation() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // 미지원 환경
  }
}

export default function SermonArchive() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [board, setBoard] = useState<string>("sermon_am");
  const [items, setItems] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState(true);
  const [proxyReady, setProxyReady] = useState(false);
  const [playing, setPlaying] = useState<Sermon | null>(null);
  // 첫 재생 준비가 오래 걸리는 파일이 있어 상태를 표시한다
  const [playState, setPlayState] = useState<"loading" | "ready" | "error">("loading");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const isIosDevice = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/sermons?board=${encodeURIComponent(target)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = await res.json();
      setBoards(json.boards ?? []);
      setItems(json.items ?? []);
      setProxyReady(!!json.proxy_ready);
    } catch {
      // 실패 시 빈 목록을 유지한다
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(board); }, [board, load]);

  useEffect(() => {
    setIsPlaying(false);
    setIsMuted(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1);
  }, [playing]);

  const seekBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.currentTime)) return;
    const end = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
    video.currentTime = Math.max(0, Math.min(end, video.currentTime + seconds));
    setCurrentTime(video.currentTime);
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setPlayState("error"));
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const cyclePlaybackRate = () => {
    const video = videoRef.current;
    if (!video) return;
    const rates = [1, 1.25, 1.5, 2];
    const nextRate = rates[(rates.indexOf(video.playbackRate) + 1) % rates.length];
    video.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  // 전체화면을 벗어나면 가로 고정을 풀어 준다
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) releaseOrientation(); };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      releaseOrientation();
    };
  }, []);

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", marginBottom: 10 }}>
        지난 말씀 듣기
      </div>

      {/* 게시판 탭 */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 4 }}>
        {(boards.length ? boards : [{ id: board, label: "주일오전" }]).map((b) => {
          const on = b.id === board;
          return (
            <button
              key={b.id}
              onClick={() => setBoard(b.id)}
              style={{
                flexShrink: 0, padding: "7px 13px", borderRadius: 999,
                border: `1px solid ${on ? "transparent" : "var(--hairline-strong)"}`,
                background: on ? "var(--accent)" : "var(--card)",
                color: on ? "var(--accent-soft)" : "var(--ink-mid)",
                fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {b.label}
            </button>
          );
        })}
      </div>

      {loading && items.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "28px 0" }}><Spinner size={22} /></div>
      ) : items.length === 0 ? (
        <div style={{
          background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 12,
          padding: "22px 16px", textAlign: "center", fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.7,
        }}>
          아직 목록을 가져오지 못했습니다.
          <br />잠시 후 다시 확인해 주세요.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          {items.map((s) => {
            const size = fmtSize(s.byte_size);
            const canPlay = proxyReady && !!s.video_url;

            // 카드 전체가 눌리게 한다. 재생 가능하면 button, 아니면 홈페이지 링크.
            const cardStyle: React.CSSProperties = {
              width: "100%", textAlign: "left", fontFamily: "inherit",
              background: "var(--card)", border: "1px solid var(--hairline)",
              borderRadius: 12, padding: "12px 13px",
              display: "flex", alignItems: "center", gap: 11,
              cursor: "pointer", textDecoration: "none", color: "inherit",
            };

            const inner = (
              <>
                {/* 썸네일 — UMS 썸네일도 http 라서 같은 워커로 중계한다 */}
                <div
                  style={{
                    position: "relative", flexShrink: 0,
                    width: 108, aspectRatio: "16 / 9", borderRadius: 9,
                    overflow: "hidden", background: "var(--bg-soft)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {s.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.thumb_url}
                      alt=""
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(ev) => { ev.currentTarget.style.display = "none"; }}
                    />
                  ) : (
                    <Play size={18} strokeWidth={1.9} color="var(--ink-faint)" />
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 3 }}>
                    {fmtDate(s.preached_on)}
                    {s.preacher && ` · ${s.preacher}`}
                  </div>
                  <div className="kr-break" style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", lineHeight: 1.4 }}>
                    {s.title}
                  </div>
                  {s.bible && (
                    <div style={{ fontSize: 12, color: "var(--ink-mid)", marginTop: 3 }}>{s.bible}</div>
                  )}
                  {size && (
                    <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>
                      {size} · 와이파이 권장
                    </div>
                  )}
                </div>

                {/* 장식용 표시 — 카드 자체가 버튼이라 별도 버튼을 두지 않는다 */}
                <span
                  aria-hidden="true"
                  style={{
                    flexShrink: 0, width: 40, height: 40, borderRadius: 12,
                    background: canPlay ? "var(--accent-soft)" : "var(--bg-soft)",
                    color: canPlay ? "var(--accent-strong)" : "var(--ink-mid)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {canPlay ? <Play size={17} strokeWidth={2.2} /> : <ExternalLink size={16} strokeWidth={1.9} />}
                </span>
              </>
            );

            return canPlay ? (
              <button
                key={`${s.board}-${s.post_no}`}
                type="button"
                onClick={() => { setPlayState("loading"); setPlaying(s); }}
                aria-label={`${s.title} 재생`}
                style={cardStyle}
              >
                {inner}
              </button>
            ) : (
              <a
                key={`${s.board}-${s.post_no}`}
                href={UMS_VIEW(s.board, s.post_no)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${s.title} 홈페이지에서 보기`}
                style={cardStyle}
              >
                {inner}
              </a>
            );
          })}
        </div>
      )}

      {!proxyReady && items.length > 0 && (
        <p style={{ fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.7, marginTop: 10 }}>
          앱 안 재생 준비가 끝나지 않아 지금은 홈페이지로 연결됩니다.
        </p>
      )}

      {/* 재생 화면 */}
      {playing?.video_url && (
        <div
          role="dialog"
          aria-label="지난 말씀 재생"
          style={{
            position: "fixed", inset: 0, zIndex: 2000,
            background: "color-mix(in srgb, var(--ink) 88%, transparent)",
            display: "flex", flexDirection: "column", justifyContent: "center", padding: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
            <button
              onClick={() => void goFullscreenLandscape(stageRef.current, videoRef.current)}
              aria-label="전체화면"
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                height: 38, padding: "0 13px", borderRadius: 12, border: "none",
                background: "color-mix(in srgb, var(--paper) 22%, transparent)",
                color: "var(--paper)", fontSize: 12, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <Maximize size={15} strokeWidth={2.1} />
              전체화면
            </button>
            <button
              onClick={() => setPlaying(null)}
              aria-label="닫기"
              style={{
                width: 38, height: 38, borderRadius: 12, border: "none",
                background: "color-mix(in srgb, var(--paper) 22%, transparent)",
                color: "var(--paper)", display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <X size={19} strokeWidth={2.2} />
            </button>
          </div>
          {isIosDevice && (
            <p style={{ margin: "0 4px 8px", color: "var(--paper)", fontSize: 11.5, textAlign: "right", opacity: 0.82 }}>
              가로로 보려면 화면 회전 잠금을 해제해 주세요.
            </p>
          )}
          <div ref={stageRef} style={{ position: "relative", background: "var(--ink)", borderRadius: 10 }}>
            <video
              key={playing.video_url}
              ref={videoRef}
              src={playing.video_url}
              poster={playing.thumb_url ?? undefined}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
              }}
              onDurationChange={(event) => {
                setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
              }}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onVolumeChange={(event) => setIsMuted(event.currentTarget.muted)}
              onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
              onCanPlay={() => {
                setPlayState("ready");
              }}
              onError={() => setPlayState("error")}
              style={{ width: "100%", maxHeight: "70vh", background: "var(--ink)", borderRadius: 10 }}
            />
            {playState !== "error" && (
              <div
                aria-label="영상 재생 조작"
                style={{
                  position: "relative", zIndex: 2,
                  display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap",
                  gap: 7, padding: "10px 8px 11px", color: "var(--paper)",
                  background: "color-mix(in srgb, var(--ink) 94%, var(--paper))",
                  borderRadius: "0 0 10px 10px",
                }}
              >
                <button
                  type="button"
                  onClick={() => seekBy(-10)}
                  aria-label="10초 되돌리기"
                  title="10초 되돌리기"
                  disabled={duration <= 0}
                  style={{
                    ...playerButtonStyle,
                    opacity: duration > 0 ? 1 : 0.45,
                    cursor: duration > 0 ? "pointer" : "not-allowed",
                  }}
                >
                  <RotateCcw size={18} strokeWidth={2.1} />
                  <span>10초</span>
                </button>
                <button
                  type="button"
                  onClick={togglePlayback}
                  aria-label={isPlaying ? "일시정지" : "재생"}
                  title={isPlaying ? "일시정지" : "재생"}
                  style={{ ...playerButtonStyle, width: 44, padding: 0 }}
                >
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>
                <button
                  type="button"
                  onClick={() => seekBy(10)}
                  aria-label="10초 빨리감기"
                  title="10초 빨리감기"
                  disabled={duration <= 0}
                  style={{
                    ...playerButtonStyle,
                    opacity: duration > 0 ? 1 : 0.45,
                    cursor: duration > 0 ? "pointer" : "not-allowed",
                  }}
                >
                  <RotateCw size={18} strokeWidth={2.1} />
                  <span>10초</span>
                </button>
                <span
                  aria-label={`재생 시간 ${fmtPlaybackTime(currentTime)} / ${fmtPlaybackTime(duration)}`}
                  style={{ minWidth: 94, textAlign: "center", fontSize: 11.5, fontVariantNumeric: "tabular-nums", opacity: 0.86 }}
                >
                  {duration > 0
                    ? `${fmtPlaybackTime(currentTime)} / ${fmtPlaybackTime(duration)}`
                    : "영상 준비 중"}
                </span>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? "소리 켜기" : "음소거"}
                  title={isMuted ? "소리 켜기" : "음소거"}
                  style={{ ...playerButtonStyle, width: 40, padding: 0 }}
                >
                  {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <button
                  type="button"
                  onClick={cyclePlaybackRate}
                  aria-label={`재생 속도 ${playbackRate}배. 눌러서 변경`}
                  title="재생 속도 변경"
                  style={{ ...playerButtonStyle, minWidth: 48, padding: "0 9px", fontVariantNumeric: "tabular-nums" }}
                >
                  {playbackRate}×
                </button>
              </div>
            )}
            {playState !== "ready" && (
              <div
                style={{
                  position: "absolute", inset: 0, borderRadius: 10,
                  background: "color-mix(in srgb, var(--ink) 55%, transparent)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 10, padding: 18, textAlign: "center",
                }}
              >
                {playState === "loading" ? (
                  <>
                    <Spinner size={24} />
                    {/* 이 파일들은 영상 목차가 파일 끝에 있어 첫 재생 준비가 오래 걸릴 수 있다 */}
                    <div style={{ color: "var(--paper)", fontSize: 12.5, lineHeight: 1.6 }}>
                      불러오는 중입니다.
                      <br />영상에 따라 30초 이상 걸릴 수 있습니다.
                    </div>
                  </>
                ) : (
                  <div style={{ color: "var(--paper)", fontSize: 12.5, lineHeight: 1.7 }}>
                    영상을 불러오지 못했습니다.
                    <br />아래 링크로 홈페이지에서 보실 수 있습니다.
                  </div>
                )}
              </div>
            )}
          </div>

          <a
            href={UMS_VIEW(playing.board, playing.post_no)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12,
              color: "color-mix(in srgb, var(--paper) 80%, transparent)",
              fontSize: 12, fontWeight: 600, textDecoration: "underline",
            }}
          >
            <ExternalLink size={13} strokeWidth={2} />
            홈페이지에서 보기
          </a>
          <div style={{ marginTop: 10, color: "var(--paper)", fontSize: 13, fontWeight: 700, lineHeight: 1.5 }}>
            {playing.title}
          </div>
          <div style={{ marginTop: 3, color: "color-mix(in srgb, var(--paper) 72%, transparent)", fontSize: 11.5 }}>
            {fmtDate(playing.preached_on)}
            {playing.preacher && ` · ${playing.preacher}`}
            {fmtSize(playing.byte_size) && ` · ${fmtSize(playing.byte_size)}`}
          </div>
        </div>
      )}
    </div>
  );
}
