import { type FormEvent, useEffect, useRef, useState } from "react";
import { useMessages } from "@/hooks/useMessages";
import { messengerApi } from "@/services/messenger";
import { errMsg } from "@/utils/error";

export function ChatView({
  conversationId,
  onSent,
}: {
  conversationId: string | null;
  onSent?: () => void;
}) {
  const { messages, loading, loadingOlder, hasMore, error, loadOlder } = useMessages(conversationId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const lastFailedRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 새 메시지 도착/전송 시 맨 아래로.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function doSend(text: string) {
    if (!conversationId) return;
    setSending(true); // 전송 중 버튼 비활성 → 중복 클릭 방지(Q-4)
    setSendError(null);
    try {
      await messengerApi.sendMessage(conversationId, text);
      setDraft("");
      lastFailedRef.current = null;
      onSent?.();
    } catch (e) {
      // Q-4: 자동 재전송 안 함. 실패 표시 + 수동 재시도만.
      lastFailedRef.current = text;
      setSendError(errMsg(e, "전송 실패 — 다시 시도하세요"));
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    void doSend(text);
  }

  function retry() {
    if (lastFailedRef.current && !sending) void doSend(lastFailedRef.current);
  }

  if (!conversationId) {
    return <section className="chat-empty">왼쪽에서 대화를 선택하세요</section>;
  }

  return (
    <section className="chat-view">
      <div className="chat-messages">
        {hasMore && (
          <button type="button" className="btn-ghost load-older" onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? "불러오는 중…" : "이전 메시지 더 보기"}
          </button>
        )}

        {loading && <div className="chat-info">메시지 불러오는 중…</div>}
        {error && <div className="error-box">{error}</div>}

        {messages.map((m) => (
          <div key={m.id} className={`msg${m.is_mine ? " mine" : ""}`}>
            {!m.is_mine && <div className="msg-sender">{m.sender_name || "알 수 없음"}</div>}
            <div className="msg-bubble">
              {m.deleted_at ? <span className="msg-deleted">삭제된 메시지</span> : m.body}
            </div>
            <div className="msg-time">{formatTime(m.created_at)}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {sendError && (
        <div className="send-error">
          {sendError}
          <button type="button" className="btn-ghost" onClick={retry} disabled={sending}>
            재시도
          </button>
        </div>
      )}

      <form className="composer" onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          placeholder="메시지를 입력하세요"
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending}
        />
        <button type="submit" className="btn-primary" disabled={sending || !draft.trim()}>
          {sending ? "전송 중…" : "전송"}
        </button>
      </form>
    </section>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
