"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, normalizePhone, formatPhone } from "@/lib/supabase";

export default function FindIdPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<{ username: string; status: string; created_at: string }[] | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setResults(null);

    if (!name.trim()) return setError("이름을 입력하세요");
    if (!phone.trim()) return setError("전화번호를 입력하세요");

    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("find_username", {
      p_name: name.trim(),
      p_phone: normalizePhone(phone),
    });

    if (rpcError) {
      setError("조회 중 오류가 발생했습니다");
      setLoading(false);
      return;
    }

    setResults(data || []);
    setLoading(false);
  };

  return (
    <main className="login-screen">

      <section className="login-panel">
        <div className="auth-topbar">
          <button
            onClick={() => router.push("/login")}
            className="auth-back-button"
            aria-label="로그인으로 돌아가기"
          >
            ←
          </button>
          <div className="auth-page-title">아이디 찾기</div>
        </div>

        <div className="auth-copy" style={{ marginBottom: 20 }}>
          가입 시 등록한 <strong>이름</strong>과 <strong>전화번호</strong>를 입력해주세요.
        </div>

        <form onSubmit={handleSearch}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="실명"
              style={{ ...inputStyle, marginTop: 6 }}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>전화번호</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="010-0000-0000"
              style={{ ...inputStyle, marginTop: 6 }}
            />
          </div>

          {error && (
            <div style={errorStyle}>⚠️ {error}</div>
          )}

          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            {loading ? "조회 중..." : "아이디 찾기"}
          </button>
        </form>

        {results !== null && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
            {results.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", fontSize: 13, color: "#94a3b8" }}>
                일치하는 회원 정보가 없습니다.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 12 }}>
                  조회된 아이디 ({results.length}개)
                </div>
                {results.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "14px 16px",
                      background: "#f3f7f1",
                      border: "1px solid rgba(62, 90, 74, 0.16)",
                      borderRadius: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: 0 }}>
                      {r.username}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--ink-soft)", marginTop: 4 }}>
                      가입일: {new Date(r.created_at).toLocaleDateString("ko-KR")}
                      {r.status === "pending" && " · 승인 대기 중"}
                      {r.status === "rejected" && " · 가입 거절됨"}
                      {r.status === "inactive" && " · 비활성"}
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => router.push("/login")}
                  style={{ ...primaryBtnStyle, marginTop: 12 }}
                >
                  로그인 하러 가기
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 750, color: "var(--ink)", letterSpacing: 0 };

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 54,
  padding: "0 16px",
  fontSize: 15,
  background: "rgba(255, 255, 255, 0.86)",
  border: "1px solid rgba(43, 39, 34, 0.14)",
  borderRadius: 8,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  color: "var(--ink)",
  fontWeight: 650,
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  height: 56,
  padding: "0 16px",
  fontSize: 16,
  fontWeight: 800,
  color: "#fff",
  background: "var(--accent)",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  boxShadow: "0 16px 34px rgba(62, 90, 74, 0.24)",
  fontFamily: "inherit",
};

const errorStyle: React.CSSProperties = {
  padding: "11px 12px",
  background: "#fff1ed",
  border: "1px solid #f2c9c1",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 650,
  color: "#8f2d2d",
  marginBottom: 12,
};
