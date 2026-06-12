"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Printer, Search, AlertTriangle, X } from "lucide-react";

interface ManifestItem {
  chapterId: string;
  chapterTitle: string;
  stepId: string;
  title: string;
  desc: string;
  shot: string | null;
  error?: string;
}

interface ChapterMeta {
  id: string;
  title: string;
  intro: string | null;
}

interface Manifest {
  generatedAt: string | null;
  chapters: ChapterMeta[];
  items: ManifestItem[];
}

/** 구버전(배열) manifest 도 지원 */
function normalizeManifest(data: unknown): Manifest {
  if (Array.isArray(data)) {
    const items = data as ManifestItem[];
    const chapters = Array.from(
      new Map(items.map(m => [m.chapterId, m.chapterTitle])).entries()
    ).map(([id, title]) => ({ id, title, intro: null }));
    return { generatedAt: null, chapters, items };
  }
  const obj = data as Manifest;
  return {
    generatedAt: obj.generatedAt ?? null,
    chapters: obj.chapters ?? [],
    items: obj.items ?? [],
  };
}

export default function ManualPage() {
  const router = useRouter();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [activeChapter, setActiveChapter] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/manual/shots/manifest.json")
      .then(r => r.json())
      .then((data: unknown) => {
        const m = normalizeManifest(data);
        setManifest(m);
        if (m.chapters.length > 0) setActiveChapter(m.chapters[0].id);
      })
      .catch(() => setManifest({ generatedAt: null, chapters: [], items: [] }));
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

  if (manifest.items.length === 0) {
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

  const { chapters, items } = manifest;
  const currentChapter = chapters.find(c => c.id === activeChapter) ?? null;
  const currentItems = items.filter(m => m.chapterId === activeChapter);
  const generatedDate = manifest.generatedAt
    ? new Date(manifest.generatedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <div style={pageWrap} className="manual-root">
      {/* ════════ 화면용 UI (인쇄 시 숨김) ════════ */}
      <div className="screen-ui">
        {/* ── 헤더 ── */}
        <header style={headerStyle}>
          <button onClick={() => router.push("/home")} style={backBtn} aria-label="홈으로">
            ← 홈
          </button>
          <div style={{ flex: 1, minWidth: 0, paddingLeft: 10 }}>
            <div style={headerTitle}>스마트명성 사용 매뉴얼</div>
            <div style={headerSub}>접속부터 부서 사용까지 · 인쇄(A4) 가능</div>
          </div>
          <button onClick={() => window.print()} style={printBtn} aria-label="인쇄 / PDF 저장">
            <Printer size={16} strokeWidth={1.8} />
            <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 5 }}>인쇄</span>
          </button>
        </header>

        {/* ── 챕터 탭 바 (모바일: 가로 스크롤) ── */}
        <div style={tabBarWrap} ref={tabBarRef} className="manual-tabbar">
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
            {currentChapter?.intro && (
              <div style={introCard}>
                <div style={introLabel}>이 장에서 배우는 것</div>
                <p style={introText}>{currentChapter.intro}</p>
              </div>
            )}
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
                    <div style={{ ...shotOverlay, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Search size={14} strokeWidth={1.8} /> 탭하여 크게 보기</div>
                  </div>
                ) : (
                  <div style={noShot}>{item.error ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} strokeWidth={1.8} /> {item.error}</span> : "스크린샷 준비 중"}</div>
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
            <button style={lbClose} onClick={() => setLightbox(null)} aria-label="닫기"><X size={20} strokeWidth={1.8} /></button>
          </div>
        )}
      </div>

      {/* ════════ 인쇄용 전체 문서 (화면에서는 숨김) ════════ */}
      <div className="print-doc">
        {/* 표지 */}
        <div className="print-cover">
          <div className="print-cover-inner">
            <div className="print-cover-church">명성교회</div>
            <div className="print-cover-title">스마트명성<br />사용 매뉴얼</div>
            <div className="print-cover-sub">접속부터 사역·부서 사용까지, 따라 하기 안내서</div>
            <div className="print-cover-url">접속 주소 &nbsp;|&nbsp; chflow-app.vercel.app</div>
            {generatedDate && <div className="print-cover-date">{generatedDate} 기준</div>}
          </div>
        </div>

        {/* 목차 */}
        <div className="print-toc">
          <div className="print-toc-title">차례</div>
          {chapters.map(ch => (
            <div key={ch.id} className="print-toc-row">
              <span className="print-toc-chapter">{ch.title}</span>
              <span className="print-toc-count">{items.filter(i => i.chapterId === ch.id && i.shot).length}단계</span>
            </div>
          ))}
          <div className="print-toc-note">
            ※ 화면 그림은 실제 앱 화면을 그대로 옮긴 것입니다. 글씨가 작게 보이면 스마트폰에서는 그림을 한 번 탭하여 크게 볼 수 있습니다.
          </div>
        </div>

        {/* 본문: 모든 챕터 */}
        {chapters.map(ch => {
          const chItems = items.filter(i => i.chapterId === ch.id);
          if (chItems.length === 0) return null;
          return (
            <section key={ch.id} className="print-chapter">
              <h2 className="print-chapter-title">{ch.title}</h2>
              {ch.intro && <p className="print-chapter-intro">{ch.intro}</p>}
              {chItems.map((item, idx) => (
                <div key={item.stepId} className="print-step">
                  <div className="print-step-text">
                    <div className="print-step-head">
                      <span className="print-step-num">{idx + 1}</span>
                      <span className="print-step-title">{item.title}</span>
                    </div>
                    <p className="print-step-desc">{item.desc}</p>
                  </div>
                  {item.shot && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className="print-step-img" src={`/manual/shots/${item.shot}`} alt={item.title} />
                  )}
                </div>
              ))}
            </section>
          );
        })}

        <div className="print-footer">
          스마트명성 사용 매뉴얼 · 문의는 앱의 &lsquo;불편신고/건의&rsquo; 메뉴를 이용해 주세요
        </div>
      </div>

      {/* ── 반응형 + 인쇄 CSS ── */}
      <style>{`
        .manual-sidenav { display: none; }
        .manual-tabbar  { display: flex; }
        .print-doc      { display: none; }

        @media (min-width: 768px) {
          .manual-sidenav { display: flex !important; }
          .manual-tabbar  { display: none !important; }
        }

        @page { size: A4 portrait; margin: 12mm; }

        @media print {
          .screen-ui { display: none !important; }
          .print-doc { display: block !important; }
          body, .manual-root { background: #fff !important; }

          .print-cover {
            height: 250mm;
            display: flex; align-items: center; justify-content: center;
            text-align: center;
            page-break-after: always;
          }
          .print-cover-church { font-size: 14pt; font-weight: 600; color: var(--accent); letter-spacing: 6px; margin-bottom: 10mm; }
          .print-cover-title  { font-size: 34pt; font-weight: 800; color: var(--ink); line-height: 1.3; margin-bottom: 8mm; }
          .print-cover-sub    { font-size: 13pt; color: var(--ink-mid); margin-bottom: 18mm; }
          .print-cover-url    { font-size: 13pt; font-weight: 700; color: var(--ink); border: 1.5pt solid var(--ink); border-radius: 4mm; display: inline-block; padding: 3mm 8mm; margin-bottom: 8mm; }
          .print-cover-date   { font-size: 10pt; color: var(--ink-soft); }

          .print-toc { page-break-after: always; padding-top: 10mm; }
          .print-toc-title { font-size: 18pt; font-weight: 800; color: var(--ink); margin-bottom: 8mm; }
          .print-toc-row {
            display: flex; justify-content: space-between; align-items: baseline;
            border-bottom: 0.4pt dotted var(--ink-faint);
            padding: 3.2mm 1mm; font-size: 12pt;
          }
          .print-toc-chapter { font-weight: 600; color: var(--ink); }
          .print-toc-count   { font-size: 10pt; color: var(--ink-soft); }
          .print-toc-note    { margin-top: 10mm; font-size: 10pt; color: var(--ink-mid); line-height: 1.7; }

          .print-chapter { page-break-before: always; }
          .print-chapter-title {
            font-size: 16pt; font-weight: 800; color: var(--ink);
            border-bottom: 1.2pt solid var(--accent);
            padding-bottom: 2.5mm; margin: 0 0 4mm;
          }
          .print-chapter-intro {
            font-size: 10.5pt; color: var(--ink-mid); line-height: 1.75;
            background: var(--bg-soft); border-radius: 2.5mm;
            padding: 3.5mm 4.5mm; margin: 0 0 6mm;
          }

          .print-step {
            display: flex; gap: 6mm; align-items: flex-start;
            break-inside: avoid; page-break-inside: avoid;
            border: 0.5pt solid var(--hairline-strong); border-radius: 3mm;
            padding: 4mm 5mm; margin-bottom: 5mm;
          }
          .print-step-text { flex: 1; min-width: 0; }
          .print-step-head { display: flex; align-items: center; gap: 3mm; margin-bottom: 2.5mm; }
          .print-step-num {
            width: 7mm; height: 7mm; border-radius: 50%;
            background: var(--accent); color: #fff;
            font-size: 10.5pt; font-weight: 700;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          }
          .print-step-title { font-size: 12.5pt; font-weight: 700; color: var(--ink); }
          .print-step-desc  { font-size: 10.5pt; color: var(--ink); line-height: 1.8; margin: 0; }
          .print-step-img {
            width: 46mm; height: auto; flex-shrink: 0;
            border: 0.5pt solid var(--hairline-strong); border-radius: 2mm;
          }

          .print-footer { margin-top: 8mm; text-align: center; font-size: 9pt; color: var(--ink-soft); }
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
  background: "var(--card)",
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
  display: "inline-flex",
  alignItems: "center",
};

/* 모바일 탭 바 */
const tabBarWrap: React.CSSProperties = {
  display: "flex",
  overflowX: "auto",
  gap: 6,
  padding: "10px 14px",
  background: "var(--card)",
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

/* 챕터 소개 카드 */
const introCard: React.CSSProperties = {
  background: "var(--accent-soft)",
  border: "1px solid var(--accent-line)",
  borderRadius: 14,
  padding: "14px 16px",
};
const introLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--accent-strong)",
  marginBottom: 6,
};
const introText: React.CSSProperties = {
  fontSize: 14,
  color: "var(--ink-mid)",
  lineHeight: 1.75,
  margin: 0,
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
  background: "var(--card)",
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
  fontSize: 16,
  fontWeight: 700,
  color: "var(--ink)",
};
const stepDesc: React.CSSProperties = {
  fontSize: 15,
  color: "var(--ink-mid)",
  lineHeight: 1.75,
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
