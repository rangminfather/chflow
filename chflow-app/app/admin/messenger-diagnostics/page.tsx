"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  MessageSquare,
  RadioTower,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  Users,
} from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import { EmptyState, LoadingView } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";

type Level = "warn" | "error" | "info";

type Diagnostics = {
  ok: boolean;
  error?: string;
  counts: Record<string, number>;
  flags: { level: Level; text: string }[];
  profiles: Record<string, { name: string | null; username: string | null; role: string | null; sub_role: string | null }>;
  conversations: Array<{ id: string; type: string; title: string | null; updated_at: string; last_message_id: string | null }>;
  participants: Array<{ conversation_id: string; user_id: string; role: string; last_read_at: string | null; archived_at: string | null; muted_until: string | null }>;
  messages: Array<{ id: string; conversation_id: string; sender_id: string; body: string; created_at: string; deleted_at: string | null }>;
  notifications: Array<{ id: string; user_id: string; type: string; title: string; body: string | null; is_read: boolean | null; metadata: Record<string, unknown> | null; created_at: string; read_at: string | null }>;
  deliveries: Array<{ id: string; notification_id: string; user_id: string; status: string; attempts: number; expo_ticket_id: string | null; error_message: string | null; sent_at: string | null; updated_at: string }>;
  tokens: Array<{ id: string; user_id: string; platform: string; device_id: string | null; enabled: boolean; last_seen_at: string; updated_at: string }>;
};

