// Realtime — 3단계는 "검증 가능한 최소 수신"만.
//
// 채택: 열린 방 단위(per-room) postgres_changes 구독(웹과 동일 패턴, RLS 검증된 경로).
// 미채택(★검증 대상 후보안 Q-1): 상시 "인박스 단일 채널"로 전체 목록을 갱신하는 구조.
//   - postgres_changes + RLS 가 "내 대화방만" 전달하는지, 미참여방 유출 없는지,
//     웹+데스크톱 동시 중복, 재연결/재마운트 중복 구독을 실측 검증한 뒤에만 채택.
//   - 문제/비용 시 폴백: DB trigger + private Broadcast `user:{userId}` 토픽.
//
// 메트릭 주의: "채널 수"와 "실제 WebSocket 연결 수"는 다르다. Supabase 클라이언트는
// 보통 소켓 1개에 채널을 멀티플렉싱한다. 아래 channelCount 는 채널 수만 센다.

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type NewMessageHandler = (payload: { id: string; conversation_id: string }) => void;

export class RealtimeManager {
  private client: SupabaseClient;
  private roomChannel: RealtimeChannel | null = null;
  private roomId: string | null = null;
  // 중복 이벤트 방지(idempotent): 이미 처리한 message id.
  private seen = new Set<string>();
  // 구독 토큰 — 재마운트/경합 시 stale 콜백 무시용.
  private token = 0;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  /** 현재 채널 수(소켓 수 아님). 측정/디버그용. */
  channelCount(): number {
    return this.client.getChannels().length;
  }

  /**
   * 열린 방의 새 메시지를 수신. 같은 방 재호출 시 기존 구독을 정리하고 재구독(중복 방지).
   * 반환된 함수를 호출해 정리한다.
   */
  subscribeRoom(conversationId: string, onInsert: NewMessageHandler): () => void {
    // 같은 방 재구독 방지: 이미 그 방이면 아무 것도 하지 않음.
    if (this.roomId === conversationId && this.roomChannel) {
      return () => this.unsubscribeRoom();
    }
    this.unsubscribeRoom();

    const myToken = ++this.token;
    this.roomId = conversationId;
    this.seen.clear();

    const channel = this.client
      .channel(`room:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messenger_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (myToken !== this.token) return; // stale
          const row = payload.new as { id?: string; conversation_id?: string };
          if (!row?.id || this.seen.has(row.id)) return;
          this.seen.add(row.id);
          onInsert({ id: row.id, conversation_id: row.conversation_id || conversationId });
        }
      )
      .subscribe();

    this.roomChannel = channel;
    return () => this.unsubscribeRoom();
  }

  unsubscribeRoom(): void {
    if (this.roomChannel) {
      this.client.removeChannel(this.roomChannel);
      this.roomChannel = null;
    }
    this.roomId = null;
    this.seen.clear();
    this.token++;
  }

  /** 로그아웃/종료 시 전체 정리. */
  dispose(): void {
    this.unsubscribeRoom();
    this.client.removeAllChannels();
  }
}
