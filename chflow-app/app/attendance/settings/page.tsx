"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { LocateFixed, Save, MapPin } from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

type Form = { name: string; latitude: string; longitude: string; radiusM: string; dwellMinutes: string; windowStart: string; windowEnd: string; isActive: boolean };
const initial: Form = { name: "본당", latitude: "", longitude: "", radiusM: "150", dwellMinutes: "5", windowStart: "07:00", windowEnd: "15:00", isActive: false };

export default function AttendanceSettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<Form>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function load() { const token = (await supabase.auth.getSession()).data.session?.access_token; if (!token) return; const response = await fetch("/api/attendance/geofence", { headers: { Authorization: `Bearer ${token}` } }); const payload = await response.json(); if (payload.geofence) setForm({ name: payload.geofence.name, latitude: String(payload.geofence.latitude), longitude: String(payload.geofence.longitude), radiusM: String(payload.geofence.radius_m), dwellMinutes: String(Math.round(payload.geofence.dwell_seconds / 60)), windowStart: String(payload.geofence.window_start).slice(0, 5), windowEnd: String(payload.geofence.window_end).slice(0, 5), isActive: payload.geofence.is_active }); }
  useEffect(() => { void load(); }, []);
  const locate = () => navigator.geolocation?.getCurrentPosition((position) => { setForm((current) => ({ ...current, latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) })); setMessage("현재 위치를 입력했습니다."); }, () => setMessage("위치 권한을 허용하거나 좌표를 직접 입력해 주세요."), { enableHighAccuracy: true, timeout: 10000 });
  const save = async () => { setSaving(true); setMessage(null); const token = (await supabase.auth.getSession()).data.session?.access_token; if (!token) { setMessage("로그인이 필요합니다."); setSaving(false); return; } const response = await fetch("/api/attendance/geofence", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: form.name, latitude: Number(form.latitude), longitude: Number(form.longitude), radiusM: Number(form.radiusM), dwellSeconds: Number(form.dwellMinutes) * 60, windowStart: form.windowStart, windowEnd: form.windowEnd, isActive: form.isActive }) }); const payload = await response.json(); setMessage(response.ok ? "자동출석 설정을 저장했습니다." : (payload.error || "저장하지 못했습니다.")); setSaving(false); };
  const set = (key: keyof Form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  return <><div className="app-subpage-header" style={subpageHeaderStyle}><HeaderLogo /><button className="app-header-back" onClick={() => router.push("/attendance")} style={headerBackStyle} aria-label="출석 현황으로">← 출석 현황</button><div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 16, fontWeight: 800, color: "var(--ink)" }}><MapPin size={18} strokeWidth={1.8} /> 자동출석 설정</div></div><main style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px 64px" }}><h1 style={{ margin: "22px 0 8px", fontSize: 30, letterSpacing: "-0.04em" }}>자동출석 설정</h1><p style={{ color: "var(--ink-mid)", fontSize: 14, lineHeight: 1.6 }}>교회 좌표와 운영 시간 안에서만 위치 후보를 수집합니다. 자동출석은 목회 참고용입니다.</p><section style={card}><label style={label}>위치 이름<input value={form.name} onChange={(e) => set("name", e.target.value)} style={input} /></label><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><label style={label}>위도<input inputMode="decimal" value={form.latitude} onChange={(e) => set("latitude", e.target.value)} style={input} /></label><label style={label}>경도<input inputMode="decimal" value={form.longitude} onChange={(e) => set("longitude", e.target.value)} style={input} /></label></div><button type="button" onClick={locate} style={secondary}><LocateFixed size={16} /> 현재 위치 사용</button><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}><label style={label}>반경(m)<input type="number" min="50" max="500" value={form.radiusM} onChange={(e) => set("radiusM", e.target.value)} style={input} /></label><label style={label}>최소 체류(분)<input type="number" min="5" max="60" value={form.dwellMinutes} onChange={(e) => set("dwellMinutes", e.target.value)} style={input} /></label></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}><label style={label}>시작<input type="time" value={form.windowStart} onChange={(e) => set("windowStart", e.target.value)} style={input} /></label><label style={label}>종료<input type="time" value={form.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} style={input} /></label></div><label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, fontSize: 14 }}><input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} /> 설정 활성화</label></section>{message && <p role="status" style={{ color: "var(--ink-mid)", fontSize: 14 }}>{message}</p>}<button type="button" onClick={save} disabled={saving} style={primary}><Save size={16} /> {saving ? "저장 중..." : "저장"}</button></main></>;
}

const card: CSSProperties = { marginTop: 24, padding: 20, border: "1px solid var(--hairline)", borderRadius: 18, background: "var(--card)" };
const label: CSSProperties = { display: "block", marginBottom: 14, color: "var(--ink-mid)", fontSize: 13 };
const input: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", marginTop: 7, padding: "10px 11px", border: "1px solid var(--hairline)", borderRadius: 9, background: "var(--paper)", color: "var(--ink)" };
const secondary: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--hairline)", borderRadius: 9, padding: "9px 12px", background: "var(--card)", color: "var(--ink)", cursor: "pointer" };
const primary: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, border: 0, borderRadius: 9, padding: "11px 16px", background: "var(--accent)", color: "var(--paper)", cursor: "pointer", fontWeight: 700 };

/* 하위 화면 공통 헤더 스타일 — /attendance 와 동일 규칙 */
const subpageHeaderStyle: CSSProperties = {
  background: "var(--card)",
  borderBottom: "1px solid var(--hairline)",
  padding: "12px 20px",
};

const headerBackStyle: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: "1px solid var(--hairline-strong)",
  background: "var(--bg-soft)",
  color: "var(--ink-mid)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
