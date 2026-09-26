"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, CheckCheck, ExternalLink, ScanText } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { BULLETIN_SERVICE_LABELS, BULLETIN_SERVICE_TYPES, type BulletinServiceType } from "@/lib/bulletin/scripture-parser";

type ExtractionStatus = "retry" | "done" | "review" | "failed";
type Bulletin = { id: string; title: string; sunday_date: string; pdf_url: string; extraction_status: ExtractionStatus | null };
type Reading = { service_type: BulletinServiceType; raw_reference: string; normalized_label: string | null; book_id: number | null; source: string; status: string; sort_order: number };
type Extraction = { status: ExtractionStatus; attempts: number; model_results: Record<string, Partial<Record<BulletinServiceType, string[]>> & { error?: string }>; last_error: string | null; updated_at: string };

type HealthWarning = { code: string; level: "action" | "watch"; message: string };
type Run = {
  bulletin_id: string | null; trigger: "cron" | "manual"; started_at: string; duration_ms: number; budget_ms: number; render_ms: number | null;
  models: Array<{ model: string; ok: boolean; ms: number; status: number | string }>; result_status: ExtractionStatus | "deferred"; time_limited: boolean; note: string | null;
};
type Health = { warnings: HealthWarning[]; runs: Run[] };
const RUN_STATUS_TEXT: Record<Run["result_status"], string> = { done: "완료", review: "확인 필요", retry: "재시도 대기", failed: "실패", deferred: "시간 부족으로 미룸" };

const STATUS_TEXT: Record<ExtractionStatus, string> = { done: "자동 게시 완료", review: "확인 필요", retry: "재시도 대기", failed: "자동 판독 실패" };
const STATUS_COLOR: Record<ExtractionStatus, string> = { done: "var(--success)", review: "var(--warning)", retry: "var(--ink-soft)", failed: "var(--danger)" };

