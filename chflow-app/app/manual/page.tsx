"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { Printer, Download, Search, AlertTriangle, X, ChevronUp, Pencil, Save, Plus, Trash2, Upload, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface ManifestItem {
  chapterId: string;
  chapterTitle: string;
  stepId: string;
  title: string;
  desc: string;
  shot: string | null;
  shotDataUrl?: string | null;
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
  const { confirm } = useConfirm();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [activeChapter, setActiveChapter] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingIntroId, setEditingIntroId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<Manifest | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showTop, setShowTop] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const tabBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: authData }) => {
        const token = authData.session?.access_token;
        return Promise.all([
          fetch("/manual/shots/manifest.json").then(r => r.json()),
          fetch("/api/manual/content", token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
      })
      .then(([staticData, saved]) => {
        const staticManifest = normalizeManifest(staticData);
        const savedManifest = saved?.content ? normalizeManifest(saved.content) : null;
        const staticTime = staticManifest.generatedAt ? Date.parse(staticManifest.generatedAt) : 0;
        const savedTime = savedManifest?.generatedAt ? Date.parse(savedManifest.generatedAt) : 0;
        const m = savedManifest && savedTime >= staticTime ? savedManifest : staticManifest;
        setManifest(m);
        setIsAdmin(!!saved?.can_edit);
        if (m.chapters.length > 0) setActiveChapter(m.chapters[0].id);
      })
      .catch(() => setManifest({ generatedAt: null, chapters: [], items: [] }));
  }, []);

  useEffect(() => {
    function onScroll() {
      setShowTop(window.scrollY > 520);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 탭 선택 시 탭바 스크롤 중앙 정렬
  function selectChapter(id: string) {
    setActiveChapter(id);
    if (tabBarRef.current) {
      const btn = tabBarRef.current.querySelector(`[data-ch="${id}"]`) as HTMLElement;
      if (btn) btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }

  function imageSrc(item: ManifestItem): string | null {
    if (item.shotDataUrl) return item.shotDataUrl;
    if (item.shot) return `/manual/shots/${item.shot}`;
    return null;
  }

  function patchManifest(updater: (current: Manifest) => Manifest) {
    setManifest(current => (current ? updater(current) : current));
  }

  function beginIntroEdit(chapterId: string) {
    setEditSnapshot(manifest);
    setEditingIntroId(chapterId);
    setEditingItemId(null);
  }

  function beginItemEdit(stepId: string) {
    setEditSnapshot(manifest);
    setEditingItemId(stepId);
    setEditingIntroId(null);
  }

  function cancelEdit() {
    if (editSnapshot) setManifest(editSnapshot);
    setEditSnapshot(null);
    setEditingIntroId(null);
    setEditingItemId(null);
    setSaveError(null);
  }

  function updateChapterIntro(id: string, intro: string) {
    patchManifest(current => ({
      ...current,
      chapters: current.chapters.map(ch => ch.id === id ? { ...ch, intro } : ch),
    }));
  }

  function updateItem(stepId: string, patch: Partial<ManifestItem>) {
    patchManifest(current => ({
      ...current,
      items: current.items.map(item => item.stepId === stepId ? { ...item, ...patch } : item),
    }));
  }

  function addItem(item: ManifestItem, placement: "before" | "after") {
    const stepId = `manual-${Date.now()}`;
    patchManifest(current => {
      const baseIndex = current.items.findIndex(i => i.stepId === item.stepId);
      const insertAt = placement === "before" ? baseIndex : baseIndex + 1;
      const newItem: ManifestItem = {
        chapterId: item.chapterId,
        chapterTitle: item.chapterTitle,
        stepId,
        title: "새 설명",
        desc: "추가할 내용을 입력하세요.",
        shot: null,
      };
      const nextItems = [...current.items];
      nextItems.splice(insertAt, 0, newItem);
      return { ...current, items: nextItems };
    });
    setEditingItemId(stepId);
  }

  async function deleteItem(stepId: string) {
    if (!manifest || !await confirm("이 설명 카드 전체를 삭제할까요?")) return;
    const next = { ...manifest, items: manifest.items.filter(item => item.stepId !== stepId) };
    setManifest(next);
    setEditingItemId(null);
    await saveManual(next);
  }

  function handleImageFile(item: ManifestItem, file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateItem(item.stepId, { shotDataUrl: String(reader.result), shot: null, error: undefined });
    };
    reader.readAsDataURL(file);
  }

  async function handlePrint() {
    if (!manifest) return;
    setPrinting(true);
    const srcs = manifest.items
      .map(item => imageSrc(item))
      .filter((s): s is string => !!s);
    await Promise.all(
      srcs.map(src => new Promise<void>(resolve => {
        const img = new window.Image();
        img.onload = img.onerror = () => resolve();
        img.src = src;
      }))
    );
    setPrinting(false);
    window.print();
  }

  async function handleDownloadPdf() {
    setGeneratingPdf(true);
    try {
      const res = await fetch("/api/manual/pdf");
      if (!res.ok) throw new Error("PDF 생성 실패");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "스마트명성_사용매뉴얼.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("PDF 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function saveManual(nextManifest = manifest) {
    if (!nextManifest) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");
      const res = await fetch("/api/manual/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: { ...nextManifest, generatedAt: new Date().toISOString() } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "저장에 실패했습니다.");
      setManifest(json.content);
      setEditSnapshot(null);
      setEditingIntroId(null);
      setEditingItemId(null);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
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
          <button onClick={handlePrint} disabled={printing} style={printBtn} aria-label="인쇄">
            <Printer size={16} strokeWidth={1.8} />
            <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 5 }}>
              {printing ? "준비 중…" : "인쇄"}
            </span>
          </button>
          <button onClick={handleDownloadPdf} disabled={generatingPdf} style={pdfBtn} aria-label="PDF 다운로드">
            <Download size={16} strokeWidth={1.8} />
            <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 5 }}>
              {generatingPdf ? "생성 중…" : "PDF"}
            </span>
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
            {saveError && <div style={errorCard}>{saveError}</div>}

            {currentChapter?.intro && (
              <div style={introCard}>
                <div style={introHead}>
                  <div style={introLabel}>이 장에서 배우는 것</div>
                  {isAdmin && editingIntroId !== currentChapter.id && (
                    <button
                      type="button"
                      style={miniBtn}
                      onClick={() => beginIntroEdit(currentChapter.id)}
                    >
                      <Pencil size={14} strokeWidth={1.8} />
                      수정
                    </button>
                  )}
                </div>
                {editingIntroId === currentChapter.id ? (
                  <>
                  <textarea
                    value={currentChapter.intro || ""}
                    onChange={e => updateChapterIntro(currentChapter.id, e.target.value)}
                    style={{ ...editTextarea, minHeight: 92 }}
                    aria-label={`${currentChapter.title} 소개 수정`}
                  />
                  <div style={editActions}>
                    <button type="button" onClick={() => saveManual()} style={saveMiniBtn} disabled={saving}>
                      <Save size={14} strokeWidth={1.8} />
                      {saving ? "저장 중" : "저장"}
                    </button>
                    <button type="button" onClick={cancelEdit} style={miniBtn}>
                      <XCircle size={14} strokeWidth={1.8} />
                      취소
                    </button>
                  </div>
                  </>
                ) : (
                  <p style={introText}>{currentChapter.intro}</p>
                )}
              </div>
            )}
            {currentItems.map((item, idx) => {
              const isEditing = editingItemId === item.stepId;
              return (
              <div key={item.stepId} style={stepCard} className="step-card">
                <div style={badgeRow}>
                  <span style={numBadge}>{idx + 1}</span>
                  {isEditing ? (
                    <input
                      value={item.title}
                      onChange={e => updateItem(item.stepId, { title: e.target.value })}
                      style={editInput}
                      aria-label="설명 제목 수정"
                    />
                  ) : (
                    <span style={stepTitle}>{item.title}</span>
                  )}
                  {isAdmin && !isEditing && (
                    <button
                      type="button"
                      style={{ ...miniBtn, marginLeft: "auto" }}
                      onClick={() => beginItemEdit(item.stepId)}
                    >
                      <Pencil size={14} strokeWidth={1.8} />
                      수정
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <textarea
                    value={item.desc}
                    onChange={e => updateItem(item.stepId, { desc: e.target.value })}
                    style={editTextarea}
                    aria-label="설명 내용 수정"
                  />
                ) : (
                  <p style={stepDesc}>{item.desc}</p>
                )}
                {imageSrc(item) ? (
                  <div
                    className="manual-shot-wrap"
                    style={shotWrap}
                    onClick={() => setLightbox(imageSrc(item))}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === "Enter" && setLightbox(imageSrc(item))}
                    aria-label={`${item.title} 화면 크게 보기`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageSrc(item)!} alt={item.title} style={shotImg} />
                    <div style={{ ...shotOverlay, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Search size={14} strokeWidth={1.8} /> 탭하여 크게 보기</div>
                  </div>
                ) : (
                  <div style={noShot}>{item.error ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} strokeWidth={1.8} /> {item.error}</span> : "스크린샷 준비 중"}</div>
                )}
                {isEditing && (
                  <div style={editActions}>
                    <button type="button" onClick={() => saveManual()} style={saveMiniBtn} disabled={saving}>
                      <Save size={14} strokeWidth={1.8} />
                      {saving ? "저장 중" : "저장"}
                    </button>
                    <button type="button" onClick={cancelEdit} style={miniBtn}>
                      <XCircle size={14} strokeWidth={1.8} />
                      취소
                    </button>
                    <label style={miniBtn}>
                      <Upload size={14} strokeWidth={1.8} />
                      사진첨부
                      <input
                        type="file"
                        accept="image/*"
                        onChange={e => handleImageFile(item, e.currentTarget.files?.[0] || null)}
                        style={{ display: "none" }}
                      />
                    </label>
                    <button type="button" onClick={() => addItem(item, "before")} style={miniBtn}>
                      <Plus size={14} strokeWidth={1.8} />
                      위에 추가
                    </button>
                    <button type="button" onClick={() => addItem(item, "after")} style={miniBtn}>
                      <Plus size={14} strokeWidth={1.8} />
                      아래에 추가
                    </button>
                    <button type="button" onClick={() => deleteItem(item.stepId)} style={{ ...miniBtn, color: "var(--danger)" }}>
                      <Trash2 size={14} strokeWidth={1.8} />
                      카드 삭제
                    </button>
                  </div>
                )}
              </div>
            );
            })}
          </main>
        </div>

        {showTop && (
          <button
            type="button"
            style={topBtn}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="맨 위로"
          >
            <ChevronUp size={22} strokeWidth={2} />
          </button>
        )}

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
            <div className="print-cover-url">접속 주소 &nbsp;|&nbsp; smartms.kr</div>
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
                  {imageSrc(item) && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className="print-step-img" src={imageSrc(item)!} alt={item.title} />
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

        /* 스크린샷 이미지: 모바일 100%, 520px 이상에서 최대 320px */
        .manual-shot-wrap { width: 100%; max-width: 100%; }
        @media (min-width: 520px) {
          .manual-shot-wrap { max-width: 320px; width: auto; }
        }

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
const pdfBtn: React.CSSProperties = {
  flexShrink: 0,
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "7px 12px",
  fontSize: 16,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
};
const errorCard: React.CSSProperties = {
  background: "var(--danger-soft)",
  border: "1px solid var(--danger)",
  borderRadius: 8,
  padding: "10px 12px",
  color: "var(--danger)",
  fontSize: 13,
  fontWeight: 700,
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
const introHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
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
const editInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "1px solid var(--hairline-strong)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 15,
  fontWeight: 700,
  color: "var(--ink)",
  background: "var(--surface)",
  fontFamily: "inherit",
};
const editTextarea: React.CSSProperties = {
  width: "100%",
  minHeight: 110,
  border: "1px solid var(--hairline-strong)",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
  color: "var(--ink-mid)",
  lineHeight: 1.7,
  background: "var(--surface)",
  fontFamily: "inherit",
  resize: "vertical",
  marginBottom: 14,
};
const editActions: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 12,
};
const miniBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "7px 10px",
  background: "var(--surface)",
  color: "var(--ink-mid)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};
const saveMiniBtn: React.CSSProperties = {
  ...miniBtn,
  background: "var(--accent)",
  borderColor: "var(--accent)",
  color: "#fff",
};

/* 스크린샷 */
const shotWrap: React.CSSProperties = {
  position: "relative",
  display: "block",
  cursor: "zoom-in",
  borderRadius: 12,
  overflow: "hidden",
  border: "1px solid var(--hairline)",
  /* maxWidth는 .manual-shot-wrap CSS 클래스로 반응형 처리 */
};
const shotImg: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
  maxWidth: "100%",
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
const topBtn: React.CSSProperties = {
  position: "fixed",
  right: 18,
  bottom: 22,
  zIndex: 60,
  width: 44,
  height: 44,
  borderRadius: "50%",
  border: "1px solid var(--hairline)",
  background: "var(--ink)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 12px 26px rgba(0,0,0,0.18)",
};
