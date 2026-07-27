"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  ArrowLeft,
  ArrowDown,
  Check,
  Copy,
  FileText,
  Forward,
  LogOut,
  MoreVertical,
  MessageCircle,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Pencil,
  Plus,
  Reply,
  ShieldAlert,
  Search,
  SmilePlus,
  Star,
  Trash2,
  Volume2,
  VolumeX,
  Users,
  X,
} from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import Avatar from "@/components/messenger/MessengerAvatar";
import MessengerComposer from "@/components/messenger/MessengerComposer";
import NewConversationModal from "@/components/messenger/NewConversationModal";
import ForwardConversationModal from "@/components/messenger/ForwardConversationModal";
import ImagePreviewModal from "@/components/messenger/ImagePreviewModal";
import ReadStatusModalContent from "@/components/messenger/ReadStatusModalContent";
import { EmptyState, LoadingView } from "@/components/StatusViews";
import { storageProxyUrl } from "@/lib/storage-url";
import {
  findFirstUnreadMessageId,
  formatMessengerAttachmentMeta,
  formatMessengerMessageTime,
  messengerErrorMessage,
  getMessengerReadStatus,
  messengerRoleLabel,
  sanitizeMessengerFileName,
  toggleMessengerUser,
} from "@/lib/messenger-utils";
import { supabase } from "@/lib/supabase";
import {
  addGroupParticipants,
  blockMessengerUser,
  deleteMessengerMessage,
  editMessengerMessage,
  forwardMessengerMessage,
  getMessengerMessages,
  getMessengerParticipants,
  leaveMessengerConversation,
  listMessengerConversations,
  markMessengerRead,
  removeGroupParticipant,
  renameGroupConversation,
  reportMessengerMessage,
  searchMessengerMessages,
  searchMessengerUsers,
  sendMessengerMessage,
  setMessengerConversationState,
  toggleMessengerReaction,
  type MessengerAttachment,
  type MessengerConversation,
  type MessengerMessage,
  type MessengerParticipant,
  type MessengerSearchResult,
  type MessengerUser,
} from "@/lib/messenger";

type PendingAttachment = MessengerAttachment & { local_url?: string };
type ImagePreviewState = { attachment: MessengerAttachment; url: string } | null;

function isMobileMessengerViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

