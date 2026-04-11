"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, normalizePhone } from "@/lib/supabase";

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
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f0f9ff 0%, #fef3c7 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
        fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
      }}
    >
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: 24,
          padding: "32px 28px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.1)",
          border: "1px solid rgba(255,255,255,0.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => router.push("/login")}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#f1f5f9",
              border: "none",
              fontSize: 16,
              cursor: "pointer",
              color: "#475569",
            }}
          >
            ←
          </button>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>아이디 찾기</div>
        </div>

        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20, lineHeight: 1.6 }}>
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
              onChange={(e) => setPhone(e.target.value)}
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
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      borderRadius: 12,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", letterSpacing: 0.5 }}>
                      {r.username}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
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
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: 0.5 };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: 14,
  background: "#fff",
  border: "1.5px solid #e2e8f0",
  borderRadius: 10,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  color: "#0f172a",
  fontWeight: 500,
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  fontSize: 15,
  fontWeight: 700,
  color: "#fff",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(99, 102, 241, 0.3)",
  fontFamily: "inherit",
};

const errorStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 10,
  fontSize: 12,
  color: "#b91c1c",
  marginBottom: 12,
};
