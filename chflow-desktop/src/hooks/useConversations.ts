import { useCallback, useEffect, useRef, useState } from "react";
import { messengerApi } from "@/services/messenger";
import type { MessengerConversation } from "@shared/messenger-types";
import { errMsg } from "@/utils/error";

export function useConversations() {
  const [items, setItems] = useState<MessengerConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const rows = await messengerApi.listConversations();
      setItems(rows);
    } catch (e) {
      setError(errMsg(e, "대화방 목록을 불러오지 못했습니다"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Q-1: 이벤트 1건마다 목록 RPC 무조건 재호출 금지 → 400ms debounce 로 합쳐서 호출.
  const refreshDebounced = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void refresh();
    }, 400);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [refresh]);

  return { items, loading, error, refresh, refreshDebounced };
}
