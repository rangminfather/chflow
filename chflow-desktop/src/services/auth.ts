// 인증 — username 커스텀 로그인.
//
// 흐름(웹과 동일 계약): POST {apiBaseUrl}/api/auth/username-login {username,password}
//   → 200 { session: { access_token, refresh_token } }
//   → supabase.auth.setSession(...) → 세션은 secure storage 어댑터에 저장됨.
//
// Q-3 검증대상: 자체 호스팅 API는 CORS/Origin/preflight 이슈가 있을 수 있음.
//   → 웹뷰 fetch 대신 tauri-plugin-http(네이티브 요청, CORS 비적용)로 호출(웹 무수정).
//   ⚠️ 실제 동작은 Rust 설치 머신에서 통합 테스트로 확인해야 함(미검증).

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { Session, User } from "@supabase/supabase-js";
import { config } from "./config";
import { supabase } from "./supabase";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Tauri 안에서는 네이티브 http(CORS 우회), 밖에서는 표준 fetch(개발용).
const httpFetch: typeof fetch = isTauri() ? (tauriFetch as unknown as typeof fetch) : fetch;

export class AuthError extends Error {
  status?: string;
  constructor(message: string, status?: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export async function loginWithUsername(username: string, password: string): Promise<User> {
  const u = String(username || "").toLowerCase().trim();
  if (!u || !password) {
    throw new AuthError("아이디와 비밀번호를 입력하세요");
  }

  let res: Response;
  try {
    res = await httpFetch(`${config.apiBaseUrl}/api/auth/username-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password }),
    });
  } catch (e) {
    throw new AuthError("로그인 서버에 연결할 수 없습니다. 네트워크를 확인하세요.");
  }

  let json: { session?: { access_token: string; refresh_token: string }; error?: string; status?: string };
  try {
    json = await res.json();
  } catch {
    throw new AuthError("로그인 응답을 해석할 수 없습니다.");
  }

  if (!res.ok || !json.session) {
    throw new AuthError(json.error || "아이디 또는 비밀번호가 일치하지 않습니다", json.status);
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: json.session.access_token,
    refresh_token: json.session.refresh_token,
  });
  if (error || !data.user) {
    throw new AuthError(error?.message || "세션 설정에 실패했습니다");
  }
  // Realtime 소켓에 토큰을 명시적으로 세팅 — 구독 전 인증 보장(RLS가 이벤트를 전달하려면 필요).
  // (검증: setAuth 누락 시 참여자도 postgres_changes 미수신 — race 방지)
  void supabase.realtime.setAuth(json.session.access_token);
  return data.user;
}

export async function restoreSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("[auth] 세션 복원 실패:", error);
    return null;
  }
  // 복원된 세션이 있으면 Realtime 소켓에도 토큰 반영(구독 전 인증 보장).
  if (data.session) {
    void supabase.realtime.setAuth(data.session.access_token);
  }
  return data.session;
}

export async function logout(): Promise<void> {
  // signOut() 은 secure storage 어댑터의 removeItem 을 호출해 토큰을 삭제한다.
  await supabase.auth.signOut();
}
