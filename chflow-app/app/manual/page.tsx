"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface ManifestItem {
  chapterId: string;
  chapterTitle: string;
  stepId: string;
  title: string;
  desc: string;
  shot: string | null;
  error?: string;
}

export default function ManualPage() {
  const router = useRouter();
  const [manifest, setManifest] = useState<ManifestItem[] | null>(null);
  const [activeChapter, setActiveChapter] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/manual/shots/manifest.json")
      .then(r => r.json())
      .then((data: ManifestItem[]) => {
        setManifest(data);
        if (data.length > 0) setActiveChapter(data[0].chapterId);
      })
      .catch(() => setManifest([]));
  }, []);

  // 탭 선택 시 탭바 스크롤 중앙 정렬
  function selectChapter(id: string) {
    setActiveChapter(id);
    if (tabBarRef.current) {
      const btn = tabBarRef.current.querySelector(`[data-ch="${id}"]`) as HTMLElement;
      if (btn) btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }

  if (manifest === null) {
    return <div style={loadWrap}><div style={loadText}>매뉴얼 로딩 중…</div></div>;
  }

  if (manifest.length === 0) {
    return (
      <div style={loadWrap}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>스크린샷이 없습니다</p>
          <code style={{ background: "var(--bg-soft)", padding: "8px 14px", borderRadius: 8, fontSize: 13 }}>
            npm run manual
          </code>
        </div>
      </div>
    );
  }

  const chapters = Array.from(
    new Map(manifest.map(m => [m.chapterId, m.chapterTitle])).entries()
  ).map(([id, title]) => ({ id, title }));

  const currentItems = manifest.filter(m => m.chapterId === activeChapter);

  return (
    <div style={pageWrap}>
      {/* ── 헤더 ── */}
      <header style={headerStyle}>
        <button onClick={() => router.push("/home")} style={backBtn} aria-label="홈으로">
          ← 홈
        </button>
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 10 }}>
          <div style={headerTitle}>스마트명성 사용 매뉴얼</div>
          <div style={headerSub}>초등1부 교육사역국</div>
        </div>
        <button onClick={() => window.print()} style={printBtn} aria-label="PDF 저장">
          🖨
        </button>
      </header>

      {/* ── 챕터 탭 바 (모바일: 가로 스크롤) ── */}
      <div style={tabBarWrap} ref={tabBarRef}>
        {chapters.map(ch => (
          <button
            key={ch.id}
            data-ch={ch.id}
            onClick={() => selectChapter(ch.id)}
            style={{
              ...tabBtn,
              ...(activeChapter === ch.id ? tabBtnActive : {}),
            }}
          >
            {ch.title}
          </button>
        ))}
      </div>

      {/* ── 메인 레이아웃 ── */}
      <div style={layoutStyle}>
        {/* 데스크톱 사이드 네비 (768px 이상에서만 표시) */}
        <nav style={sideNav} className="manual-sidenav">
          {chapters.map(ch => (
            <button
              key={ch.id}
              onClick={() => selectChapter(ch.id)}
              style={{
                ...sideItem,
                ...(activeChapter === ch.id ? sideItemActive : {}),
              }}
            >
              {ch.title}
            </button>
          ))}
        </nav>

        {/* 스텝 목록 */}
        <main style={mainStyle}>
          {currentItems.map((item, idx) => (
            <div key={item.stepId} style={stepCard} className="step-card">
              <div style={badgeRow}>
                <span style={numBadge}>{idx + 1}</span>
                <span style={stepTitle}>{item.title}</span>
              </div>
              <p style={stepDesc}>{item.desc}</p>
              {item.shot ? (
                <div
                  style={shotWrap}
                  onClick={() => setLightbox(`/manual/shots/${item.shot}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === "Enter" && setLightbox(`/manual/shots/${item.shot}`)}
                  aria-label={`${item.title} 화면 크게 보기`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/manual/shots/${item.shot}`} alt={item.title} style={shotImg} />
                  <div style={shotOverlay}>🔍 탭하여 크게 보기</div>
                </div>
              ) : (
                <div style={noShot}>{item.error ? `⚠ ${item.error}` : "스크린샷 준비 중"}</div>
              )}
            </div>
          ))}
        </main>
      </div>

      {/* ── 라이트박스 ── */}
      {lightbox && (
        <div style={lbOverlay} onClick={() => setLightbox(null)} role="dialog" aria-modal>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="확대 보기"
            style={lbImg}
            onClick={e => e.stopPropagation()}
          />
          <button style={lbClose} onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}

      {/* ── 반응형 + 인쇄 CSS ── */}
      <style>{`
        .manual-sidenav { display: none; }
        .manual-tabbar  { display: flex; }

        @media (min-width: 768px) {
          .manual-sidenav { display: flex !important; }
          .manual-tabbar  { display: none !important; }
        }

        @media print {
          header, .manual-sidenav, .manual-tabbar { display: none !important; }
          .step-card { break-inside: avoid; margin-bottom: 24px; }
        }
      `}</style>
    </div>
  );
}

