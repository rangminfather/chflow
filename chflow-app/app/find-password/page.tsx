"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Phone, Mail, Send, Inbox, Info } from "lucide-react";

type Step = "form" | "sent" | "no-email";

export default function FindPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [username, setUsername] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");
    if (!username.trim()) { setError("아이디를 입력해주세요"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "오류가 발생했습니다"); return; }
      if (data.noEmail) { setStep("no-email"); return; }
      setMaskedEmail(data.maskedEmail);
      setStep("sent");
    } catch {
      setError("네트워크 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
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
          <div className="auth-page-title">비밀번호 찾기</div>
        </div>

        {step === "form" && (
          <>
            <div style={{ textAlign: "center", padding: "20px 0 16px" }}>
              <div style={{ marginBottom: 12, color: "var(--ink-faint)" }}><KeyRound size={40} strokeWidth={1.5} /></div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
                아이디를 입력하세요
              </div>
              <div className="auth-copy" style={{ marginBottom: 0 }}>
                등록된 이메일로 비밀번호 재설정 링크를 보내드립니다
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="아이디"
                autoFocus
                style={{
                  width: "100%", height: 54, padding: "0 16px",
                  fontSize: 15, border: "1.5px solid var(--border)",
                  borderRadius: 8, fontFamily: "inherit",
                  outline: "none", boxSizing: "border-box",
                }}
              />
              {error && (
                <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>{error}</div>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                width: "100%", height: 54, fontSize: 15, fontWeight: 800,
                color: "#fff", background: "var(--accent)",
                border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1, marginBottom: 16, fontFamily: "inherit",
              }}
            >
              {loading ? "확인 중..." : "이메일로 재설정 링크 받기"}
            </button>

            {/* 관리자 문의 (이메일 미등록자용) */}
            <div style={{
              background: "#f3f7f1", border: "1px solid rgba(62, 90, 74, 0.16)",
              borderRadius: 8, padding: 16, marginBottom: 0,
            }}>
              <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 800, marginBottom: 8 }}>
                이메일 미등록이거나 링크를 못 받으셨나요?
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Phone size={20} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>관리자</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>010-2527-2064</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Mail size={20} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>이메일</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>sunsetrome@naver.com</div>
                </div>
              </div>
            </div>
          </>
        )}

        {step === "sent" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ marginBottom: 16, color: "var(--ink-faint)" }}><Send size={40} strokeWidth={1.5} /></div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", marginBottom: 12 }}>
              재설정 링크 발송 완료
            </div>
            <div className="auth-copy" style={{ marginBottom: 24 }}>
              <strong>{maskedEmail}</strong> 으로<br />
              비밀번호 재설정 링크를 보냈습니다.<br /><br />
              이메일에서 링크를 클릭하면<br />
              새 비밀번호를 설정할 수 있습니다.
            </div>
            <div style={{
              fontSize: 11, color: "var(--ink-soft)", background: "rgba(234,239,232,0.72)",
              border: "1px solid rgba(62,90,74,0.14)", borderRadius: 8, padding: "10px 14px",
              lineHeight: 1.6, marginBottom: 20, textAlign: "left",
            }}>
              <Info size={13} strokeWidth={1.8} style={{ verticalAlign: "-2px", marginRight: 4 }} />링크는 1시간 후 만료됩니다. 이메일이 보이지 않으면 스팸함을 확인해주세요.
            </div>
            <button onClick={() => router.push("/login")} style={{
              width: "100%", height: 54, fontSize: 15, fontWeight: 800,
              color: "var(--accent)", background: "var(--accent-soft)",
              border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
            }}>
              로그인 화면으로
            </button>
          </div>
        )}

        {step === "no-email" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ marginBottom: 16, color: "var(--ink-faint)" }}><Inbox size={40} strokeWidth={1.5} /></div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", marginBottom: 12 }}>
              등록된 이메일이 없습니다
            </div>
            <div className="auth-copy" style={{ marginBottom: 24 }}>
              해당 계정에 이메일이 등록되어 있지 않아<br />
              자동 재설정이 어렵습니다.<br /><br />
              관리자에게 직접 문의해 주세요.
            </div>
            <div style={{
              background: "#f3f7f1", border: "1px solid rgba(62, 90, 74, 0.16)",
              borderRadius: 8, padding: 20, marginBottom: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <Phone size={24} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 800 }}>관리자 연락처</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>010-2527-2064</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Mail size={24} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 800 }}>이메일</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>sunsetrome@naver.com</div>
                </div>
              </div>
            </div>
            <button onClick={() => setStep("form")} style={{
              width: "100%", height: 54, fontSize: 15, fontWeight: 800,
              color: "var(--accent)", background: "var(--accent-soft)",
              border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
            }}>
              다시 시도
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
