"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, ExternalLink, List, RefreshCw, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PdfCanvasViewer from "@/components/PdfCanvasViewer";
import { LoadingView } from "@/components/StatusViews";

type BulletinItem = {
  no: number;
  title: string;
  volume: string | null;
  issue_date: string | null;
  posted_at: string | null;
  author: string | null;
  url: string;
  pdf_url?: string | null;
  stored?: boolean;
};

type BulletinResponse = {
  ok: boolean;
  latest: BulletinItem | null;
  items: BulletinItem[];
  source?: string;
  cached?: boolean;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

export default function BulletinPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [items, setItems] = useState<BulletinItem[]>([]);
  const [selected, setSelected] = useState<BulletinItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);

  const loadBulletins = async (accessToken: string) => {
    setError("");
    const res = await fetch("/api/bulletin/latest", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as BulletinResponse;
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "주보 목록을 불러오지 못했습니다");
    }
    setItems(data.items || []);
    setSelected(data.latest || data.items?.[0] || null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      if (!cancelled) setAuthChecked(true);

      try {
        await loadBulletins(session.access_token);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "주보 목록을 불러오지 못했습니다");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      await loadBulletins(session.access_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "주보 목록을 불러오지 못했습니다");
    } finally {
      setRefreshing(false);
    }
  };

  if (!authChecked) {
    return (
      <main style={pageStyle}>
        <LoadingView full />
      </main>
    );
  }

  const latest = selected || items[0] || null;

  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <header style={headerStyle}>
          <button type="button" onClick={() => router.push("/home")} aria-label="홈으로" style={iconButtonStyle}>
            <ArrowLeft size={20} strokeWidth={1.8} />
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={eyebrowStyle}>명성교회</div>
            <h1 style={titleStyle}>주보 보기</h1>
          </div>
          {items.length > 0 && (
            <button type="button" onClick={() => setShowList((v) => !v)} aria-label="주보 목록" style={iconButtonStyle}>
              <List size={19} strokeWidth={1.8} />
            </button>
          )}
          <button type="button" onClick={refresh} aria-label="새로고침" disabled={refreshing} style={iconButtonStyle}>
            <RefreshCw size={19} strokeWidth={1.8} style={{ transform: refreshing ? "rotate(28deg)" : undefined }} />
          </button>
        </header>

        {error ? (
          <div style={emptyStyle}>
            <div style={emptyTitleStyle}>주보 목록을 가져오지 못했습니다</div>
            <div style={emptyTextStyle}>{error}</div>
            <button type="button" onClick={refresh} style={primaryButtonStyle}>다시 불러오기</button>
          </div>
        ) : loading ? (
          <div style={loadingPanelStyle}>최신 주보 확인 중...</div>
        ) : latest ? (
          <>
            {latest.pdf_url ? (
              <section style={pdfFrameWrapStyle}>
                <PdfCanvasViewer
                  key={latest.pdf_url}
                  url={latest.pdf_url}
                  fallbackUrl={latest.pdf_url || latest.url}
                />
              </section>
            ) : (
              <section style={pdfFallbackStyle}>
                저장된 PDF가 없어 교회 홈페이지 원문으로 연결합니다.
              </section>
            )}

            <article style={latestCardStyle}>
              <div style={latestIconStyle}>
                <BookOpen size={26} strokeWidth={1.7} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={badgeStyle}>{latest.issue_date === items[0]?.issue_date ? "기본 주보" : "선택한 주보"}</div>
                <h2 style={latestTitleStyle}>{latest.title}</h2>
                <div style={metaStyle}>
                  {formatDate(latest.issue_date)} 발행
                  {latest.posted_at ? ` · ${formatDate(latest.posted_at)} 등록` : ""}
                </div>
                {latest.volume && <div style={volumeStyle}>{latest.volume}</div>}
              </div>
              <a href={latest.pdf_url || latest.url} target="_blank" rel="noopener noreferrer" style={openButtonStyle}>
                <span>{latest.pdf_url ? "PDF 보기" : "원문 보기"}</span>
                <ExternalLink size={16} strokeWidth={1.8} />
              </a>
            </article>

            {showList && (
              <div style={listOverlayStyle} onClick={() => setShowList(false)}>
                <div style={listStyle} onClick={(e) => e.stopPropagation()}>
                  <div style={listHeaderRowStyle}>
                    <span style={sectionTitleTextStyle}>주보 목록</span>
                    <button type="button" onClick={() => setShowList(false)} aria-label="닫기" style={listCloseStyle}>
                      <X size={18} strokeWidth={1.9} />
                    </button>
                  </div>
                  <div style={listScrollStyle}>
                    {items.slice(0, 10).map((item) => (
                      <button
                        key={`${item.no}-${item.issue_date}`}
                        type="button"
                        onClick={() => {
                          setSelected(item);
                          setShowList(false);
                        }}
                        style={{
                          ...rowStyle,
                          ...(item.issue_date === latest.issue_date ? selectedRowStyle : null),
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={rowTitleStyle}>{item.title}</div>
                          <div style={rowMetaStyle}>
                            {formatDate(item.issue_date)}
                            {item.volume ? ` · ${item.volume}` : ""}
                          </div>
                        </div>
                        <span style={item.issue_date === latest.issue_date ? activeTextStyle : chooseTextStyle}>
                          {item.issue_date === latest.issue_date ? "선택됨" : "선택"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div style={noticeStyle}>
              {latest.pdf_url
                ? "저장된 주보 PDF는 SmartMS 인증 회원에게만 제공됩니다."
                : "아직 저장된 주보 PDF가 없어 교회 홈페이지 원문으로 연결합니다."}
            </div>
          </>
        ) : (
          <div style={emptyStyle}>
            <div style={emptyTitleStyle}>표시할 주보가 없습니다</div>
            <button type="button" onClick={refresh} style={primaryButtonStyle}>다시 불러오기</button>
          </div>
        )}
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "'Noto Sans KR', var(--app-sans), sans-serif",
  paddingLeft: "clamp(12px, 4vw, 24px)",
  paddingRight: "clamp(12px, 4vw, 24px)",
  paddingBottom: "clamp(12px, 4vw, 24px)",
  paddingTop: "clamp(16px, 4vw, 28px)",
};

const shellStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 900,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 16,
};

const iconButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  color: "var(--ink)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "var(--accent)",
  lineHeight: 1.2,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: 1.25,
  fontWeight: 800,
  letterSpacing: 0,
};

const pdfFrameWrapStyle: React.CSSProperties = {
  width: "100%",
  height: "calc(100vh - 132px)",
  minHeight: 520,
  maxHeight: 900,
  border: "1px solid var(--hairline)",
  borderRadius: 12,
  background: "var(--card)",
  overflow: "hidden",
  marginBottom: 12,
};

const pdfFallbackStyle: React.CSSProperties = {
  minHeight: 180,
  borderRadius: 12,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--ink-soft)",
  fontSize: 13,
  lineHeight: 1.5,
  padding: 16,
  marginBottom: 12,
  textAlign: "center",
};

const latestCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  border: "1px solid rgba(62, 90, 74, 0.22)",
  borderRadius: 14,
  background: "linear-gradient(135deg, color-mix(in srgb, var(--surface) 98%, transparent), color-mix(in srgb, var(--accent-soft) 92%, transparent))",
  padding: "clamp(16px, 4vw, 22px)",
  marginBottom: 14,
  flexWrap: "wrap",
};

const latestIconStyle: React.CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: 12,
  background: "#EAF3ED",
  color: "#2F6B4F",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 24,
  padding: "0 9px",
  borderRadius: 999,
  background: "#EAF3ED",
  color: "#2F6B4F",
  fontSize: 12,
  fontWeight: 800,
  marginBottom: 8,
};

const latestTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(20px, 4.8vw, 28px)",
  lineHeight: 1.25,
  fontWeight: 800,
  letterSpacing: 0,
};

const metaStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--ink-soft)",
};

