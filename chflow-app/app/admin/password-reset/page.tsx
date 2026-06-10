"use client";

import { useCallback, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";

interface UserSearchResult {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  role: string;
  must_change_password: boolean;
}

interface ResetLogRow {
  id: string;
  admin_username: string;
  target_username: string;
  target_name: string | null;
  reason: string | null;
  reset_at: string;
}

export default function PasswordResetPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [reason, setReason] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ username: string; name: string; tempPw: string } | null>(null);
  const [logs, setLogs] = useState<ResetLogRow[]>([]);
  const [error, setError] = useState("");

  const loadLogs = useCallback(async () => {
    const { data } = await supabase
      .from("password_reset_log")
      .select("id, admin_username, target_username, target_name, reason, reset_at")
      .order("reset_at", { ascending: false })
      .limit(20);
    if (data) setLogs(data);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role !== "admin") {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
      loadLogs();
    })();
  }, [loadLogs, router]);

  async function doSearch() {
    setError("");
    const q = query.trim();
    if (q.length < 2) { setError("최소 2자 이상 입력하세요"); return; }
    setSearching(true);
    const { data, error: e } = await supabase
      .from("profiles")
      .select("id, username, name, phone, role, must_change_password")
      .or(`username.ilike.%${q}%,name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(20);
    setSearching(false);
    if (e) { setError(e.message); return; }
    setResults(data || []);
  }

  async function doReset() {
    if (!selectedUser) return;
    if (!confirm(`${selectedUser.name} (${selectedUser.username}) 의 비밀번호를 초기화하시겠습니까?\n\n임시 비밀번호가 발급되며, 첫 로그인 시 변경하도록 강제됩니다.`)) return;
    setResetting(true);
    setError("");
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ target_user_id: selectedUser.id, reason: reason.trim() || null }),
    });
    const j = await r.json();
    setResetting(false);
    if (!j.ok) { setError(j.error || "실패"); return; }
    setResetResult({ username: j.target_username, name: j.target_name, tempPw: j.temp_password });
    setSelectedUser(null);
    setReason("");
    loadLogs();
  }

  function copyTempPw() {
    if (!resetResult) return;
    navigator.clipboard.writeText(resetResult.tempPw).then(() => {
      alert("클립보드에 복사됨");
    });
  }

  if (!authChecked) {
    return <div style={{ padding: 40, textAlign: "center" }}>권한 확인 중...</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <HeaderLogo />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={() => router.push("/home")} style={btnGhost}>←</button>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0 }}>🔐 비밀번호 초기화 (관리자)</h1>
        </div>

        <div style={{ background: "var(--warning-soft)", border: "1px solid #E0C893", borderRadius: 8, padding: 12, fontSize: 12, color: "var(--warning)", marginBottom: 16, lineHeight: 1.6 }}>
          ⚠️ 사용자 비밀번호 초기화는 <strong>모두 audit log 에 기록</strong>됩니다 (누가/언제/누구). 임시 비밀번호 발급 후 사용자가 첫 로그인 시 새 비밀번호로 변경하도록 강제됩니다.
        </div>

        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>1. 사용자 검색</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
              placeholder="아이디, 이름, 또는 전화번호"
              style={input}
            />
            <button onClick={doSearch} disabled={searching} style={btnPrimary}>
              {searching ? "..." : "검색"}
            </button>
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{error}</div>}
        </div>

        {results.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>2. 대상 선택 ({results.length}명)</div>
            {results.map((u) => (
              <div
                key={u.id}
                onClick={() => setSelectedUser(u)}
                style={{
                  padding: "10px 12px", marginBottom: 4, borderRadius: 8, cursor: "pointer",
                  background: selectedUser?.id === u.id ? "var(--accent-soft)" : "var(--surface)",
                  border: selectedUser?.id === u.id ? "2px solid var(--accent)" : "1px solid var(--hairline)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                      {u.name} <span style={{ color: "var(--ink-faint)", fontWeight: 400, fontSize: 11 }}>({u.username})</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                      {u.phone || "전화번호 없음"} · {u.role === "admin" ? "관리자" : "회원"}
                      {u.must_change_password && <span style={{ color: "var(--warning)", marginLeft: 6 }}>· 비번 변경 필요</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedUser && (
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>3. 초기화 사유 (선택)</div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 사용자가 비번 분실 — SMS 로 요청"
              style={input}
            />
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setSelectedUser(null)} style={btnGhost}>취소</button>
              <button onClick={doReset} disabled={resetting} style={btnDanger}>
                {resetting ? "처리 중..." : `🔐 ${selectedUser.name} 비번 초기화`}
              </button>
            </div>
          </div>
        )}

        {resetResult && (
          <div style={{ ...card, background: "var(--success-soft)", border: "2px solid var(--success)" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--success)", marginBottom: 8 }}>✅ 임시 비밀번호 발급 완료</div>
            <div style={{ fontSize: 13, color: "var(--ink)", marginBottom: 4 }}>
              사용자: <strong>{resetResult.name}</strong> ({resetResult.username})
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 12 }}>
              임시 비밀번호를 사용자에게 안전한 채널 (SMS/카카오톡 등) 로 전달하세요.
            </div>
            <div style={{ background: "#fff", border: "1px solid var(--hairline-strong)", borderRadius: 8, padding: "10px 12px", fontFamily: "ui-monospace, monospace", fontSize: 18, fontWeight: 800, color: "var(--ink)", textAlign: "center", marginBottom: 8, letterSpacing: 2 }}>
              {resetResult.tempPw}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={copyTempPw} style={{ ...btnPrimary, flex: 1 }}>📋 복사</button>
              <button onClick={() => setResetResult(null)} style={btnGhost}>닫기</button>
            </div>
          </div>
        )}

        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>📋 최근 초기화 이력</div>
          {logs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--ink-faint)", padding: 12 }}>이력 없음</div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--ink-mid)" }}>
              {logs.map((log) => (
                <div key={log.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--bg-soft)" }}>
                  <span style={{ color: "var(--ink-faint)" }}>{new Date(log.reset_at).toLocaleString("ko-KR")}</span>
                  {" · "}
                  <strong>{log.admin_username}</strong>
                  {" → "}
                  <strong>{log.target_name || log.target_username}</strong>
                  {log.reason && <span style={{ color: "var(--ink-faint)" }}> ({log.reason})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" };
const input: React.CSSProperties = { flex: 1, padding: "10px 12px", border: "1px solid var(--hairline-strong)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const btnPrimary: React.CSSProperties = { padding: "10px 16px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnDanger: React.CSSProperties = { padding: "10px 16px", background: "var(--danger)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnGhost: React.CSSProperties = { padding: "10px 16px", background: "var(--bg-soft)", color: "var(--ink-mid)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
