"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ScanText } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { BULLETIN_SERVICE_LABELS, BULLETIN_SERVICE_TYPES, type BulletinServiceType } from "@/lib/bulletin/scripture-parser";
import { extractSpatialScriptureCandidates, type OcrLine } from "@/lib/bulletin/scripture-ocr-spatial";

type Bulletin = { id: string; title: string; sunday_date: string; pdf_url: string };
type Reading = { service_type: BulletinServiceType; raw_reference: string; normalized_label: string | null; source: string; confidence: number; status: string };
type ResultState = { kind: "success" | "failed" | "applied" | "submitted"; message: string };

async function call(path: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}`, ...init?.headers } });
}

export default function Page() {
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);
  const [bulletins, setBulletins] = useState<Bulletin[]>([]);
  const [selected, setSelected] = useState<Bulletin | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [values, setValues] = useState<Partial<Record<BulletinServiceType, string>>>({});
  const [results, setResults] = useState<Partial<Record<BulletinServiceType, ResultState>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [needsOcr, setNeedsOcr] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string[]>([]);

  const loadReadings = async (id: string) => {
    const response = await call(`/api/admin/bulletin-scripture-readings?bulletin_id=${id}`);
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "분석 결과를 불러오지 못했습니다.");
    const next = (json.readings || []) as Reading[];
    setReadings(next);
    setValues(Object.fromEntries(next.map((reading) => [reading.service_type, reading.raw_reference])));
    return next;
  };

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc("get_my_status");
      if (!data?.[0] || !["admin", "office", "pastor"].includes(data[0].role)) { router.replace("/home"); return; }
      const response = await call("/api/admin/bulletin-scripture-readings");
      const json = await response.json();
      if (response.ok) setBulletins(json.bulletins || []); else setNotice(json.error || "최근 주보를 불러오지 못했습니다.");
    })();
  }, [router]);

  const runNative = async (bulletin: Bulletin) => {
    setBusy(true); setNotice("텍스트 분석 중입니다…"); setNeedsOcr(false);
    try {
      const response = await call("/api/admin/bulletin-scripture-readings", { method: "POST", body: JSON.stringify({ action: "analyze_native", bulletin_id: bulletin.id }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "텍스트 분석 실패");
      const next = await loadReadings(bulletin.id);
      const found = new Set(next.filter((reading) => reading.source === "pdf_text" || reading.status === "verified").map((reading) => reading.service_type));
      setResults(Object.fromEntries(BULLETIN_SERVICE_TYPES.map((type) => [type, found.has(type) ? { kind: "success", message: "텍스트 분석 성공" } : { kind: "failed", message: "텍스트 분석 실패" }])));
      setNeedsOcr(json.needs_ocr || found.size < 4);
      setNotice(found.size < 4 ? `텍스트 분석 ${found.size}/4 · 실패 항목을 OCR로 분석하시겠습니까?` : "텍스트 분석 4/4 성공 · 적용할 항목을 선택하세요.");
    } catch (error) { setResults(Object.fromEntries(BULLETIN_SERVICE_TYPES.map((type) => [type, { kind: "failed", message: "텍스트 분석 실패" }]))); setNeedsOcr(true); setNotice(error instanceof Error ? error.message : "텍스트 분석 실패"); }
    finally { setBusy(false); }
  };

  const selectBulletin = async (bulletin: Bulletin) => {
    setSelected(bulletin); setReadings([]); setValues({}); setResults({}); setDiagnostic([]); setNeedsOcr(false);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await runNative(bulletin);
  };

  const runOcr = async () => {
    if (!selected) return;
    setBusy(true); setNotice("주보 1페이지 OCR 분석 중입니다…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const file = await fetch(`/api/storage/bulletins/${selected.pdf_url}?stream=1`, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } });
      if (!file.ok) throw new Error("PDF를 불러오지 못했습니다.");
      const pdfjs = await import("pdfjs-dist"); pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const page = await document.getPage(1); const base = page.getViewport({ scale: 1 }); const viewport = page.getViewport({ scale: Math.min(2.25, 1800 / base.width) });
      const canvas = window.document.createElement("canvas"); canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d"); if (!context) throw new Error("OCR canvas 생성 실패");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const { createWorker, PSM } = await import("tesseract.js"); const worker = await createWorker(["kor", "eng"], 1);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }); const output = await worker.recognize(canvas, {}, { blocks: true }); await worker.terminate();
      const blocks = (output.data as unknown as { blocks?: Array<{ paragraphs?: Array<{ lines?: OcrLine[] }> }> }).blocks || [];
      const lines = blocks.flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || [])).filter((line) => line.text.trim());
      const extraction = extractSpatialScriptureCandidates(lines); setDiagnostic(extraction.lines);
      const response = await call("/api/admin/bulletin-scripture-readings", { method: "POST", body: JSON.stringify({ action: "save_ocr_candidates", bulletin_id: selected.id, candidates: extraction.candidates }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error || "OCR 후보 저장 실패");
      const next = await loadReadings(selected.id);
      const accepted = new Set<BulletinServiceType>((json.accepted || []) as BulletinServiceType[]);
      const found = new Set(next.filter((reading) => reading.status === "verified" || (reading.source === "ocr" && accepted.has(reading.service_type))).map((reading) => reading.service_type));
      setResults(Object.fromEntries(BULLETIN_SERVICE_TYPES.map((type) => [type, found.has(type) ? { kind: "success", message: "OCR 분석 성공" } : { kind: "failed", message: "OCR 분석 실패 · 직접 입력 필요" }])));
      setNeedsOcr(false); setNotice(found.size === 4 ? "OCR 분석 4/4 성공 · 적용할 항목을 선택하세요." : `OCR 분석 ${found.size}/4 · 실패 항목은 직접 입력하세요.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "OCR 분석 실패"); }
    finally { setBusy(false); }
  };

  const apply = (type: BulletinServiceType) => {
    if (!values[type]?.trim()) { setResults((old) => ({ ...old, [type]: { kind: "failed", message: "적용할 본문이 없습니다." } })); return; }
    setResults((old) => ({ ...old, [type]: { kind: "applied", message: "적용됨 · 제출 대기" } }));
  };

  const submit = async () => {
    if (!selected) return;
    const targets = BULLETIN_SERVICE_TYPES.filter((type) => results[type]?.kind === "applied");
    if (!targets.length) { setNotice("먼저 각 항목의 적용 버튼을 눌러주세요."); return; }
    setBusy(true); let success = 0;
    for (const type of targets) {
      try {
        const response = await call("/api/admin/bulletin-scripture-readings", { method: "POST", body: JSON.stringify({ action: "save_reading", bulletin_id: selected.id, reading: { serviceType: type, rawReference: values[type], status: "verified" } }) });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || "저장 실패");
        success += 1; setResults((old) => ({ ...old, [type]: { kind: "submitted", message: "✓ 제출 및 저장 완료" } }));
      } catch (error) { setResults((old) => ({ ...old, [type]: { kind: "failed", message: error instanceof Error ? error.message : "저장 실패" } })); }
    }
    await loadReadings(selected.id); setNotice(`${success}/${targets.length}개 항목 제출 완료`); setBusy(false);
  };

  const byType = new Map(readings.map((reading) => [reading.service_type, reading]));
  return <main style={page}><style>{mobileCss}</style><header style={head}><button onClick={() => router.push("/home")} style={back}><ArrowLeft size={18}/></button><div><h1 style={{ margin: 0, fontSize: 21 }}>주보 성경봉독 관리</h1><small>주보 선택 시 텍스트 분석이 자동 실행됩니다.</small></div></header><div className="scripture-grid" style={grid}><section style={card}><b>최근 주보</b>{bulletins.map((item) => <button key={item.id} onClick={() => void selectBulletin(item)} style={{ ...itemButton, ...(selected?.id === item.id ? { background: "var(--accent-soft)" } : {}) }}>{item.sunday_date}<br/><small>{item.title}</small></button>)}</section><section ref={panelRef} style={card}>{selected ? <><b>{selected.sunday_date} 주보</b><p className="actions"><button disabled={busy} onClick={() => void runNative(selected)} style={primary}><ScanText size={16}/>텍스트 재분석</button>{needsOcr && <button disabled={busy} onClick={() => void runOcr()} style={secondary}>텍스트 실패 항목 OCR 분석</button>}</p><p role="status" style={{ fontWeight: 700 }}>{busy ? "처리 중… " : ""}{notice}</p>{diagnostic.length > 0 && <details><summary>OCR 진단 결과 보기</summary><pre style={diagnosticStyle}>{diagnostic.join("\n")}</pre></details>}<h2 style={{ fontSize: 15 }}>분석 결과 적용 및 제출</h2>{BULLETIN_SERVICE_TYPES.map((type) => { const reading = byType.get(type); const state = results[type]; const done = state?.kind === "submitted" || reading?.status === "verified"; return <div className="reading" key={type} style={{ ...readingStyle, background: done ? "color-mix(in srgb, #16803c 10%, transparent)" : undefined }}><label style={{ fontWeight: 800 }}>{BULLETIN_SERVICE_LABELS[type]}</label><input value={values[type] || ""} onChange={(event) => { setValues({ ...values, [type]: event.target.value }); setResults((old) => ({ ...old, [type]: { kind: "success", message: "직접 입력 · 적용 필요" } })); }} placeholder="예: 출애굽기 23:10-13" style={input}/><small style={{ color: done ? "#16803c" : state?.kind === "failed" ? "#b42318" : undefined, fontWeight: 700 }}>{done ? `✓ 저장 완료 · ${reading?.normalized_label || values[type]}` : state?.message || "분석 대기"}</small><button disabled={busy || done || !values[type]?.trim()} onClick={() => apply(type)} style={secondary}>{state?.kind === "applied" ? "적용됨" : done ? "저장됨" : "적용"}</button></div>; })}<button disabled={busy || !BULLETIN_SERVICE_TYPES.some((type) => results[type]?.kind === "applied")} onClick={() => void submit()} style={{ ...primary, marginTop: 14 }}>적용 항목 제출</button></> : <p>주보를 선택하세요.</p>}</section></div></main>;
}

