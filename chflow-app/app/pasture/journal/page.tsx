"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { BookText, Settings, X, RefreshCw, ChevronRight, KeyRound } from "lucide-react";

type Board = { boardId: string; category: number; label: string | null } | null;

type Entry = { no: number; writer: string; place: string; meetingDate: string };

type EntryDetail = {
  no: number;
  boardTitle: string;
  writer: string;
  postedAt: string;
  fields: Record<string, string>;
};

type LoadState = "loading" | "no_credentials" | "no_board" | "ready" | "error";

export default function CellJournalPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [board, setBoard] = useState<Board>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rediscovering, setRediscovering] = useState(false);

  const [credsModalOpen, setCredsModalOpen] = useState(false);
  const [credsForm, setCredsForm] = useState({ ums_user_id: "", ums_password: "" });
  const [credsSaving, setCredsSaving] = useState(false);

  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (opts?: { rediscover?: boolean }) => {
    if (opts?.rediscover) setRediscovering(true);
    else setState("loading");
    setErrorMsg("");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }

    try {
      const url = opts?.rediscover ? "/api/cell-journal?rediscover=1" : "/api/cell-journal";
      const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await res.json();
      if (!json.ok) {
        setErrorMsg(json.error || "목장일지를 불러오지 못했습니다.");
        setState("error");
        return;
      }
      if (!json.has_credentials) {
        setState("no_credentials");
        return;
      }
      if (!json.board) {
        setBoard(null);
        setState("no_board");
        return;
      }
      setBoard(json.board);
      setEntries(json.entries || []);
      setState("ready");
    } catch {
      setErrorMsg("네트워크 오류가 발생했습니다.");
      setState("error");
    } finally {
      setRediscovering(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (no: number) => {
    setDetailLoading(true);
    setDetail(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch(`/api/cell-journal/${no}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await res.json();
      if (json.ok) setDetail(json.entry);
      else setErrorMsg(json.error || "목장일지를 불러오지 못했습니다.");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSaveCreds = async () => {
    if (!credsForm.ums_user_id.trim() || !credsForm.ums_password) return;
    setCredsSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/ums-credentials/mine", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(credsForm),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setCredsForm({ ums_user_id: "", ums_password: "" });
      setCredsModalOpen(false);
      await load();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setCredsSaving(false);
    }
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <HeaderLogo />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <BookText size={18} strokeWidth={1.8} /> 목장일지
            </h1>
            <div style={subtitleStyle}>해외선교 후원목장 · 본인 UMS 계정으로 열람</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={ghostButtonStyle} onClick={() => router.replace("/home")}>홈</button>
          {state === "ready" && (
            <button style={ghostButtonStyle} onClick={() => { setCredsForm({ ums_user_id: "", ums_password: "" }); setCredsModalOpen(true); }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Settings size={13} strokeWidth={1.8} /> 계정</span>
            </button>
          )}
        </div>
      </header>

      <div style={panelStyle}>
        {state === "loading" && <LoadingView label="불러오는 중... (최초 조회 시 최대 1분 정도 걸릴 수 있어요)" />}

        {state === "no_credentials" && (
          <>
            <EmptyState
              icon={<KeyRound size={28} strokeWidth={1.6} />}
              message="UMS 계정 등록이 필요합니다"
              hint="목장일지는 본인의 명성교회 홈페이지(ums.or.kr) 계정으로만 열람할 수 있습니다. 비밀번호는 암호화되어 저장됩니다."
            />
            <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
              <button style={primaryButtonStyle} onClick={() => setCredsModalOpen(true)}>UMS 계정 등록</button>
            </div>
          </>
        )}

        {state === "no_board" && (
          <>
            <EmptyState
              icon={<BookText size={28} strokeWidth={1.6} />}
              message="연동된 목장일지를 찾지 못했습니다"
              hint="이 기능은 해외선교 후원목장 전용 게시판입니다. 소속되어 있지 않다면 해당하지 않는 것이 정상입니다."
            />
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 4 }}>
              <button style={ghostButtonStyle} onClick={() => setCredsModalOpen(true)}>계정 다시 등록</button>
              <button style={primaryButtonStyle} onClick={() => load({ rediscover: true })} disabled={rediscovering}>
                {rediscovering ? "다시 찾는 중..." : "다시 찾기"}
              </button>
            </div>
          </>
        )}

        {state === "error" && (
          <>
            <EmptyState icon={<X size={28} strokeWidth={1.6} />} message="문제가 발생했습니다" hint={errorMsg} />
            <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
              <button style={primaryButtonStyle} onClick={() => load()}>다시 시도</button>
            </div>
          </>
        )}

        {state === "ready" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{board?.label || "내 목장"}</div>
              <button style={ghostButtonStyle} onClick={() => load({ rediscover: true })} disabled={rediscovering}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <RefreshCw size={13} strokeWidth={1.8} className={rediscovering ? "spin" : ""} /> 새로고침
                </span>
              </button>
            </div>

            {entries.length === 0 ? (
              <EmptyState icon={<BookText size={28} strokeWidth={1.6} />} message="등록된 목장일지가 없습니다" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {entries.map((e) => (
                  <button key={e.no} onClick={() => openDetail(e.no)} style={entryRowStyle}>
                    <div style={{ minWidth: 0, textAlign: "left" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{e.meetingDate}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                        {e.writer} 작성 {e.place && `· ${e.place}`}
                      </div>
                    </div>
                    <ChevronRight size={16} strokeWidth={1.8} color="var(--ink-faint)" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {credsModalOpen && (
        <ModalBackdrop onClose={() => setCredsModalOpen(false)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Settings size={18} strokeWidth={1.8} /> UMS 계정 설정
              </div>
              <button onClick={() => setCredsModalOpen(false)} style={iconBtnStyle}><X size={16} strokeWidth={1.8} /></button>
            </div>

            <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6, marginBottom: 14, background: "var(--surface)", padding: 10, borderRadius: 8 }}>
              <b>본인의 명성교회 홈페이지(ums.or.kr) 계정</b>을 등록하세요.<br />
              주보 자동등록과 계정을 함께 사용합니다.<br />
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>비밀번호는 AES-256-GCM 으로 암호화돼 저장됩니다.</span>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>UMS 아이디</div>
              <input
                type="text" autoComplete="off"
                value={credsForm.ums_user_id}
                onChange={(e) => setCredsForm((f) => ({ ...f, ums_user_id: e.target.value }))}
                placeholder="ums.or.kr 가입 시 만든 아이디"
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>UMS 비밀번호</div>
              <input
                type="password" autoComplete="new-password"
                value={credsForm.ums_password}
                onChange={(e) => setCredsForm((f) => ({ ...f, ums_password: e.target.value }))}
                placeholder="ums.or.kr 비밀번호"
                style={inputStyle}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setCredsModalOpen(false)} style={ghostButtonStyle}>취소</button>
              <button onClick={handleSaveCreds} disabled={credsSaving} style={primaryButtonStyle}>
                {credsSaving ? "저장 중..." : "저장"}
              </button>
            </div>

            <div style={{ marginTop: 14, fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5 }}>
              계정 없으면 <a href="http://www.ums.or.kr/bbs/join.php" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>ums.or.kr 회원가입</a> 후 등록.
            </div>
          </div>
        </ModalBackdrop>
      )}

      {(detailLoading || detail) && (
        <ModalBackdrop onClose={() => setDetail(null)}>
          <div style={{ ...modalCardStyle, maxWidth: 520, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>
                {detail ? detail.fields["모임일자"] || detail.boardTitle : "불러오는 중..."}
              </div>
              <button onClick={() => setDetail(null)} style={iconBtnStyle}><X size={16} strokeWidth={1.8} /></button>
            </div>

            {detailLoading && <LoadingView label="불러오는 중..." />}

            {detail && (
              <>
                <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 12 }}>
                  {detail.writer} 작성 · {detail.postedAt}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {Object.entries(detail.fields).map(([label, value]) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: 13, color: "var(--ink)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{value || "-"}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </ModalBackdrop>
      )}

      <style>{`
        .spin { animation: cj-spin 1s linear infinite; }
        @keyframes cj-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, var(--info-soft) 0%, var(--warning-soft) 100%)",
  padding: "20px 16px 60px",
  fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
};
const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  gap: 12, maxWidth: 640, margin: "0 auto 16px", padding: "0 4px",
};
const titleStyle: React.CSSProperties = { fontSize: 20, fontWeight: 800, color: "var(--ink)", margin: 0 };
const subtitleStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink-soft)", marginTop: 2 };
const panelStyle: React.CSSProperties = {
  maxWidth: 640, margin: "0 auto",
  background: "color-mix(in srgb, var(--card) 92%, transparent)",
  backdropFilter: "blur(20px)",
  borderRadius: 16, padding: 16,
  boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  border: "1px solid var(--hairline)",
};
const ghostButtonStyle: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 10, background: "var(--card)",
  border: "1.5px solid var(--hairline)", fontSize: 12, fontWeight: 700,
  color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
};
const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 10,
  background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  color: "#fff", border: "none", fontSize: 13, fontWeight: 800,
  cursor: "pointer", fontFamily: "inherit",
};
const iconBtnStyle: React.CSSProperties = {
  padding: 6, borderRadius: 8, background: "var(--surface)",
  border: "1px solid var(--hairline)", cursor: "pointer", display: "inline-flex", alignItems: "center",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8,
  border: "1.5px solid var(--hairline)", background: "var(--card)", color: "var(--ink)",
  fontSize: 14, fontFamily: "inherit", boxSizing: "border-box",
};
const modalCardStyle: React.CSSProperties = {
  background: "var(--card)", borderRadius: 16, padding: 20,
  width: "100%", maxWidth: 420, boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
};
const entryRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "12px 14px", borderRadius: 10, background: "var(--surface)",
  border: "1px solid var(--hairline)", cursor: "pointer", fontFamily: "inherit",
  width: "100%",
};
