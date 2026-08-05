// 앱 전체 단일 Supabase 클라이언트(싱글톤).
// 설계 기준: 컴포넌트/화면/채팅방마다 새 클라이언트 생성 금지 (Supabase 사용량 절감).
//
// auth.storage 에 custom secure storage 어댑터를 "생성 시점부터" 주입한다(Q-2).
// HMR 로 재생성되지 않도록 globalThis 캐시에 보관한다.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";
import { secureStorage } from "./secureStorage";

const GLOBAL_KEY = "__chflow_supabase__";

function build(): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: secureStorage,
      persistSession: true,
      autoRefreshToken: true,
      // 데스크톱은 OAuth URL 리디렉트가 없음 → 비활성.
      detectSessionInUrl: false,
      // 명시적 키(보안 저장소 키와 1:1 매칭, 점검 용이).
      storageKey: "chflow-desktop-auth",
    },
    realtime: {
      // 이벤트 폭주 방지(typing 등). 채널 수 != 소켓 수 — 소켓은 보통 1개.
      params: { eventsPerSecond: 5 },
    },
  });
}

const g = globalThis as unknown as { [GLOBAL_KEY]?: SupabaseClient };

export const supabase: SupabaseClient = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = build());
