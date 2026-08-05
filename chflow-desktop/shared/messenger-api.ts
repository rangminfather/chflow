// ⚠️ 임시 이식 — 원본: chflow-app/lib/messenger.ts (2026-06-18 복제)
// RPC 계약(함수명·파라미터·반환형)을 임의로 변경하지 말 것 (웹과 분기 방지).
// 차이: 웹은 싱글톤 supabase import, 데스크톱은 client 주입 팩토리.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MessengerConversation,
  MessengerMessage,
  MessengerParticipant,
  MessengerSearchResult,
  MessengerUser,
  MessengerAttachment,
} from "./messenger-types";

export function createMessengerApi(client: SupabaseClient) {
  return {
    async listConversations(): Promise<MessengerConversation[]> {
      const { data, error } = await client.rpc("list_messenger_conversations");
      if (error) throw error;
      return (data || []) as MessengerConversation[];
    },

    /**
     * 최근 메시지 조회. p_before 커서를 넘기면 그 시각 이전(과거) 메시지를 가져온다.
     * 반환은 created_at 오름차순(오래된→최신)으로 정렬해 돌려준다.
     * (웹 동작과 동일: RPC는 최신순 반환 → reverse)
     */
    async getMessages(
      conversationId: string,
      opts: { limit?: number; before?: string | null } = {}
    ): Promise<MessengerMessage[]> {
      const { data, error } = await client.rpc("get_messenger_messages_v2", {
        p_conversation_id: conversationId,
        p_limit: opts.limit ?? 50,
        p_before: opts.before ?? null,
      });
      if (error) throw error;
      return ((data || []) as MessengerMessage[]).slice().reverse();
    },

    async getParticipants(conversationId: string): Promise<MessengerParticipant[]> {
      const { data, error } = await client.rpc("get_messenger_participants", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      return (data || []) as MessengerParticipant[];
    },

    async sendMessage(
      conversationId: string,
      body: string,
      replyToId: string | null = null,
      attachments: MessengerAttachment[] = []
    ): Promise<string> {
      const { data, error } = await client.rpc("send_messenger_message_v2", {
        p_conversation_id: conversationId,
        p_body: body,
        p_reply_to_id: replyToId,
        p_attachments: attachments,
      });
      if (error) throw error;
      return data as string;
    },

    async markRead(conversationId: string): Promise<void> {
      const { error } = await client.rpc("mark_messenger_read", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
    },

    async searchUsers(query: string, limit = 20): Promise<MessengerUser[]> {
      const { data, error } = await client.rpc("search_messenger_users", {
        p_query: query,
        p_limit: limit,
      });
      if (error) throw error;
      return (data || []) as MessengerUser[];
    },

    async searchMessages(query: string, limit = 30): Promise<MessengerSearchResult[]> {
      const { data, error } = await client.rpc("search_messenger_messages", {
        p_query: query,
        p_limit: limit,
      });
      if (error) throw error;
      return (data || []) as MessengerSearchResult[];
    },

    async startDirectMessage(userId: string): Promise<string> {
      const { data, error } = await client.rpc("start_direct_message", {
        p_user_id: userId,
      });
      if (error) throw error;
      return data as string;
    },
  };
}

export type MessengerApi = ReturnType<typeof createMessengerApi>;
