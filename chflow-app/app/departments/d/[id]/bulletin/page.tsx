"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { useParams, useRouter } from "next/navigation";
import { List, RefreshCw, X } from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import PdfCanvasViewer from "@/components/PdfCanvasViewer";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";

type DeptBulletinItem = {
  no: number;
  title: string;
  issue_date: string | null;
  posted_at: string | null;
  author: string | null;
  url: string;
  pdf_url: string;
  stored: boolean;
};

type DeptBulletinResponse = {
  ok: boolean;
  latest: DeptBulletinItem | null;
  items: DeptBulletinItem[];
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

// 월·일만 (예: "6월 14일")
function formatMonthDay(value: string | null) {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${Number(m[2])}월 ${Number(m[3])}일`;
}

export default function DepartmentBulletinPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [deptCategory, setDeptCategory] = useState("");
  const [items, setItems] = useState<DeptBulletinItem[]>([]);
  const [selected, setSelected] = useState<DeptBulletinItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);

  const loadBulletins = async (accessToken: string, name: string) => {
    setError("");
    const res = await fetch(`/api/dept-bulletin/latest?dept=${encodeURIComponent(name)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as DeptBulletinResponse;
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `${name} 주보 목록을 불러오지 못했습니다`);
    }
    setItems(data.items || []);
    setSelected(data.latest || data.items?.[0] || null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      if (!cancelled) setAuthChecked(true);

      try {
        const { data: deptInfo, error: deptError } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
        const info = deptInfo && deptInfo[0];
        if (deptError || !info?.name) {
          throw new Error("부서 정보를 불러오지 못했습니다");
        }
        if (cancelled) return;
        setDeptName(info.name);
        setDeptCategory(info.category || "");
        await loadBulletins(session.access_token, info.name);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "주보 목록을 불러오지 못했습니다");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, deptId]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      let name = deptName;
      if (!name) {
        const { data: deptInfo } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
        const info = deptInfo && deptInfo[0];
        if (!info?.name) throw new Error("부서 정보를 불러오지 못했습니다");
        name = info.name;
        setDeptName(info.name);
        setDeptCategory(info.category || "");
      }
      await loadBulletins(session.access_token, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "주보 목록을 불러오지 못했습니다");
    } finally {
      setRefreshing(false);
    }
  };

  if (!authChecked) {
    return (
      <main style={pageStyle}>
        <LoadingView full />
      </main>
    );
  }

  const latest = selected || items[0] || null;

  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <header className="app-subpage-header" style={headerStyle}>
          <button className="app-header-back" type="button" onClick={() => router.push(`/departments/d/${deptId}`)} aria-label="부서홈으로" style={{ ...iconButtonStyle, width: "auto", padding: "0 12px", whiteSpace: "nowrap" }}>
            ← 부서홈
          </button>
          <HeaderLogo />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={eyebrowStyle}>{[deptCategory, deptName].filter(Boolean).join(" · ") || "부서 주보"}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <h1 style={titleStyle}>주보 보기</h1>
              {latest && formatMonthDay(latest.issue_date) && (
                <span style={dateChipStyle}>{formatMonthDay(latest.issue_date)}</span>
              )}
            </div>
          </div>
          <div className="app-header-actions">
            {items.length > 0 && (
              <button type="button" onClick={() => setShowList((v) => !v)} aria-label="주보 목록" style={iconButtonStyle}>
                <List size={19} strokeWidth={1.8} />
              </button>
            )}
            <button type="button" onClick={refresh} aria-label="새로고침" disabled={refreshing} style={iconButtonStyle}>
              <RefreshCw size={19} strokeWidth={1.8} style={{ transform: refreshing ? "rotate(28deg)" : undefined }} />
            </button>
          </div>
        </header>

        {error ? (
          <div style={emptyStyle}>
            <div style={emptyTitleStyle}>주보 목록을 가져오지 못했습니다</div>
            <div style={emptyTextStyle}>{error}</div>
            <button type="button" onClick={refresh} style={primaryButtonStyle}>다시 불러오기</button>
          </div>
        ) : loading ? (
          <div style={loadingPanelStyle}>{`최신 ${deptName || "부서"} 주보 확인 중...`}</div>
        ) : latest ? (
          <>
            <section style={pdfFrameWrapStyle}>
              <PdfCanvasViewer
                key={latest.pdf_url}
                url={latest.pdf_url}
                fallbackUrl={latest.url}
              />
            </section>

            {showList && (
              <div style={listOverlayStyle} onClick={() => setShowList(false)}>
                <div style={listStyle} onClick={(e) => e.stopPropagation()}>
                  <div style={listHeaderRowStyle}>
                    <span style={sectionTitleTextStyle}>{`${deptName || "부서"} 주보 목록`}</span>
                    <button type="button" onClick={() => setShowList(false)} aria-label="닫기" style={listCloseStyle}>
                      <X size={18} strokeWidth={1.9} />
                    </button>
                  </div>
                  <div style={listScrollStyle}>
                    {items.slice(0, 12).map((item) => (
                      <button
                        key={`${item.no}-${item.issue_date}`}
                        type="button"
                        onClick={() => {
                          setSelected(item);
                          setShowList(false);
                        }}
                        style={{
                          ...rowStyle,
                          ...(item.no === latest.no ? selectedRowStyle : null),
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={rowTitleStyle}>{item.title}</div>
                          <div style={rowMetaStyle}>{formatDate(item.issue_date)}</div>
                        </div>
                        <span style={item.no === latest.no ? activeTextStyle : chooseTextStyle}>
                          {item.no === latest.no ? "선택됨" : "선택"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

          </>
        ) : (
          <div style={emptyStyle}>
            <div style={emptyTitleStyle}>{`표시할 ${deptName || "부서"} 주보가 없습니다`}</div>
            <button type="button" onClick={refresh} style={primaryButtonStyle}>다시 불러오기</button>
          </div>
        )}
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "'Noto Sans KR', var(--app-sans), sans-serif",
  padding: "clamp(12px, 4vw, 24px)",
};

const shellStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 900,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 16,
};

const iconButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  color: "var(--ink)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "var(--accent)",
  lineHeight: 1.2,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: 1.25,
  fontWeight: 800,
  letterSpacing: 0,
};

const dateChipStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#3E7D74",
};

const pdfFrameWrapStyle: React.CSSProperties = {
  width: "100%",
  height: "calc(100vh - 132px)",
  minHeight: 520,
  maxHeight: 900,
  border: "1px solid var(--hairline)",
  borderRadius: 12,
  background: "var(--card)",
  overflow: "hidden",
  marginBottom: 12,
};

const listOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  background: "rgba(20, 26, 22, 0.45)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "clamp(16px, 6vh, 64px) 16px",
  overflowY: "auto",
};

const listStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 520,
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  border: "1px solid var(--hairline)",
  borderRadius: 14,
  background: "var(--surface)",
  overflow: "hidden",
  boxShadow: "0 18px 48px rgba(20, 26, 22, 0.28)",
};

const listHeaderRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "11px 12px 11px 16px",
  borderBottom: "1px solid var(--hairline)",
  flexShrink: 0,
};

const sectionTitleTextStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
};

const listCloseStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 9,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  color: "var(--ink)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const listScrollStyle: React.CSSProperties = {
  overflowY: "auto",
};

const rowStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 68,
  padding: "12px 16px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  borderBottom: "1px solid var(--hairline)",
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  background: "transparent",
  color: "var(--ink)",
  textAlign: "left",
  fontFamily: "inherit",
  cursor: "pointer",
};

const selectedRowStyle: React.CSSProperties = {
  background: "rgba(20, 184, 166, 0.08)",
};

const rowTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.35,
  wordBreak: "keep-all",
  overflowWrap: "anywhere",
};

const rowMetaStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "var(--ink-soft)",
  lineHeight: 1.35,
};

const chooseTextStyle: React.CSSProperties = {
  minWidth: 48,
  flexShrink: 0,
  color: "#3E7D74",
  fontSize: 12,
  fontWeight: 800,
  textAlign: "right",
};

const activeTextStyle: React.CSSProperties = {
  ...chooseTextStyle,
  color: "var(--warning)",
};

const loadingPanelStyle: React.CSSProperties = {
  minHeight: 180,
  borderRadius: 14,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--ink-soft)",
};

const emptyStyle: React.CSSProperties = {
  minHeight: 220,
  borderRadius: 14,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: 20,
  textAlign: "center",
};

const emptyTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
};

const emptyTextStyle: React.CSSProperties = {
  maxWidth: 480,
  fontSize: 13,
  color: "var(--ink-soft)",
  lineHeight: 1.5,
};

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 38,
  padding: "0 14px",
  borderRadius: 10,
  border: "none",
  background: "#3E7D74",
  color: "#fff",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};
