"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BULLETIN_SERVICE_LABELS, type BulletinServiceType } from "@/lib/bulletin/scripture-parser";
import { getRecommendedBulletinService } from "@/lib/bulletin/scripture-recommendation";
import ScripturePassageSheet from "./ScripturePassageSheet";

type Reading = { id: string; service_type: BulletinServiceType; raw_reference: string; normalized_label: string | null; sort_order: number };
export default function BulletinScripturePanel({ bulletinId }: { bulletinId: string }) {
  const [readings, setReadings] = useState<Reading[]>([]); const [expanded, setExpanded] = useState(false); const [opened, setOpened] = useState<Reading | null>(null);
  useEffect(() => { void (async () => { const { data: { session } } = await supabase.auth.getSession(); const res = await fetch(`/api/bulletin/${bulletinId}/scripture-readings`, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } }); const json = await res.json(); if (res.ok && json.ok) setReadings(json.readings || []); })(); }, [bulletinId]);
  const recommended = getRecommendedBulletinService();
  const ordered = useMemo(() => [...readings].sort((a, b) => Number(b.service_type === recommended) - Number(a.service_type === recommended) || a.service_type.localeCompare(b.service_type)), [readings, recommended]);
  if (!ordered.length) return null;
  const primary = ordered[0]; const others = ordered.slice(1);
  const card = (reading: Reading, featured = false) => <div key={reading.id} style={{ padding: featured ? "2px 0 10px" : "10px 0", borderTop: featured ? "none" : "1px solid var(--hairline)" }}><div style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 700 }}>{featured && reading.service_type === recommended ? "추천 · " : ""}{BULLETIN_SERVICE_LABELS[reading.service_type]}</div><div style={{ fontSize: 16, fontWeight: 800, marginTop: 3 }}>{reading.normalized_label || reading.raw_reference}</div><button type="button" onClick={() => setOpened(reading)} style={button}><BookOpen size={15} /> 본문 보기</button></div>;
  return <section style={{ marginTop: 12, border: "1px solid var(--hairline)", borderRadius: 12, background: "var(--surface)", padding: "14px 16px" }}><h2 style={{ fontSize: 15, margin: "0 0 8px" }}>성경봉독</h2>{card(primary, true)}{others.length > 0 && <><button type="button" onClick={() => setExpanded((value) => !value)} style={{ ...toggle, marginTop: 2 }}>다른 예배 본문 <ChevronDown size={16} style={{ transform: expanded ? "rotate(180deg)" : undefined }} /></button>{expanded && <div style={{ marginTop: 4 }}>{others.map((reading) => card(reading))}</div>}</>}{opened && <ScripturePassageSheet reference={opened.normalized_label || opened.raw_reference} onClose={() => setOpened(null)} />}</section>;
}
const button: React.CSSProperties = { marginTop: 8, minHeight: 34, padding: "0 11px", border: 0, borderRadius: 8, background: "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 800, fontFamily: "inherit" };
const toggle: React.CSSProperties = { border: 0, background: "transparent", padding: "7px 0", color: "var(--accent-strong)", fontWeight: 800, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" };
