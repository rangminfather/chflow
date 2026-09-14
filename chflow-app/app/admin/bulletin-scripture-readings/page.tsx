"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ScanText } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { BULLETIN_SERVICE_LABELS, BULLETIN_SERVICE_TYPES, type BulletinServiceType } from "@/lib/bulletin/scripture-parser";

type Bulletin = { id: string; title: string; sunday_date: string; pdf_url: string };
type Reading = { service_type: BulletinServiceType; raw_reference: string; normalized_label: string | null; source: string; confidence: number; status: string };
type Candidate = { serviceType: BulletinServiceType; rawReference: string; confidence: number };
async function call(path: string, init?: RequestInit) { const { data: { session } } = await supabase.auth.getSession(); return fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}`, ...init?.headers } }); }

export default function Page() {
  const router = useRouter(); const [bulletins, setBulletins] = useState<Bulletin[]>([]); const [selected, setSelected] = useState<Bulletin | null>(null); const [readings, setReadings] = useState<Reading[]>([]); const [manual, setManual] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const load = async (id?: string) => { const res = await call(`/api/admin/bulletin-scripture-readings${id ? `?bulletin_id=${id}` : ""}`); const json = await res.json(); if (id) setReadings(json.readings || []); else setBulletins(json.bulletins || []); };
  useEffect(() => { void (async () => { const { data } = await supabase.rpc("get_my_status"); if (!data?.[0] || !["admin", "office", "pastor"].includes(data[0].role)) { router.replace("/home"); return; } await load(); })(); }, [router]);
  const select = async (item: Bulletin) => { setSelected(item); setReadings([]); setNotice(""); await load(item.id); };
  const native = async () => { if (!selected) return; setBusy(true); const res = await call("/api/admin/bulletin-scripture-readings", { method: "POST", body: JSON.stringify({ action: "analyze_native", bulletin_id: selected.id }) }); const json = await res.json(); setNotice(res.ok ? `텍스트 분석 완료: ${json.saved}개 후보 저장${json.needs_ocr ? " · OCR fallback을 실행합니다." : ""}` : json.error); await load(selected.id); setBusy(false); if (res.ok && json.needs_ocr) await ocr(); };
  const ocr = async () => { if (!selected) return; setBusy(true); setNotice("1페이지 OCR 분석 중입니다…"); try {
    const { data: { session } } = await supabase.auth.getSession(); const file = await fetch(`/api/storage/bulletins/${selected.pdf_url}?stream=1`, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } }); if (!file.ok) throw new Error("PDF를 불러오지 못했습니다.");
    const pdfjs = await import("pdfjs-dist"); pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; const page = await doc.getPage(1); const base = page.getViewport({ scale: 1 }); const viewport = page.getViewport({ scale: Math.min(2.25, 1800 / base.width) }); const canvas = document.createElement("canvas"); canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height); const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("OCR canvas 생성 실패"); await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const { createWorker, PSM } = await import("tesseract.js"); const worker = await createWorker(["kor", "eng"], 1);
    // Tesseract v7 does not include word boxes unless the blocks output is explicitly requested.
    // Sparse-text mode preserves the separate columns in the first-page order of service.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }); const result = await worker.recognize(canvas, {}, { blocks: true }); await worker.terminate();
    type Box = { x0: number; y0: number; x1: number; y1: number }; type OcrLine = { text: string; bbox: Box; confidence: number };
    const blocks = (result.data as unknown as { blocks?: Array<{ paragraphs?: Array<{ lines?: OcrLine[] }> }> }).blocks || [];
    const lines = blocks.flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || [])).filter((line) => line.text.trim());
    // Prefer a service-heading anchor and relative geometry. The final fallback is only used for
    // an OCR layout that has lost its heading, and all candidates are still NKRV-validated server-side.
    const service = (text: string): BulletinServiceType | null => /수요\s*오전/.test(text) ? "wednesday_morning" : /수요\s*(?:오후|저녁)/.test(text) ? "wednesday_evening" : /(?:주일.*오전|[123]\s*부.*오전)/.test(text) ? "sunday_morning" : /(?:주일.*오후|4\s*부.*예배|예배.*오후)/.test(text) ? "sunday_afternoon" : null;
    const headers = lines.flatMap((line) => { const type = service(line.text); return type ? [{ ...line, type }] : []; });
    const scriptureAnchors = lines.filter((line) => /[성섬]경.*(?:봉독|강론)/.test(line.text));
    const referenceVariants = (text: string) => [...text.matchAll(/([가-힣]{1,10})\s*(\d[\d\s:.-]{1,14})/g)].flatMap((match) => {
      const book = match[1]; const range = match[2].replace(/\s+/g, "").replace(/[~∼]/g, "-").replace(/[).]+$/g, "");
      if (/:/.test(range)) return [`${book} ${range}`];
      const compact = range.match(/^(\d{2,6})-(\d{1,3})$/); if (!compact) return [];
      // OCR can omit the colon (2310-13). Send only plausible split variants; NKRV validation
      // on the server rejects every invalid split before a pending row is written.
      return Array.from({ length: compact[1].length - 1 }, (_, index) => `${book} ${compact[1].slice(0, index + 1)}:${compact[1].slice(index + 1)}-${compact[2]}`);
    });
    const candidates: Candidate[] = [];
    for (const line of lines) {
      if (!scriptureAnchors.some((anchor) => Math.abs(anchor.bbox.y0 - line.bbox.y0) < 45)) continue;
      for (const rawReference of referenceVariants(line.text)) {
      const centerX = (line.bbox.x0 + line.bbox.x1) / 2; const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
      const heading = headers.filter((item) => item.bbox.y0 <= line.bbox.y1).sort((a, b) => (Math.abs(((a.bbox.x0 + a.bbox.x1) / 2) - centerX) + Math.abs(a.bbox.y0 - centerY) * .25) - (Math.abs(((b.bbox.x0 + b.bbox.x1) / 2) - centerX) + Math.abs(b.bbox.y0 - centerY) * .25))[0];
        if (heading) candidates.push({ serviceType: heading.type, rawReference, confidence: Math.min(.9, .55 + line.confidence / 200) });
      }
    }
    const saved = await call("/api/admin/bulletin-scripture-readings", { method: "POST", body: JSON.stringify({ action: "save_ocr_candidates", bulletin_id: selected.id, candidates }) }); const json = await saved.json(); setNotice(saved.ok ? `OCR 분석 완료: ${json.saved}개 후보 저장` : json.error); await load(selected.id);
  } catch (error) { setNotice(error instanceof Error ? error.message : "OCR 분석 실패"); } finally { setBusy(false); } };
  const verify = async (type: BulletinServiceType) => { if (!selected || !manual[type]?.trim()) return; setBusy(true); const res = await call("/api/admin/bulletin-scripture-readings", { method: "POST", body: JSON.stringify({ action: "save_reading", bulletin_id: selected.id, reading: { serviceType: type, rawReference: manual[type], status: "verified" } }) }); const json = await res.json(); setNotice(res.ok && json.ok ? "검증 및 저장했습니다." : json.error || "저장 실패"); await load(selected.id); setBusy(false); };
  return <main style={page}><header style={head}><button onClick={() => router.push("/home")} style={back}><ArrowLeft size={18}/></button><div><h1 style={{ margin: 0, fontSize: 21 }}>주보 성경봉독 관리</h1><small>후보는 확인 전까지 성도에게 보이지 않습니다.</small></div></header><div style={grid}><section style={card}><b>최근 주보</b>{bulletins.map((item) => <button key={item.id} onClick={() => void select(item)} style={{ ...itemButton, ...(selected?.id === item.id ? { background: "var(--accent-soft)" } : {}) }}>{item.sunday_date}<br/><small>{item.title}</small></button>)}</section><section style={card}>{selected ? <><b>{selected.sunday_date} 주보</b><p><button disabled={busy} onClick={() => void native()} style={primary}><ScanText size={16}/>텍스트 분석</button> <button disabled={busy} onClick={() => void ocr()} style={secondary}>1페이지 OCR 분석</button></p>{notice && <p style={{ fontSize: 13 }}>{notice}</p>}{readings.map((reading) => <div key={reading.service_type} style={readingStyle}><b>{BULLETIN_SERVICE_LABELS[reading.service_type]}</b><div>{reading.normalized_label || reading.raw_reference}</div><small>{reading.status} · {reading.source} · confidence {reading.confidence}</small></div>)}<h2 style={{ fontSize: 15 }}>직접 입력 및 확인</h2>{BULLETIN_SERVICE_TYPES.map((type) => <div key={type} style={{ display: "flex", gap: 7, margin: "8px 0", flexWrap: "wrap" }}><label style={{ minWidth: 105, fontWeight: 700 }}>{BULLETIN_SERVICE_LABELS[type]}</label><input value={manual[type] || ""} onChange={(e) => setManual({ ...manual, [type]: e.target.value })} placeholder="예: 출애굽기 23:10-13" style={input}/><button disabled={busy} onClick={() => void verify(type)} style={secondary}>검증 후 저장</button></div>)}</> : <p>왼쪽에서 주보를 선택하세요.</p>}</section></div></main>;
}
const page: React.CSSProperties = { maxWidth: 1080, margin: "0 auto", padding: 20, color: "var(--ink)" }; const head: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }; const back: React.CSSProperties = { border: "1px solid var(--hairline)", background: "var(--surface)", borderRadius: 8, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer" }; const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px,.8fr) minmax(0,2fr)", gap: 16 }; const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 12, padding: 15 }; const itemButton: React.CSSProperties = { width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--hairline)", padding: "12px 4px", cursor: "pointer", color: "var(--ink)", fontFamily: "inherit" }; const primary: React.CSSProperties = { border: 0, borderRadius: 8, background: "var(--accent)", color: "#fff", padding: "9px 12px", fontWeight: 800, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }; const secondary: React.CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 7, background: "var(--surface)", padding: "7px 9px", cursor: "pointer", fontWeight: 700 }; const input: React.CSSProperties = { flex: 1, minWidth: 180, border: "1px solid var(--hairline)", borderRadius: 7, padding: "7px 9px", fontFamily: "inherit" }; const readingStyle: React.CSSProperties = { borderTop: "1px solid var(--hairline)", padding: "10px 0" };
