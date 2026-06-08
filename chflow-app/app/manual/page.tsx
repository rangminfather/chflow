"use client";

import { useState, useEffect } from "react";
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

  useEffect(() => {
    fetch("/manual/shots/manifest.json")
      .then(r => r.json())
      .then(data => {
        setManifest(data);
        if (data.length > 0) setActiveChapter(data[0].chapterId);
      })
      .catch(() => setManifest([]));
  }, []);

  if (manifest === null) {
    return (
      <div style={pageWrap}>
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>매뉴얼 로딩 중...</div>
      </div>
    );
  }

  if (manifest.length === 0) {
    return (
      <div style={pageWrap}>
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b", marginBottom: 12 }}>
            매뉴얼 스크린샷이 없습니다
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24 }}>
            아래 명령어로 스크린샷을 생성하세요:
          </div>
          <code style={{ background: "#f1f5f9", padding: "10px 16px", borderRadius: 8, fontSize: 13 }}>
            node scripts/generate-manual.js
          </code>
        </div>
      </div>
    );
  }

  // 챕터 목록 추출 (중복 제거)
  const chapters = Array.from(
    new Map(manifest.map(m => [m.chapterId, m.chapterTitle])).entries()
  ).map(([id, title]) => ({ id, title }));

  const currentItems = manifest.filter(m => m.chapterId === activeChapter);

  return (
    <div style={pageWrap}>
      {/* 헤더 */}
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push("/home")} style={backBtn}>← 홈</button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>스마트명성 사용 매뉴얼</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>초등1부 교육사역국</div>
          </div>
        </div>
        <button onClick={() => window.print()} style={printBtn}>🖨 PDF 저장</button>
      </header>

      <div style={layoutStyle}>
        {/* 사이드 챕터 네비게이션 */}
        <nav style={navStyle}>
          {chapters.map(ch => (
            <button
              key={ch.id}
              onClick={() => setActiveChapter(ch.id)}
              style={{
                ...navItem,
                background: activeChapter === ch.id ? "#e8eff7" : "transparent",
                color: activeChapter === ch.id ? "#1e4e8c" : "#475569",
                fontWeight: activeChapter === ch.id ? 700 : 500,
              }}
            >
              {ch.title}
            </button>
          ))}
        </nav>

        {/* 스텝 목록 */}
        <main style={mainStyle}>
          {currentItems.map((item, idx) => (
            <div key={item.stepId} style={stepCard}>
              <div style={stepNumBadge}>{idx + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={stepTitle}>{item.title}</div>
                <div style={stepDesc}>{item.desc}</div>
                {item.shot ? (
                  <div
                    style={shotWrap}
                    onClick={() => setLightbox(`/manual/shots/${item.shot}`)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/manual/shots/${item.shot}`}
                      alt={item.title}
                      style={shotImg}
                    />
                    <div style={shotHint}>클릭하여 크게 보기</div>
                  </div>
                ) : (
                  <div style={noShot}>
                    {item.error ? `⚠ 스크린샷 오류: ${item.error}` : "스크린샷 없음"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </main>
      </div>

      {/* 라이트박스 */}
      {lightbox && (
        <div style={lightboxOverlay} onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="확대 보기" style={lightboxImg} onClick={e => e.stopPropagation()} />
          <button style={lightboxClose} onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}

      {/* 인쇄용 스타일 */}
      <style>{`
        @media print {
          nav, header button, .no-print { display: none !important; }
          .step-card { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────
const pageWrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f8fafc",
  fontFamily: "'Noto Sans KR', sans-serif",
};
const headerStyle: React.CSSProperties = {
  background: "#fff",
  borderBottom: "1px solid #e2e8f0",
  padding: "14px 20px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  position: "sticky",
  top: 0,
  zIndex: 10,
};
const backBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "6px 14px",
  fontSize: 13,
  cursor: "pointer",
  color: "#475569",
};
const printBtn: React.CSSProperties = {
  background: "#1e293b",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const layoutStyle: React.CSSProperties = {
  display: "flex",
  maxWidth: 1100,
  margin: "0 auto",
  padding: "24px 16px",
  gap: 24,
};
const navStyle: React.CSSProperties = {
  width: 220,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  position: "sticky",
  top: 80,
  alignSelf: "flex-start",
};
const navItem: React.CSSProperties = {
  textAlign: "left",
  border: "none",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  cursor: "pointer",
  lineHeight: 1.4,
  transition: "all 0.15s",
};
const mainStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 28,
};
const stepCard: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 20,
  display: "flex",
  gap: 16,
};
const stepNumBadge: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  background: "#1e4e8c",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  marginTop: 2,
};
const stepTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "#1e293b",
  marginBottom: 6,
};
const stepDesc: React.CSSProperties = {
  fontSize: 14,
  color: "#475569",
  lineHeight: 1.6,
  marginBottom: 14,
};
const shotWrap: React.CSSProperties = {
  position: "relative",
  display: "inline-block",
  cursor: "zoom-in",
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid #e2e8f0",
  maxWidth: 240,
};
const shotImg: React.CSSProperties = {
  display: "block",
  width: "100%",
};
const shotHint: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  background: "rgba(0,0,0,0.45)",
  color: "#fff",
  fontSize: 11,
  padding: "4px 0",
  textAlign: "center",
};
const noShot: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  padding: "12px 16px",
  background: "#f8fafc",
  borderRadius: 8,
  border: "1px dashed #cbd5e1",
};
const lightboxOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.85)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const lightboxImg: React.CSSProperties = {
  maxHeight: "90vh",
  maxWidth: "90vw",
  borderRadius: 12,
  boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
};
const lightboxClose: React.CSSProperties = {
  position: "fixed",
  top: 20,
  right: 24,
  background: "rgba(255,255,255,0.15)",
  border: "none",
  color: "#fff",
  fontSize: 22,
  width: 40,
  height: 40,
  borderRadius: "50%",
  cursor: "pointer",
};