// ── 스타일 토큰 ────────────────────────────────────────────
const pageWrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const loadWrap: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const loadText: React.CSSProperties = { fontSize: 15, color: "var(--ink-soft)" };

const headerStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "10px 16px",
  background: "#fff",
  borderBottom: "1px solid var(--hairline)",
};
const headerTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: "var(--ink)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const headerSub: React.CSSProperties = { fontSize: 11, color: "var(--ink-faint)" };
const backBtn: React.CSSProperties = {
  flexShrink: 0,
  background: "transparent",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  color: "var(--ink-mid)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const printBtn: React.CSSProperties = {
  flexShrink: 0,
  background: "var(--ink)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "7px 12px",
  fontSize: 16,
  cursor: "pointer",
};

/* 모바일 탭 바 */
const tabBarWrap: React.CSSProperties = {
  display: "flex",
  overflowX: "auto",
  gap: 6,
  padding: "10px 14px",
  background: "#fff",
  borderBottom: "1px solid var(--hairline)",
  scrollbarWidth: "none",
  WebkitOverflowScrolling: "touch",
};
const tabBtn: React.CSSProperties = {
  flexShrink: 0,
  padding: "7px 14px",
  borderRadius: 20,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--ink-mid)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "all 0.15s",
};
const tabBtnActive: React.CSSProperties = {
  background: "var(--info)",
  borderColor: "var(--info)",
  color: "#fff",
  fontWeight: 700,
};

/* 레이아웃 */
const layoutStyle: React.CSSProperties = {
  display: "flex",
  maxWidth: 1100,
  margin: "0 auto",
  padding: "16px 12px 40px",
  gap: 24,
  alignItems: "flex-start",
};

/* 데스크톱 사이드 네비 */
const sideNav: React.CSSProperties = {
  width: 210,
  flexShrink: 0,
  flexDirection: "column",
  gap: 4,
  position: "sticky",
  top: 100,
  alignSelf: "flex-start",
};
const sideItem: React.CSSProperties = {
  textAlign: "left",
  border: "none",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--ink-mid)",
  background: "transparent",
  cursor: "pointer",
  lineHeight: 1.4,
  width: "100%",
};
const sideItemActive: React.CSSProperties = {
  background: "var(--info-soft)",
  color: "var(--info)",
  fontWeight: 700,
};

/* 스텝 카드 */
const mainStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};
const stepCard: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--hairline)",
  borderRadius: 14,
  padding: "18px 16px",
};
const badgeRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 8,
};
const numBadge: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: "50%",
  background: "var(--info)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const stepTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "var(--ink)",
};
const stepDesc: React.CSSProperties = {
  fontSize: 14,
  color: "var(--ink-mid)",
  lineHeight: 1.65,
  margin: "0 0 14px",
};

/* 스크린샷 */
const shotWrap: React.CSSProperties = {
  position: "relative",
  display: "block",
  cursor: "zoom-in",
  borderRadius: 12,
  overflow: "hidden",
  border: "1px solid var(--hairline)",
  maxWidth: 320,          /* 모바일에서도 넉넉한 폭 */
};
const shotImg: React.CSSProperties = {
  display: "block",
  width: "100%",
};
const shotOverlay: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  background: "rgba(0,0,0,0.42)",
  color: "#fff",
  fontSize: 12,
  padding: "5px 0",
  textAlign: "center",
};
const noShot: React.CSSProperties = {
  fontSize: 12,
  color: "var(--ink-faint)",
  padding: "12px 14px",
  background: "var(--surface)",
  borderRadius: 8,
  border: "1px dashed var(--hairline-strong)",
};

/* 라이트박스 */
const lbOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.88)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const lbImg: React.CSSProperties = {
  maxHeight: "90vh",
  maxWidth: "92vw",
  borderRadius: 10,
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
};
const lbClose: React.CSSProperties = {
  position: "fixed",
  top: 18,
  right: 20,
  background: "rgba(255,255,255,0.18)",
  border: "none",
  color: "#fff",
  fontSize: 20,
  width: 38,
  height: 38,
  borderRadius: "50%",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