const volumeStyle: React.CSSProperties = {
  marginTop: 5,
  fontSize: 12,
  fontWeight: 700,
  color: "#A4884E",
};

const openButtonStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 10,
  background: "#3E5A4A",
  color: "#FFFDF7",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  fontSize: 13,
  fontWeight: 800,
  flexShrink: 0,
};

const listOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  background: "rgba(20, 26, 22, 0.45)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "clamp(16px, 6vh, 64px) 16px",
  overflowY: "auto",
};

const listStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 520,
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  border: "1px solid var(--hairline)",
  borderRadius: 14,
  background: "var(--surface)",
  overflow: "hidden",
  boxShadow: "0 18px 48px rgba(20, 26, 22, 0.28)",
};

const listHeaderRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "11px 12px 11px 16px",
  borderBottom: "1px solid var(--hairline)",
  flexShrink: 0,
};

const sectionTitleTextStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
};

const listCloseStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 9,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  color: "var(--ink)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const listScrollStyle: React.CSSProperties = {
  overflowY: "auto",
};

const rowStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 68,
  padding: "12px 16px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  borderBottom: "1px solid var(--hairline)",
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  background: "transparent",
  color: "var(--ink)",
  textAlign: "left",
  fontFamily: "inherit",
  cursor: "pointer",
};

const selectedRowStyle: React.CSSProperties = {
  background: "rgba(62, 90, 74, 0.08)",
};

const rowTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.35,
  wordBreak: "keep-all",
  overflowWrap: "anywhere",
};

const rowMetaStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "var(--ink-soft)",
  lineHeight: 1.35,
};

const chooseTextStyle: React.CSSProperties = {
  minWidth: 48,
  flexShrink: 0,
  color: "#3E5A4A",
  fontSize: 12,
  fontWeight: 800,
  textAlign: "right",
};

const activeTextStyle: React.CSSProperties = {
  ...chooseTextStyle,
  color: "#A4884E",
};

const noticeStyle: React.CSSProperties = {
  marginTop: 12,
  padding: "12px 14px",
  borderRadius: 12,
  background: "rgba(164, 136, 78, 0.1)",
  color: "#725A3A",
  fontSize: 12,
  lineHeight: 1.6,
};


const loadingPanelStyle: React.CSSProperties = {
  minHeight: 180,
  borderRadius: 14,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--ink-soft)",
};

const emptyStyle: React.CSSProperties = {
  minHeight: 220,
  borderRadius: 14,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: 20,
  textAlign: "center",
};

const emptyTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
};

const emptyTextStyle: React.CSSProperties = {
  maxWidth: 480,
  fontSize: 13,
  color: "var(--ink-soft)",
  lineHeight: 1.5,
};

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 38,
  padding: "0 14px",
  borderRadius: 10,
  border: "none",
  background: "#3E5A4A",
  color: "#FFFDF7",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};
