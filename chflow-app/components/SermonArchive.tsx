"use client";

// 지난 말씀 듣기 — UMS 설교 게시판 목록.
//
// 영상은 UMS VOD 서버(http)에 있고 Cloudflare Worker 가 https 로 중계한다.
// 프록시가 아직 설정되지 않았으면(NEXT_PUBLIC_VOD_PROXY_URL 없음) 목록만 보여주고
// UMS 홈페이지로 안내한다 — 재생이 안 되는 버튼을 내놓지 않기 위해서다.
//
// 설교 영상은 한 편에 수백 MB다. 재생 전에 용량을 반드시 보여준다(모바일 데이터).

import { useCallback, useEffect, useState } from "react";
import { Play, ExternalLink, X } from "lucide-react";
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

export default function SermonArchive() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [board, setBoard] = useState<string>("sermon_am");
  const [items, setItems] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState(true);
  const [proxyReady, setProxyReady] = useState(false);
  const [playing, setPlaying] = useState<Sermon | null>(null);

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

      {loading ? (
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((s) => {
            const size = fmtSize(s.byte_size);
            const canPlay = proxyReady && !!s.video_url;
            return (
              <div
                key={`${s.board}-${s.post_no}`}
                style={{
                  background: "var(--card)", border: "1px solid var(--hairline)",
                  borderRadius: 12, padding: "12px 13px",
                  display: "flex", alignItems: "center", gap: 11,
                }}
              >
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
                      영상 {size} · 와이파이 사용을 권합니다
                    </div>
                  )}
                </div>

                {canPlay ? (
                  <button
                    onClick={() => setPlaying(s)}
                    aria-label={`${s.title} 재생`}
                    style={{
                      flexShrink: 0, width: 40, height: 40, borderRadius: 12,
                      border: "none", background: "var(--accent-soft)", color: "var(--accent-strong)",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                  >
                    <Play size={17} strokeWidth={2.2} />
                  </button>
                ) : (
                  <a
                    href={UMS_VIEW(s.board, s.post_no)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${s.title} 홈페이지에서 보기`}
                    style={{
                      flexShrink: 0, width: 40, height: 40, borderRadius: 12,
                      background: "var(--bg-soft)", color: "var(--ink-mid)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <ExternalLink size={16} strokeWidth={1.9} />
                  </a>
                )}
              </div>
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
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
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
          <video
            src={playing.video_url}
            poster={playing.thumb_url ?? undefined}
            controls
            autoPlay
            playsInline
            preload="metadata"
            style={{ width: "100%", maxHeight: "70vh", background: "var(--ink)", borderRadius: 10 }}
          />
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
