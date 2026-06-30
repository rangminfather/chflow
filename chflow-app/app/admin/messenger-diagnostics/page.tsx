"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Users,
} from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import { EmptyState, LoadingView } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";
import {
  diagnoseMessengerDelivery,
  type MessengerDiagnostics,
  type MessengerDiagnosticsFlag,
} from "@/lib/messenger";

export default function MessengerDiagnosticsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [diagnostics, setDiagnostics] = useState<MessengerDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const flags = diagnostics?.flags || [];
  const dangerCount = flags.filter((flag) => flag.severity === "danger").length;
  const warningCount = flags.filter((flag) => flag.severity === "warning").length;

  const load = useCallback(async (nextQuery = query) => {
    const trimmed = nextQuery.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      const result = await diagnoseMessengerDelivery(trimmed, 40);
      setDiagnostics(result);
      setSearched(trimmed);
    } catch (e) {
      setError(getErrorMessage(e));
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

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
    if (!diagnostics) return null;
    return {
      participants: diagnostics.participants.length,
      notifications: diagnostics.notifications.length,
      tokens: diagnostics.push_tokens.filter((token) => Boolean(token.enabled)).length,
      deliveries: diagnostics.deliveries.length,
    };
  }, [diagnostics]);

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={pageStyle}>
      <style>{responsiveCss}</style>
      <div style={shellStyle}>
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <HeaderLogo />
            <div style={{ minWidth: 0 }}>
              <div style={titleStyle}>메신저 진단</div>
              <div style={subTitleStyle}>메시지 알림, 푸시 토큰, 발송 로그를 한 번에 확인합니다.</div>
            </div>
          </div>
          <div style={headerActionsStyle}>
            <button type="button" onClick={() => router.push("/admin/messenger-reports")} style={secondaryButtonStyle}>
              <MessageSquare size={15} strokeWidth={1.8} /> 신고
            </button>
            <button type="button" onClick={() => router.push("/home")} style={secondaryButtonStyle}>
              <ArrowLeft size={15} strokeWidth={1.8} /> 홈
            </button>
          </div>
        </header>

        <section style={searchPanelStyle}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              load();
            }}
            style={searchFormStyle}
          >
            <div style={searchInputWrapStyle}>
              <Search size={17} strokeWidth={1.9} color="var(--ink-faint)" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="메시지 ID, 대화 ID, 사용자 이름, 아이디, 전화, 이메일"
                style={searchInputStyle}
              />
            </div>
            <button type="submit" disabled={loading || !query.trim()} style={primaryButtonStyle}>
              {loading ? <RefreshCw size={15} className="spin" /> : <Search size={15} />} 진단
            </button>
          </form>
          {error && <div style={errorStyle}>{error}</div>}
        </section>

        {loading ? (
          <LoadingView padding={70} />
        ) : !diagnostics ? (
          <EmptyState
            icon={<Search size={30} strokeWidth={1.7} />}
            message="진단할 대상을 검색하세요."
            hint="가장 정확한 검색값은 메시지 ID입니다. 대화 ID나 사용자 이름으로도 최근 관련 기록을 찾습니다."
            padding={70}
          />
        ) : (
          <main style={contentStyle}>
            <section className="summary-grid" style={summaryGridStyle}>
              <SummaryCard icon={<Users size={21} />} label="참여자" value={summary?.participants || 0} />
              <SummaryCard icon={<Bell size={21} />} label="알림" value={summary?.notifications || 0} />
              <SummaryCard icon={<Smartphone size={21} />} label="활성 토큰" value={summary?.tokens || 0} />
              <SummaryCard icon={<Send size={21} />} label="푸시 로그" value={summary?.deliveries || 0} />
            </section>

            <section style={panelStyle}>
              <div style={panelHeaderStyle}>
                <div>
                  <div style={panelTitleStyle}>판정</div>
                  <div style={panelSubStyle}>검색값: {searched}</div>
                </div>
                {dangerCount === 0 && warningCount === 0 ? (
                  <span style={okBadgeStyle}><CheckCircle2 size={14} /> 특이사항 없음</span>
                ) : (
                  <span style={warnBadgeStyle}><AlertTriangle size={14} /> 위험 {dangerCount} · 주의 {warningCount}</span>
                )}
              </div>
              {flags.length === 0 ? (
                <div style={emptyLineStyle}>중복 알림, 누락 알림, 실패한 푸시 로그가 감지되지 않았습니다.</div>
              ) : (
                <div style={flagListStyle}>
                  {flags.map((flag, index) => <FlagRow key={`${flag.code}-${index}`} flag={flag} />)}
                </div>
              )}
            </section>

            <section className="two-col" style={twoColStyle}>
              <InfoPanel title="메시지" icon={<MessageSquare size={18} />} rows={diagnostics.message ? [diagnostics.message] : []} />
              <InfoPanel title="대화" icon={<Users size={18} />} rows={diagnostics.conversation ? [diagnostics.conversation] : []} />
            </section>

            {diagnostics.candidates.length > 0 && (
              <TablePanel title="검색 후보" icon={<Search size={18} />} rows={diagnostics.candidates} />
            )}

            <TablePanel title="참여자" icon={<Users size={18} />} rows={diagnostics.participants} />
            <TablePanel title="알림 행" icon={<Bell size={18} />} rows={diagnostics.notifications} />
            <TablePanel title="푸시 토큰" icon={<Smartphone size={18} />} rows={diagnostics.push_tokens} />
            <TablePanel title="푸시 발송 로그" icon={<Send size={18} />} rows={diagnostics.deliveries} />

            {diagnostics.resolved?.conversation_id && (
              <div style={footerActionsStyle}>
                <button
                  type="button"
                  onClick={() => router.push(`/messenger?c=${diagnostics.resolved.conversation_id}`)}
                  style={secondaryButtonStyle}
                >
                  <ExternalLink size={15} strokeWidth={1.8} /> 대화 열기
                </button>
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div style={summaryCardStyle}>
      <div style={summaryIconStyle}>{icon}</div>
      <div>
        <div style={summaryValueStyle}>{value}</div>
        <div style={summaryLabelStyle}>{label}</div>
      </div>
    </div>
  );
}

function FlagRow({ flag }: { flag: MessengerDiagnosticsFlag }) {
  const danger = flag.severity === "danger";
  return (
    <div style={{ ...flagRowStyle, ...(danger ? flagDangerStyle : flagWarnStyle) }}>
      <AlertTriangle size={17} strokeWidth={2} />
      <div style={{ minWidth: 0 }}>
        <div style={flagTitleStyle}>{flag.message}</div>
        <div style={flagMetaStyle}>{flag.code} · {compactJson(flag)}</div>
      </div>
    </div>
  );
}

function InfoPanel({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: Array<Record<string, unknown>> }) {
  return (
    <section style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div style={panelTitleWithIconStyle}>{icon} {title}</div>
      </div>
      {rows.length === 0 ? <div style={emptyLineStyle}>데이터가 없습니다.</div> : rows.map((row, index) => (
        <KeyValueBlock key={index} row={row} />
      ))}
    </section>
  );
}

function TablePanel({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: Array<Record<string, unknown>> }) {
  return (
    <section style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div style={panelTitleWithIconStyle}>{icon} {title}</div>
        <span style={countBadgeStyle}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div style={emptyLineStyle}>데이터가 없습니다.</div>
      ) : (
        <div style={tableWrapStyle}>
          {rows.map((row, index) => (
            <KeyValueBlock key={index} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

function KeyValueBlock({ row }: { row: Record<string, unknown> }) {
  const entries = Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== "");
  return (
    <div style={kvBlockStyle}>
      {entries.map(([key, value]) => (
        <div key={key} style={kvRowStyle}>
          <div style={kvKeyStyle}>{key}</div>
          <div style={kvValueStyle}>{formatValue(value)}</div>
        </div>
      ))}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function compactJson(value: Record<string, unknown>): string {
  const { severity, message, ...rest } = value;
  void severity;
  void message;
  return JSON.stringify(rest);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "진단 중 오류가 발생했습니다.";
}

const responsiveCss = `
  @media (max-width: 760px) {
    .summary-grid { grid-template-columns: 1fr 1fr !important; }
    .two-col { grid-template-columns: 1fr !important; }
    .spin { animation: spin .8s linear infinite; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", color: "var(--ink)", fontFamily: "var(--font-noto-sans-kr), -apple-system, BlinkMacSystemFont, sans-serif", padding: 16 };
const shellStyle: React.CSSProperties = { maxWidth: 1180, margin: "0 auto" };
const headerStyle: React.CSSProperties = { minHeight: 68, padding: "14px 16px", borderRadius: 10, background: "var(--card)", border: "1px solid var(--hairline)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 };
const headerActionsStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" };
const titleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 900 };
const subTitleStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink-faint)", marginTop: 2 };
const searchPanelStyle: React.CSSProperties = { borderRadius: 10, border: "1px solid var(--hairline)", background: "var(--card)", padding: 12, marginBottom: 14 };
const searchFormStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };
const searchInputWrapStyle: React.CSSProperties = { flex: 1, minWidth: 0, height: 42, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px" };
const searchInputStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 14, fontFamily: "inherit" };
const contentStyle: React.CSSProperties = { display: "grid", gap: 12 };
const summaryGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 };
const summaryCardStyle: React.CSSProperties = { minHeight: 78, borderRadius: 10, border: "1px solid var(--hairline)", background: "var(--card)", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" };
const summaryIconStyle: React.CSSProperties = { width: 42, height: 42, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0, background: "var(--accent-soft)", color: "var(--accent)" };
const summaryValueStyle: React.CSSProperties = { fontSize: 24, fontWeight: 900, lineHeight: 1 };
const summaryLabelStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink-faint)", fontWeight: 800, marginTop: 4 };
const panelStyle: React.CSSProperties = { borderRadius: 10, border: "1px solid var(--hairline)", background: "var(--card)", overflow: "hidden" };
const panelHeaderStyle: React.CSSProperties = { minHeight: 48, padding: "11px 12px", borderBottom: "1px solid var(--hairline)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const panelTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 900 };
const panelTitleWithIconStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 900 };
const panelSubStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--ink-faint)", marginTop: 2 };
const twoColStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const primaryButtonStyle: React.CSSProperties = { height: 42, padding: "0 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const secondaryButtonStyle: React.CSSProperties = { height: 36, padding: "0 11px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink-mid)", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 850, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const okBadgeStyle: React.CSSProperties = { height: 28, padding: "0 9px", borderRadius: 999, background: "var(--success-soft)", color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 900 };
const warnBadgeStyle: React.CSSProperties = { ...okBadgeStyle, background: "var(--danger-soft)", color: "var(--danger)" };
const countBadgeStyle: React.CSSProperties = { minWidth: 24, height: 24, padding: "0 8px", borderRadius: 999, background: "var(--bg-soft)", color: "var(--ink-faint)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900 };
const flagListStyle: React.CSSProperties = { display: "grid", gap: 8, padding: 12 };
const flagRowStyle: React.CSSProperties = { borderRadius: 8, border: "1px solid var(--hairline)", padding: 10, display: "flex", gap: 8, alignItems: "flex-start" };
const flagDangerStyle: React.CSSProperties = { background: "var(--danger-soft)", color: "var(--danger)" };
const flagWarnStyle: React.CSSProperties = { background: "var(--warning-soft)", color: "var(--warning)" };
const flagTitleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 900, lineHeight: 1.4 };
const flagMetaStyle: React.CSSProperties = { marginTop: 3, fontSize: 11, fontWeight: 750, opacity: 0.8, wordBreak: "break-word" };
const emptyLineStyle: React.CSSProperties = { padding: 18, color: "var(--ink-faint)", fontSize: 13, fontWeight: 750, textAlign: "center" };
const tableWrapStyle: React.CSSProperties = { display: "grid", gap: 8, padding: 12 };
const kvBlockStyle: React.CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--surface)", padding: 10, display: "grid", gap: 6 };
const kvRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "150px minmax(0, 1fr)", gap: 8, alignItems: "start" };
const kvKeyStyle: React.CSSProperties = { fontSize: 11, fontWeight: 900, color: "var(--ink-faint)", wordBreak: "break-word" };
const kvValueStyle: React.CSSProperties = { fontSize: 12, fontWeight: 750, color: "var(--ink-mid)", wordBreak: "break-word", whiteSpace: "pre-wrap" };
const errorStyle: React.CSSProperties = { marginTop: 10, padding: "9px 10px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12, fontWeight: 800 };
const footerActionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", paddingBottom: 8 };
