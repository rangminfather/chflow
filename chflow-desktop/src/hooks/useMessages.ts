import { useCallback, useEffect, useRef, useState } from "react";
import { messengerApi, realtime } from "@/services/messenger";
import type { MessengerMessage } from "@shared/messenger-types";
import { errMsg } from "@/utils/error";

const PAGE = 50;

function sortByCreated(a: MessengerMessage, b: MessengerMessage): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

export function useMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const oldestRef = useRef<string | null>(null);

  // id 기준 병합(중복 이벤트/재조회 방지) + 시간순 정렬.
  const mergeById = useCallback((incoming: MessengerMessage[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      const arr = Array.from(map.values()).sort(sortByCreated);
      oldestRef.current = arr.length ? arr[0].created_at : null;
      return arr;
    });
  }, []);

  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMore || !oldestRef.current) return;
    setLoadingOlder(true);
    try {
      const rows = await messengerApi.getMessages(conversationId, {
        limit: PAGE,
        before: oldestRef.current,
      });
      if (rows.length === 0) setHasMore(false);
      else {
        mergeById(rows);
        if (rows.length < PAGE) setHasMore(false);
      }
    } catch (e) {
      setError(errMsg(e, "이전 메시지를 불러오지 못했습니다"));
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadingOlder, hasMore, mergeById]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      oldestRef.current = null;
      setHasMore(true);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    setHasMore(true);

    (async () => {
      try {
        const rows = await messengerApi.getMessages(conversationId, { limit: PAGE });
        if (!active) return;
        setMessages(rows);
        oldestRef.current = rows.length ? rows[0].created_at : null;
        setHasMore(rows.length >= PAGE);
      } catch (e) {
        if (active) setError(errMsg(e, "메시지를 불러오지 못했습니다"));
      } finally {
        if (active) setLoading(false);
      }
    })();

    // 읽음 처리(실패해도 치명적 아님).
    messengerApi.markRead(conversationId).catch(() => {});

    // 검증 가능한 최소 Realtime: 새 메시지 INSERT 시 최근 페이지만 재조회 후 병합.
    const unsub = realtime.subscribeRoom(conversationId, () => {
      messengerApi
        .getMessages(conversationId, { limit: 20 })
        .then((rows) => {
          if (active) mergeById(rows);
        })
        .catch(() => {});
    });

    return () => {
      active = false;
      unsub();
    };
  }, [conversationId, mergeById]);

  return { messages, loading, loadingOlder, hasMore, error, loadOlder, mergeById };
}