async function call(path: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}`, ...init?.headers } });
}

function slotText(rows: Reading[]) {
  return rows.map((row) => row.normalized_label || row.raw_reference).join(", ");
}

export default function Page() {
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);
  const [bulletins, setBulletins] = useState<Bulletin[]>([]);
  const [selected, setSelected] = useState<Bulletin | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [values, setValues] = useState<Partial<Record<BulletinServiceType, string>>>({});
  const [slotMessage, setSlotMessage] = useState<Partial<Record<BulletinServiceType, { ok: boolean; text: string }>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [health, setHealth] = useState<Health | null>(null);

  const loadBulletins = async () => {
    const response = await call("/api/admin/bulletin-scripture-readings");
    const json = await response.json();
    if (!response.ok) { setNotice(json.error || "최근 주보를 불러오지 못했습니다."); return [] as Bulletin[]; }
    const next = (json.bulletins || []) as Bulletin[];
    setBulletins(next);
    setHealth(json.health || null);
    return next;
  };

  const loadReadings = async (id: string) => {
    const response = await call(`/api/admin/bulletin-scripture-readings?bulletin_id=${id}`);
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "성경봉독을 불러오지 못했습니다.");
    const next = (json.readings || []) as Reading[];
    setReadings(next);
    setExtraction(json.extraction || null);
    setValues(Object.fromEntries(BULLETIN_SERVICE_TYPES.map((type) => [type, slotText(next.filter((row) => row.service_type === type))])));
  };

  const selectBulletin = async (bulletin: Bulletin) => {
    setSelected(bulletin); setSlotMessage({}); setNotice("");
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try { await loadReadings(bulletin.id); } catch (error) { setNotice(error instanceof Error ? error.message : "불러오기 실패"); }
  };

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc("get_my_status");
      if (!data?.[0] || !["admin", "office", "pastor"].includes(data[0].role)) { router.replace("/home"); return; }
      const next = await loadBulletins();
      const requestedId = new URLSearchParams(window.location.search).get("bulletin_id");
      const requested = requestedId ? next.find((bulletin) => bulletin.id === requestedId) : null;
      if (requested) void selectBulletin(requested);
    })();
    // Initial admin authorization and deep-link selection only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const refresh = async (bulletin: Bulletin) => {
    await loadReadings(bulletin.id);
    const next = await loadBulletins();
    setSelected(next.find((item) => item.id === bulletin.id) ?? bulletin);
  };

  const extractAgain = async () => {
    if (!selected) return;
    setBusy(true); setNotice("주보 1쪽을 AI 로 판독하는 중입니다… (최대 1분)"); setSlotMessage({});
    try {
      const response = await call("/api/admin/bulletin-scripture-readings", { method: "POST", body: JSON.stringify({ action: "extract_ai", bulletin_id: selected.id }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "AI 판독 실패");
      await refresh(selected);
      setNotice(`AI 판독 결과: ${STATUS_TEXT[json.status as ExtractionStatus] || json.status}${json.errors?.length ? ` · ${json.errors.join(" | ")}` : ""}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "AI 판독 실패"); }
    finally { setBusy(false); }
  };

  const saveSlot = async (type: BulletinServiceType) => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await call("/api/admin/bulletin-scripture-readings", { method: "POST", body: JSON.stringify({ action: "save_slot", bulletin_id: selected.id, service_type: type, references: values[type] || "" }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "저장 실패");
      await loadReadings(selected.id);
      setSlotMessage((old) => ({ ...old, [type]: { ok: true, text: values[type]?.trim() ? "저장되어 게시됨" : "비움" } }));
    } catch (error) { setSlotMessage((old) => ({ ...old, [type]: { ok: false, text: error instanceof Error ? error.message : "저장 실패" } })); }
    finally { setBusy(false); }
  };

  const approve = async (types: BulletinServiceType[]) => {
    if (!selected || !types.length) return;
    setBusy(true);
    try {
      const response = await call("/api/admin/bulletin-scripture-readings", { method: "POST", body: JSON.stringify({ action: "approve", bulletin_id: selected.id, service_types: types }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "승인 실패");
      await refresh(selected);
      setNotice(`${(json.approved || []).length}개 예배 본문을 승인했습니다.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "승인 실패"); }
    finally { setBusy(false); }
  };

  const rowsFor = (type: BulletinServiceType) => readings.filter((row) => row.service_type === type).sort((a, b) => a.sort_order - b.sort_order);
  const pendingTypes = BULLETIN_SERVICE_TYPES.filter((type) => { const rows = rowsFor(type); return rows.some((row) => row.status === "pending") && rows.every((row) => row.book_id != null); });
  const modelEntries = Object.entries(extraction?.model_results || {});

  return <main className="scripture-admin-page" style={page}>
    <style>{`${mobileCss}${desktopCss}`}</style>
    <header style={head}>
      <button onClick={() => router.push("/home")} style={back} aria-label="뒤로"><ArrowLeft size={18}/></button>
      <div><h1 style={{ margin: 0, fontSize: 21 }}>주보 성경봉독 관리</h1><small style={{ color: "var(--ink-soft)" }}>새 주보가 올라오면 AI 가 자동으로 읽어 게시합니다. 확인이 필요한 항목만 처리하세요.</small></div>
    </header>
    {health && <section style={{ ...card, marginBottom: 16 }}>
      <b style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Activity size={16}/>자동 판독 자가 진단</b>
      {health.warnings.length === 0
        ? <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--success)", fontWeight: 700 }}>최근 14일 실행 기록에서 조치가 필요한 신호가 없습니다.</p>
        : <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>{health.warnings.map((warning) => <li key={warning.code} style={{ color: warning.level === "action" ? "var(--danger)" : "var(--warning)", fontWeight: 700, marginTop: 3 }}>{warning.level === "action" ? "조치 필요 · " : "지켜보기 · "}{warning.message}</li>)}</ul>}
      {health.runs.length > 0 && <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 13 }}>최근 실행 기록 {health.runs.length}건 (소요 시간 / 쓸 수 있던 시간)</summary>
        <div style={{ overflowX: "auto" }}><table style={runTable}><thead><tr><th style={runCell}>시각</th><th style={runCell}>방식</th><th style={runCell}>소요/여유</th><th style={runCell}>결과</th><th style={runCell}>모델별 응답</th></tr></thead><tbody>
          {health.runs.map((run) => <tr key={run.started_at + (run.bulletin_id || "")}>
            <td style={runCell}>{new Date(run.started_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
            <td style={runCell}>{run.trigger === "cron" ? "자동" : "수동"}</td>
            <td style={{ ...runCell, color: run.time_limited ? "var(--danger)" : undefined }}>{(run.duration_ms / 1000).toFixed(1)}초 / {(run.budget_ms / 1000).toFixed(0)}초{run.time_limited ? " · 시간 부족" : ""}</td>
            <td style={runCell}>{RUN_STATUS_TEXT[run.result_status] || run.result_status}</td>
            <td style={runCell}>{run.models.length ? run.models.map((item) => `${item.model.replace("gemini-", "")} ${item.ok ? "✓" : `✗${item.status}`} ${(item.ms / 1000).toFixed(1)}초`).join(" · ") : run.note || "-"}</td>
          </tr>)}
        </tbody></table></div>
      </details>}
    </section>}
    <div className="scripture-grid" style={grid}>
      <section className="scripture-card" style={card}>
        <b>최근 주보</b>
        {bulletins.map((item) => <button key={item.id} onClick={() => void selectBulletin(item)} style={{ ...itemButton, ...(selected?.id === item.id ? { background: "var(--accent-soft)" } : {}) }}>
          {item.sunday_date}
          {item.extraction_status && <span style={{ ...chip, color: STATUS_COLOR[item.extraction_status], borderColor: STATUS_COLOR[item.extraction_status] }}>{STATUS_TEXT[item.extraction_status]}</span>}
          <br/><small>{item.title}</small>
        </button>)}
      </section>
      <section className="scripture-card" ref={panelRef} style={card}>{selected ? <>
        <b>{selected.sunday_date} 주보</b>
        <p className="actions" style={actions}>
          <button disabled={busy} onClick={() => void extractAgain()} style={primary}><ScanText size={16}/>AI 다시 판독</button>
          <a href={`/api/storage/bulletins/${selected.pdf_url}`} target="_blank" rel="noreferrer" style={linkButton}><ExternalLink size={15}/>원본 주보 보기</a>
          {pendingTypes.length > 0 && <button disabled={busy} onClick={() => void approve(pendingTypes)} style={secondary}><CheckCheck size={15}/>확인 필요 {pendingTypes.length}개 모두 승인</button>}
        </p>
        {extraction && <p style={{ margin: "4px 0", fontSize: 13 }}>
          자동 판독: <b style={{ color: STATUS_COLOR[extraction.status] }}>{STATUS_TEXT[extraction.status]}</b> · 시도 {extraction.attempts}회 · {new Date(extraction.updated_at).toLocaleString("ko-KR")}
        </p>}
        {!extraction && <p style={{ margin: "4px 0", fontSize: 13, color: "var(--ink-soft)" }}>아직 자동 판독 기록이 없습니다.</p>}
        <p role="status" style={{ fontWeight: 700, minHeight: 20 }}>{busy ? "처리 중… " : ""}{notice}</p>

        {BULLETIN_SERVICE_TYPES.map((type) => {
          const rows = rowsFor(type);
          const saved = slotText(rows);
          const dirty = (values[type] || "").trim() !== saved;
          const pending = rows.some((row) => row.status === "pending");
          const invalid = rows.some((row) => row.book_id == null);
          const readingsByModel = modelEntries.filter(([, result]) => !result.error).map(([model, result]) => `${model}: ${(result[type] || []).join(", ") || "없음"}`);
          const message = slotMessage[type];
          let state = { text: "비어 있음", color: "var(--ink-soft)" };
          if (rows.length && !pending) state = { text: rows.some((row) => row.source === "manual") ? "게시됨 · 직접 입력" : "게시됨 · 자동 판독", color: "var(--accent)" };
          if (pending) state = { text: invalid ? "확인 필요 · 성경에 없는 구절" : "확인 필요", color: "var(--warning)" };
          return <div className="reading" key={type} style={readingStyle}>
            <label style={{ fontWeight: 800 }}>{BULLETIN_SERVICE_LABELS[type]}</label>
            <input value={values[type] || ""} onChange={(event) => setValues({ ...values, [type]: event.target.value })} placeholder="예: 출애굽기 23:10-13 (여러 개는 쉼표로)" style={input}/>
            <div style={{ display: "flex", gap: 6 }}>
              {dirty
                ? <button disabled={busy} onClick={() => void saveSlot(type)} style={secondary}>저장</button>
                : pending && !invalid && <button disabled={busy} onClick={() => void approve([type])} style={secondary}>승인</button>}
            </div>
            <small className="reading-state" style={{ gridColumn: "2 / -1", color: message ? (message.ok ? "var(--accent)" : "var(--danger)") : state.color, fontWeight: 700 }}>
              {message?.text || state.text}
              {pending && readingsByModel.length > 0 && <span style={{ display: "block", fontWeight: 500, color: "var(--ink-soft)" }}>{readingsByModel.join(" / ")}</span>}
            </small>
          </div>;
        })}

        {modelEntries.length > 0 && <details style={{ marginTop: 14 }}>
          <summary>AI 판독 원본 보기</summary>
          <pre style={diagnosticStyle}>{modelEntries.map(([model, result]) => `${model}\n${result.error ? `  실패: ${result.error}` : BULLETIN_SERVICE_TYPES.map((type) => `  ${BULLETIN_SERVICE_LABELS[type]}: ${(result[type] || []).join(", ") || "없음"}`).join("\n")}`).join("\n\n")}{extraction?.last_error ? `\n\n오류: ${extraction.last_error}` : ""}</pre>
        </details>}
      </> : <p>주보를 선택하세요.</p>}</section>
    </div>
  </main>;
}

const mobileCss = `@media(max-width:720px){.scripture-grid{grid-template-columns:minmax(0,1fr)!important}.actions{display:grid!important;gap:8px}.reading{grid-template-columns:minmax(0,1fr) auto!important}.reading label,.reading input,.reading .reading-state{grid-column:1/-1}}`;
const desktopCss = `@media(min-width:721px){.scripture-admin-page{display:block!important;visibility:visible!important;width:100%!important;min-height:calc(100vh - 80px)}.scripture-admin-page .scripture-grid{display:grid!important;grid-template-columns:minmax(250px,320px) minmax(0,1fr)!important;align-items:start!important}.scripture-admin-page .scripture-card{display:block!important;visibility:visible!important;opacity:1!important;min-height:180px}}`;
const page: React.CSSProperties = { maxWidth: 1080, margin: "0 auto", padding: 20, color: "var(--ink)" };
const head: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 };
const back: React.CSSProperties = { border: "1px solid var(--hairline)", background: "var(--surface)", borderRadius: 8, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--ink)" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px,.8fr) minmax(0,2fr)", gap: 16 };
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 12, padding: 15, minWidth: 0 };
const itemButton: React.CSSProperties = { width: "100%", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--hairline)", padding: "12px 4px", cursor: "pointer", color: "var(--ink)", fontFamily: "inherit" };
const chip: React.CSSProperties = { marginLeft: 6, padding: "1px 6px", border: "1px solid", borderRadius: 999, fontSize: 11, fontWeight: 700 };
const actions: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
const primary: React.CSSProperties = { border: 0, borderRadius: 8, background: "var(--accent)", color: "#fff", padding: "9px 12px", fontWeight: 800, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "center", fontFamily: "inherit" };
const secondary: React.CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 7, background: "var(--card)", color: "var(--ink)", padding: "7px 10px", cursor: "pointer", fontWeight: 700, display: "inline-flex", gap: 5, alignItems: "center", justifyContent: "center", fontFamily: "inherit" };
const linkButton: React.CSSProperties = { ...secondary, textDecoration: "none" };
const input: React.CSSProperties = { minWidth: 0, border: "1px solid var(--hairline)", borderRadius: 7, padding: "9px", fontFamily: "inherit", background: "var(--card)", color: "var(--ink)" };
const readingStyle: React.CSSProperties = { borderTop: "1px solid var(--hairline)", padding: "12px 6px", display: "grid", gridTemplateColumns: "110px minmax(180px,1fr) auto", gap: 8, alignItems: "center" };
const runTable: React.CSSProperties = { borderCollapse: "collapse", fontSize: 12, marginTop: 6, minWidth: 560, width: "100%" };
const runCell: React.CSSProperties = { borderTop: "1px solid var(--hairline)", padding: "5px 6px", textAlign: "left", verticalAlign: "top" };
const diagnosticStyle: React.CSSProperties = { whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 320, overflow: "auto", background: "var(--surface-muted)", padding: 10, borderRadius: 8 };
