"use client";

import { useState, type CSSProperties } from "react";
import { Forward, Search, X } from "lucide-react";
import Avatar from "@/components/messenger/MessengerAvatar";
import { EmptyState } from "@/components/StatusViews";
import type { MessengerConversation } from "@/lib/messenger";

type Props = {
  conversations: MessengerConversation[];
  onClose: () => void;
  onForward: (conversationId: string) => void;
};

export default function ForwardConversationModal({ conversations, onClose, onForward }: Props) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = conversations.filter((conversation) => (
    !normalizedQuery || conversation.display_title.toLowerCase().includes(normalizedQuery)
  ));

  return (
    <div onClick={onClose} style={modalOverlayStyle}>
      <div onClick={(event) => event.stopPropagation()} style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div style={sectionTitleStyle}><Forward size={18} strokeWidth={2} /> 메시지 전달</div>
          <button type="button" onClick={onClose} style={smallIconButtonStyle}><X size={17} /></button>
        </div>
        <div style={searchBoxStyle}>
          <Search size={16} strokeWidth={1.8} color="var(--ink-faint)" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="전달할 대화 검색" style={searchInputStyle} />
        </div>
        <div style={userListStyle}>
          {filtered.length === 0 ? (
            <EmptyState message="전달할 대화가 없습니다." padding={34} />
          ) : filtered.map((conversation) => (
            <button key={conversation.conversation_id} type="button" onClick={() => onForward(conversation.conversation_id)} style={userRowStyle}>
              <Avatar title={conversation.display_title} src={conversation.display_avatar_url} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={userNameStyle}>{conversation.display_title}</div>
                <div style={userMetaStyle}>{conversation.last_message_body || `${conversation.participant_count}명`}</div>
              </div>
              <Forward size={16} strokeWidth={2} color="var(--accent)" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const modalOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 200, background: "rgba(43,39,34,0.48)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px))" };
const modalStyle: CSSProperties = { width: "min(560px, calc(100vw - 24px))", maxHeight: "calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))", overflowY: "auto", boxSizing: "border-box", background: "var(--card)", borderRadius: 10, border: "1px solid var(--hairline)", boxShadow: "0 24px 70px rgba(26,22,18,0.22)", padding: 16 };
const modalHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 };
const sectionTitleStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 900 };
const smallIconButtonStyle: CSSProperties = { width: 34, height: 34, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--card)", color: "var(--ink-mid)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 };
const searchBoxStyle: CSSProperties = { height: 42, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", marginBottom: 10 };
const searchInputStyle: CSSProperties = { flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 14, fontFamily: "inherit" };
const userListStyle: CSSProperties = { maxHeight: 340, overflowY: "auto", border: "1px solid var(--hairline)", borderRadius: 8 };
const userRowStyle: CSSProperties = { width: "100%", minHeight: 62, border: "none", borderBottom: "1px solid var(--hairline)", background: "transparent", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" };
const userNameStyle: CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 900, color: "var(--ink)" };
const userMetaStyle: CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: "var(--ink-faint)", marginTop: 2 };
