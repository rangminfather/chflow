"use client";

/* ============================================================
   시설 사용신청 — 결재 화면 (admin / office / pastor)

   목록·권한 판정은 DB RPC(get_facility_bookings_admin, decide_facility_booking)가
   담당한다. 화면은 상태 필터와 승인/반려 입력만 맡는다.
   ============================================================ */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Landmark } from "lucide-react";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { EmptyState, LoadingView } from "@/components/StatusViews";

type AdminBooking = {
  id: string;
  requester_name: string | null;
  facility_id: string | null;
  facility_name: string;
  date: string;
  time_start: string;
  time_end: string;
  purpose: string | null;
  headcount: number | null;
  contact: string | null;
  status: string;
  decision_note: string | null;
};

const TABS = [
  { id: "pending", label: "결재 대기" },
  { id: "approved", label: "승인" },
  { id: "rejected", label: "반려" },
  { id: "all", label: "전체" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const STATUS_LABEL: Record<string, string> = {
  pending: "결재 대기",
  approved: "승인",
  rejected: "반려",
  cancelled: "취소됨",
};

const STATUS_COLOR: Record<string, { fg: string; bg: string }> = {
  pending: { fg: "var(--warning)", bg: "var(--warning-soft)" },
  approved: { fg: "var(--success)", bg: "var(--success-soft)" },
  rejected: { fg: "var(--danger)", bg: "var(--danger-soft)" },
  cancelled: { fg: "var(--ink-soft)", bg: "var(--bg-soft)" },
};

function hhmm(value: string): string {
  return value.slice(0, 5);
}

export default function FacilityApprovalPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [tab, setTab] = useState<TabId>("pending");
  const [rows, setRows] = useState<AdminBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (which: TabId) => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("get_facility_bookings_admin", {
      p_status: which === "all" ? null : which,
    });
    if (rpcError) setError(rpcError.message);
    setRows((data as AdminBooking[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: profileData } = await supabase.rpc("get_my_status");
      const profile = profileData?.[0];
      const ok = Boolean(profile && ["admin", "office", "pastor"].includes(profile.role));
      setAllowed(ok);
      setAuthChecked(true);
      if (ok) await load("pending");
      else setLoading(false);
    })();
  }, [router, load]);

  async function decide(id: string, decision: "approved" | "rejected") {
    setError("");
    setNotice("");
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("decide_facility_booking", {
      p_id: id,
      p_decision: decision,
      p_note: notes[id]?.trim() || null,
    });
    setBusyId(null);
    if (rpcError) { setError(rpcError.message); return; }
    setNotice(decision === "approved" ? "승인 처리했습니다." : "반려 처리했습니다.");
    await load(tab);
  }

  if (!authChecked) return <LoadingView full />;

  if (!allowed) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "grid", placeItems: "center", padding: 24 }}>
        <EmptyState message="시설 신청을 결재할 권한이 없습니다" hint="교회 관리자에게 문의해주세요" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "var(--app-sans)" }}>
      <div style={{
        background: "var(--card)", borderBottom: "1px solid var(--hairline)",
        padding: "14px 20px", display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={() => router.push("/facility")} style={iconBtn} aria-label="시설 신청으로">←</button>
        <HeaderLogo />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Landmark size={16} strokeWidth={1.8} /> 시설 신청 결재
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>신청 내용을 확인하고 승인 또는 반려하세요</div>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "18px 16px 60px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); void load(t.id); }}
                style={{
                  minHeight: 40, padding: "8px 14px", borderRadius: 999,
                  border: active ? "1px solid var(--accent-line)" : "1px solid var(--hairline)",
                  background: active ? "var(--accent-soft)" : "var(--card)",
                  color: active ? "var(--accent-strong)" : "var(--ink-mid)",
                  fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {notice && (
          <div style={{ ...banner, background: "var(--success-soft)", color: "var(--success)" }}>
            <CheckCircle2 size={14} strokeWidth={1.8} /> {notice}
          </div>
        )}
        {error && (
          <div style={{ ...banner, background: "var(--danger-soft)", color: "var(--danger)" }}>
            <AlertTriangle size={14} strokeWidth={1.8} /> {error}
          </div>
        )}

        {loading ? (
          <LoadingView />
        ) : rows.length === 0 ? (
          <EmptyState message="해당하는 신청이 없습니다" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((row) => {
              const color = STATUS_COLOR[row.status] ?? STATUS_COLOR.cancelled;
              return (
                <div key={row.id} style={{
                  padding: 16, borderRadius: 14,
                  background: "var(--card)", border: "1px solid var(--hairline)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>{row.facility_name}</div>
                    <span style={{
                      padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      color: color.fg, background: color.bg,
                    }}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </div>

                  <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-mid)", fontWeight: 600 }}>
                    {row.date} · {hhmm(row.time_start)}~{hhmm(row.time_end)}
                    {row.headcount ? ` · ${row.headcount}명` : ""}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--ink-soft)", fontWeight: 500 }}>
                    신청자 {row.requester_name ?? "(이름 없음)"}
                    {row.contact ? ` · ${row.contact}` : ""}
                  </div>
                  {row.purpose && (
                    <div style={{
                      marginTop: 8, padding: "10px 12px", borderRadius: 10,
                      background: "var(--surface)", fontSize: 12.5, color: "var(--ink-mid)", lineHeight: 1.6,
                    }}>
                      {row.purpose}
                    </div>
                  )}
                  {row.decision_note && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-mid)", fontWeight: 600 }}>
                      결재 의견: {row.decision_note}
                    </div>
                  )}

                  {row.status === "pending" && (
                    <div style={{ marginTop: 12 }}>
                      <label style={label} htmlFor={`note-${row.id}`}>결재 의견 (선택)</label>
                      <input
                        id={`note-${row.id}`}
                        value={notes[row.id] ?? ""}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        placeholder="반려 사유나 안내사항을 적어주세요"
                        maxLength={200}
                        style={{ ...input, marginTop: 6 }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => decide(row.id, "approved")}
                          style={{ ...decideBtn, color: "var(--card)", background: "var(--accent)" }}
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => decide(row.id, "rejected")}
                          style={{ ...decideBtn, color: "var(--danger)", background: "var(--danger-soft)" }}
                        >
                          반려
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, background: "var(--bg-soft)",
  border: "none", fontSize: 16, cursor: "pointer", color: "var(--ink-mid)", flexShrink: 0,
};
const label: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", letterSpacing: 0.3,
};
const input: React.CSSProperties = {
  width: "100%", padding: "11px 13px", fontSize: 13.5, minHeight: 44,
  background: "var(--card)", border: "1.5px solid var(--hairline)", borderRadius: 10,
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
  color: "var(--ink)", fontWeight: 500,
};
const decideBtn: React.CSSProperties = {
  flex: 1, minHeight: 46, padding: "12px 14px", fontSize: 14, fontWeight: 800,
  border: "none", borderRadius: 11, cursor: "pointer", fontFamily: "inherit",
};
const banner: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "10px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, marginBottom: 12,
};
