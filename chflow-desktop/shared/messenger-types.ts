// ⚠️ 임시 이식 — 원본: chflow-app/lib/messenger.ts (2026-06-18 복제)
// RPC 계약(타입)을 임의로 변경하지 말 것. 웹 변경 시 수동 동기화 필요.
// 후속: supabase gen types 로 대체 검토 → 공통 패키지 추출(별도 단계).

export type MessengerUser = {
  user_id: string;
  name: string | null;
  sub_role: string | null;
  role: string | null;
  avatar_url: string | null;
};

export type MessengerConversation = {
  conversation_id: string;
  type: "direct" | "group";
  title: string | null;
  display_title: string;
  display_avatar_url: string | null;
  participant_count: number;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  unread_count: number;
  updated_at: string;
  is_pinned?: boolean;
  is_favorite?: boolean;
  is_muted?: boolean;
  archived_at?: string | null;
};

export type MessengerParticipant = {
  user_id: string;
  name: string | null;
  sub_role: string | null;
  avatar_url: string | null;
  role: "owner" | "member";
  last_read_at: string | null;
};

export type MessengerMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string | null;
  sender_avatar_url: string | null;
  body: string;
  kind: "text" | "system";
  reply_to_id: string | null;
  reply_to: MessengerReply | null;
  attachments: MessengerAttachment[];
  read_by: MessengerReadReceipt[];
  reactions: MessengerReaction[];
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  is_mine: boolean;
};

export type MessengerReply = {
  id: string;
  sender_id: string;
  sender_name: string | null;
  body: string;
  deleted_at: string | null;
};

export type MessengerAttachment = {
  id?: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  width?: number | null;
  height?: number | null;
};

export type MessengerReadReceipt = {
  user_id: string;
  name: string | null;
  read_at: string | null;
};

export type MessengerReaction = {
  emoji: string;
  count: number;
  mine: boolean;
  names: string[];
};

export type MessengerSearchResult = {
  conversation_id: string;
  conversation_title: string;
  message_id: string;
  sender_id: string;
  sender_name: string | null;
  body: string;
  created_at: string;
};
