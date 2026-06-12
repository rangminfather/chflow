"use client";

import { useState, Suspense } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, validateUsername } from "@/lib/supabase";
import { AlertCircle, Check, Eye, EyeOff, Info, LogIn } from "lucide-react";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notice = searchParams.get("notice");
  const info =
    notice === "pending"
      ? "관리자 승인 대기 중입니다. 승인 후 이용 가능합니다."
      : notice === "signup"
        ? "회원가입 신청 완료! 관리자 승인 후 로그인 가능합니다."
        : notice === "logout"
          ? "로그아웃되었습니다."
          : "";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
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

    // 1. 먼저 아이디가 DB에 존재하는지 확인 (check_username_available은 사용 가능 여부 = 없으면 true)
    const { data: isAvailable } = await supabase.rpc("check_username_available", {
      p_username: lowerUsername,
    });

    if (isAvailable === true) {
      // username이 DB에 없음 → 등록되지 않은 아이디
      setError("등록되지 않은 아이디입니다. 아이디를 다시 확인하세요.");
      setLoading(false);
      return;
    }

    // 2. 아이디는 존재함 → 로그인 시도
    const loginRes = await fetch("/api/auth/username-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: lowerUsername, password }),
    });
    const loginData = await loginRes.json();

    // 비밀번호는 맞지만 계정이 활성 상태가 아닌 경우 (서버가 토큰 미발급)
    if (loginRes.status === 403 && loginData.status) {
      const statusMessage: Record<string, string> = {
        pending: "관리자 승인 대기 중입니다",
        rejected: "가입이 거절되었습니다. 관리자에게 문의하세요",
        inactive: "비활성화된 계정입니다. 관리자에게 문의하세요",
      };
      setError(statusMessage[loginData.status as string] || "계정이 활성화되지 않았습니다");
      setLoading(false);
      return;
    }

    if (!loginRes.ok || !loginData.session) {
      // 아이디는 있는데 로그인 실패 = 비밀번호 오류
      setError("비밀번호가 일치하지 않습니다. 다시 입력해주세요.");
      setLoading(false);
      return;
    }

    // 상태 확인
    const { error: authError } = await supabase.auth.setSession(loginData.session);
    if (authError) {
      setError("로그인 세션을 설정하지 못했습니다. 다시 시도해주세요.");
      setLoading(false);
      return;
    }

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

    // 로그인 유지 선택 저장
    if (typeof window !== "undefined") {
      localStorage.setItem("smartms_remember_me", remember ? "1" : "0");
    }

    // 임시 비밀번호 발급 후 첫 로그인 → 강제 비밀번호 변경 페이지로
    if (profile.must_change_password) {
      router.replace("/myinfo?force=password-change");
      return;
    }

    // replace 사용: /home이 WebView 첫 entry가 되어야 모바일 shell이 root 종료 동작을 안정적으로 처리함
    router.replace("/home");
  };

  return (
    <main className="login-screen">
      <section className="login-panel" aria-label="스마트명성 로그인">
        <div className="login-brand">
          <div className="login-brand-mark">
            <Image src="/brand-mark-192.png" alt="스마트명성" width={58} height={58} priority />
          </div>
          <div className="login-title-wrap">
            <h1>스마트명성</h1>
            <p>로그인</p>
          </div>
        </div>

        {info && (
          <div className="login-message login-message-info" role="status">
            <Info size={16} aria-hidden="true" />
            <span>{info}</span>
          </div>
        )}

        <form className="login-form" onSubmit={handleLogin}>
          <div className="login-field">
            <label htmlFor="login-username">아이디</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoComplete="username"
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">비밀번호</label>
            <div className="login-password-wrap">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="login-icon-button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <label className="login-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span className="login-check">
              <Check size={14} aria-hidden="true" />
            </span>
            로그인 유지
          </label>

          {error && (
            <div className="login-message login-message-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="login-submit"
            disabled={loading}
          >
            <LogIn size={18} aria-hidden="true" />
            <span>{loading ? "로그인 중..." : "로그인"}</span>
          </button>
        </form>

        <nav className="login-links" aria-label="계정 도움말">
          <a href="/signup" className="login-link-primary">
            회원가입
          </a>
          <div>
            <a href="/find-id">아이디 찾기</a>
            <span aria-hidden="true" />
            <a href="/find-password">비밀번호 찾기</a>
          </div>
        </nav>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div />}>
      <LoginContent />
    </Suspense>
  );
}