const mobileCss = `@media(max-width:720px){.scripture-grid{grid-template-columns:minmax(0,1fr)!important}.actions{display:grid;gap:8px}.reading{grid-template-columns:minmax(0,1fr) auto!important}.reading label,.reading input,.reading small{grid-column:1/-1}}`;
const page: React.CSSProperties = { maxWidth: 1080, margin: "0 auto", padding: 20, color: "var(--ink)" };
const head: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 };
const back: React.CSSProperties = { border: "1px solid var(--hairline)", background: "var(--surface)", borderRadius: 8, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px,.8fr) minmax(0,2fr)", gap: 16 };
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 12, padding: 15, minWidth: 0 };
const itemButton: React.CSSProperties = { width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--hairline)", padding: "12px 4px", cursor: "pointer", color: "var(--ink)", fontFamily: "inherit" };
const primary: React.CSSProperties = { border: 0, borderRadius: 8, background: "var(--accent)", color: "#fff", padding: "9px 12px", fontWeight: 800, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "center" };
const secondary: React.CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 7, background: "var(--surface)", padding: "7px 9px", cursor: "pointer", fontWeight: 700 };
const input: React.CSSProperties = { minWidth: 0, border: "1px solid var(--hairline)", borderRadius: 7, padding: "9px", fontFamily: "inherit" };
const readingStyle: React.CSSProperties = { borderTop: "1px solid var(--hairline)", padding: "12px 6px", display: "grid", gridTemplateColumns: "110px minmax(180px,1fr) auto", gap: 8, alignItems: "center", borderRadius: 8 };
const diagnosticStyle: React.CSSProperties = { whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 320, overflow: "auto", background: "var(--surface-muted)", padding: 10, borderRadius: 8 };
