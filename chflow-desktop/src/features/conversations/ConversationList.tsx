import type { MessengerConversation } from "@shared/messenger-types";

export function ConversationList({
  items,
  activeId,
  onSelect,
  loading,
  error,
}: {
  items: MessengerConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <aside className="conv-list">
      <div className="conv-list-header">대화</div>

      {loading && <div className="conv-empty">불러오는 중…</div>}
      {error && <div className="error-box">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="conv-empty">대화방이 없습니다</div>
      )}

      <div className="conv-scroll">
        {items.map((c) => (
          <button
            key={c.conversation_id}
            type="button"
            className={`conv-item${c.conversation_id === activeId ? " active" : ""}`}
            onClick={() => onSelect(c.conversation_id)}
          >
            <div className="conv-row">
              <span className="conv-title">{c.display_title || c.title || "(제목 없음)"}</span>
              {c.unread_count > 0 && (
                <span className="conv-badge">{c.unread_count > 99 ? "99+" : c.unread_count}</span>
              )}
            </div>
            <div className="conv-preview">{c.last_message_body || "메시지 없음"}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}
