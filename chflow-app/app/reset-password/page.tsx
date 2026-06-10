"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    // 혹시 이미 세션이 복구된 경우 (페이지 새로고침 등)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
      else {
        // 3초 대기 후에도 세션 없으면 링크 만료
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: { session: s } }) => {
            if (!s) setInvalid(true);
          });
        }, 3000);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async () => {
    setMsg("");
    if (!newPw || !newPw2) { setMsg("모든 항목을 입력해주세요"); return; }
    if (newPw.length < 6) { setMsg("비밀번호는 6자 이상이어야 합니다"); return; }
    if (newPw !== newPw2) { setMsg("비밀번호가 서로 다릅니다"); return; }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setSubmitting(false);

    if (error) { setMsg(`변경 실패: ${error.message}`); return; }
    setDone(true);
    setTimeout(() => router.replace("/login"), 2500);
  };

  if (invalid) {
    return (
      <main className="login-screen">
        <section className="login-panel" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", marginBottom: 12 }}>
            링크가 만료되었습니다
          </div>
          <div className="auth-copy" style={{ marginBottom: 24 }}>
            비밀번호 재설정 링크의 유효시간이 지났습니다.<br />
            비밀번호 찾기를 다시 시도해주세요.
          </div>
          <button onClick={() => router.push("/find-password")} style={{
            width: "100%", height: 54, fontSize: 15, fontWeight: 800,
            color: "var(--accent)", background: "var(--accent-soft)",
            border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
          }}>
            비밀번호 찾기로 이동
          </button>
        </section>
      </main>
    );
  }

  if (done) {
    return (
      <main className="login-screen">
        <section className="login-panel" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", marginBottom: 12 }}>
            비밀번호가 변경되었습니다
          </div>
          <div className="auth-copy">잠시 후 로그인 화면으로 이동합니다...</div>
        </section>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="login-screen">
        <section className="login-panel" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔄</div>
          <div className="auth-copy">링크를 확인하는 중...</div>
        </section>
      </main>
    );
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div style={{ textAlign: "center", padding: "16px 0 20px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)" }}>
            새 비밀번호 설정
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="새 비밀번호 (6자 이상)"
            autoFocus
            style={{
              width: "100%", height: 54, padding: "0 16px",
              fontSize: 15, border: "1.5px solid var(--border)",
              borderRadius: 8, fontFamily: "inherit",
              outline: "none", boxSizing: "border-box",
            }}
          />
          <input
            type="password"
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleReset()}
            placeholder="새 비밀번호 확인"
            style={{
              width: "100%", height: 54, padding: "0 16px",
              fontSize: 15, border: "1.5px solid var(--border)",
              borderRadius: 8, fontFamily: "inherit",
              outline: "none", boxSizing: "border-box",
            }}
          />
          {msg && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>{msg}</div>}
        </div>

        <button
          onClick={handleReset}
          disabled={submitting}
          style={{
            width: "100%", height: 54, fontSize: 15, fontWeight: 800,
            color: "#fff", background: "var(--accent)",
            border: "none", borderRadius: 8,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.7 : 1,
            marginTop: 14, fontFamily: "inherit",
          }}
        >
          {submitting ? "변경 중..." : "비밀번호 변경"}
        </button>
      </section>
    </main>
  );
}
