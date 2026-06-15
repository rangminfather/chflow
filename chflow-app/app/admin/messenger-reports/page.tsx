"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  MessageSquareWarning,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import { EmptyState, LoadingView } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";
import {
  listMessengerReports,
  resolveMessengerReport,
  type MessengerReport,
  type MessengerReportStatus,
} from "@/lib/messenger";

const STATUS_OPTIONS: { value: MessengerReportStatus | ""; label: string }[] = [
  { value: "open", label: "미처리" },
  { value: "reviewing", label: "검토중" },
  { value: "resolved", label: "해결" },
  { value: "dismissed", label: "기각" },
  { value: "", label: "전체" },
];

const STATUS_LABEL: Record<MessengerReportStatus, string> = {
  open: "미처리",
  reviewing: "검토중",
  resolved: "해결",
  dismissed: "기각",
};

export default function MessengerReportsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [status, setStatus] = useState<MessengerReportStatus | "">("open");
  const [reports, setReports] = useState<MessengerReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const counts = useMemo(() => ({
    open: reports.filter((r) => r.status === "open").length,
    reviewing: reports.filter((r) => r.status === "reviewing").length,
    done: reports.filter((r) => r.status === "resolved" || r.status === "dismissed").length,
  }), [reports]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await listMessengerReports(status, 80);
      setReports(rows);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

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

  useEffect(() => {
    if (authChecked) load();
  }, [authChecked, load]);

  const updateStatus = async (report: MessengerReport, nextStatus: MessengerReportStatus) => {
    const note = nextStatus === "reviewing"
      ? "검토를 시작했습니다."
      : window.prompt("처리 메모를 입력하세요.", report.note || "") || "";

    setProcessingId(report.report_id);
    setError("");
    try {
      await resolveMessengerReport(report.report_id, nextStatus, note);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setProcessingId(null);
    }
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
              <div style={titleStyle}>메신저 신고 관리</div>
              <div style={subTitleStyle}>신고 메시지를 검토하고 처리 상태를 기록합니다.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => router.push("/messenger")} style={secondaryButtonStyle}>
              <ExternalLink size={15} strokeWidth={1.8} /> 메신저
            </button>
            <button type="button" onClick={() => router.push("/home")} style={secondaryButtonStyle}>
              <ArrowLeft size={15} strokeWidth={1.8} /> 홈
            </button>
          </div>
        </header>

        {error && <div style={errorStyle}>{error}</div>}

        <section className="report-summary" style={summaryGridStyle}>
          <SummaryCard icon={<MessageSquareWarning size={22} />} label="미처리" value={counts.open} tone="danger" />
          <SummaryCard icon={<ShieldCheck size={22} />} label="검토중" value={counts.reviewing} tone="accent" />
          <SummaryCard icon={<CheckCircle2 size={22} />} label="처리완료" value={counts.done} tone="success" />
        </section>

        <section style={panelStyle}>
          <div style={toolbarStyle}>
            <div style={tabsStyle}>
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value || "all"}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  style={{
                    ...tabStyle,
                    ...(status === option.value ? tabActiveStyle : null),
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={load} disabled={loading} style={refreshButtonStyle}>
              <RefreshCw size={14} strokeWidth={1.9} /> 새로고침
            </button>
          </div>

          {loading ? (
            <LoadingView padding={44} />
          ) : reports.length === 0 ? (
            <EmptyState
              icon={<MessageSquareWarning size={28} strokeWidth={1.7} />}
              message="표시할 신고가 없습니다."
              hint="신고가 접수되면 이 화면에서 처리할 수 있습니다."
              padding={56}
            />
          ) : (
            <div style={listStyle}>
              {reports.map((report) => (
                <ReportCard
                  key={report.report_id}
                  report={report}
                  busy={processingId === report.report_id}
                  onReview={() => updateStatus(report, "reviewing")}
                  onResolve={() => updateStatus(report, "resolved")}
                  onDismiss={() => updateStatus(report, "dismissed")}
                  onOpenConversation={() => {
                    if (report.conversation_id) router.push(`/messenger?c=${report.conversation_id}`);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ReportCard({
  report,
  busy,
  onReview,
  onResolve,
  onDismiss,
  onOpenConversation,
}: {
  report: MessengerReport;
  busy: boolean;
  onReview: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  onOpenConversation: () => void;
}) {
  return (
    <article style={cardStyle}>
      <div style={cardTopStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={reasonStyle}>{report.reason}</div>
          <div style={metaStyle}>
            신고자 {report.reporter_name || "알 수 없음"} · 대상 {report.reported_user_name || "알 수 없음"} · {formatKST(report.created_at)}
          </div>
        </div>
        <span style={{ ...statusBadgeStyle, ...statusTone(report.status) }}>
          {STATUS_LABEL[report.status]}
        </span>
      </div>

      <div style={messageBoxStyle}>
        {report.message_body || "메시지 본문이 없거나 삭제되었습니다."}
      </div>

      {report.note && (
        <div style={noteStyle}>
          처리 메모: {report.note}
          {report.resolved_at ? ` · ${formatKST(report.resolved_at)}` : ""}
        </div>
      )}

      <div style={actionsStyle}>
        <button type="button" onClick={onOpenConversation} disabled={!report.conversation_id || busy} style={outlineActionStyle}>
          <ExternalLink size={14} strokeWidth={1.8} /> 대화 열기
        </button>
        <button type="button" onClick={onReview} disabled={busy || report.status === "reviewing"} style={outlineActionStyle}>
          <ShieldCheck size={14} strokeWidth={1.8} /> 검토중
        </button>
        <button type="button" onClick={onResolve} disabled={busy} style={successActionStyle}>
          <CheckCircle2 size={14} strokeWidth={1.8} /> 해결
        </button>
        <button type="button" onClick={onDismiss} disabled={busy} style={dangerActionStyle}>
          <XCircle size={14} strokeWidth={1.8} /> 기각
        </button>
      </div>
    </article>
  );
}

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "danger" | "accent" | "success" }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "success" ? "var(--success)" : "var(--accent)";
  const bg = tone === "danger" ? "var(--danger-soft)" : tone === "success" ? "var(--success-soft)" : "var(--accent-soft)";
  return (
    <div style={summaryCardStyle}>
      <div style={{ ...summaryIconStyle, background: bg, color }}>{icon}</div>
      <div>
        <div style={summaryValueStyle}>{value}</div>
        <div style={summaryLabelStyle}>{label}</div>
      </div>
    </div>
  );
}

function statusTone(status: MessengerReportStatus): React.CSSProperties {
  if (status === "resolved") return { background: "var(--success-soft)", color: "var(--success)" };
  if (status === "dismissed") return { background: "var(--bg-soft)", color: "var(--ink-faint)" };
  if (status === "reviewing") return { background: "var(--accent-soft)", color: "var(--accent)" };
  return { background: "var(--danger-soft)", color: "var(--danger)" };
}

function formatKST(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "처리 중 오류가 발생했습니다.";
}

const responsiveCss = `
  @media (max-width: 760px) {
    .report-summary { grid-template-columns: 1fr !important; }
  }
`;

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", color: "var(--ink)", fontFamily: "var(--font-noto-sans-kr), -apple-system, BlinkMacSystemFont, sans-serif", padding: 16 };
const shellStyle: React.CSSProperties = { maxWidth: 1120, margin: "0 auto" };
const headerStyle: React.CSSProperties = { minHeight: 68, padding: "14px 16px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 };
const titleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 900 };
const subTitleStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink-faint)", marginTop: 2 };
const secondaryButtonStyle: React.CSSProperties = { height: 36, padding: "0 11px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink-mid)", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 850, cursor: "pointer", fontFamily: "inherit" };
const errorStyle: React.CSSProperties = { marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12, fontWeight: 800 };
const summaryGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 14 };
const summaryCardStyle: React.CSSProperties = { minHeight: 82, borderRadius: 10, border: "1px solid var(--hairline)", background: "var(--card)", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" };
const summaryIconStyle: React.CSSProperties = { width: 44, height: 44, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0 };
const summaryValueStyle: React.CSSProperties = { fontSize: 24, fontWeight: 900, lineHeight: 1 };
const summaryLabelStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink-faint)", fontWeight: 800, marginTop: 4 };
const panelStyle: React.CSSProperties = { borderRadius: 12, border: "1px solid var(--hairline)", background: "var(--card)", overflow: "hidden" };
const toolbarStyle: React.CSSProperties = { padding: 12, borderBottom: "1px solid var(--hairline)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" };
const tabsStyle: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const tabStyle: React.CSSProperties = { height: 32, padding: "0 10px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink-soft)", fontSize: 12, fontWeight: 850, cursor: "pointer", fontFamily: "inherit" };
const tabActiveStyle: React.CSSProperties = { borderColor: "rgba(62,90,74,0.35)", background: "var(--accent-soft)", color: "var(--accent)" };
const refreshButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, height: 32 };
const listStyle: React.CSSProperties = { display: "grid", gap: 10, padding: 12 };
const cardStyle: React.CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 10, background: "var(--surface)", padding: 13 };
const cardTopStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 };
const reasonStyle: React.CSSProperties = { fontSize: 15, fontWeight: 900, lineHeight: 1.35 };
const metaStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink-faint)", fontWeight: 650, marginTop: 4 };
const statusBadgeStyle: React.CSSProperties = { minWidth: 56, height: 26, padding: "0 8px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, flexShrink: 0 };
const messageBoxStyle: React.CSSProperties = { marginTop: 10, borderRadius: 8, background: "var(--bg-soft)", border: "1px solid var(--hairline)", padding: "10px 11px", fontSize: 13, lineHeight: 1.55, color: "var(--ink-mid)", whiteSpace: "pre-wrap", wordBreak: "break-word" };
const noteStyle: React.CSSProperties = { marginTop: 8, fontSize: 12, color: "var(--accent)", fontWeight: 800 };
const actionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 7, flexWrap: "wrap", marginTop: 12 };
const actionBaseStyle: React.CSSProperties = { height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--hairline)", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 850, cursor: "pointer", fontFamily: "inherit" };
const outlineActionStyle: React.CSSProperties = { ...actionBaseStyle, background: "var(--card)", color: "var(--ink-mid)" };
const successActionStyle: React.CSSProperties = { ...actionBaseStyle, border: "none", background: "var(--success)", color: "#fff" };
const dangerActionStyle: React.CSSProperties = { ...actionBaseStyle, border: "none", background: "var(--danger-soft)", color: "var(--danger)" };
