"use client";

import { useEffect, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import ModalBackdrop from "@/components/ModalBackdrop";
import Avatar from "@/components/messenger/MessengerAvatar";
import { EmptyState, LoadingView } from "@/components/StatusViews";
import { getMessengerGroupTitle, messengerErrorMessage, messengerRoleLabel, toggleMessengerUser } from "@/lib/messenger-utils";
import { createGroupConversation, searchMessengerUsers, startDirectMessage, type MessengerUser } from "@/lib/messenger";

type NewMode = "direct" | "group";

export default function NewConversationModal({ onClose, onCreated, onError }: { onClose: () => void; onCreated: (conversationId: string) => void; onError: (message: string) => void }) {
  const [mode, setMode] = useState<NewMode>("direct");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [users, setUsers] = useState<MessengerUser[]>([]);
  const [selected, setSelected] = useState<MessengerUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchMessengerUsers(query, 30);
        if (!cancelled) setUsers(rows);
      } catch (error) {
        if (!cancelled) onError(messengerErrorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [onError, query]);

  const create = async () => {
    if (selected.length === 0 || creating) return;
    setCreating(true);
    try {
      const id = mode === "direct"
        ? await startDirectMessage(selected[0].user_id)
        : await createGroupConversation(getMessengerGroupTitle(selected, title), selected.map((user) => user.user_id));
      onCreated(id);
    } catch (error) {
      onError(messengerErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose} style={modalOverlayStyle}>
      <div onClick={(event) => event.stopPropagation()} style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div style={sectionTitleStyle}><Plus size={18} strokeWidth={2} /> 새 대화</div>
          <button type="button" onClick={onClose} style={smallIconButtonStyle}><X size={17} /></button>
        </div>
        <div style={modalTabsStyle}>
          <button type="button" onClick={() => { setMode("direct"); setSelected(selected.slice(0, 1)); }} style={mode === "direct" ? tabActiveStyle : tabStyle}>1:1</button>
          <button type="button" onClick={() => setMode("group")} style={mode === "group" ? tabActiveStyle : tabStyle}>그룹</button>
        </div>
        {mode === "group" && <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="그룹 이름" maxLength={80} style={inputStyle} />}
        <div style={searchBoxStyle}><Search size={16} strokeWidth={1.8} color="var(--ink-faint)" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름 또는 직분 검색" style={searchInputStyle} /></div>
        {selected.length > 0 && <div style={selectedWrapStyle}>{selected.map((user) => <span key={user.user_id} style={selectedChipStyle}><span style={oneLineStyle}>{user.name || "이름 없음"}</span><button type="button" onClick={() => setSelected((current) => current.filter((item) => item.user_id !== user.user_id))} style={chipRemoveStyle}><X size={12} strokeWidth={2} /></button></span>)}</div>}
        <div style={userListStyle}>{loading ? <LoadingView padding={28} /> : users.length === 0 ? <EmptyState message="검색 결과가 없습니다." padding={34} /> : users.map((user) => {
          const picked = selected.some((item) => item.user_id === user.user_id);
          return <button key={user.user_id} type="button" onClick={() => setSelected((current) => toggleMessengerUser(current, user, mode === "direct"))} style={userRowStyle}><Avatar title={user.name || "U"} src={user.avatar_url} /><div style={{ flex: 1, minWidth: 0 }}><div style={userNameStyle}>{user.name || "이름 없음"}</div><div style={userMetaStyle}>{user.sub_role || messengerRoleLabel(user.role)}</div></div>{picked && <Check size={17} strokeWidth={2.4} color="var(--accent)" />}</button>;
        })}</div>
        <div style={modalFooterStyle}><button type="button" onClick={onClose} style={secondaryButtonStyle}>취소</button><button type="button" onClick={create} disabled={selected.length === 0 || creating} style={{ ...primaryButtonStyle, opacity: selected.length === 0 || creating ? 0.45 : 1 }}>시작</button></div>
      </div>
    </ModalBackdrop>
  );
}

const modalOverlayStyle = { position: "fixed", inset: 0, zIndex: 200, background: "rgba(43,39,34,0.48)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px))" } as const;
const modalStyle = { width: "min(560px, calc(100vw - 24px))", maxHeight: "calc(100dvh - 24px)", overflowY: "auto", boxSizing: "border-box", background: "var(--card)", borderRadius: 10, border: "1px solid var(--hairline)", boxShadow: "0 24px 70px rgba(26,22,18,0.22)", padding: 16 } as const;
const modalHeaderStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 } as const;
const sectionTitleStyle = { display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 900, color: "var(--ink)" } as const;
const smallIconButtonStyle = { width: 34, height: 34, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--card)", color: "var(--ink-mid)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 } as const;
const modalTabsStyle = { display: "flex", gap: 6, marginBottom: 12 } as const;
const tabStyle = { flex: 1, height: 38, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink-soft)", cursor: "pointer", fontFamily: "inherit", fontWeight: 800 } as const;
const tabActiveStyle = { ...tabStyle, background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--accent)" } as const;
const inputStyle = { width: "100%", boxSizing: "border-box", height: 42, border: "1px solid var(--hairline)", borderRadius: 8, padding: "0 12px", marginBottom: 10, fontSize: 14, color: "var(--ink)", background: "var(--surface)", outline: "none", fontFamily: "inherit" } as const;
const searchBoxStyle = { height: 42, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", marginBottom: 10 } as const;
const searchInputStyle = { flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 14, fontFamily: "inherit" } as const;
const selectedWrapStyle = { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 } as const;
const selectedChipStyle = { maxWidth: "100%", height: 30, borderRadius: 7, background: "var(--accent-soft)", color: "var(--accent)", padding: "0 5px 0 9px", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 800 } as const;
const oneLineStyle = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const chipRemoveStyle = { width: 18, height: 18, border: "none", background: "transparent", color: "inherit", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 } as const;
const userListStyle = { border: "1px solid var(--hairline)", borderRadius: 8, overflow: "auto", maxHeight: 320, background: "var(--surface)", marginBottom: 14 } as const;
const userRowStyle = { width: "100%", border: "none", borderBottom: "1px solid var(--hairline)", background: "transparent", display: "flex", alignItems: "center", gap: 10, padding: "10px 11px", textAlign: "left", cursor: "pointer", fontFamily: "inherit" } as const;
const userNameStyle = { fontSize: 13, fontWeight: 900, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const userMetaStyle = { marginTop: 2, fontSize: 11, fontWeight: 700, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const modalFooterStyle = { display: "flex", justifyContent: "flex-end", gap: 8 } as const;
const secondaryButtonStyle = { height: 40, border: "1px solid var(--hairline)", borderRadius: 8, padding: "0 14px", background: "var(--surface)", color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", fontWeight: 800 } as const;
const primaryButtonStyle = { height: 40, border: "none", borderRadius: 8, padding: "0 14px", background: "var(--accent)", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 900 } as const;
