import { supabase } from "./supabase";

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

export type MessengerReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

export type MessengerReport = {
  report_id: string;
  status: MessengerReportStatus;
  reason: string;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
  conversation_id: string | null;
  message_id: string | null;
  message_body: string | null;
  reporter_id: string;
  reporter_name: string | null;
  reported_user_id: string | null;
  reported_user_name: string | null;
};

export async function listMessengerConversations(): Promise<MessengerConversation[]> {
  const { data, error } = await supabase.rpc("list_messenger_conversations");
  if (error) throw error;
  return (data || []) as MessengerConversation[];
}

export async function getMessengerMessages(conversationId: string, limit = 60, before: string | null = null): Promise<MessengerMessage[]> {
  const { data, error } = await supabase.rpc("get_messenger_messages_v2", {
    p_conversation_id: conversationId,
    p_limit: limit,
    p_before: before,
  });
  if (error) throw error;
  return ((data || []) as MessengerMessage[]).reverse();
}

export async function getMessengerParticipants(conversationId: string): Promise<MessengerParticipant[]> {
  const { data, error } = await supabase.rpc("get_messenger_participants", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return (data || []) as MessengerParticipant[];
}

export async function searchMessengerUsers(query: string, limit = 20): Promise<MessengerUser[]> {
  const { data, error } = await supabase.rpc("search_messenger_users", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;
  return (data || []) as MessengerUser[];
}

export async function searchMessengerMessages(query: string, limit = 30): Promise<MessengerSearchResult[]> {
  const { data, error } = await supabase.rpc("search_messenger_messages", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;
  return (data || []) as MessengerSearchResult[];
}

export async function startDirectMessage(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_direct_message", {
    p_user_id: userId,
  });
  if (error) throw error;
  return data as string;
}

export async function createGroupConversation(title: string, participantIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc("create_group_conversation", {
    p_title: title,
    p_participant_ids: participantIds,
  });
  if (error) throw error;
  return data as string;
}

export async function renameGroupConversation(conversationId: string, title: string): Promise<void> {
  const { error } = await supabase.rpc("rename_group_conversation", {
    p_conversation_id: conversationId,
    p_title: title,
  });
  if (error) throw error;
}

export async function addGroupParticipants(conversationId: string, participantIds: string[]): Promise<void> {
  const { error } = await supabase.rpc("add_group_participants", {
    p_conversation_id: conversationId,
    p_participant_ids: participantIds,
  });
  if (error) throw error;
}

export async function removeGroupParticipant(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_group_participant", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function sendMessengerMessage(
  conversationId: string,
  body: string,
  replyToId: string | null = null,
  attachments: MessengerAttachment[] = []
): Promise<string> {
  const { data, error } = await supabase.rpc("send_messenger_message_v2", {
    p_conversation_id: conversationId,
    p_body: body,
    p_reply_to_id: replyToId,
    p_attachments: attachments,
  });
  if (error) throw error;
  return data as string;
}

export async function markMessengerRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_messenger_read", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

export async function editMessengerMessage(messageId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("edit_messenger_message", {
    p_message_id: messageId,
    p_body: body,
  });
  if (error) throw error;
}

export async function deleteMessengerMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_messenger_message", {
    p_message_id: messageId,
  });
  if (error) throw error;
}

export async function setMessengerConversationState(
  conversationId: string,
  state: {
    pinned?: boolean | null;
    favorite?: boolean | null;
    muted?: boolean | null;
    archived?: boolean | null;
  }
): Promise<void> {
  const { error } = await supabase.rpc("set_messenger_conversation_state", {
    p_conversation_id: conversationId,
    p_pinned: state.pinned ?? null,
    p_favorite: state.favorite ?? null,
    p_muted: state.muted ?? null,
    p_archived: state.archived ?? null,
  });
  if (error) throw error;
}

export async function reportMessengerMessage(messageId: string, reason: string, note = ""): Promise<string> {
  const { data, error } = await supabase.rpc("report_messenger_message", {
    p_message_id: messageId,
    p_reason: reason,
    p_note: note,
  });
  if (error) throw error;
  return data as string;
}

export async function blockMessengerUser(userId: string, reason = ""): Promise<void> {
  const { error } = await supabase.rpc("block_messenger_user", {
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function unblockMessengerUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("unblock_messenger_user", {
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function forwardMessengerMessage(messageId: string, targetConversationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("forward_messenger_message", {
    p_message_id: messageId,
    p_target_conversation_id: targetConversationId,
  });
  if (error) throw error;
  return data as string;
}

export async function toggleMessengerReaction(messageId: string, emoji: string): Promise<void> {
  const { error } = await supabase.rpc("toggle_messenger_reaction", {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error) throw error;
}

export async function leaveMessengerConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_messenger_conversation", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

export async function listMessengerReports(status: MessengerReportStatus | "" = "open", limit = 50): Promise<MessengerReport[]> {
  const { data, error } = await supabase.rpc("list_messenger_reports", {
    p_status: status,
    p_limit: limit,
  });
  if (error) throw error;
  return (data || []) as MessengerReport[];
}

export async function resolveMessengerReport(
  reportId: string,
  status: MessengerReportStatus,
  note = ""
): Promise<void> {
  const { error } = await supabase.rpc("resolve_messenger_report", {
    p_report_id: reportId,
    p_status: status,
    p_note: note,
  });
  if (error) throw error;
}
