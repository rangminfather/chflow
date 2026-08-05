import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/services/supabase";
import { restoreSession, logout } from "@/services/auth";
import { realtime } from "@/services/messenger";
import { useConversations } from "@/hooks/useConversations";
import { LoginView } from "@/features/auth/LoginView";
import { ConversationList } from "@/features/conversations/ConversationList";
import { ChatView } from "@/features/chat/ChatView";

type Phase = "loading" | "login" | "ready";

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;

    // 세션 복원(secure storage 어댑터에서 읽음).
    restoreSession()
      .then((s) => {
        if (!active) return;
        if (s?.user) {
          setUser(s.user);
          setPhase("ready");
        } else {
          setPhase("login");
        }
      })
      .catch(() => active && setPhase("login"));

    // 토큰 갱신/로그아웃/계정변경 동기화.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      setUser(session?.user ?? null);
      setPhase(session?.user ? "ready" : "login");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (phase === "loading") {
    return <div className="full-center">불러오는 중…</div>;
  }

  if (phase === "login" || !user) {
    return <LoginView onSuccess={(u) => { setUser(u); setPhase("ready"); }} />;
  }

  return <MessengerLayout user={user} />;
}

function MessengerLayout({ user }: { user: User }) {
  const { items, loading, error, refreshDebounced } = useConversations();
  const [activeId, setActiveId] = useState<string | null>(null);

  async function handleLogout() {
    realtime.dispose(); // 전체 채널 정리
    await logout(); // onAuthStateChange 가 login 화면으로 전환
  }

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">CHFlow 메신저</span>
        <span className="spacer" />
        <span className="me">{user.email ?? ""}</span>
        <button type="button" className="btn-ghost" onClick={() => void handleLogout()}>
          로그아웃
        </button>
      </header>

      <div className="body">
        <ConversationList
          items={items}
          activeId={activeId}
          onSelect={setActiveId}
          loading={loading}
          error={error}
        />
        <ChatView conversationId={activeId} onSent={refreshDebounced} />
      </div>
    </div>
  );
}
