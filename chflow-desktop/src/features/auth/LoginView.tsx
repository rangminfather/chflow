import { type FormEvent, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { loginWithUsername } from "@/services/auth";
import { errMsg } from "@/utils/error";

export function LoginView({ onSuccess }: { onSuccess: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return; // 중복 제출 방지
    setSubmitting(true);
    setError(null);
    try {
      const u = await loginWithUsername(username, password);
      onSuccess(u);
    } catch (err) {
      setError(errMsg(err, "로그인에 실패했습니다"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">CHFlow 메신저</h1>
        <p className="login-sub">교역자·행정 데스크톱 메신저</p>

        <label className="field">
          <span>아이디</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
            autoFocus
          />
        </label>

        <label className="field">
          <span>비밀번호</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        </label>

        {error && <div className="error-box">{error}</div>}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}
