"use client";

import { useState, useEffect } from "react";
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
  }, [router]);

  async function loadLogs() {
    const { data } = await supabase
      .from("password_reset_log")
      .select("id, admin_username, target_username, target_name, reason, reset_at")
      .order("reset_at", { ascending: false })
      .limit(20);
    if (data) setLogs(data);
  }

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
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <HeaderLogo />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={() => router.push("/home")} style={btnGhost}>←</button>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", margin: 0 }}>🔐 비밀번호 초기화 (관리자)</h1>
        </div>

        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: 12, fontSize: 12, color: "#78350f", marginBottom: 16, lineHeight: 1.6 }}>
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
          {error && <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>{error}</div>}
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
                  background: selectedUser?.id === u.id ? "#dbeafe" : "#f8fafc",
                  border: selectedUser?.id === u.id ? "2px solid #3b82f6" : "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                      {u.name} <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 11 }}>({u.username})</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {u.phone || "전화번호 없음"} · {u.role === "admin" ? "관리자" : "회원"}
                      {u.must_change_password && <span style={{ color: "#d97706", marginLeft: 6 }}>· 비번 변경 필요</span>}
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
          <div style={{ ...card, background: "#f0fdf4", border: "2px solid #22c55e" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#15803d", marginBottom: 8 }}>✅ 임시 비밀번호 발급 완료</div>
            <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 4 }}>
              사용자: <strong>{resetResult.name}</strong> ({resetResult.username})
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
              임시 비밀번호를 사용자에게 안전한 채널 (SMS/카카오톡 등) 로 전달하세요.
            </div>
            <div style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 12px", fontFamily: "ui-monospace, monospace", fontSize: 18, fontWeight: 800, color: "#1e293b", textAlign: "center", marginBottom: 8, letterSpacing: 2 }}>
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
            <div style={{ fontSize: 12, color: "#94a3b8", padding: 12 }}>이력 없음</div>
          ) : (
            <div style={{ fontSize: 12, color: "#475569" }}>
              {logs.map((log) => (
                <div key={log.id} style={{ padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ color: "#94a3b8" }}>{new Date(log.reset_at).toLocaleString("ko-KR")}</span>
                  {" · "}
                  <strong>{log.admin_username}</strong>
                  {" → "}
                  <strong>{log.target_name || log.target_username}</strong>
                  {log.reason && <span style={{ color: "#94a3b8" }}> ({log.reason})</span>}
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
const input: React.CSSProperties = { flex: 1, padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const btnPrimary: React.CSSProperties = { padding: "10px 16px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnDanger: React.CSSProperties = { padding: "10px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnGhost: React.CSSProperties = { padding: "10px 16px", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