const MAX_ATTACHMENTS = 6;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export default function MessengerPage() {
  const router = useRouter();
  const { confirm, prompt, alert } = useConfirm();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const skipNextAutoScrollRef = useRef(false);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingAtRef = useRef(0);
  const typingTimersRef = useRef<Record<string, number>>({});

  const [authChecked, setAuthChecked] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<MessengerConversation[]>([]);
  const conversationsRef = useRef<MessengerConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [participants, setParticipants] = useState<MessengerParticipant[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [showLatestJump, setShowLatestJump] = useState(false);
  const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<string | null>(null);
  const [showFirstUnreadJump, setShowFirstUnreadJump] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [messageResults, setMessageResults] = useState<MessengerSearchResult[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [replyTarget, setReplyTarget] = useState<MessengerMessage | null>(null);
  const [editing, setEditing] = useState<MessengerMessage | null>(null);
  const [forwarding, setForwarding] = useState<MessengerMessage | null>(null);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [readStatusMessage, setReadStatusMessage] = useState<MessengerMessage | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreviewState>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.conversation_id === activeId) || null,
    [activeId, conversations]
  );

  const participantNameById = useMemo(() => {
    const map = new Map<string, string>();
    participants.forEach((p) => map.set(p.user_id, p.name || "이름 없음"));
    return map;
  }, [participants]);

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => (
      c.display_title.toLowerCase().includes(q)
      || (c.last_message_body || "").toLowerCase().includes(q)
    ));
  }, [conversations, searchQuery]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const clearActiveConversation = useCallback(() => {
    setActiveId(null);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.delete("c");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/messenger?${query}` : "/messenger");
  }, []);

  const loadConversations = useCallback(async (preferredId?: string | null) => {
    setLoadingList(true);
    setError("");
    try {
      const rows = await listMessengerConversations();
      setConversations(rows);
      const requested = preferredId !== undefined ? preferredId : activeId;
      if (requested && rows.some((c) => c.conversation_id === requested)) {
        setActiveId(requested);
      } else if (!requested && !activeId && rows.length > 0 && !isMobileMessengerViewport()) {
        setActiveId(rows[0].conversation_id);
      }
    } catch (e) {
      setError(messengerErrorMessage(e));
    } finally {
      setLoadingList(false);
    }
  }, [activeId]);

  const loadConversationBody = useCallback(async (conversationId: string, unreadCount = 0) => {
    setLoadingMessages(true);
    setError("");
    try {
      await markMessengerRead(conversationId);
      const [messageRows, participantRows] = await Promise.all([
        getMessengerMessages(conversationId, 60),
        getMessengerParticipants(conversationId),
      ]);
      setMessages(messageRows);
      setHasOlderMessages(messageRows.length >= 60);
      setParticipants(participantRows);
      const firstUnreadId = findFirstUnreadMessageId(messageRows, unreadCount);
      setFirstUnreadMessageId(firstUnreadId);
      setShowFirstUnreadJump(!!firstUnreadId);
      if (firstUnreadId) skipNextAutoScrollRef.current = true;
      setConversations((prev) => prev.map((c) => (
        c.conversation_id === conversationId ? { ...c, unread_count: 0 } : c
      )));
    } catch (e) {
      setError(getErrorMessage(e));
      setMessages([]);
      setHasOlderMessages(false);
      setParticipants([]);
      setFirstUnreadMessageId(null);
      setShowFirstUnreadJump(false);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setMyUserId(session.user.id);
      setAuthChecked(true);
      const initialId = new URLSearchParams(window.location.search).get("c");
      await loadConversations(initialId);
    })();
  }, [loadConversations, router]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setParticipants([]);
      setOnlineUserIds([]);
      setTypingUserIds([]);
      setActionMessageId(null);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("c", activeId);
    window.history.replaceState(null, "", `/messenger?${params.toString()}`);
    setReplyTarget(null);
    setEditing(null);
    setDraft("");
    setAttachments([]);
    setShowLatestJump(false);
    const unreadCount = conversationsRef.current.find((c) => c.conversation_id === activeId)?.unread_count || 0;
    loadConversationBody(activeId, unreadCount);
  }, [activeId, loadConversationBody]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setMessageResults([]);
      setSearchingMessages(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchingMessages(true);
      try {
        const rows = await searchMessengerMessages(q, 25);
        if (!cancelled) setMessageResults(rows);
      } catch (e) {
        if (!cancelled) setError(getErrorMessage(e));
      } finally {
        if (!cancelled) setSearchingMessages(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!activeId || !myUserId) return;
    const channel = supabase
      .channel(`messenger:${activeId}`)
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ user_id?: string }>();
        const ids = Object.values(state)
          .flat()
          .map((entry) => entry.user_id)
          .filter((id): id is string => !!id && id !== myUserId);
        setOnlineUserIds(Array.from(new Set(ids)));
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const userId = typeof payload?.user_id === "string" ? payload.user_id : "";
        if (!userId || userId === myUserId) return;

        setTypingUserIds((prev) => prev.includes(userId) ? prev : [...prev, userId]);
        if (typingTimersRef.current[userId]) {
          window.clearTimeout(typingTimersRef.current[userId]);
        }
        typingTimersRef.current[userId] = window.setTimeout(() => {
          setTypingUserIds((prev) => prev.filter((id) => id !== userId));
          delete typingTimersRef.current[userId];
        }, 2600);
      })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messenger_messages",
          filter: `conversation_id=eq.${activeId}`,
        },
        async () => {
          await loadConversationBody(activeId);
          await loadConversations(activeId);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messenger_message_reactions",
          filter: `conversation_id=eq.${activeId}`,
        },
        async () => {
          await loadConversationBody(activeId);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track({ user_id: myUserId, online_at: new Date().toISOString() });
        }
      });

    realtimeChannelRef.current = channel;

    return () => {
      Object.values(typingTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      typingTimersRef.current = {};
      setTypingUserIds([]);
      setOnlineUserIds([]);
      realtimeChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [activeId, loadConversationBody, loadConversations, myUserId]);

  useEffect(() => {
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    if (showLatestJump) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, activeId, showLatestJump]);

  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    setShowLatestJump(false);
    setShowFirstUnreadJump(false);
  };

  const scrollToFirstUnread = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (!firstUnreadMessageId) return;
    const element = document.getElementById(`messenger-message-${firstUnreadMessageId}`);
    element?.scrollIntoView({ behavior, block: "center" });
    setShowFirstUnreadJump(false);
  }, [firstUnreadMessageId]);

  const handleMessageListScroll = () => {
    const el = messageListRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowLatestJump(distanceFromBottom > 220);
    if (firstUnreadMessageId) {
      const firstUnread = document.getElementById(`messenger-message-${firstUnreadMessageId}`);
      if (firstUnread) {
        const listRect = el.getBoundingClientRect();
        const unreadRect = firstUnread.getBoundingClientRect();
        setShowFirstUnreadJump(unreadRect.bottom < listRect.top || unreadRect.top > listRect.bottom);
      }
    }
  };

  const loadOlderMessages = async () => {
    if (!activeId || loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    setError("");
    try {
      const olderRows = await getMessengerMessages(activeId, 60, messages[0].created_at);
      skipNextAutoScrollRef.current = true;
      setMessages((prev) => {
        const seen = new Set(prev.map((row) => row.id));
        return [...olderRows.filter((row) => !seen.has(row.id)), ...prev];
      });
      setHasOlderMessages(olderRows.length >= 60);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    if (!highlightedMessageId || loadingMessages) return;
    const element = document.getElementById(`messenger-message-${highlightedMessageId}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId, loadingMessages, messages]);

  useEffect(() => {
    if (!firstUnreadMessageId || loadingMessages) return;
    const timer = window.setTimeout(() => scrollToFirstUnread("auto"), 0);
    return () => window.clearTimeout(timer);
  }, [firstUnreadMessageId, loadingMessages, scrollToFirstUnread]);

  const emitTyping = () => {
    const now = Date.now();
    if (!myUserId || now - lastTypingAtRef.current < 1200) return;
    lastTypingAtRef.current = now;
    realtimeChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: myUserId },
    });
  };

  const uploadFiles = async (files: FileList | File[] | null) => {
    if (!files || !activeId) return;
    const selected = Array.from(files).slice(0, MAX_ATTACHMENTS - attachments.length);
    if (selected.length === 0) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    setUploading(true);
    try {
      const uploaded: PendingAttachment[] = [];
      for (const file of selected) {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(`${file.name} 파일이 25MB를 초과합니다.`);
        }
        const safeName = sanitizeMessengerFileName(file.name);
        const path = `${session.user.id}/${activeId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
        const form = new FormData();
        form.append("file", new File([file], file.name, { type: file.type || "application/octet-stream" }));
        const uploadRes = await fetch(`/api/storage/messenger-attachments/${path}`, { method: "POST", body: form });
        const uploadResult = await uploadRes.json();
        if (!uploadResult.ok) throw new Error(uploadResult.error ?? "업로드 실패");

        uploaded.push({
          file_path: path,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          local_url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        });
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const send = async () => {
    if (!activeId || sending || uploading) return;
    const body = draft.trim();

    if (editing) {
      if (!body) return;
      setSending(true);
      try {
        await editMessengerMessage(editing.id, body);
        setEditing(null);
        setDraft("");
        await loadConversationBody(activeId);
        await loadConversations(activeId);
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        setSending(false);
      }
      return;
    }

    if (!body && attachments.length === 0) return;
    setSending(true);
    try {
      await sendMessengerMessage(
        activeId,
        body,
        replyTarget?.id || null,
        attachments.map(({ local_url, ...a }) => {
          void local_url;
          return a;
        })
      );
      setDraft("");
      setReplyTarget(null);
      setAttachments([]);
      await loadConversationBody(activeId);
      await loadConversations(activeId);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const startEdit = (message: MessengerMessage) => {
    setEditing(message);
    setReplyTarget(null);
    setAttachments([]);
    setDraft(message.body);
  };

  const removeMessage = async (message: MessengerMessage) => {
    if (!activeId) return;
    if (!await confirm("메시지를 삭제할까요?")) return;
    try {
      await deleteMessengerMessage(message.id);
      await loadConversationBody(activeId);
      await loadConversations(activeId);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const updateConversationState = async (state: Parameters<typeof setMessengerConversationState>[1]) => {
    if (!activeId) return;
    try {
      await setMessengerConversationState(activeId, state);
      if (state.archived) {
        clearActiveConversation();
      }
      await loadConversations(state.archived ? null : activeId);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const blockCurrentPeer = async () => {
    if (!activeConversation || activeConversation.type !== "direct") return;
    const peer = participants.find((p) => p.user_id !== myUserId);
    if (!peer) return;
    if (!await confirm(`${peer.name || "상대방"}님을 차단할까요?`)) return;
    try {
      await blockMessengerUser(peer.user_id);
      await setMessengerConversationState(activeConversation.conversation_id, { archived: true });
      clearActiveConversation();
      await loadConversations(null);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const reportMessage = async (message: MessengerMessage) => {
    const reason = await prompt("신고 사유를 입력하세요.");
    if (!reason?.trim()) return;
    try {
      await reportMessengerMessage(message.id, reason.trim());
      await alert("신고가 접수되었습니다.");
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const forwardMessage = async (targetConversationId: string) => {
    if (!forwarding || !activeId) return;
    try {
      await forwardMessengerMessage(forwarding.id, targetConversationId);
      setForwarding(null);
      if (targetConversationId === activeId) {
        await loadConversationBody(activeId);
      }
      await loadConversations(activeId);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const reactToMessage = async (message: MessengerMessage, emoji: string) => {
    if (!activeId) return;
    try {
      await toggleMessengerReaction(message.id, emoji);
      await loadConversationBody(activeId);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const copyMessageText = async (message: MessengerMessage) => {
    const text = message.body.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      await alert("메시지를 복사했습니다.");
    } catch {
      setError("클립보드 복사에 실패했습니다.");
    }
  };

  const leaveConversation = async () => {
    if (!activeConversation) return;
    const label = activeConversation.type === "group" ? "이 그룹 대화방에서 나갈까요?" : "이 대화를 목록에서 숨길까요?";
    if (!await confirm(label)) return;
    try {
      await leaveMessengerConversation(activeConversation.conversation_id);
      clearActiveConversation();
      await loadConversations(null);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const renameGroup = async (title: string) => {
    if (!activeId) return;
    try {
      await renameGroupConversation(activeId, title);
      await loadConversations(activeId);
      await loadConversationBody(activeId);
    } catch (e) {
      setError(getErrorMessage(e));
      throw e;
    }
  };

  const addGroupMembers = async (userIds: string[]) => {
    if (!activeId) return;
    try {
      await addGroupParticipants(activeId, userIds);
      await loadConversations(activeId);
      await loadConversationBody(activeId);
    } catch (e) {
      setError(getErrorMessage(e));
      throw e;
    }
  };

  const removeGroupMember = async (userId: string) => {
    if (!activeId) return;
    try {
      await removeGroupParticipant(activeId, userId);
      await loadConversations(activeId);
      await loadConversationBody(activeId);
    } catch (e) {
      setError(getErrorMessage(e));
      throw e;
    }
  };

  const cancelComposerContext = () => {
    setEditing(null);
    setReplyTarget(null);
    setDraft("");
  };

  if (!authChecked) return <LoadingView full />;

  return (
    <div className="messenger-page">
      <style>{responsiveCss}</style>
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <HeaderLogo />
          <div style={{ minWidth: 0 }}>
            <div style={headerTitleStyle}>메신저</div>
            <div style={headerSubStyle}>대화, 첨부, 답장, 수정, 읽음 확인</div>
          </div>
        </div>
        <button type="button" onClick={() => router.push("/home")} style={headerButtonStyle}>
          <ArrowLeft size={16} strokeWidth={1.8} /> 홈
        </button>
      </header>

      {error && (
        <div style={errorBarStyle}>
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} style={smallIconButtonStyle}><X size={14} /></button>
        </div>
      )}

      <main className={`messenger-shell ${activeId ? "has-active" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <aside className="conversation-list">
          <div style={listHeaderStyle}>
            <div style={sectionTitleStyle}><MessagesSquare size={19} strokeWidth={1.8} /> 대화</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" onClick={() => setSidebarCollapsed(true)} style={sidebarToggleIconStyle} className="desktop-only" title="대화 목록 접기">
                <PanelLeftClose size={17} strokeWidth={2} />
              </button>
              <button type="button" onClick={() => setNewOpen(true)} style={newButtonStyle}>
                <Plus size={16} strokeWidth={2.2} /> 새 대화
              </button>
            </div>
          </div>

          <div style={sidebarSearchWrapStyle}>
            <Search size={16} strokeWidth={1.8} color="var(--ink-faint)" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="대화와 메시지 검색"
              style={sidebarSearchInputStyle}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} style={clearSearchButtonStyle}>
                <X size={13} strokeWidth={2} />
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
            {loadingList ? (
              <LoadingView padding={36} />
            ) : conversations.length === 0 ? (
              <EmptyState
                icon={<MessageCircle size={26} strokeWidth={1.7} />}
                message="아직 대화가 없습니다."
                hint="새 대화를 눌러 메시지를 보내세요."
                padding={48}
              />
            ) : (
              <>
                {searchQuery.trim().length >= 2 && (
                  <SearchResults
                    loading={searchingMessages}
                    results={messageResults}
                    onOpen={(result) => {
                      setActiveId(result.conversation_id);
                      setHighlightedMessageId(result.message_id);
                    }}
                  />
                )}
                <div style={sidebarLabelStyle}>
                  {searchQuery.trim() ? "대화 결과" : "최근 대화"}
                </div>
                {filteredConversations.length === 0 ? (
                  <EmptyState message="일치하는 대화가 없습니다." padding={30} />
                ) : (
                  <ul style={listStyle}>
                    {filteredConversations.map((c) => (
                      <li key={c.conversation_id}>
                        <ConversationButton
                          conversation={c}
                          active={c.conversation_id === activeId}
                          mine={myUserId}
                          onClick={() => setActiveId(c.conversation_id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </aside>

        <section
          className="conversation-panel"
          onDragOver={(e) => {
            if (!activeId) return;
            e.preventDefault();
          }}
          onDrop={(e) => {
            if (!activeId) return;
            e.preventDefault();
            uploadFiles(e.dataTransfer.files);
          }}
        >
          {activeConversation ? (
            <>
              <ChatHeader
                conversation={activeConversation}
                participants={participants}
                onlineUserIds={onlineUserIds}
                typingNames={typingUserIds.map((id) => participantNameById.get(id) || "상대방")}
                onTogglePinned={() => updateConversationState({ pinned: !activeConversation.is_pinned })}
                onToggleFavorite={() => updateConversationState({ favorite: !activeConversation.is_favorite })}
                onToggleMuted={() => updateConversationState({ muted: !activeConversation.is_muted })}
                onArchive={() => updateConversationState({ archived: true })}
                onLeave={leaveConversation}
                onBlockPeer={activeConversation.type === "direct" ? blockCurrentPeer : undefined}
                onManageGroup={activeConversation.type === "group" ? () => setGroupManageOpen(true) : undefined}
                onBack={clearActiveConversation}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
              />

              <div ref={messageListRef} onScroll={handleMessageListScroll} style={messageListStyle}>
                {loadingMessages ? (
                  <LoadingView padding={40} />
                ) : messages.length === 0 ? (
                  <EmptyState icon={<MessageCircle size={26} strokeWidth={1.7} />} message="첫 메시지를 보내세요." padding={56} />
                ) : (
                  <>
                    {hasOlderMessages && (
                      <div style={olderButtonWrapStyle}>
                        <button type="button" onClick={loadOlderMessages} disabled={loadingOlder} style={olderButtonStyle}>
                          {loadingOlder ? "불러오는 중..." : "이전 메시지 더 보기"}
                        </button>
                      </div>
                    )}
                    {messages.map((m, idx) => (
                      <div key={m.id}>
                        {firstUnreadMessageId === m.id && (
                          <div style={firstUnreadMarkerStyle}>
                            <span style={firstUnreadLineStyle} />
                            <span style={firstUnreadTextStyle}>여기부터 안 읽은 메시지</span>
                            <span style={firstUnreadLineStyle} />
                          </div>
                        )}
                        <MessageBubble
                          message={m}
                          compact={idx > 0 && messages[idx - 1].sender_id === m.sender_id}
                          participants={participants}
                          highlighted={highlightedMessageId === m.id}
                          onReply={() => setReplyTarget(m)}
                          onEdit={() => startEdit(m)}
                          onDelete={() => removeMessage(m)}
                          onForward={() => setForwarding(m)}
                          onReport={() => reportMessage(m)}
                          onCopy={() => copyMessageText(m)}
                          onReact={(emoji) => reactToMessage(m, emoji)}
                          onShowReadStatus={() => setReadStatusMessage(m)}
                          onPreviewImage={(attachment, url) => setImagePreview({ attachment, url })}
                          actionsOpen={actionMessageId === m.id}
                          onToggleActions={() => setActionMessageId((current) => current === m.id ? null : m.id)}
                        />
                      </div>
                    ))}
                  </>
                )}
                <div ref={bottomRef} />
              </div>
              {showFirstUnreadJump && firstUnreadMessageId && (
                <button type="button" onClick={() => scrollToFirstUnread()} style={firstUnreadJumpButtonStyle}>
                  <ArrowDown size={15} strokeWidth={2.1} /> 첫 안 읽은 메시지
                </button>
              )}
              {showLatestJump && (
                <button type="button" onClick={() => scrollToLatest()} style={latestJumpButtonStyle}>
                  <ArrowDown size={15} strokeWidth={2.1} /> 최신 메시지
                </button>
              )}

              <MessengerComposer
                draft={draft}
                setDraft={setDraft}
                sending={sending}
                uploading={uploading}
                attachments={attachments}
                setAttachments={setAttachments}
                replyTarget={replyTarget}
                editing={editing}
                onCancelContext={cancelComposerContext}
                onSend={send}
                onTyping={emitTyping}
                onPickFiles={() => fileInputRef.current?.click()}
                onPasteFiles={(files) => uploadFiles(files)}
                maxAttachments={MAX_ATTACHMENTS}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.docx,.xlsx,.pptx"
                onChange={(e) => uploadFiles(e.target.files)}
                style={{ display: "none" }}
              />
            </>
          ) : (
            <div style={{ flex: 1, display: "grid", placeItems: "center", position: "relative" }}>
              {sidebarCollapsed && (
                <button
                  type="button"
                  className="desktop-only"
                  onClick={() => setSidebarCollapsed(false)}
                  style={{ ...smallIconButtonStyle, position: "absolute", top: 14, left: 14 }}
                  title="대화 목록 열기"
                >
                  <PanelLeftOpen size={18} strokeWidth={2} />
                </button>
              )}
              <EmptyState
                icon={<MessagesSquare size={30} strokeWidth={1.6} />}
                message="대화를 선택하세요."
                hint="왼쪽 목록에서 대화를 고르거나 새 대화를 시작하세요."
                padding={56}
              />
            </div>
          )}
        </section>
      </main>

      {newOpen && (
        <NewConversationModal
          onClose={() => setNewOpen(false)}
          onCreated={async (conversationId) => {
            setNewOpen(false);
            await loadConversations(conversationId);
            setActiveId(conversationId);
          }}
          onError={setError}
        />
      )}
      {forwarding && (
        <ForwardConversationModal
          conversations={conversations.filter((c) => c.conversation_id !== forwarding.conversation_id)}
          onClose={() => setForwarding(null)}
          onForward={forwardMessage}
        />
      )}
      {groupManageOpen && activeConversation?.type === "group" && (
        <GroupManagementModal
          conversation={activeConversation}
          participants={participants}
          myUserId={myUserId}
          onClose={() => setGroupManageOpen(false)}
          onRename={renameGroup}
          onAddMembers={addGroupMembers}
          onRemoveMember={removeGroupMember}
          onError={setError}
        />
      )}
      {imagePreview && (
        <ImagePreviewModal
          preview={imagePreview}
          onClose={() => setImagePreview(null)}
        />
      )}
      {readStatusMessage && (
        <ReadStatusModal
          message={readStatusMessage}
          participants={participants}
          onClose={() => setReadStatusMessage(null)}
        />
      )}
    </div>
  );
}

function ChatHeader({
  conversation,
  participants,
  onlineUserIds,
  typingNames,
  onTogglePinned,
  onToggleFavorite,
  onToggleMuted,
  onArchive,
  onLeave,
  onBlockPeer,
  onManageGroup,
  onBack,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  conversation: MessengerConversation;
  participants: MessengerParticipant[];
  onlineUserIds: string[];
  typingNames: string[];
  onTogglePinned: () => void;
  onToggleFavorite: () => void;
  onToggleMuted: () => void;
  onArchive: () => void;
  onLeave: () => void;
  onBlockPeer?: () => void;
  onManageGroup?: () => void;
  onBack: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const statusText = typingNames.length > 0
    ? `${typingNames.slice(0, 2).join(", ")} 입력 중`
    : `온라인 ${onlineUserIds.length}명`;

  return (
    <div style={chatHeaderStyle}>
      <button type="button" className="mobile-back" onClick={onBack} style={smallIconButtonStyle}>
        <ArrowLeft size={18} strokeWidth={1.9} />
      </button>
      <button
        type="button"
        className="desktop-only"
        onClick={onToggleSidebar}
        style={sidebarToggleButtonStyle}
        title={sidebarCollapsed ? "대화 목록 열기" : "대화 목록 접기"}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={18} strokeWidth={2} /> : <PanelLeftClose size={18} strokeWidth={2} />}
        <span>{sidebarCollapsed ? "목록 열기" : "목록 접기"}</span>
      </button>
      <Avatar title={conversation.display_title} src={conversation.display_avatar_url} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={chatTitleStyle}>{conversation.display_title}</div>
        <div style={chatSubStyle}>
          {conversation.type === "group" && <Users size={12} strokeWidth={1.8} />}
          {conversation.participant_count}명
          <span style={presenceDotStyle} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: typingNames.length > 0 ? "var(--accent)" : "var(--ink-faint)", fontWeight: 800 }}>
            {statusText}
          </span>
          {participants.length > 0 && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>· {participants.map((p) => p.name || "이름 없음").join(", ")}</span>}
        </div>
      </div>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button type="button" onClick={() => setMenuOpen((v) => !v)} style={smallIconButtonStyle} title="대화 메뉴">
          <MoreVertical size={18} strokeWidth={2} />
        </button>
        {menuOpen && (
          <div style={conversationMenuStyle}>
            {onManageGroup && <MenuAction icon={<Users size={14} />} label="그룹 관리" onClick={() => { setMenuOpen(false); onManageGroup(); }} />}
            <MenuAction icon={<LogOut size={14} />} label={conversation.type === "group" ? "대화방 나가기" : "대화 숨기기"} onClick={() => { setMenuOpen(false); onLeave(); }} />
            <MenuAction icon={<Pin size={14} />} label={conversation.is_pinned ? "고정 해제" : "대화 고정"} onClick={() => { setMenuOpen(false); onTogglePinned(); }} />
            <MenuAction icon={<Star size={14} />} label={conversation.is_favorite ? "즐겨찾기 해제" : "즐겨찾기"} onClick={() => { setMenuOpen(false); onToggleFavorite(); }} />
            <MenuAction icon={conversation.is_muted ? <Volume2 size={14} /> : <VolumeX size={14} />} label={conversation.is_muted ? "알림 켜기" : "알림 끄기"} onClick={() => { setMenuOpen(false); onToggleMuted(); }} />
            <MenuAction icon={<X size={14} />} label="대화 숨기기" onClick={() => { setMenuOpen(false); onArchive(); }} />
            {onBlockPeer && <MenuAction danger icon={<ShieldAlert size={14} />} label="상대 차단" onClick={() => { setMenuOpen(false); onBlockPeer(); }} />}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuAction({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{ ...menuActionStyle, color: danger ? "var(--danger)" : "var(--ink-mid)" }}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SearchResults({
  loading,
  results,
  onOpen,
}: {
  loading: boolean;
  results: MessengerSearchResult[];
  onOpen: (result: MessengerSearchResult) => void;
}) {
  return (
    <div style={searchResultsWrapStyle}>
      <div style={sidebarLabelStyle}>
        메시지 검색 {loading ? "검색 중" : `${results.length}건`}
      </div>
      {loading ? (
        <LoadingView padding={22} />
      ) : results.length === 0 ? (
        <div style={searchEmptyStyle}>본문 검색 결과가 없습니다.</div>
      ) : (
        <ul style={{ ...listStyle, gap: 5 }}>
          {results.slice(0, 8).map((r) => (
            <li key={r.message_id}>
              <button type="button" onClick={() => onOpen(r)} style={searchResultButtonStyle}>
                <div style={oneLineStyle}>
                  <span style={{ fontWeight: 900 }}>{r.conversation_title}</span>
                  <span style={{ color: "var(--ink-faint)" }}> · {formatShortTime(r.created_at)}</span>
                </div>
                <div style={{ ...oneLineStyle, marginTop: 3 }}>
                  <span style={{ color: "var(--accent)", fontWeight: 900 }}>{r.sender_name || "이름 없음"}</span>
                  <span style={{ color: "var(--ink-soft)" }}> {r.body}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConversationButton({
  conversation,
  active,
  mine,
  onClick,
}: {
  conversation: MessengerConversation;
  active: boolean;
  mine: string | null;
  onClick: () => void;
}) {
  const fromMe = conversation.last_sender_id && conversation.last_sender_id === mine;
  return (
    <button type="button" onClick={onClick} style={{
      ...conversationButtonStyle,
      border: active ? "1px solid rgba(62,90,74,0.35)" : "1px solid transparent",
      background: active ? "var(--accent-soft)" : conversation.unread_count > 0 ? "color-mix(in srgb, var(--card) 72%, transparent)" : "transparent",
      boxShadow: active ? "0 8px 20px rgba(62,90,74,0.1)" : conversation.unread_count > 0 ? "0 1px 6px rgba(26,22,18,0.04)" : "none",
    }}>
      <Avatar title={conversation.display_title} src={conversation.display_avatar_url} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={conversationTitleStyle}>{conversation.display_title}</div>
          {conversation.is_pinned && <Pin size={12} strokeWidth={2} color="var(--accent)" />}
          {conversation.is_favorite && <Star size={12} strokeWidth={2} color="var(--warning)" />}
          {conversation.is_muted && <VolumeX size={12} strokeWidth={2} color="var(--ink-faint)" />}
          <div style={conversationTimeStyle}>{conversation.last_message_at ? formatShortTime(conversation.last_message_at) : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
          <div style={{
            ...conversationPreviewStyle,
            color: conversation.unread_count > 0 ? "var(--ink)" : "var(--ink-soft)",
            fontWeight: conversation.unread_count > 0 ? 800 : 600,
          }}>
            {conversation.last_message_body ? `${fromMe ? "나: " : ""}${conversation.last_message_body}` : "새 대화"}
          </div>
          {conversation.unread_count > 0 && (
            <span style={unreadBadgeStyle}>{conversation.unread_count > 99 ? "99+" : conversation.unread_count}</span>
          )}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({
  message,
  compact,
  participants,
  highlighted,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onReport,
  onCopy,
  onReact,
  onShowReadStatus,
  onPreviewImage,
  actionsOpen,
  onToggleActions,
}: {
  message: MessengerMessage;
  compact: boolean;
  participants: MessengerParticipant[];
  highlighted: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onForward: () => void;
  onReport: () => void;
  onCopy: () => void;
  onReact: (emoji: string) => void;
  onShowReadStatus: () => void;
  onPreviewImage: (attachment: MessengerAttachment, url: string) => void;
  actionsOpen: boolean;
  onToggleActions: () => void;
}) {
  const deleted = !!message.deleted_at;
  const readerNames = message.read_by.map((r) => r.name).filter(Boolean).join(", ");
  const readCount = message.read_by.length;
  const trackableCount = Math.max(participants.filter((p) => p.user_id !== message.sender_id).length, readCount);

  return (
    <div id={`messenger-message-${message.id}`} style={{ display: "flex", justifyContent: message.is_mine ? "flex-end" : "flex-start", marginTop: compact ? 4 : 12 }}>
      <div className="message-wrap" style={{
        maxWidth: "min(78%, 680px)",
        display: "flex",
        flexDirection: "column",
        alignItems: message.is_mine ? "flex-end" : "flex-start",
        gap: 4,
        outline: highlighted ? "2px solid rgba(62,90,74,0.36)" : "none",
        outlineOffset: 4,
        borderRadius: 18,
        transition: "outline-color .2s ease",
      }}>
        {!message.is_mine && !compact && (
          <div style={senderNameStyle}>{message.sender_name || "이름 없음"}</div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, minWidth: 0, maxWidth: "100%", flexDirection: message.is_mine ? "row" : "row-reverse" }}>
          <MessageActions
            mine={message.is_mine}
            deleted={deleted}
            hasText={!!message.body.trim()}
            open={actionsOpen}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
            onForward={onForward}
            onReport={onReport}
            onCopy={onCopy}
            onReact={onReact}
          />
          <div style={{
            ...bubbleStyle,
            borderRadius: message.is_mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
            background: message.is_mine ? "var(--accent)" : "var(--card)",
            color: message.is_mine ? "#fff" : "var(--ink)",
            border: message.is_mine ? "none" : "1px solid var(--hairline)",
            opacity: deleted ? 0.72 : 1,
            maxWidth: "100%",
          }} onClick={onToggleActions}>
            {message.reply_to && (
              <div style={{
                ...replyPreviewStyle,
                background: message.is_mine ? "rgba(255,255,255,0.16)" : "var(--bg-soft)",
                color: message.is_mine ? "rgba(255,255,255,0.92)" : "var(--ink-soft)",
              }}>
                <div style={{ fontWeight: 900 }}>{message.reply_to.sender_name || "이전 메시지"}</div>
                <div style={oneLineStyle}>{message.reply_to.body || "첨부 메시지"}</div>
              </div>
            )}
            {message.body && (
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                <LinkifiedText text={message.body} mine={message.is_mine} />
              </div>
            )}
            {message.attachments.length > 0 && (
              <AttachmentList attachments={message.attachments} mine={message.is_mine} onPreviewImage={onPreviewImage} />
            )}
          </div>
        </div>

        {(message.reactions || []).length > 0 && (
          <div style={reactionRowStyle}>
            {(message.reactions || []).map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => onReact(reaction.emoji)}
                title={reaction.names.join(", ")}
                style={{
                  ...reactionButtonStyle,
                  borderColor: reaction.mine ? "rgba(62,90,74,0.48)" : "var(--hairline)",
                  background: reaction.mine ? "var(--accent-soft)" : "var(--card)",
                  color: reaction.mine ? "var(--accent)" : "var(--ink-mid)",
                }}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        )}

        <div style={messageMetaStyle} title={readerNames ? `읽은 사람: ${readerNames}` : undefined}>
          {formatMessageTime(message.created_at)}
          {message.edited_at && !deleted ? " · 수정됨" : ""}
          {!deleted && trackableCount > 0 && (
            <button type="button" onClick={onShowReadStatus} style={readStatusButtonStyle}>
              {` · 읽음 ${readCount}/${trackableCount}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageActions({
  mine,
  deleted,
  hasText,
  open,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onReport,
  onCopy,
  onReact,
}: {
  mine: boolean;
  deleted: boolean;
  hasText: boolean;
  open: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onForward: () => void;
  onReport: () => void;
  onCopy: () => void;
  onReact: (emoji: string) => void;
}) {
  if (deleted) return null;
  return (
    <div className={`message-actions${open ? " open" : ""}`} style={messageActionsStyle}>
      <button type="button" onClick={() => onReact("👍")} title="좋아요" style={miniActionStyle}><SmilePlus size={13} /></button>
      <button type="button" onClick={() => onReact("✅")} title="확인" style={miniTextActionStyle}>✓</button>
      <button type="button" onClick={() => onReact("🙏")} title="감사" style={miniTextActionStyle}>🙏</button>
      <button type="button" onClick={onReply} title="답장" style={miniActionStyle}><Reply size={13} /></button>
      <button type="button" onClick={onForward} title="전달" style={miniActionStyle}><Forward size={13} /></button>
      {hasText && <button type="button" onClick={onCopy} title="복사" style={miniActionStyle}><Copy size={13} /></button>}
      {mine && hasText && <button type="button" onClick={onEdit} title="수정" style={miniActionStyle}><Pencil size={13} /></button>}
      {mine && <button type="button" onClick={onDelete} title="삭제" style={miniActionStyle}><Trash2 size={13} /></button>}
      {!mine && <button type="button" onClick={onReport} title="신고" style={miniActionStyle}><ShieldAlert size={13} /></button>}
    </div>
  );
}

function LinkifiedText({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={`${index}-${part}`}>{part}</span>;
        return (
          <a
            key={`${index}-${part}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            style={{
              color: mine ? "#fff" : "var(--accent)",
              textDecoration: "underline",
              textUnderlineOffset: 2,
              fontWeight: 850,
              wordBreak: "break-all",
            }}
          >
            {part}
          </a>
        );
      })}
    </>
  );
}

function AttachmentList({
  attachments,
  mine,
  onPreviewImage,
}: {
  attachments: MessengerAttachment[];
  mine: boolean;
  onPreviewImage: (attachment: MessengerAttachment, url: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 7, marginTop: 8, maxWidth: "100%" }}>
      {attachments.map((a) => {
        const url = storageProxyUrl("messenger-attachments", a.file_path);
        const image = !!a.mime_type?.startsWith("image/");
        if (image) {
          return (
            <button
              key={a.id || a.file_path}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onPreviewImage(a, url);
              }}
              style={imageAttachmentButtonStyle}
              title={`${a.file_name}${formatAttachmentMeta(a) ? ` · ${formatAttachmentMeta(a)}` : ""}`}
            >
              <Image
                src={url}
                alt={a.file_name}
                width={320}
                height={220}
                unoptimized
                style={imageAttachmentStyle}
              />
            </button>
          );
        }
        return (
          <a
            key={a.id || a.file_path}
            href={url}
            target="_blank"
            rel="noreferrer"
            title={`${a.file_name}${formatAttachmentMeta(a) ? ` · ${formatAttachmentMeta(a)}` : ""}`}
            style={{
              ...fileAttachmentStyle,
              background: mine ? "rgba(255,255,255,0.14)" : "var(--bg-soft)",
              color: mine ? "#fff" : "var(--ink)",
            }}
          >
            <FileText size={17} strokeWidth={1.8} style={{ flexShrink: 0 }} />
            <span style={fileNameStyle}>{a.file_name}</span>
            <span style={fileMetaStyle}>{formatAttachmentMeta(a)}</span>
          </a>
        );
      })}
    </div>
  );
}

function GroupManagementModal({
  conversation,
  participants,
  myUserId,
  onClose,
  onRename,
  onAddMembers,
  onRemoveMember,
  onError,
}: {
  conversation: MessengerConversation;
  participants: MessengerParticipant[];
  myUserId: string | null;
  onClose: () => void;
  onRename: (title: string) => Promise<void>;
  onAddMembers: (userIds: string[]) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { confirm } = useConfirm();
  const [title, setTitle] = useState(conversation.title || conversation.display_title);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<MessengerUser[]>([]);
  const [selected, setSelected] = useState<MessengerUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const participantIds = useMemo(() => new Set(participants.map((p) => p.user_id)), [participants]);
  const filteredUsers = users.filter((u) => !participantIds.has(u.user_id));

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchMessengerUsers(query, 30);
        if (!cancelled) setUsers(rows);
      } catch (e) {
        if (!cancelled) onError(getErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onError, query]);

  const toggleUser = (user: MessengerUser) => {
    setSelected((prev) => toggleMessengerUser(prev, user));
  };

  const saveTitle = async () => {
    const nextTitle = title.trim();
    if (!nextTitle || savingTitle) return;
    setSavingTitle(true);
    try {
      await onRename(nextTitle);
    } catch {
      // Parent already surfaces the error.
    } finally {
      setSavingTitle(false);
    }
  };

  const addSelected = async () => {
    if (selected.length === 0 || adding) return;
    setAdding(true);
    try {
      await onAddMembers(selected.map((u) => u.user_id));
      setSelected([]);
      setQuery("");
    } catch {
      // Parent already surfaces the error.
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (participant: MessengerParticipant) => {
    if (participant.user_id === myUserId || removingId) return;
    if (!await confirm(`${participant.name || "이 멤버"}님을 대화방에서 내보낼까요?`)) return;
    setRemovingId(participant.user_id);
    try {
      await onRemoveMember(participant.user_id);
    } catch {
      // Parent already surfaces the error.
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div onClick={onClose} style={modalOverlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div style={sectionTitleStyle}><Users size={18} strokeWidth={2} /> 그룹 관리</div>
          <button type="button" onClick={onClose} style={smallIconButtonStyle}><X size={17} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, marginBottom: 14 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="그룹 이름" maxLength={80} style={{ ...inputStyle, marginBottom: 0 }} />
          <button type="button" onClick={saveTitle} disabled={!title.trim() || savingTitle} style={{
            ...primaryButtonStyle,
            opacity: !title.trim() || savingTitle ? 0.45 : 1,
          }}>
            저장
          </button>
        </div>

        <div style={sidebarLabelStyle}>참여자 {participants.length}명</div>
        <div style={{ ...userListStyle, maxHeight: 260, marginBottom: 14 }}>
          {participants.map((p) => (
            <div key={p.user_id} style={{ ...userRowStyle, cursor: "default" }}>
              <Avatar title={p.name || "U"} src={p.avatar_url} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={userNameStyle}>{p.name || "이름 없음"} {p.user_id === myUserId ? "(나)" : ""}</div>
                <div style={userMetaStyle}>{p.role === "owner" ? "방장" : p.sub_role || "참여자"}</div>
              </div>
              {p.user_id !== myUserId && (
                <button
                  type="button"
                  onClick={() => removeMember(p)}
                  disabled={removingId === p.user_id}
                  style={{ ...secondaryButtonStyle, height: 32, padding: "0 10px", color: "var(--danger)" }}
                >
                  내보내기
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={sidebarLabelStyle}>참여자 추가</div>
        <div style={searchBoxStyle}>
          <Search size={16} strokeWidth={1.8} color="var(--ink-faint)" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 또는 직분 검색" style={searchInputStyle} />
        </div>

        {selected.length > 0 && (
          <div style={selectedWrapStyle}>
            {selected.map((u) => (
              <span key={u.user_id} style={selectedChipStyle}>
                <span style={oneLineStyle}>{u.name || "이름 없음"}</span>
                <button type="button" onClick={() => setSelected((prev) => prev.filter((x) => x.user_id !== u.user_id))} style={chipRemoveStyle}>
                  <X size={12} strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div style={userListStyle}>
          {loading ? (
            <LoadingView padding={28} />
          ) : filteredUsers.length === 0 ? (
            <EmptyState message="추가할 사용자가 없습니다." padding={34} />
          ) : (
            filteredUsers.map((u) => {
              const picked = selected.some((s) => s.user_id === u.user_id);
              return (
                <button key={u.user_id} type="button" onClick={() => toggleUser(u)} style={userRowStyle}>
                  <Avatar title={u.name || "U"} src={u.avatar_url} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={userNameStyle}>{u.name || "이름 없음"}</div>
                    <div style={userMetaStyle}>{u.sub_role || roleLabel(u.role)}</div>
                  </div>
                  {picked && <Check size={17} strokeWidth={2.4} color="var(--accent)" />}
                </button>
              );
            })
          )}
        </div>

        <div style={modalFooterStyle}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>닫기</button>
          <button type="button" onClick={addSelected} disabled={selected.length === 0 || adding} style={{
            ...primaryButtonStyle,
            opacity: selected.length === 0 || adding ? 0.45 : 1,
          }}>
            추가
          </button>
        </div>
      </div>
    </div>
  );
}

function ReadStatusModal({
  message,
  participants,
  onClose,
}: {
  message: MessengerMessage;
  participants: MessengerParticipant[];
  onClose: () => void;
}) {
  const { sender, readRows, unreadRows } = getMessengerReadStatus(message.sender_id, message.read_by, participants);
  return <ReadStatusModalContent message={message} status={{ sender, readRows, unreadRows }} onClose={onClose} styles={{ modalOverlay: modalOverlayStyle, modal: modalStyle, modalHeader: modalHeaderStyle, sectionTitle: sectionTitleStyle, smallIconButton: smallIconButtonStyle, replyPreview: replyPreviewStyle, oneLine: oneLineStyle, sidebarLabel: sidebarLabelStyle, userList: userListStyle, userRow: userRowStyle, userName: userNameStyle, userMeta: userMetaStyle }} />;
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatMessageTime(iso: string): string {
  return formatMessengerMessageTime(iso);
}

function formatAttachmentMeta(attachment: MessengerAttachment): string {
  return formatMessengerAttachmentMeta(attachment);
}

function roleLabel(role: string | null): string {
  return messengerRoleLabel(role);
}

function getErrorMessage(error: unknown): string {
  return messengerErrorMessage(error);
}

const responsiveCss = `
  @media (min-width: 761px) {
    html:has(.messenger-page),
    body:has(.messenger-page) {
      height: 100%;
      overflow: hidden;
    }
    #app-zoom-root:has(.messenger-page) {
      zoom: 1;
      min-height: 0;
      height: calc(100dvh - var(--body-safe-top, 0px));
      overflow: hidden;
    }
  }
  .messenger-page {
    position: relative;
    margin-top: calc(-1 * var(--body-safe-top, 0px));
    min-height: calc(100vh - var(--body-safe-top, 0px));
    min-height: calc(100dvh - var(--body-safe-top, 0px));
    height: calc(100dvh - var(--body-safe-top, 0px));
    overflow: hidden;
    background: linear-gradient(180deg, #f7f4ed 0%, #f1eee6 100%);
    color: var(--ink);
    font-family: var(--font-noto-sans-kr), -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .messenger-shell {
    display: grid;
    grid-template-columns: 352px minmax(0, 1fr);
    height: calc(100vh - var(--body-safe-top, 0px) - 62px);
    height: calc(100dvh - var(--body-safe-top, 0px) - 62px);
    max-width: 1320px;
    margin: 0 auto;
    border-left: 1px solid var(--hairline);
    border-right: 1px solid var(--hairline);
    background: var(--surface);
    box-shadow: 0 18px 70px rgba(26,22,18,0.08);
    overflow: hidden;
  }
  .messenger-shell.sidebar-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }
  .conversation-list {
    border-right: 1px solid var(--hairline);
    background: var(--card);
    min-width: 0;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .messenger-shell.sidebar-collapsed .conversation-list {
    display: none;
  }
  .conversation-panel {
    min-width: 0;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background:
      radial-gradient(circle at 1px 1px, rgba(62,90,74,0.055) 1px, transparent 0) 0 0 / 22px 22px,
      #fbfaf7;
    position: relative;
  }
  .desktop-only { display: inline-flex; }
  .mobile-back { display: none; }
  .message-actions { opacity: 0; pointer-events: none; transition: opacity .14s ease; }
  .message-wrap:hover .message-actions,
  .message-actions.open { opacity: 1; pointer-events: auto; }
  @media (max-width: 760px) {
    .messenger-shell {
      display: block;
      height: calc(100vh - 62px);
      height: calc(100dvh - 62px);
      border: none;
      min-height: 0;
    }
    .conversation-list {
      height: 100%;
      border-right: none;
      display: flex;
    }
    .messenger-shell.sidebar-collapsed .conversation-list {
      display: flex;
    }
    .conversation-panel {
      height: 100%;
      display: none;
      min-height: 0;
    }
    .messenger-shell.has-active .conversation-list { display: none; }
    .messenger-shell.has-active .conversation-panel { display: flex; }
    .desktop-only { display: none !important; }
    .mobile-back { display: inline-flex; }
    .message-wrap { max-width: min(92%, 620px) !important; }
    .message-actions { display: none !important; opacity: 1; }
    .message-actions.open { display: inline-flex !important; }
  }
`;

const listStyle: React.CSSProperties = { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 };
const sidebarSearchWrapStyle: React.CSSProperties = { height: 44, margin: "12px 12px 0", borderRadius: 10, border: "1px solid var(--hairline)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 8, padding: "0 10px", boxShadow: "0 1px 3px rgba(26,22,18,0.03)" };
const sidebarSearchInputStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 13, fontWeight: 700, fontFamily: "inherit" };
const clearSearchButtonStyle: React.CSSProperties = { width: 24, height: 24, border: "none", borderRadius: 6, background: "var(--bg-soft)", color: "var(--ink-faint)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const sidebarLabelStyle: React.CSSProperties = { margin: "8px 4px 6px", fontSize: 11, fontWeight: 900, color: "var(--ink-faint)", letterSpacing: 0.2 };
const searchResultsWrapStyle: React.CSSProperties = { marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid var(--hairline)" };
const searchResultButtonStyle: React.CSSProperties = { width: "100%", border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--surface)", padding: "8px 9px", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 12, lineHeight: 1.35 };
const searchEmptyStyle: React.CSSProperties = { padding: "12px 8px", color: "var(--ink-faint)", fontSize: 12, fontWeight: 700, textAlign: "center" };
const headerStyle: React.CSSProperties = { height: 62, padding: "0 clamp(12px, 4vw, 20px)", borderBottom: "1px solid var(--hairline)", background: "color-mix(in srgb, var(--card) 86%, transparent)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
const headerTitleStyle: React.CSSProperties = { fontSize: 17, fontWeight: 900, color: "var(--ink)", lineHeight: 1.1 };
const headerSubStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--ink-faint)", marginTop: 2 };
const headerButtonStyle: React.CSSProperties = { height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--bg-soft)", color: "var(--ink-mid)", fontSize: 13, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit" };
const errorBarStyle: React.CSSProperties = { position: "fixed", left: "50%", top: 72, transform: "translateX(-50%)", zIndex: 120, maxWidth: "calc(100vw - 24px)", background: "var(--danger-soft)", color: "var(--danger)", border: "1px solid rgba(160, 55, 55, 0.22)", borderRadius: 8, padding: "8px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 800 };
const smallIconButtonStyle: React.CSSProperties = { width: 34, height: 34, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--card)", color: "var(--ink-mid)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 };
const sidebarToggleIconStyle: React.CSSProperties = { width: 36, height: 34, borderRadius: 10, border: "1px solid rgba(62,90,74,0.18)", background: "linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, transparent), color-mix(in srgb, var(--surface) 92%, transparent))", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, boxShadow: "0 8px 22px rgba(26,22,18,0.08)", fontFamily: "inherit" };
const sidebarToggleButtonStyle: React.CSSProperties = { height: 36, padding: "0 12px 0 10px", borderRadius: 999, border: "1px solid rgba(62,90,74,0.18)", background: "linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, transparent), color-mix(in srgb, var(--surface) 92%, transparent))", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer", flexShrink: 0, boxShadow: "0 10px 26px rgba(26,22,18,0.08)", fontSize: 12, fontWeight: 900, fontFamily: "inherit" };
const sectionTitleStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 900 };
const listHeaderStyle: React.CSSProperties = { padding: "14px 14px 12px", borderBottom: "1px solid var(--hairline)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "var(--card)" };
const newButtonStyle: React.CSSProperties = { height: 34, padding: "0 11px", border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 900, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "inherit", boxShadow: "0 8px 20px rgba(62,90,74,0.18)" };
const chatHeaderStyle: React.CSSProperties = { minHeight: 66, padding: "10px 14px", borderBottom: "1px solid var(--hairline)", background: "color-mix(in srgb, var(--card) 90%, transparent)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", gap: 10 };
const chatTitleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const chatSubStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, minWidth: 0, fontSize: 12, color: "var(--ink-faint)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const presenceDotStyle: React.CSSProperties = { width: 7, height: 7, borderRadius: 999, background: "#2F9E62", display: "inline-block", flexShrink: 0 };
const conversationMenuStyle: React.CSSProperties = { position: "absolute", top: 40, right: 0, zIndex: 40, width: 180, border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--card)", boxShadow: "0 16px 44px rgba(26,22,18,0.16)", padding: 6 };
const menuActionStyle: React.CSSProperties = { width: "100%", minHeight: 34, border: "none", borderRadius: 7, background: "transparent", display: "flex", alignItems: "center", gap: 8, padding: "0 9px", fontSize: 12, fontWeight: 850, cursor: "pointer", fontFamily: "inherit", textAlign: "left" };
const messageListStyle: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto", padding: "18px clamp(14px, 3vw, 26px)", overscrollBehavior: "contain" };
const latestJumpButtonStyle: React.CSSProperties = { position: "absolute", right: 18, bottom: 92, zIndex: 25, minHeight: 36, border: "1px solid rgba(62,90,74,0.22)", borderRadius: 999, background: "var(--card)", color: "var(--accent)", padding: "0 13px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, cursor: "pointer", boxShadow: "0 12px 34px rgba(26,22,18,0.14)", fontFamily: "inherit" };
const firstUnreadJumpButtonStyle: React.CSSProperties = { ...latestJumpButtonStyle, bottom: 136, background: "var(--accent)", color: "#fff", border: "1px solid rgba(62,90,74,0.3)" };
const firstUnreadMarkerStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, margin: "14px 0 10px", color: "var(--accent)" };
const firstUnreadLineStyle: React.CSSProperties = { height: 1, flex: 1, background: "rgba(62,90,74,0.24)" };
const firstUnreadTextStyle: React.CSSProperties = { borderRadius: 999, background: "var(--accent-soft)", border: "1px solid rgba(62,90,74,0.18)", padding: "4px 9px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" };
const olderButtonWrapStyle: React.CSSProperties = { display: "flex", justifyContent: "center", padding: "2px 0 12px" };
const olderButtonStyle: React.CSSProperties = { minHeight: 34, border: "1px solid var(--hairline)", borderRadius: 999, background: "var(--card)", color: "var(--ink-soft)", padding: "0 14px", fontSize: 12, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(26,22,18,0.04)" };
const conversationButtonStyle: React.CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 11px", borderRadius: 10, cursor: "pointer", textAlign: "left", fontFamily: "inherit", transition: "background .16s ease, border-color .16s ease, transform .16s ease" };
const conversationTitleStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 900, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const conversationTimeStyle: React.CSSProperties = { fontSize: 11, color: "var(--ink-faint)", flexShrink: 0 };
const conversationPreviewStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const unreadBadgeStyle: React.CSSProperties = { minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 900, flexShrink: 0 };
const senderNameStyle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "var(--ink-soft)", paddingLeft: 2 };
const bubbleStyle: React.CSSProperties = { padding: "9px 12px", fontSize: 14, lineHeight: 1.55, boxShadow: "0 6px 18px rgba(26,22,18,0.06)", overflowWrap: "anywhere" };
const replyPreviewStyle: React.CSSProperties = { borderLeft: "3px solid currentColor", borderRadius: 7, padding: "6px 8px", marginBottom: 7, maxWidth: 300 };
const messageMetaStyle: React.CSSProperties = { fontSize: 10, color: "var(--ink-faint)" };
const readStatusButtonStyle: React.CSSProperties = { border: "none", background: "transparent", color: "inherit", padding: 0, font: "inherit", cursor: "pointer" };
const messageActionsStyle: React.CSSProperties = { display: "inline-flex", gap: 3, paddingBottom: 3 };
const miniActionStyle: React.CSSProperties = { width: 25, height: 25, borderRadius: 7, border: "1px solid var(--hairline)", background: "var(--card)", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const miniTextActionStyle: React.CSSProperties = { ...miniActionStyle, fontSize: 12, fontWeight: 900, lineHeight: 1 };
const reactionRowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4, maxWidth: "min(76%, 620px)" };
const reactionButtonStyle: React.CSSProperties = { minWidth: 42, height: 25, borderRadius: 999, border: "1px solid var(--hairline)", background: "var(--card)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "0 8px", fontSize: 12, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" };
const imageAttachmentButtonStyle: React.CSSProperties = { display: "block", width: "fit-content", maxWidth: "100%", border: "none", background: "transparent", padding: 0, cursor: "zoom-in", borderRadius: 8, overflow: "hidden" };
const imageAttachmentStyle: React.CSSProperties = { display: "block", maxWidth: "min(320px, 60vw)", maxHeight: 260, borderRadius: 8, objectFit: "cover", border: "1px solid rgba(255,255,255,0.18)" };
const fileAttachmentStyle: React.CSSProperties = { minWidth: 0, width: "min(320px, 68vw)", maxWidth: "100%", boxSizing: "border-box", minHeight: 42, borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, textDecoration: "none", fontSize: 12, fontWeight: 800 };
const fileNameStyle: React.CSSProperties = { minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const fileMetaStyle: React.CSSProperties = { flexShrink: 0, maxWidth: "42%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.78 };
const oneLineStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const chipRemoveStyle: React.CSSProperties = { width: 18, height: 18, border: "none", background: "transparent", color: "inherit", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 };
const modalOverlayStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 200, background: "rgba(43,39,34,0.48)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px))" };
const modalStyle: React.CSSProperties = { width: "min(560px, calc(100vw - 24px))", maxHeight: "calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))", overflowY: "auto", boxSizing: "border-box", background: "var(--card)", borderRadius: 10, border: "1px solid var(--hairline)", boxShadow: "0 24px 70px rgba(26,22,18,0.22)", padding: 16 };
const modalHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 };
const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", height: 40, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink)", fontSize: 14, fontWeight: 700, padding: "0 12px", marginBottom: 10, outline: "none", fontFamily: "inherit" };
const searchBoxStyle: React.CSSProperties = { height: 42, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", marginBottom: 10 };
const searchInputStyle: React.CSSProperties = { flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 14, fontFamily: "inherit" };
const selectedWrapStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0, marginBottom: 10 };
const selectedChipStyle: React.CSSProperties = { minWidth: 0, maxWidth: "100%", height: 26, padding: "0 6px 0 9px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 900 };
const userListStyle: React.CSSProperties = { maxHeight: 340, overflowY: "auto", border: "1px solid var(--hairline)", borderRadius: 8 };
const userRowStyle: React.CSSProperties = { width: "100%", minHeight: 62, border: "none", borderBottom: "1px solid var(--hairline)", background: "transparent", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" };
const userNameStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 900, color: "var(--ink)" };
const userMetaStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: "var(--ink-faint)", marginTop: 2 };
const modalFooterStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, marginTop: 14 };
const primaryButtonStyle: React.CSSProperties = { height: 38, padding: "0 16px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" };
const secondaryButtonStyle: React.CSSProperties = { ...primaryButtonStyle, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink-mid)" };
