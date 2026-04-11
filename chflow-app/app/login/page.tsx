"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, usernameToEmail, validateUsername } from "@/lib/supabase";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notice = searchParams.get("notice");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (notice === "pending") setInfo("관리자 승인 대기 중입니다. 승인 후 이용 가능합니다.");
    if (notice === "signup") setInfo("회원가입 신청 완료! 관리자 승인 후 로그인 가능합니다.");
    if (notice === "logout") setInfo("로그아웃되었습니다.");
  }, [notice]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    const lowerUsername = username.toLowerCase().trim();
    const v = validateUsername(lowerUsername);
    if (!v.valid) {
      setError(v.error!);
      setLoading(false);
      return;
    }
    if (!password) {
      setError("비밀번호를 입력하세요");
      setLoading(false);
      return;
    }

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(lowerUsername),
      password,
    });

    if (authError) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다");
      setLoading(false);
      return;
    }

    // 상태 확인
    const { data: statusData } = await supabase.rpc("get_my_status");
    const profile = statusData?.[0];

    if (!profile) {
      setError("프로필을 찾을 수 없습니다");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    if (profile.status === "pending") {
      setError("관리자 승인 대기 중입니다");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }
    if (profile.status === "rejected") {
      setError("가입이 거절되었습니다. 관리자에게 문의하세요");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }
    if (profile.status === "inactive") {
      setError("비활성화된 계정입니다. 관리자에게 문의하세요");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    router.push("/home");
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
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap"
        rel="stylesheet"
      />

      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: 24,
          padding: "40px 32px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.1)",
          border: "1px solid rgba(255,255,255,0.6)",
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img
            src="/icon-192.png"
            alt="스마트명성"
            style={{ width: 72, height: 72, borderRadius: 16, marginBottom: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
          />
          <div style={{ fontSize: 22, fontWeight: 900, color: "#1e293b", letterSpacing: -0.5 }}>
            스마트명성
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>로그인</div>
        </div>

        {/* Notice */}
        {info && (
          <div
            style={{
              padding: "10px 14px",
              background: "#dbeafe",
              border: "1px solid #93c5fd",
              borderRadius: 10,
              fontSize: 12,
              color: "#1e40af",
              marginBottom: 16,
            }}
          >
            ℹ️ {info}
          </div>
        )}

        <form onSubmit={handleLogin}>
          {/* 아이디 */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: 0.5 }}>
              아이디
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoComplete="username"
              placeholder="영문 소문자, 숫자, . _ (4~20자)"
              style={{
                width: "100%",
                marginTop: 6,
                padding: "12px 14px",
                fontSize: 14,
                background: "#fff",
                border: "1.5px solid #e2e8f0",
                borderRadius: 10,
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box",
                color: "#0f172a",
                fontWeight: 600,
                WebkitTextFillColor: "#0f172a",
                caretColor: "#6366f1",
                letterSpacing: 0.5,
              }}
              onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
              onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
            />
          </div>

          {/* 비밀번호 */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: 0.5 }}>
              비밀번호
            </label>
            <div style={{ position: "relative", marginTop: 6 }}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="8자 이상 (문자, 숫자, 기호 조합 권장)"
                style={{
                  width: "100%",
                  padding: "12px 44px 12px 14px",
                  fontSize: 14,
                  background: "#fff",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 10,
                  outline: "none",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
                onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  color: "#94a3b8",
                  padding: 6,
                }}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          {/* 로그인 유지 */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "#475569",
              cursor: "pointer",
              marginBottom: 16,
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "#6366f1" }}
            />
            로그인 유지
          </label>

          {/* 에러 */}
          {error && (
            <div
              style={{
                padding: "10px 14px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 10,
                fontSize: 12,
                color: "#b91c1c",
                marginBottom: 12,
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {/* 로그인 버튼 */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px 16px",
              fontSize: 15,
              fontWeight: 700,
              color: "#fff",
              background: loading ? "#94a3b8" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none",
              borderRadius: 12,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              boxShadow: "0 8px 20px rgba(99, 102, 241, 0.3)",
              fontFamily: "inherit",
            }}
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        {/* 하단 링크 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 20,
            padding: "16px 0 0",
            borderTop: "1px solid #e2e8f0",
          }}
        >
          <a
            href="/signup"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#6366f1",
              textDecoration: "none",
            }}
          >
            회원가입
          </a>
          <div style={{ display: "flex", gap: 14 }}>
            <a
              href="/find-id"
              style={{
                fontSize: 12,
                color: "#64748b",
                textDecoration: "none",
              }}
            >
              아이디 찾기
            </a>
            <span style={{ color: "#cbd5e1" }}>|</span>
            <a
              href="/find-password"
              style={{
                fontSize: 12,
                color: "#64748b",
                textDecoration: "none",
              }}
            >
              비밀번호 찾기
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div />}>
      <LoginContent />
    </Suspense>
  );
}
