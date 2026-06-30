"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Download,
  FileText,
  Forward,
  LogOut,
  MoreVertical,
  MessageCircle,
  MessagesSquare,
  Pin,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  ShieldAlert,
  Search,
  Send,
  SmilePlus,
  Star,
  Trash2,
  Volume2,
  VolumeX,
  Users,
  X,
} from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import { EmptyState, LoadingView } from "@/components/StatusViews";
import { storageProxyUrl } from "@/lib/storage-url";
import { supabase } from "@/lib/supabase";
import {
  createGroupConversation,
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
  startDirectMessage,
  toggleMessengerReaction,
  type MessengerAttachment,
  type MessengerConversation,
  type MessengerMessage,
  type MessengerParticipant,
  type MessengerSearchResult,
  type MessengerUser,
} from "@/lib/messenger";

type NewMode = "direct" | "group";
type ConversationFilter = "all" | "unread" | "favorite";
type PendingAttachment = MessengerAttachment & { local_url?: string };
type ImagePreviewItem = MessengerAttachment & { url: string };

function isMobileMessengerViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

const MAX_ATTACHMENTS = 6;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MESSAGE_PAGE_SIZE = 60;
const DRAFT_STORAGE_KEY = "chflow:messenger:drafts:v1";

export default function MessengerPage() {
  const router = useRouter();
  const { confirm, prompt, alert } = useConfirm();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const previousActiveIdRef = useRef<string | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const draftsByConversationRef = useRef<Record<string, string>>({});
  const lastTypingAtRef = useRef(0);
  const typingTimersRef = useRef<Record<string, number>>({});

  const [authChecked, setAuthChecked] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<MessengerConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [participants, setParticipants] = useState<MessengerParticipant[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [newMessageNotice, setNewMessageNotice] = useState(false);
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>("all");
  const [messageResults, setMessageResults] = useState<MessengerSearchResult[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);

  const [draft, setDraft] = useState("");
  const [draftsByConversation, setDraftsByConversation] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) || "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [replyTarget, setReplyTarget] = useState<MessengerMessage | null>(null);
  const [editing, setEditing] = useState<MessengerMessage | null>(null);
  const [forwarding, setForwarding] = useState<MessengerMessage | null>(null);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [readStatusMessage, setReadStatusMessage] = useState<MessengerMessage | null>(null);
  const [imagePreview, setImagePreview] = useState<{ images: ImagePreviewItem[]; index: number } | null>(null);

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
    const searched = !q ? conversations : conversations.filter((c) => (
      c.display_title.toLowerCase().includes(q)
      || (c.last_message_body || "").toLowerCase().includes(q)
    ));
    if (conversationFilter === "unread") return searched.filter((c) => c.unread_count > 0);
    if (conversationFilter === "favorite") return searched.filter((c) => c.is_favorite);
    return searched;
  }, [conversationFilter, conversations, searchQuery]);

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
      setError(getErrorMessage(e));
    } finally {
      setLoadingList(false);
    }
  }, [activeId]);

  const isMessageListNearBottom = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  }, []);

  const loadConversationBody = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    setError("");
    try {
      await markMessengerRead(conversationId);
      const [messageRows, participantRows] = await Promise.all([
        getMessengerMessages(conversationId, MESSAGE_PAGE_SIZE),
        getMessengerParticipants(conversationId),
      ]);
      setMessages(messageRows);
      setHasOlderMessages(messageRows.length >= MESSAGE_PAGE_SIZE);
      setParticipants(participantRows);
      setConversations((prev) => prev.map((c) => (
        c.conversation_id === conversationId ? { ...c, unread_count: 0 } : c
      )));
    } catch (e) {
      setError(getErrorMessage(e));
      setMessages([]);
      setHasOlderMessages(false);
      setParticipants([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    if (!activeId || loadingOlderMessages || !hasOlderMessages || messages.length === 0) return;
    const list = messageListRef.current;
    const previousHeight = list?.scrollHeight ?? 0;
    const previousTop = list?.scrollTop ?? 0;
    setLoadingOlderMessages(true);
    setError("");
    try {
      const rows = await getMessengerMessages(activeId, MESSAGE_PAGE_SIZE, messages[0].created_at);
      setHasOlderMessages(rows.length >= MESSAGE_PAGE_SIZE);
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...rows.filter((m) => !seen.has(m.id)), ...prev];
      });
      window.requestAnimationFrame(() => {
        const nextList = messageListRef.current;
        if (!nextList) return;
        nextList.scrollTop = nextList.scrollHeight - previousHeight + previousTop;
      });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [activeId, hasOlderMessages, loadingOlderMessages, messages]);

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
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>;
        draftsByConversationRef.current = parsed;
        setDraftsByConversation(parsed);
      }
    } catch {
      draftsByConversationRef.current = {};
      setDraftsByConversation({});
    }
  }, []);

  useEffect(() => {
    draftsByConversationRef.current = draftsByConversation;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftsByConversation));
    } catch {
      // Draft persistence is a convenience feature; storage failures should not block messaging.
    }
  }, [draftsByConversation]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setParticipants([]);
      setHasOlderMessages(false);
      setLoadingOlderMessages(false);
      setNewMessageNotice(false);
      setShowJumpLatest(false);
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
    setDraft(draftsByConversationRef.current[activeId] || "");
    setDraggingFiles(false);
    setAttachments([]);
    loadConversationBody(activeId);
  }, [activeId, loadConversationBody]);

  useEffect(() => {
    if (!activeId || editing) return;
    const value = draft.trim() ? draft : "";
    setDraftsByConversation((prev) => {
      if (value) {
        if (prev[activeId] === value) return prev;
        return { ...prev, [activeId]: value };
      }
      if (!(activeId in prev)) return prev;
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
  }, [activeId, draft, editing]);

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
          const nearBottom = isMessageListNearBottom();
          shouldStickToBottomRef.current = nearBottom;
          if (!nearBottom) setNewMessageNotice(true);
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
          const nearBottom = isMessageListNearBottom();
          shouldStickToBottomRef.current = nearBottom;
          if (!nearBottom) setNewMessageNotice(true);
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
  }, [activeId, isMessageListNearBottom, loadConversationBody, loadConversations, myUserId]);

  useEffect(() => {
    const activeChanged = previousActiveIdRef.current !== activeId;
    previousActiveIdRef.current = activeId;
    if (activeChanged || shouldStickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: activeChanged ? "auto" : "smooth", block: "end" });
      setShowJumpLatest(false);
    }
  }, [messages.length, activeId]);

  useEffect(() => {
    if (!highlightedMessageId || loadingMessages) return;
    const element = document.getElementById(`messenger-message-${highlightedMessageId}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId, loadingMessages, messages]);

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
        const safeName = sanitizeFileName(file.name);
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
        const savedDraft = draftsByConversationRef.current[activeId] || "";
        setEditing(null);
        setDraft(savedDraft);
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
      setDraftsByConversation((prev) => {
        if (!(activeId in prev)) return prev;
        const next = { ...prev };
        delete next[activeId];
        return next;
      });
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

  const copyMessage = async (message: MessengerMessage) => {
    const body = message.body.trim();
    if (!body) return;
    try {
      await copyText(body);
      await alert("메시지를 복사했습니다.");
    } catch (e) {
      setError(getErrorMessage(e));
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

      <main className={`messenger-shell ${activeId ? "has-active" : ""}`}>
        <aside className="conversation-list">
          <div style={listHeaderStyle}>
            <div style={sectionTitleStyle}><MessagesSquare size={19} strokeWidth={1.8} /> 대화</div>
            <button type="button" onClick={() => setNewOpen(true)} style={newButtonStyle}>
              <Plus size={16} strokeWidth={2.2} /> 새 대화
            </button>
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

          <div style={conversationFilterStyle}>
            {([
              ["all", "전체"],
              ["unread", "안 읽음"],
              ["favorite", "즐겨찾기"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setConversationFilter(value)}
                style={conversationFilter === value ? conversationFilterActiveButtonStyle : conversationFilterButtonStyle}
              >
                {label}
              </button>
            ))}
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
                          draftText={draftsByConversation[c.conversation_id] || ""}
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
              />

              <div
                ref={messageListRef}
                style={messageListStyle}
                onScroll={() => {
                  const nearBottom = isMessageListNearBottom();
                  shouldStickToBottomRef.current = nearBottom;
                  setShowJumpLatest(!nearBottom);
                  if (nearBottom) setNewMessageNotice(false);
                  if ((messageListRef.current?.scrollTop ?? 0) < 80) {
                    void loadOlderMessages();
                  }
                }}
              >
                {loadingMessages ? (
                  <LoadingView padding={40} />
                ) : messages.length === 0 ? (
                  <EmptyState icon={<MessageCircle size={26} strokeWidth={1.7} />} message="첫 메시지를 보내세요." padding={56} />
                ) : (
                  <>
                    {hasOlderMessages && (
                      <div style={olderMessagesWrapStyle}>
                        <button
                          type="button"
                          onClick={loadOlderMessages}
                          disabled={loadingOlderMessages}
                          style={olderMessagesButtonStyle}
                        >
                          {loadingOlderMessages ? "불러오는 중..." : "이전 메시지 더 보기"}
                        </button>
                      </div>
                    )}
                    {messages.map((m, idx) => {
                      const previous = idx > 0 ? messages[idx - 1] : null;
                      const showDay = !previous || !isSameMessageDay(previous.created_at, m.created_at);
                      return (
                        <Fragment key={m.id}>
                          {showDay && <DateDivider label={formatDayLabel(m.created_at)} />}
                          <MessageBubble
                            message={m}
                            compact={!!previous && previous.sender_id === m.sender_id && isSameMessageDay(previous.created_at, m.created_at)}
                            participants={participants}
                            highlighted={highlightedMessageId === m.id}
                            onReply={() => setReplyTarget(m)}
                            onEdit={() => startEdit(m)}
                            onDelete={() => removeMessage(m)}
                            onForward={() => setForwarding(m)}
                            onReport={() => reportMessage(m)}
                            onReact={(emoji) => reactToMessage(m, emoji)}
                            onCopy={() => copyMessage(m)}
                            onShowReadStatus={() => setReadStatusMessage(m)}
                            onPreviewImages={(images, index) => setImagePreview({ images, index })}
                            actionsOpen={actionMessageId === m.id}
                            onToggleActions={() => setActionMessageId((current) => current === m.id ? null : m.id)}
                          />
                        </Fragment>
                      );
                    })}
                  </>
                )}
                {(newMessageNotice || showJumpLatest) && (
                  <div style={newMessageNoticeWrapStyle}>
                    <button
                      type="button"
                      onClick={() => {
                        setNewMessageNotice(false);
                        setShowJumpLatest(false);
                        shouldStickToBottomRef.current = true;
                        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
                      }}
                      style={newMessageNoticeButtonStyle}
                    >
                      {newMessageNotice ? "새 메시지 보기" : "최신으로"}
                    </button>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <Composer
                draft={draft}
                setDraft={setDraft}
                sending={sending}
                uploading={uploading}
                draggingFiles={draggingFiles}
                attachments={attachments}
                setAttachments={setAttachments}
                replyTarget={replyTarget}
                editing={editing}
                onCancelContext={cancelComposerContext}
                onSend={send}
                onTyping={emitTyping}
                onPickFiles={() => fileInputRef.current?.click()}
                onPasteFiles={(files) => uploadFiles(files)}
                onDropFiles={(files) => uploadFiles(files)}
                onDragFiles={setDraggingFiles}
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
            <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
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
        <ForwardModal
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
          onConfirm={confirm}
        />
      )}
      {readStatusMessage && (
        <ReadStatusModal
          message={readStatusMessage}
          participants={participants}
          onClose={() => setReadStatusMessage(null)}
        />
      )}
      {imagePreview && (
        <ImagePreviewModal
          images={imagePreview.images}
          index={imagePreview.index}
          onChange={(index) => setImagePreview((current) => current ? { ...current, index } : current)}
          onClose={() => setImagePreview(null)}
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
      <Avatar title={conversation.display_title} src={conversation.display_avatar_url} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={chatTitleRowStyle}>
          <span style={chatTitleStyle}>{conversation.display_title}</span>
          {conversation.is_pinned && <span title="Pinned" style={chatStateBadgeStyle}><Pin size={11} /></span>}
          {conversation.is_favorite && <span title="Favorite" style={chatStateBadgeStyle}><Star size={11} /></span>}
          {conversation.is_muted && <span title="Muted" style={chatStateBadgeStyle}><VolumeX size={11} /></span>}
        </div>
        <div style={chatSubStyle}>
          {conversation.type === "group" && <Users size={12} strokeWidth={1.8} />}
          {conversation.participant_count}명
          <span style={presenceDotStyle} />
          <span style={{ color: typingNames.length > 0 ? "var(--accent)" : "var(--ink-faint)", fontWeight: 800 }}>
            {statusText}
          </span>
          {participants.length > 0 && <span>· {participants.map((p) => p.name || "이름 없음").join(", ")}</span>}
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

function DateDivider({ label }: { label: string }) {
  return (
    <div style={dateDividerWrapStyle}>
      <span style={dateDividerStyle}>{label}</span>
    </div>
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
  draftText,
  onClick,
}: {
  conversation: MessengerConversation;
  active: boolean;
  mine: string | null;
  draftText: string;
  onClick: () => void;
}) {
  const fromMe = !!conversation.last_sender_id && conversation.last_sender_id === mine;
  const hasDraft = !!draftText.trim();
  const preview = formatConversationPreview(conversation, fromMe, draftText);
  return (
    <button type="button" onClick={onClick} style={{
      ...conversationButtonStyle,
      border: active ? "1px solid rgba(62,90,74,0.35)" : "1px solid transparent",
      background: active ? "var(--accent-soft)" : "transparent",
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
            color: hasDraft ? "var(--accent)" : conversation.unread_count > 0 ? "var(--ink)" : "var(--ink-soft)",
            fontWeight: hasDraft || conversation.unread_count > 0 ? 800 : 600,
          }}>
            {preview}
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
  onReact,
  onCopy,
  onShowReadStatus,
  onPreviewImages,
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
  onReact: (emoji: string) => void;
  onCopy: () => void;
  onShowReadStatus: () => void;
  onPreviewImages: (images: ImagePreviewItem[], index: number) => void;
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
        maxWidth: "min(76%, 620px)",
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

        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, flexDirection: message.is_mine ? "row" : "row-reverse" }}>
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
            onReact={onReact}
            onCopy={onCopy}
          />
          <div style={{
            ...bubbleStyle,
            borderRadius: message.is_mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
            background: message.is_mine ? "var(--accent)" : "var(--card)",
            color: message.is_mine ? "#fff" : "var(--ink)",
            border: message.is_mine ? "none" : "1px solid var(--hairline)",
            opacity: deleted ? 0.72 : 1,
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
            {message.body && <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.body}</div>}
            {message.attachments.length > 0 && (
              <AttachmentList attachments={message.attachments} mine={message.is_mine} onPreviewImages={onPreviewImages} />
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
  onReact,
  onCopy,
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
  onReact: (emoji: string) => void;
  onCopy: () => void;
}) {
  if (deleted) return null;
  return (
    <div className={`message-actions${open ? " open" : ""}`} style={messageActionsStyle}>
      <button type="button" onClick={() => onReact("👍")} title="좋아요" style={miniActionStyle}><SmilePlus size={13} /></button>
      <button type="button" onClick={() => onReact("✅")} title="확인" style={miniTextActionStyle}>✓</button>
      <button type="button" onClick={() => onReact("🙏")} title="감사" style={miniTextActionStyle}>🙏</button>
      {hasText && <button type="button" onClick={onCopy} title="복사" style={miniActionStyle}><Copy size={13} /></button>}
      <button type="button" onClick={onReply} title="답장" style={miniActionStyle}><Reply size={13} /></button>
      <button type="button" onClick={onForward} title="전달" style={miniActionStyle}><Forward size={13} /></button>
      {mine && hasText && <button type="button" onClick={onEdit} title="수정" style={miniActionStyle}><Pencil size={13} /></button>}
      {mine && <button type="button" onClick={onDelete} title="삭제" style={miniActionStyle}><Trash2 size={13} /></button>}
      {!mine && <button type="button" onClick={onReport} title="신고" style={miniActionStyle}><ShieldAlert size={13} /></button>}
    </div>
  );
}

function AttachmentList({
  attachments,
  mine,
  onPreviewImages,
}: {
  attachments: MessengerAttachment[];
  mine: boolean;
  onPreviewImages: (images: ImagePreviewItem[], index: number) => void;
}) {
  const imageAttachments = attachments
    .filter((a) => !!a.mime_type?.startsWith("image/"))
    .map((a) => ({ ...a, url: storageProxyUrl("messenger-attachments", a.file_path) }));

  return (
    <div style={{ display: "grid", gap: 7, marginTop: 8 }}>
      {attachments.map((a) => {
        const url = storageProxyUrl("messenger-attachments", a.file_path);
        const image = !!a.mime_type?.startsWith("image/");
        if (image) {
          const imageIndex = imageAttachments.findIndex((img) => img.file_path === a.file_path);
          return (
            <button
              key={a.id || a.file_path}
              type="button"
              onClick={() => onPreviewImages(imageAttachments, Math.max(0, imageIndex))}
              title={a.file_name}
              style={imageAttachmentButtonStyle}
            >
              <img src={url} alt={a.file_name} loading="lazy" decoding="async" style={imageAttachmentStyle} />
            </button>
          );
        }
        return (
          <a
            key={a.id || a.file_path}
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{
              ...fileAttachmentStyle,
              background: mine ? "rgba(255,255,255,0.14)" : "var(--bg-soft)",
              color: mine ? "#fff" : "var(--ink)",
            }}
          >
            <FileText size={17} strokeWidth={1.8} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={oneLineStyle}>{a.file_name}</span>
              <span style={{ display: "block", opacity: 0.72, fontSize: 10, marginTop: 2 }}>
                {[a.mime_type || "file", formatBytes(a.size_bytes)].filter(Boolean).join(" · ")}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function ImagePreviewModal({
  images,
  index,
  onChange,
  onClose,
}: {
  images: ImagePreviewItem[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const safeIndex = Math.min(Math.max(index, 0), Math.max(images.length - 1, 0));
  const current = images[safeIndex];

  const go = useCallback((delta: number) => {
    if (images.length <= 1) return;
    onChange((safeIndex + delta + images.length) % images.length);
  }, [images.length, onChange, safeIndex]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [go, onClose]);

  if (!current) return null;

  return (
    <div onClick={onClose} style={imagePreviewOverlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={imagePreviewShellStyle}>
        <div style={imagePreviewTopStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={oneLineStyle}>{current.file_name}</div>
            <div style={{ fontSize: 11, opacity: 0.72, marginTop: 2 }}>
              {safeIndex + 1}/{images.length} · {formatBytes(current.size_bytes)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <a href={current.url} download={current.file_name} target="_blank" rel="noreferrer" title="다운로드" style={previewIconButtonStyle}>
              <Download size={17} />
            </a>
            <button type="button" onClick={onClose} title="닫기" style={previewIconButtonStyle}><X size={18} /></button>
          </div>
        </div>
        <div style={imagePreviewBodyStyle}>
          {images.length > 1 && (
            <button type="button" onClick={() => go(-1)} title="이전" style={{ ...previewNavButtonStyle, left: 10 }}>
              <ChevronLeft size={24} />
            </button>
          )}
          <img src={current.url} alt={current.file_name} style={imagePreviewImgStyle} />
          {images.length > 1 && (
            <button type="button" onClick={() => go(1)} title="다음" style={{ ...previewNavButtonStyle, right: 10 }}>
              <ChevronRight size={24} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({
  draft,
  setDraft,
  sending,
  uploading,
  draggingFiles,
  attachments,
  setAttachments,
  replyTarget,
  editing,
  onCancelContext,
  onSend,
  onTyping,
  onPickFiles,
  onPasteFiles,
  onDropFiles,
  onDragFiles,
}: {
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  uploading: boolean;
  draggingFiles: boolean;
  attachments: PendingAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<PendingAttachment[]>>;
  replyTarget: MessengerMessage | null;
  editing: MessengerMessage | null;
  onCancelContext: () => void;
  onSend: () => void;
  onTyping: () => void;
  onPickFiles: () => void;
  onPasteFiles: (files: File[]) => void;
  onDropFiles: (files: File[]) => void;
  onDragFiles: (dragging: boolean) => void;
}) {
  const canSend = !sending && !uploading && (!!draft.trim() || attachments.length > 0);
  const attachmentBytes = attachments.reduce((total, item) => total + (item.size_bytes || 0), 0);

  return (
    <form
      className="messenger-composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!editing) onDragFiles(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onDragFiles(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDragFiles(false);
        if (editing) return;
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length > 0) onDropFiles(files);
      }}
      style={composerStyle}
    >
      {draggingFiles && !editing && (
        <div style={composerDropHintStyle}>
          <Paperclip size={16} strokeWidth={2} />
          <span>파일을 놓아 첨부</span>
        </div>
      )}

      {(replyTarget || editing) && (
        <div style={composerContextStyle}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "var(--accent)" }}>
              {editing ? "메시지 수정" : `${replyTarget?.sender_name || "메시지"}에게 답장`}
            </div>
            <div style={{ ...oneLineStyle, fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
              {editing?.body || replyTarget?.body || "첨부 메시지"}
            </div>
          </div>
          <button type="button" onClick={onCancelContext} style={smallIconButtonStyle}><X size={14} /></button>
        </div>
      )}

      {attachments.length > 0 && !editing && (
        <div style={pendingAttachmentWrapStyle}>
          {attachments.map((a) => (
            <div key={a.file_path} style={pendingAttachmentStyle}>
              {a.local_url ? <img src={a.local_url} alt="" style={pendingThumbStyle} /> : <FileText size={17} />}
              <span style={oneLineStyle}>{a.file_name}</span>
              {a.size_bytes ? <span style={pendingMetaStyle}>{formatBytes(a.size_bytes)}</span> : null}
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.file_path !== a.file_path))}
                style={chipRemoveStyle}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={onPickFiles}
          disabled={uploading || sending || !!editing || attachments.length >= MAX_ATTACHMENTS}
          title="첨부"
          style={composerIconButtonStyle}
        >
          {uploading ? "..." : <Paperclip size={18} strokeWidth={2} />}
        </button>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onTyping();
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files || []);
            if (files.length > 0) {
              onPasteFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          maxLength={4000}
          placeholder={editing ? "수정할 내용을 입력하세요" : "메시지를 입력하세요"}
          style={textareaStyle}
        />
        <button
          type="submit"
          disabled={!canSend}
          style={{
            ...sendButtonStyle,
            opacity: canSend ? 1 : 0.45,
          }}
        >
          {sending ? "..." : <Send size={18} strokeWidth={2} />}
        </button>
      </div>

      <div style={composerStatusRowStyle}>
        <span>
          {uploading ? "첨부 업로드 중" : attachments.length > 0 ? `${attachments.length}/${MAX_ATTACHMENTS}개 · ${formatBytes(attachmentBytes)}` : "메시지 작성 중"}
        </span>
        <span>{draft.length}/4000</span>
      </div>
    </form>
  );
}

function NewConversationModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
  onError: (message: string) => void;
}) {
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
    if (mode === "direct") {
      setSelected([user]);
      return;
    }
    setSelected((prev) => (
      prev.some((u) => u.user_id === user.user_id)
        ? prev.filter((u) => u.user_id !== user.user_id)
        : [...prev, user]
    ));
  };

  const create = async () => {
    if (selected.length === 0 || creating) return;
    setCreating(true);
    try {
      const id = mode === "direct"
        ? await startDirectMessage(selected[0].user_id)
        : await createGroupConversation(title || selected.map((u) => u.name).filter(Boolean).join(", "), selected.map((u) => u.user_id));
      onCreated(id);
    } catch (e) {
      onError(getErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div onClick={onClose} style={modalOverlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div style={sectionTitleStyle}><Plus size={18} strokeWidth={2} /> 새 대화</div>
          <button type="button" onClick={onClose} style={smallIconButtonStyle}><X size={17} /></button>
        </div>

        <div style={modalTabsStyle}>
          <button type="button" onClick={() => { setMode("direct"); setSelected(selected.slice(0, 1)); }} style={mode === "direct" ? tabActiveStyle : tabStyle}>1:1</button>
          <button type="button" onClick={() => setMode("group")} style={mode === "group" ? tabActiveStyle : tabStyle}>그룹</button>
        </div>

        {mode === "group" && (
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="그룹 이름" maxLength={80} style={inputStyle} />
        )}

        <div style={searchBoxStyle}>
          <Search size={16} strokeWidth={1.8} color="var(--ink-faint)" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 또는 직분 검색" style={searchInputStyle} />
        </div>

        {selected.length > 0 && (
          <div style={selectedWrapStyle}>
            {selected.map((u) => (
              <span key={u.user_id} style={selectedChipStyle}>
                {u.name || "이름 없음"}
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
          ) : users.length === 0 ? (
            <EmptyState message="검색 결과가 없습니다." padding={34} />
          ) : (
            users.map((u) => {
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
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>취소</button>
          <button type="button" onClick={create} disabled={selected.length === 0 || creating} style={{
            ...primaryButtonStyle,
            opacity: selected.length === 0 || creating ? 0.45 : 1,
          }}>
            시작
          </button>
        </div>
      </div>
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
  onConfirm,
}: {
  conversation: MessengerConversation;
  participants: MessengerParticipant[];
  myUserId: string | null;
  onClose: () => void;
  onRename: (title: string) => Promise<void>;
  onAddMembers: (userIds: string[]) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onError: (message: string) => void;
  onConfirm: (message: string) => Promise<boolean>;
}) {
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
    setSelected((prev) => (
      prev.some((u) => u.user_id === user.user_id)
        ? prev.filter((u) => u.user_id !== user.user_id)
        : [...prev, user]
    ));
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
    if (!await onConfirm(`${participant.name || "이 멤버"}님을 대화방에서 내보낼까요?`)) return;
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginBottom: 14 }}>
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
                {u.name || "이름 없음"}
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
  const readUserIds = new Set(message.read_by.map((r) => r.user_id));
  const sender = participants.find((p) => p.user_id === message.sender_id);
  const readableParticipants = participants.filter((p) => p.user_id !== message.sender_id);
  const readRows = message.read_by
    .map((receipt) => {
      const participant = participants.find((p) => p.user_id === receipt.user_id);
      return {
        user_id: receipt.user_id,
        name: receipt.name || participant?.name || "이름 없음",
        avatar_url: participant?.avatar_url || null,
        sub_role: participant?.sub_role || null,
        read_at: receipt.read_at,
      };
    })
    .sort((a, b) => String(a.read_at || "").localeCompare(String(b.read_at || "")));
  const unreadRows = readableParticipants.filter((p) => !readUserIds.has(p.user_id));

  return (
    <div onClick={onClose} style={modalOverlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div style={sectionTitleStyle}><Check size={18} strokeWidth={2} /> 읽음 현황</div>
          <button type="button" onClick={onClose} style={smallIconButtonStyle}><X size={17} /></button>
        </div>

        <div style={{ ...replyPreviewStyle, maxWidth: "none", background: "var(--bg-soft)", color: "var(--ink-soft)", marginBottom: 14 }}>
          <div style={{ fontWeight: 900 }}>{sender?.name || message.sender_name || "보낸 사람"}</div>
          <div style={oneLineStyle}>{message.body || "첨부 메시지"}</div>
        </div>

        <div style={sidebarLabelStyle}>읽은 사람 {readRows.length}명</div>
        <div style={{ ...userListStyle, maxHeight: 220, marginBottom: 14 }}>
          {readRows.length === 0 ? (
            <EmptyState message="아직 읽은 사람이 없습니다." padding={24} />
          ) : (
            readRows.map((row) => (
              <div key={row.user_id} style={{ ...userRowStyle, cursor: "default" }}>
                <Avatar title={row.name || "U"} src={row.avatar_url} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={userNameStyle}>{row.name}</div>
                  <div style={userMetaStyle}>{row.read_at ? formatMessageTime(row.read_at) : row.sub_role || "읽음"}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={sidebarLabelStyle}>안 읽은 사람 {unreadRows.length}명</div>
        <div style={{ ...userListStyle, maxHeight: 220 }}>
          {unreadRows.length === 0 ? (
            <EmptyState message="모두 읽었습니다." padding={24} />
          ) : (
            unreadRows.map((row) => (
              <div key={row.user_id} style={{ ...userRowStyle, cursor: "default" }}>
                <Avatar title={row.name || "U"} src={row.avatar_url} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={userNameStyle}>{row.name || "이름 없음"}</div>
                  <div style={userMetaStyle}>{row.sub_role || "미읽음"}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ForwardModal({
  conversations,
  onClose,
  onForward,
}: {
  conversations: MessengerConversation[];
  onClose: () => void;
  onForward: (conversationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = conversations.filter((c) => (
    !query.trim()
    || c.display_title.toLowerCase().includes(query.trim().toLowerCase())
  ));

  return (
    <div onClick={onClose} style={modalOverlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={modalHeaderStyle}>
          <div style={sectionTitleStyle}><Forward size={18} strokeWidth={2} /> 메시지 전달</div>
          <button type="button" onClick={onClose} style={smallIconButtonStyle}><X size={17} /></button>
        </div>
        <div style={searchBoxStyle}>
          <Search size={16} strokeWidth={1.8} color="var(--ink-faint)" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="전달할 대화 검색" style={searchInputStyle} />
        </div>
        <div style={userListStyle}>
          {filtered.length === 0 ? (
            <EmptyState message="전달할 대화가 없습니다." padding={34} />
          ) : filtered.map((c) => (
            <button key={c.conversation_id} type="button" onClick={() => onForward(c.conversation_id)} style={userRowStyle}>
              <Avatar title={c.display_title} src={c.display_avatar_url} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={userNameStyle}>{c.display_title}</div>
                <div style={userMetaStyle}>{c.last_message_body || `${c.participant_count}명`}</div>
              </div>
              <Forward size={16} strokeWidth={2} color="var(--accent)" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Avatar({ title, src }: { title: string; src?: string | null }) {
  const initial = (title || "M").trim().slice(0, 1).toUpperCase();
  if (src) return <img src={src} alt="" style={avatarStyle} />;
  return <div style={avatarFallbackStyle}>{initial}</div>;
}

function sanitizeFileName(name: string): string {
  const clean = name.normalize("NFKC").replace(/[^\w.\-가-힣]/g, "_").slice(0, 90);
  return clean || "attachment";
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
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function isSameMessageDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(d);
}

function formatConversationPreview(conversation: MessengerConversation, fromMe: boolean, draftText = ""): string {
  const draft = draftText.trim();
  if (draft) return `초안: ${draft}`;
  if (!conversation.last_message_id) return "새 대화";
  const body = (conversation.last_message_body || "").trim();
  const content = body || "첨부 메시지";
  return fromMe ? `나: ${content}` : content;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function roleLabel(role: string | null): string {
  if (role === "admin") return "관리자";
  if (role === "office") return "사무";
  if (role === "pastor") return "교역자";
  if (role === "leader") return "리더";
  return "성도";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "처리 중 오류가 발생했습니다.";
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  area.style.top = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

const responsiveCss = `
  .messenger-page {
    margin-top: calc(-1 * var(--body-safe-top, 0px));
    min-height: 100vh;
    min-height: 100dvh;
    height: 100dvh;
    overflow: hidden;
    background: var(--bg-soft);
    color: var(--ink);
    font-family: var(--font-noto-sans-kr), -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .messenger-shell {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr);
    height: calc(100vh - 62px);
    height: calc(100dvh - 62px);
    max-width: 1180px;
    margin: 0 auto;
    border-left: 1px solid var(--hairline);
    border-right: 1px solid var(--hairline);
    background: var(--surface);
  }
  .conversation-list {
    border-right: 1px solid var(--hairline);
    background: var(--card);
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .conversation-panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #fbfaf7;
  }
  .messenger-composer:focus-within {
    border-color: rgba(62,90,74,0.22);
    box-shadow: 0 -10px 28px rgba(26,22,18,0.08);
  }
  .mobile-back { display: none; }
  .message-actions { opacity: 0; pointer-events: none; transform: translateY(3px); transition: opacity .14s ease, transform .14s ease; }
  .message-wrap:hover .message-actions,
  .message-actions.open { opacity: 1; pointer-events: auto; transform: translateY(0); }
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
    .conversation-panel {
      height: 100%;
      display: none;
      min-height: 0;
    }
    .messenger-shell.has-active .conversation-list { display: none; }
    .messenger-shell.has-active .conversation-panel { display: flex; }
    .mobile-back { display: inline-flex; }
    .message-actions { display: none !important; opacity: 1; }
    .message-actions.open { display: inline-flex !important; }
  }
`;

const listStyle: React.CSSProperties = { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 };
const sidebarSearchWrapStyle: React.CSSProperties = { height: 44, margin: "10px 10px 0", borderRadius: 9, border: "1px solid var(--hairline)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 8, padding: "0 10px" };
const sidebarSearchInputStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 13, fontWeight: 700, fontFamily: "inherit" };
const clearSearchButtonStyle: React.CSSProperties = { width: 24, height: 24, border: "none", borderRadius: 6, background: "var(--bg-soft)", color: "var(--ink-faint)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const sidebarLabelStyle: React.CSSProperties = { margin: "8px 4px 6px", fontSize: 11, fontWeight: 900, color: "var(--ink-faint)", letterSpacing: 0.2 };
const searchResultsWrapStyle: React.CSSProperties = { marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid var(--hairline)" };
const searchResultButtonStyle: React.CSSProperties = { width: "100%", border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--surface)", padding: "8px 9px", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 12, lineHeight: 1.35 };
const searchEmptyStyle: React.CSSProperties = { padding: "12px 8px", color: "var(--ink-faint)", fontSize: 12, fontWeight: 700, textAlign: "center" };
const headerStyle: React.CSSProperties = { height: 62, padding: "0 clamp(12px, 4vw, 20px)", borderBottom: "1px solid var(--hairline)", background: "var(--card)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
const headerTitleStyle: React.CSSProperties = { fontSize: 17, fontWeight: 900, color: "var(--ink)", lineHeight: 1.1 };
const headerSubStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--ink-faint)", marginTop: 2 };
const headerButtonStyle: React.CSSProperties = { height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--bg-soft)", color: "var(--ink-mid)", fontSize: 13, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit" };
const errorBarStyle: React.CSSProperties = { position: "fixed", left: "50%", top: 72, transform: "translateX(-50%)", zIndex: 120, maxWidth: "calc(100vw - 24px)", background: "var(--danger-soft)", color: "var(--danger)", border: "1px solid rgba(160, 55, 55, 0.22)", borderRadius: 8, padding: "8px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 800 };
const smallIconButtonStyle: React.CSSProperties = { width: 34, height: 34, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--card)", color: "var(--ink-mid)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 };
const sectionTitleStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 900 };
const listHeaderStyle: React.CSSProperties = { padding: 14, borderBottom: "1px solid var(--hairline)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
const newButtonStyle: React.CSSProperties = { height: 34, padding: "0 10px", border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 900, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "inherit" };
const conversationFilterStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "10px 14px 0" };
const conversationFilterButtonStyle: React.CSSProperties = { minHeight: 30, borderRadius: 999, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink-soft)", fontSize: 12, fontWeight: 850, cursor: "pointer", fontFamily: "inherit" };
const conversationFilterActiveButtonStyle: React.CSSProperties = { ...conversationFilterButtonStyle, borderColor: "rgba(62,90,74,0.34)", background: "var(--accent-soft)", color: "var(--accent)" };
const chatHeaderStyle: React.CSSProperties = { minHeight: 68, padding: "10px 14px", borderBottom: "1px solid var(--hairline)", background: "rgba(255,255,255,0.94)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 0 rgba(43,39,34,0.03)" };
const chatTitleRowStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", gap: 5 };
const chatTitleStyle: React.CSSProperties = { minWidth: 0, fontSize: 16, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const chatStateBadgeStyle: React.CSSProperties = { width: 20, height: 20, borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const chatSubStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink-faint)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const presenceDotStyle: React.CSSProperties = { width: 7, height: 7, borderRadius: 999, background: "#2F9E62", display: "inline-block", flexShrink: 0 };
const conversationMenuStyle: React.CSSProperties = { position: "absolute", top: 40, right: 0, zIndex: 40, width: 180, border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--card)", boxShadow: "0 16px 44px rgba(26,22,18,0.16)", padding: 6 };
const menuActionStyle: React.CSSProperties = { width: "100%", minHeight: 34, border: "none", borderRadius: 7, background: "transparent", display: "flex", alignItems: "center", gap: 8, padding: "0 9px", fontSize: 12, fontWeight: 850, cursor: "pointer", fontFamily: "inherit", textAlign: "left" };
const messageListStyle: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto", padding: "18px clamp(12px, 3vw, 24px)", overscrollBehavior: "contain", backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.58), rgba(251,250,247,0.96))" };
const olderMessagesWrapStyle: React.CSSProperties = { display: "flex", justifyContent: "center", marginBottom: 12 };
const olderMessagesButtonStyle: React.CSSProperties = { minHeight: 32, borderRadius: 999, border: "1px solid var(--hairline)", background: "rgba(255,255,255,0.86)", color: "var(--ink-soft)", padding: "0 12px", fontSize: 12, fontWeight: 850, fontFamily: "inherit", cursor: "pointer", boxShadow: "0 4px 14px rgba(26,22,18,0.06)" };
const newMessageNoticeWrapStyle: React.CSSProperties = { position: "sticky", bottom: 10, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 5 };
const newMessageNoticeButtonStyle: React.CSSProperties = { minHeight: 34, borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", padding: "0 14px", fontSize: 12, fontWeight: 900, fontFamily: "inherit", cursor: "pointer", pointerEvents: "auto", boxShadow: "0 10px 24px rgba(62,90,74,0.28)" };
const conversationButtonStyle: React.CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 8, cursor: "pointer", textAlign: "left", fontFamily: "inherit" };
const conversationTitleStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 900, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const conversationTimeStyle: React.CSSProperties = { fontSize: 11, color: "var(--ink-faint)", flexShrink: 0 };
const conversationPreviewStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const unreadBadgeStyle: React.CSSProperties = { minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 900, flexShrink: 0 };
const avatarStyle: React.CSSProperties = { width: 42, height: 42, borderRadius: "50%", objectFit: "cover", background: "var(--bg-soft)", flexShrink: 0 };
const avatarFallbackStyle: React.CSSProperties = { ...avatarStyle, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 15, fontWeight: 900 };
const senderNameStyle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "var(--ink-soft)", paddingLeft: 2 };
const bubbleStyle: React.CSSProperties = { padding: "9px 12px", fontSize: 14, lineHeight: 1.55, boxShadow: "0 1px 4px rgba(26,22,18,0.04)" };
const replyPreviewStyle: React.CSSProperties = { borderLeft: "3px solid currentColor", borderRadius: 7, padding: "6px 8px", marginBottom: 7, maxWidth: 300 };
const messageMetaStyle: React.CSSProperties = { fontSize: 10, color: "var(--ink-faint)" };
const readStatusButtonStyle: React.CSSProperties = { border: "none", background: "transparent", color: "inherit", padding: 0, font: "inherit", cursor: "pointer" };
const dateDividerWrapStyle: React.CSSProperties = { display: "flex", justifyContent: "center", margin: "10px 0 14px" };
const dateDividerStyle: React.CSSProperties = { minHeight: 24, padding: "0 10px", borderRadius: 999, background: "rgba(43,39,34,0.07)", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 850, boxShadow: "0 1px 0 rgba(255,255,255,0.5) inset" };
const messageActionsStyle: React.CSSProperties = { display: "inline-flex", gap: 3, padding: 4, marginBottom: 2, borderRadius: 999, border: "1px solid rgba(43,39,34,0.08)", background: "rgba(255,255,255,0.94)", boxShadow: "0 8px 22px rgba(26,22,18,0.12)", backdropFilter: "blur(8px)" };
const miniActionStyle: React.CSSProperties = { width: 28, height: 28, borderRadius: 999, border: "none", background: "transparent", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 };
const miniTextActionStyle: React.CSSProperties = { ...miniActionStyle, fontSize: 12, fontWeight: 900, lineHeight: 1 };
const reactionRowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4, maxWidth: "min(76%, 620px)" };
const reactionButtonStyle: React.CSSProperties = { minWidth: 42, height: 25, borderRadius: 999, border: "1px solid var(--hairline)", background: "var(--card)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "0 8px", fontSize: 12, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" };
const imageAttachmentButtonStyle: React.CSSProperties = { display: "block", border: "none", background: "transparent", padding: 0, cursor: "zoom-in", textAlign: "left" };
const imageAttachmentStyle: React.CSSProperties = { display: "block", maxWidth: "min(320px, 60vw)", maxHeight: 260, borderRadius: 8, objectFit: "cover", border: "1px solid rgba(255,255,255,0.18)" };
const fileAttachmentStyle: React.CSSProperties = { minWidth: 220, maxWidth: 320, minHeight: 42, borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, textDecoration: "none", fontSize: 12, fontWeight: 800 };
const oneLineStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const composerStyle: React.CSSProperties = { padding: "12px 12px calc(12px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--hairline)", background: "rgba(255,255,255,0.96)", backdropFilter: "blur(10px)", display: "grid", gap: 8, flexShrink: 0, transition: "box-shadow .16s ease, border-color .16s ease" };
const composerDropHintStyle: React.CSSProperties = { minHeight: 38, border: "1px dashed rgba(62,90,74,0.42)", borderRadius: 12, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12, fontWeight: 900 };
const composerContextStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--hairline)", background: "var(--accent-soft)", borderRadius: 8, padding: "7px 8px" };
const pendingAttachmentWrapStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };
const pendingAttachmentStyle: React.CSSProperties = { maxWidth: 220, height: 34, borderRadius: 8, background: "var(--bg-soft)", border: "1px solid var(--hairline)", display: "inline-flex", alignItems: "center", gap: 6, padding: "0 7px", fontSize: 12, fontWeight: 800, color: "var(--ink-mid)" };
const pendingMetaStyle: React.CSSProperties = { flexShrink: 0, color: "var(--ink-faint)", fontSize: 10, fontWeight: 800 };
const pendingThumbStyle: React.CSSProperties = { width: 24, height: 24, borderRadius: 5, objectFit: "cover" };
const composerIconButtonStyle: React.CSSProperties = { width: 44, height: 44, border: "1px solid var(--hairline)", borderRadius: 999, background: "var(--surface)", color: "var(--ink-mid)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const textareaStyle: React.CSSProperties = { flex: 1, minHeight: 44, maxHeight: 140, resize: "none", border: "1px solid var(--hairline)", borderRadius: 18, padding: "11px 14px", fontSize: 14, lineHeight: 1.45, color: "var(--ink)", outline: "none", fontFamily: "inherit", background: "var(--surface)", boxShadow: "0 1px 0 rgba(255,255,255,0.6) inset" };
const sendButtonStyle: React.CSSProperties = { width: 44, height: 44, border: "none", borderRadius: 999, background: "var(--accent)", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 8px 20px rgba(62,90,74,0.22)" };
const composerStatusRowStyle: React.CSSProperties = { minHeight: 16, display: "flex", justifyContent: "space-between", gap: 10, color: "var(--ink-faint)", fontSize: 10, fontWeight: 750, padding: "0 4px" };
const chipRemoveStyle: React.CSSProperties = { width: 18, height: 18, border: "none", background: "transparent", color: "inherit", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 };
const modalOverlayStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 200, background: "rgba(43,39,34,0.48)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const modalStyle: React.CSSProperties = { width: "min(560px, 100%)", maxHeight: "min(720px, calc(100vh - 32px))", overflowY: "auto", background: "var(--card)", borderRadius: 10, border: "1px solid var(--hairline)", boxShadow: "0 24px 70px rgba(26,22,18,0.22)", padding: 16 };
const imagePreviewOverlayStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 260, background: "rgba(20,18,16,0.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14 };
const imagePreviewShellStyle: React.CSSProperties = { width: "min(960px, 100%)", height: "min(760px, calc(100vh - 28px))", borderRadius: 10, overflow: "hidden", background: "#12100e", color: "#fff", boxShadow: "0 24px 80px rgba(0,0,0,0.42)", display: "flex", flexDirection: "column" };
const imagePreviewTopStyle: React.CSSProperties = { minHeight: 52, padding: "9px 11px", borderBottom: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 13, fontWeight: 850 };
const imagePreviewBodyStyle: React.CSSProperties = { position: "relative", flex: 1, minHeight: 0, display: "grid", placeItems: "center", padding: 10 };
const imagePreviewImgStyle: React.CSSProperties = { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 };
const previewIconButtonStyle: React.CSSProperties = { width: 36, height: 36, borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const previewNavButtonStyle: React.CSSProperties = { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 42, height: 42, borderRadius: 999, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.34)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const modalHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 };
const modalTabsStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 };
const tabStyle: React.CSSProperties = { height: 38, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink-soft)", fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" };
const tabActiveStyle: React.CSSProperties = { ...tabStyle, borderColor: "rgba(62,90,74,0.35)", background: "var(--accent-soft)", color: "var(--accent)" };
const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", height: 40, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink)", fontSize: 14, fontWeight: 700, padding: "0 12px", marginBottom: 10, outline: "none", fontFamily: "inherit" };
const searchBoxStyle: React.CSSProperties = { height: 42, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", marginBottom: 10 };
const searchInputStyle: React.CSSProperties = { flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontSize: 14, fontFamily: "inherit" };
const selectedWrapStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 };
const selectedChipStyle: React.CSSProperties = { height: 26, padding: "0 6px 0 9px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 900 };
const userListStyle: React.CSSProperties = { maxHeight: 340, overflowY: "auto", border: "1px solid var(--hairline)", borderRadius: 8 };
const userRowStyle: React.CSSProperties = { width: "100%", minHeight: 62, border: "none", borderBottom: "1px solid var(--hairline)", background: "transparent", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" };
const userNameStyle: React.CSSProperties = { fontSize: 14, fontWeight: 900, color: "var(--ink)" };
const userMetaStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--ink-faint)", marginTop: 2 };
const modalFooterStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 };
const primaryButtonStyle: React.CSSProperties = { height: 38, padding: "0 16px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" };
const secondaryButtonStyle: React.CSSProperties = { ...primaryButtonStyle, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--ink-mid)" };