export default function MessengerDiagnosticsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Diagnostics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      if (!profile || !["admin", "office", "pastor"].includes(profile.role)) {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
    })();
  }, [router]);

  const summary = useMemo(() => {
    if (!result) return [];
    return [
      { label: "메시지", value: result.counts.messages || 0, icon: <MessageSquare size={18} /> },
      { label: "참여자", value: result.counts.participants || 0, icon: <Users size={18} /> },
      { label: "알림", value: result.counts.notifications || 0, icon: <Bell size={18} /> },
      { label: "푸시", value: result.counts.deliveries || 0, icon: <RadioTower size={18} /> },
      { label: "토큰", value: result.counts.tokens || 0, icon: <Smartphone size={18} /> },
    ];
  }, [result]);

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) {
      setError("검색어는 2자 이상 입력하세요.");
      return;
    }

    setLoading(true);
    setSearched(true);
    setError("");
    setResult(null);
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`/api/admin/messenger-diagnostics?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${session?.access_token || ""}` },
    });
    const json = await response.json();
    setLoading(false);

    if (!response.ok || !json.ok) {
      setError(json.error || "진단 조회에 실패했습니다.");
      return;
    }
    setResult(json as Diagnostics);
  }

  const nameOf = (userId: string) => {
    const profile = result?.profiles[userId];
    return profile?.name || profile?.username || userId.slice(0, 8);
  };

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={pageStyle}>
      <style>{responsiveCss}</style>
      <div style={shellStyle}>
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <HeaderLogo />
            <div style={{ minWidth: 0 }}>
              <h1 style={titleStyle}>메신저 진단</h1>
              <p style={subTitleStyle}>메시지, 알림 row, 푸시 delivery, 토큰 상태를 한 번에 확인합니다.</p>
            </div>
          </div>
          <button type="button" onClick={() => router.push("/home")} style={ghostButtonStyle}>
            <ArrowLeft size={16} /> 홈
          </button>
        </header>

        <section style={searchPanelStyle}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Search size={18} color="var(--accent)" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") runSearch(); }}
              placeholder="message id, conversation id, notification id, 본문 검색"
              style={inputStyle}
            />
            <button type="button" onClick={runSearch} disabled={loading} style={primaryButtonStyle}>
              {loading ? <RefreshCw size={15} className="spin" /> : <Search size={15} />} 조회
            </button>
          </div>
          {error && <div style={errorStyle}>{error}</div>}
        </section>

        {loading ? (
          <LoadingView padding={56} />
        ) : result ? (
          <>
            <section style={summaryGridStyle}>
              {summary.map((item) => (
                <div key={item.label} style={summaryCardStyle}>
                  <span style={summaryIconStyle}>{item.icon}</span>
                  <span style={summaryLabelStyle}>{item.label}</span>
                  <strong style={summaryValueStyle}>{item.value}</strong>
                </div>
              ))}
            </section>

            <section style={panelStyle}>
              <h2 style={sectionTitleStyle}><ShieldAlert size={18} /> 위험 플래그</h2>
              {result.flags.length === 0 ? (
                <div style={okBoxStyle}><CheckCircle2 size={17} /> 즉시 확인되는 중복, 누락, 실패 플래그가 없습니다.</div>
              ) : (
                <div style={listStyle}>
                  {result.flags.map((flag, index) => (
                    <div key={`${flag.text}-${index}`} style={{ ...flagStyle, ...flagTone(flag.level) }}>
                      <AlertTriangle size={16} /> {flag.text}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="diag-grid" style={gridStyle}>
              <DataPanel title="메시지" icon={<MessageSquare size={17} />}>
                {result.messages.map((row) => (
                  <div key={row.id} style={rowStyle}>
                    <strong>{nameOf(row.sender_id)}</strong>
                    <span>{row.body || "(본문 없음)"}</span>
                    <small>{row.id} · {formatDate(row.created_at)}</small>
                  </div>
                ))}
              </DataPanel>

              <DataPanel title="참여자" icon={<Users size={17} />}>
                {result.participants.map((row) => (
                  <div key={`${row.conversation_id}-${row.user_id}`} style={rowStyle}>
                    <strong>{nameOf(row.user_id)} · {row.role}</strong>
                    <span>{row.muted_until ? `mute until ${formatDate(row.muted_until)}` : "알림 허용"}</span>
                    <small>{row.archived_at ? `archived ${formatDate(row.archived_at)}` : `read ${formatDate(row.last_read_at)}`}</small>
                  </div>
                ))}
              </DataPanel>

              <DataPanel title="알림" icon={<Bell size={17} />}>
                {result.notifications.map((row) => (
                  <div key={row.id} style={rowStyle}>
                    <strong>{nameOf(row.user_id)} · {row.type}</strong>
                    <span>{row.title}{row.body ? ` - ${row.body}` : ""}</span>
                    <small>{row.is_read ? "read" : "unread"} · {formatDate(row.created_at)}</small>
                  </div>
                ))}
              </DataPanel>

              <DataPanel title="푸시 delivery" icon={<RadioTower size={17} />}>
                {result.deliveries.map((row) => (
                  <div key={row.id} style={rowStyle}>
                    <strong>{nameOf(row.user_id)} · {row.status}</strong>
                    <span>{row.error_message || row.expo_ticket_id || "ticket 없음"}</span>
                    <small>attempts {row.attempts} · {formatDate(row.updated_at)}</small>
                  </div>
                ))}
              </DataPanel>

              <DataPanel title="푸시 토큰" icon={<Smartphone size={17} />}>
                {result.tokens.map((row) => (
                  <div key={row.id} style={rowStyle}>
                    <strong>{nameOf(row.user_id)} · {row.platform}</strong>
                    <span>{row.enabled ? "enabled" : "disabled"}{row.device_id ? ` · ${row.device_id}` : ""}</span>
                    <small>last seen {formatDate(row.last_seen_at)}</small>
                  </div>
                ))}
              </DataPanel>
            </section>
          </>
        ) : searched ? (
          <EmptyState message="진단 결과가 없습니다." hint="다른 id 또는 본문 일부로 다시 조회하세요." padding={56} />
        ) : (
          <EmptyState
            icon={<Search size={30} strokeWidth={1.7} />}
            message="진단할 항목을 검색하세요."
            hint="message id, conversation id, notification id, 메시지 본문 일부를 사용할 수 있습니다."
            padding={56}
          />
        )}
      </div>
    </div>
  );
}

function DataPanel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : true;
  return (
    <section style={panelStyle}>
      <h2 style={sectionTitleStyle}>{icon}{title}</h2>
      <div style={listStyle}>
        {hasRows ? children : <div style={emptySmallStyle}>데이터 없음</div>}
      </div>
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function flagTone(level: Level): React.CSSProperties {
  if (level === "error") return { background: "var(--danger-soft)", color: "var(--danger)", borderColor: "rgba(197, 64, 52, 0.28)" };
  if (level === "warn") return { background: "var(--warning-soft)", color: "var(--warning)", borderColor: "rgba(181, 132, 28, 0.28)" };
  return { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent-line)" };
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const shellStyle: React.CSSProperties = { maxWidth: 1180, margin: "0 auto", padding: "18px 16px 36px" };
const headerStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 22, lineHeight: 1.2, color: "var(--ink)", fontWeight: 900 };
const subTitleStyle: React.CSSProperties = { margin: "4px 0 0", fontSize: 13, color: "var(--ink-soft)", fontWeight: 600 };
const searchPanelStyle: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 12, marginBottom: 14 };
const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0, height: 42, border: "1px solid var(--hairline-strong)", borderRadius: 8, padding: "0 12px", fontSize: 14, fontWeight: 700, outline: "none", background: "var(--surface)", color: "var(--ink)" };
const primaryButtonStyle: React.CSSProperties = { height: 42, border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", padding: "0 14px", fontSize: 13, fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" };
const ghostButtonStyle: React.CSSProperties = { height: 38, border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--surface)", color: "var(--ink-mid)", padding: "0 12px", fontSize: 13, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" };
const errorStyle: React.CSSProperties = { marginTop: 10, color: "var(--danger)", fontSize: 13, fontWeight: 800 };
const summaryGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, marginBottom: 14 };
const summaryCardStyle: React.CSSProperties = { minHeight: 74, background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 12, display: "grid", gap: 4 };
const summaryIconStyle: React.CSSProperties = { color: "var(--accent)", display: "inline-flex" };
const summaryLabelStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink-soft)", fontWeight: 800 };
const summaryValueStyle: React.CSSProperties = { fontSize: 22, color: "var(--ink)", lineHeight: 1 };
const panelStyle: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: 8, padding: 14 };
const sectionTitleStyle: React.CSSProperties = { margin: "0 0 10px", color: "var(--ink)", fontSize: 15, fontWeight: 900, display: "flex", alignItems: "center", gap: 7 };
const listStyle: React.CSSProperties = { display: "grid", gap: 8 };
const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 14 };
const flagStyle: React.CSSProperties = { border: "1px solid", borderRadius: 8, padding: "9px 10px", fontSize: 12, fontWeight: 800, lineHeight: 1.45, display: "flex", alignItems: "flex-start", gap: 8 };
const okBoxStyle: React.CSSProperties = { background: "var(--success-soft)", color: "var(--success)", border: "1px solid rgba(72, 145, 92, 0.24)", borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 };
const rowStyle: React.CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 8, padding: 10, display: "grid", gap: 4, color: "var(--ink-mid)", fontSize: 12, overflow: "hidden" };
const emptySmallStyle: React.CSSProperties = { color: "var(--ink-faint)", fontSize: 13, fontWeight: 700, padding: 12, textAlign: "center" };
const responsiveCss = `
  .spin { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 860px) {
    .diag-grid { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 680px) {
    header { align-items: flex-start !important; }
    input { width: 100%; }
  }
`;
