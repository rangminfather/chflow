"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import ModalBackdrop from "@/components/ModalBackdrop";
import { supabase } from "@/lib/supabase";

type Props = { reference: string; onClose: () => void };
type Verse = { chapter: number; verse: number; endVerse?: number; text: string };

export default function ScripturePassageSheet({ reference, onClose }: Props) {
  const [verses, setVerses] = useState<Verse[]>([]); const [title, setTitle] = useState(reference); const [error, setError] = useState("");
  useEffect(() => { void (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/bible/reference?ref=${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } });
    const json = await res.json();
    if (!res.ok || !json.ok) { setError("본문을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."); return; }
    setTitle(json.normalizedLabel || reference); setVerses(json.rows || []);
  })(); }, [reference]);
  return <ModalBackdrop onClose={onClose} style={{ zIndex: 200, alignItems: "flex-end", padding: 0 }}>
    <section onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: 720, maxHeight: "82dvh", overflow: "hidden", background: "var(--card)", borderRadius: "18px 18px 0 0", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "15px 16px", borderBottom: "1px solid var(--hairline)" }}><strong>{title}</strong><button onClick={onClose} aria-label="닫기" style={icon}><X size={18} /></button></header>
      <div style={{ overflowY: "auto", padding: "16px 18px 30px", lineHeight: 1.85 }}>{error ? <p>{error}</p> : verses.length ? verses.map((row) => <p key={`${row.chapter}-${row.verse}`} style={{ margin: "0 0 12px" }}><b style={{ color: "var(--accent)", marginRight: 8 }}>{row.verse}{row.endVerse ? `-${row.endVerse}` : ""}</b>{row.text}</p>) : <p>본문을 불러오는 중입니다…</p>}</div>
    </section>
  </ModalBackdrop>;
}
const icon: React.CSSProperties = { width: 32, height: 32, borderRadius: 999, border: "1px solid var(--hairline)", background: "var(--surface)", display: "grid", placeItems: "center", cursor: "pointer", color: "var(--ink)" };
